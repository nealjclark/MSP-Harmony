import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import {
  DattoClient,
  dattoCredentialsFromSettings,
  dattoIntegrationId,
  type DattoBcdrAgent,
  type DattoSaasDomain,
  type DattoSaasUsageSummary,
} from './client';
import {
  buildDattoRuleSet,
  dattoProductNameForSaasProductLine,
  defaultDattoProductMappings,
  isDattoProductMappingKey,
  type DattoProductMapping,
  type DattoProductMappingKey,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type DattoUsageClient = {
  listBcdrProtectedAgents: (options?: { pageSize?: number; maxPages?: number }) => Promise<DattoBcdrAgent[]>;
  listSaasDomains: (options?: { pageSize?: number; maxPages?: number }) => Promise<DattoSaasDomain[]>;
  listSaasUsageSummaries: (options?: {
    pageSize?: number;
    maxPages?: number;
    seatPageSize?: number;
    seatMaxPages?: number;
  }) => Promise<DattoSaasUsageSummary[]>;
};

export type DattoConnectionTestResult = {
  integrationId: typeof dattoIntegrationId;
  testedAt: string;
  bcdrAgentCount: number;
  sampleBcdrAgents: Array<{ customerName?: string; deviceHostname?: string; agentName?: string }>;
  saasDomainCount: number;
  sampleSaasDomains: Array<{ saasCustomerId?: string; customerName?: string; domain?: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type DattoUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  bcdrAgentsRead: number;
  saasSeatQuantityRead: number;
  saasSummaryRowsRead: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedSnapshots: number;
  productSnapshots: Record<string, number>;
};

type VendorAccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string | null;
};

type VendorProductMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

type DattoAccountMapping = {
  customerId: string;
  agreementId?: string;
};

export async function testDattoConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: DattoUsageClient;
  now?: string;
} = {}): Promise<DattoConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(dattoIntegrationId);
  assertDattoReady(settings);

  const client = input.client ?? createDattoClient(settings);
  const [bcdrAgents, saasDomains] = await Promise.all([
    client.listBcdrProtectedAgents(),
    client.listSaasDomains({ pageSize: 25, maxPages: 1 }),
  ]);

  return {
    integrationId: dattoIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    bcdrAgentCount: bcdrAgents.length,
    sampleBcdrAgents: bcdrAgents.slice(0, 5).map((agent) => ({
      customerName: agent.customerName,
      deviceHostname: agent.deviceHostname,
      agentName: agent.agentName,
    })),
    saasDomainCount: saasDomains.length,
    sampleSaasDomains: saasDomains.slice(0, 5).map((domain) => ({
      saasCustomerId: domain.saasCustomerId,
      customerName: domain.customerName,
      domain: domain.domain,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncDattoUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: DattoUsageClient;
  pageSize?: number;
  maxPages?: number;
  seatPageSize?: number;
  seatMaxPages?: number;
  includeBcdr?: boolean;
  dataset?: 'bcdr' | 'saas';
  now?: string;
}): Promise<DattoUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(dattoIntegrationId);
  assertDattoReady(settings);
  const includeBcdr = input.dataset ? input.dataset === 'bcdr' : input.includeBcdr === true;
  const includeSaas = input.dataset !== 'bcdr';

  const observedAt = input.now ?? new Date().toISOString();
  const operationKey = input.dataset === 'bcdr' ? 'datto-bcdr' : input.dataset === 'saas' ? 'datto-saas' : 'usage-snapshots';
  const dataSourceKey = input.dataset === 'bcdr' ? 'datto-bcdr-agents' : input.dataset === 'saas' ? 'datto-saas-seats' : undefined;
  const syncRunId = await startDattoSyncRun(input.pool, operationKey, dataSourceKey);
  const client = input.client ?? createDattoClient(settings);

  try {
    const [accountMappings, productMappings, bcdrAgents, saasSummaries] = await Promise.all([
      loadDattoAccountMappings(input.pool),
      loadDattoProductMappings(input.pool),
      includeBcdr ? client.listBcdrProtectedAgents({ pageSize: input.pageSize, maxPages: input.maxPages }) : Promise.resolve([]),
      includeSaas
        ? client.listSaasUsageSummaries({
            pageSize: input.pageSize,
            maxPages: input.maxPages,
            seatPageSize: input.seatPageSize,
            seatMaxPages: input.seatMaxPages,
          })
        : Promise.resolve([]),
    ]);

    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedSnapshots = 0;
    const productSnapshots: Record<string, number> = {};

    for (const agent of bcdrAgents) {
      const vendorProductKey = 'datto-bcdr-agent';
      const productMapping = productMappings[vendorProductKey];
      const externalAccountId = externalAccountIdForBcdrAgent(agent);
      if (!externalAccountId) {
        skippedSnapshots += 1;
        continue;
      }

      const accountMapping = accountMappings.get(externalAccountId);
      const mapped = Boolean(accountMapping?.customerId && accountMapping.agreementId);
      if (mapped) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      productSnapshots[vendorProductKey] = (productSnapshots[vendorProductKey] ?? 0) + 1;

      await insertDattoUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId,
        externalAccountId,
        vendorProductKey,
        productCode: productMapping.productCode,
        productName: productMapping.productName,
        quantity: 1,
        observedAt,
        dimensions: dimensionsForBcdrAgent(agent),
        rawPayload: agent.raw,
      });
      recordsWritten += 1;
    }

    for (const summary of saasSummaries) {
      if (!isDattoProductMappingKey(summary.productKey) || summary.quantity <= 0) {
        skippedSnapshots += 1;
        continue;
      }

      const productMapping = productMappings[summary.productKey] ?? defaultSaasProductMapping(summary);
      const externalAccountId = externalAccountIdForSaasSummary(summary);
      if (!externalAccountId) {
        skippedSnapshots += 1;
        continue;
      }

      const accountMapping = accountMappings.get(externalAccountId);
      const mapped = Boolean(accountMapping?.customerId && accountMapping.agreementId);
      if (mapped) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      productSnapshots[summary.productKey] = (productSnapshots[summary.productKey] ?? 0) + 1;

      await insertDattoUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId,
        externalAccountId,
        vendorProductKey: summary.productKey,
        productCode: productMapping.productCode,
        productName: productMapping.productName,
        quantity: summary.quantity,
        observedAt,
        dimensions: dimensionsForSaasSummary(summary),
        rawPayload: summary.raw,
      });
      recordsWritten += 1;
    }

    const saasSeatQuantityRead = saasSummaries.reduce((total, summary) => total + summary.quantity, 0);
    const recordsRead = bcdrAgents.length + saasSeatQuantityRead;

    await completeDattoSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'usage-snapshots',
      bcdrAgentsRead: bcdrAgents.length,
      includeBcdr,
      saasSeatQuantityRead,
      saasSummaryRowsRead: saasSummaries.length,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
      productMappings: productMappingMetadata(productMappings),
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      bcdrAgentsRead: bcdrAgents.length,
      saasSeatQuantityRead,
      saasSummaryRowsRead: saasSummaries.length,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
    };
  } catch (error) {
    await failDattoSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertDattoReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `Datto Backup settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadDattoProductMappings(
  database: Queryable,
): Promise<Record<DattoProductMappingKey, DattoProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
    [dattoIntegrationId],
  );
  const mappings = { ...defaultDattoProductMappings };
  const rowsByKey = new Map<DattoProductMappingKey, VendorProductMappingRow[]>();

  for (const row of result.rows) {
    if (!isDattoProductMappingKey(row.vendor_product_key)) {
      continue;
    }

    rowsByKey.set(row.vendor_product_key, [...(rowsByKey.get(row.vendor_product_key) ?? []), row]);
  }

  for (const [vendorProductKey, rows] of rowsByKey.entries()) {
    const orderedRows = [...rows].sort(
      (left, right) =>
        integerValue(left.target_index) - integerValue(right.target_index) ||
        left.connectwise_product_code.localeCompare(right.connectwise_product_code),
    );
    const primary = orderedRows[0];
    if (!primary) {
      continue;
    }

    mappings[vendorProductKey] = {
      vendorProductKey,
      productCode: primary.connectwise_product_code,
      productName: primary.connectwise_product_name,
      targetProductCodes: [...new Set(orderedRows.map((row) => row.connectwise_product_code))],
      unitPrice: nullableMoney(primary.unit_price),
    };
  }

  return mappings;
}

export async function loadDattoRuleSet(database: Queryable) {
  return buildDattoRuleSet(await loadDattoProductMappings(database));
}

function createDattoClient(settings: IntegrationRuntimeSettings) {
  return new DattoClient(dattoCredentialsFromSettings(settings));
}

async function loadDattoAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'`,
    [dattoIntegrationId],
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id ?? undefined,
      } satisfies DattoAccountMapping,
    ]),
  );
}

async function startDattoSyncRun(database: Queryable, operationKey: string, dataSourceKey?: string) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [dattoIntegrationId, JSON.stringify({ entity: 'usage-snapshots', operationKey, dataSourceKey })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create Datto Backup usage snapshot sync run.');
  }

  return syncRunId;
}

async function insertDattoUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId: string;
    vendorProductKey: DattoProductMappingKey;
    productCode: string;
    productName: string;
    quantity: number;
    observedAt: string;
    dimensions: Record<string, unknown>;
    rawPayload: unknown;
  },
) {
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id,
       vendor_id,
       customer_id,
       agreement_id,
       external_account_id,
       vendor_product_key,
       product_code,
       product_name,
       quantity,
       observed_at,
       dimensions,
       raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
    [
      input.syncRunId,
      dattoIntegrationId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.quantity,
      input.observedAt,
      JSON.stringify(input.dimensions),
      JSON.stringify(input.rawPayload ?? {}),
    ],
  );
}

async function completeDattoSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete',
         completed_at = now(),
         records_read = $2,
         records_written = $3,
         metadata = metadata || $4::jsonb
     where id = $1`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failDattoSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function externalAccountIdForBcdrAgent(agent: DattoBcdrAgent) {
  return agent.customerName ?? agent.organizationId ?? agent.deviceHostname ?? agent.agentUuid ?? agent.deviceSerial;
}

function externalAccountIdForSaasSummary(summary: DattoSaasUsageSummary) {
  const accountKey = summary.saasCustomerId ?? summary.customerName ?? summary.domain;
  return accountKey ? `${accountKey}|${summary.productKey}` : undefined;
}

function dimensionsForBcdrAgent(agent: DattoBcdrAgent) {
  return {
    dattoProductFamily: 'bcdr',
    dattoExternalAccountName: dattoExternalAccountNameForBcdrAgent(agent),
    dattoOrganizationId: agent.organizationId,
    dattoCustomerName: agent.customerName,
    dattoAgentUuid: agent.agentUuid,
    dattoAssetId: agent.assetId,
    dattoAgentShortCode: agent.shortCode,
    dattoDeviceHostname: agent.deviceHostname,
    dattoDeviceSerial: agent.deviceSerial,
    dattoDeviceModel: agent.deviceModel,
    dattoAgentName: agent.agentName,
    dattoAgentHostname: agent.agentHostname,
    dattoAgentType: agent.agentType,
    dattoAgentVersion: agent.agentVersion,
    dattoProtectedVolumesCount: agent.protectedVolumesCount,
    dattoUnprotectedVolumesCount: agent.unprotectedVolumesCount,
    dattoProtectedVolumeNames: agent.protectedVolumeNames,
    dattoUnprotectedVolumeNames: agent.unprotectedVolumeNames,
    dattoIsPaused: agent.isPaused,
    dattoIsArchived: agent.isArchived,
    dattoLatestOffsite: agent.latestOffsite,
    dattoLocalSnapshots: agent.localSnapshots,
    dattoLastSnapshot: agent.lastSnapshot,
    dattoLastScreenshot: agent.lastScreenshot,
    dattoScreenshotSuccess: agent.screenshotSuccess,
    volumeName: agent.volumeName,
    shadowProtectVersion: agent.shadowProtectVersion,
    operatingSystem: agent.operatingSystem,
  };
}

function dimensionsForSaasSummary(summary: DattoSaasUsageSummary) {
  return {
    dattoProductFamily: 'saas',
    dattoExternalAccountName: dattoExternalAccountNameForSaasSummary(summary),
    dattoSaasProductKey: summary.productKey,
    dattoSaasProductType: summary.productType,
    dattoSaasRetentionType: summary.retentionType,
    dattoSaasCustomerId: summary.saasCustomerId,
    dattoOrganizationId: summary.organizationId,
    externalSubscriptionId: summary.externalSubscriptionId,
    dattoCustomerName: summary.customerName,
    domain: summary.domain,
    quantitySource: summary.source,
    seatsUsed: summary.quantity,
  };
}

function dattoExternalAccountNameForBcdrAgent(agent: DattoBcdrAgent) {
  const accountName = agent.customerName ?? agent.deviceHostname ?? agent.deviceSerial ?? 'Datto BCDR';
  return `${accountName} / BCDR`;
}

function dattoExternalAccountNameForSaasSummary(summary: DattoSaasUsageSummary) {
  const accountName = summary.customerName ?? summary.domain ?? summary.saasCustomerId ?? 'Datto SaaS';
  const productLine = dattoProductNameForSaasProductLine(summary.productType, summary.retentionType).replace(
    /^Datto SaaS Protection\s+/,
    '',
  );

  return `${accountName} / ${productLine}`;
}

function defaultSaasProductMapping(summary: DattoSaasUsageSummary): DattoProductMapping {
  return {
    vendorProductKey: summary.productKey,
    productCode: summary.productKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    productName: dattoProductNameForSaasProductLine(summary.productType, summary.retentionType),
  };
}

function productMappingMetadata(mappings: Record<DattoProductMappingKey, DattoProductMapping>) {
  return Object.fromEntries(
    Object.entries(mappings).map(([key, mapping]) => [
      key,
      {
        productCode: mapping.productCode,
        productName: mapping.productName,
        unitPrice: mapping.unitPrice?.amount,
      },
    ]),
  );
}

function nullableMoney(value: string | number | null | undefined) {
  const amount = typeof value === 'number' ? value : value ? Number.parseFloat(value) : undefined;
  return typeof amount === 'number' && Number.isFinite(amount) ? { amount, currency: 'USD' as const } : undefined;
}

function integerValue(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
