import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import { sqlLatestReconcilableSyncRunIdExpression } from '../../shared/reconcilableSyncRuns';
import {
  SentinelOneClient,
  sentinelOneCredentialsFromSettings,
  type SentinelOneAgent,
  type SentinelOneSite,
} from './client';
import {
  buildSentinelOneRuleSet,
  canonicalSentinelOneVendorProductKey,
  defaultSentinelOneProductMappings,
  sentinelOneApiVendorProductKey,
  type SentinelOneProductMapping,
  type SentinelOneProductMappingKey,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type SentinelOneUsageClient = {
  listAccounts: SentinelOneClient['listAccounts'];
  listSites: SentinelOneClient['listSites'];
  listAgents: SentinelOneClient['listAgents'];
};

export type SentinelOneConnectionTestResult = {
  integrationId: 'sentinelone';
  testedAt: string;
  accountCount: number;
  siteCount: number;
  sampleSites: Array<{ siteId: string; siteName?: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type SentinelOneUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedSnapshots: number;
  serverSnapshots: number;
  workstationSnapshots: number;
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

const productKeys = ['sentinelone-server', 'sentinelone-workstation'] as const;

export async function testSentinelOneConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: SentinelOneUsageClient;
  now?: string;
} = {}): Promise<SentinelOneConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('sentinelone');
  assertSentinelOneReady(settings);

  const client = input.client ?? new SentinelOneClient(sentinelOneCredentialsFromSettings(settings));
  const [accounts, sites] = await Promise.all([
    client.listAccounts({ pageSize: 25, maxPages: 1 }),
    client.listSites({ pageSize: 25, maxPages: 1 }),
  ]);

  return {
    integrationId: 'sentinelone',
    testedAt: input.now ?? new Date().toISOString(),
    accountCount: accounts.length,
    siteCount: sites.length,
    sampleSites: sites.slice(0, 5).map((site) => ({
      siteId: site.siteId,
      siteName: site.siteName,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncSentinelOneUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: SentinelOneUsageClient;
  pageSize?: number;
  maxPages?: number;
  now?: string;
}): Promise<SentinelOneUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('sentinelone');
  assertSentinelOneReady(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startSentinelOneSyncRun(input.pool);
  const client = input.client ?? new SentinelOneClient(sentinelOneCredentialsFromSettings(settings));

  try {
    const [accountMappings, productMappings, agents] = await Promise.all([
      loadSentinelOneAccountMappings(input.pool),
      loadSentinelOneProductMappings(input.pool),
      client.listAgents({
        pageSize: input.pageSize,
        maxPages: input.maxPages,
      }),
    ]);

    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedSnapshots = 0;
    let serverSnapshots = 0;
    let workstationSnapshots = 0;

    for (const agent of agents) {
      const apiProductKey = productKeyForAgent(agent);
      if (!apiProductKey) {
        skippedSnapshots += 1;
        continue;
      }

      const externalAccountId = externalAccountIdForAgent(agent);
      const accountMapping = externalAccountId ? accountMappings.get(externalAccountId) : undefined;
      const deviceProductKey = canonicalSentinelOneVendorProductKey(apiProductKey);
      const preferDeviceKeys = Object.keys(productMappings).some((key) => key.startsWith('device:'));
      const productKey = preferDeviceKeys ? deviceProductKey : apiProductKey;
      const productMapping =
        productMappings[productKey] ??
        productMappings[apiProductKey] ??
        productMappings[deviceProductKey] ??
        defaultSentinelOneProductMappings[apiProductKey];
      if (!productMapping) {
        skippedSnapshots += 1;
        continue;
      }

      if (accountMapping) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      if (apiProductKey === 'sentinelone-server' || productKey === 'device:server') {
        serverSnapshots += 1;
      } else {
        workstationSnapshots += 1;
      }

      await insertSentinelOneUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId ?? undefined,
        externalAccountId,
        vendorProductKey: productKey,
        productCode: productMapping.productCode,
        productName: productMapping.productName,
        observedAt,
        agent,
      });
      recordsWritten += 1;
    }

    await completeSentinelOneSyncRun(input.pool, syncRunId, agents.length, recordsWritten, {
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      serverSnapshots,
      workstationSnapshots,
      productMappings: productMappingMetadata(productMappings),
    });

    return {
      syncRunId,
      recordsRead: agents.length,
      recordsWritten,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      serverSnapshots,
      workstationSnapshots,
    };
  } catch (error) {
    await failSentinelOneSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertSentinelOneReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `SentinelOne settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadSentinelOneProductMappings(
  database: Queryable,
): Promise<Record<string, SentinelOneProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = 'sentinelone'
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
  );
  const mappings: Record<string, SentinelOneProductMapping> = {};
  const rowsByKey = new Map<string, VendorProductMappingRow[]>();

  for (const row of result.rows) {
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

    const mapping: SentinelOneProductMapping = {
      vendorProductKey,
      productCode: primary.connectwise_product_code,
      productName: primary.connectwise_product_name,
      targetProductCodes: [...new Set(orderedRows.map((row) => row.connectwise_product_code))],
      unitPrice: nullableMoney(primary.unit_price),
    };
    mappings[vendorProductKey] = mapping;

    // Keep CSV device:* and live API sentinelone-* keys interchangeable for reconcile.
    const aliasKey =
      vendorProductKey.startsWith('device:')
        ? sentinelOneApiVendorProductKey(vendorProductKey)
        : canonicalSentinelOneVendorProductKey(vendorProductKey);
    if (aliasKey !== vendorProductKey && !mappings[aliasKey]) {
      mappings[aliasKey] = {
        ...mapping,
        vendorProductKey: aliasKey,
      };
    }
  }

  if (Object.keys(mappings).length === 0) {
    return { ...defaultSentinelOneProductMappings };
  }

  return mappings;
}

export async function loadSentinelOneRuleSet(database: Queryable) {
  const [productMappings, snapshotProducts] = await Promise.all([
    loadSentinelOneProductMappings(database),
    loadDistinctSentinelOneSnapshotProducts(database),
  ]);

  const resolvedMappings = { ...productMappings };
  for (const snapshotProduct of snapshotProducts) {
    if (!snapshotProduct.vendor_product_key || resolvedMappings[snapshotProduct.vendor_product_key]) {
      continue;
    }

    resolvedMappings[snapshotProduct.vendor_product_key] = {
      vendorProductKey: snapshotProduct.vendor_product_key,
      productCode: snapshotProduct.product_code,
      productName: snapshotProduct.product_name,
    };
  }

  return buildSentinelOneRuleSet(resolvedMappings);
}

async function loadDistinctSentinelOneSnapshotProducts(database: Queryable) {
  const result = await database.query<{
    vendor_product_key: string;
    product_code: string;
    product_name: string;
  }>(
    `select distinct on (vendor_product_key)
       vendor_product_key,
       product_code,
       product_name
     from vendor_usage_snapshots
     where vendor_id = 'sentinelone'
       and vendor_product_key is not null
       and sync_run_id = (${sqlLatestReconcilableSyncRunIdExpression("'sentinelone'")})
     order by vendor_product_key, observed_at desc`,
  );

  return result.rows;
}

async function loadSentinelOneAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'sentinelone'
       and active = true
       and mapping_status = 'approved'`,
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id,
      },
    ]),
  );
}

async function startSentinelOneSyncRun(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('sentinelone', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity: 'usage-snapshots' })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create SentinelOne usage snapshot sync run.');
  }

  return syncRunId;
}

async function insertSentinelOneUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId?: string;
    vendorProductKey: SentinelOneProductMappingKey;
    productCode: string;
    productName: string;
    observedAt: string;
    agent: SentinelOneAgent;
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
     values ($1, 'sentinelone', $2, $3, $4, $5, $6, $7, 1, $8, $9::jsonb, $10::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId ?? null,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.observedAt,
      JSON.stringify(dimensionsForAgent(input.agent)),
      JSON.stringify(input.agent.raw),
    ],
  );
}

async function completeSentinelOneSyncRun(
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

async function failSentinelOneSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function productKeyForAgent(agent: SentinelOneAgent): SentinelOneProductMappingKey | undefined {
  if (agent.machineType === 'server') return 'sentinelone-server';
  if (agent.machineType === 'workstation') return 'sentinelone-workstation';
  return undefined;
}

function externalAccountIdForAgent(agent: SentinelOneAgent | SentinelOneSite) {
  if ('siteId' in agent && agent.siteId) {
    return agent.siteId;
  }

  return agent.accountId;
}

function dimensionsForAgent(agent: SentinelOneAgent) {
  return {
    machineType: agent.machineType,
    hostname: agent.computerName,
    siteId: agent.siteId,
    siteName: agent.siteName,
    accountId: agent.accountId,
    accountName: agent.accountName,
    osType: agent.osType,
    agentId: agent.agentId,
    lastCheckIn: agent.lastActiveDate,
    lastActiveDate: agent.lastActiveDate,
  };
}

function productMappingMetadata(mappings: Record<SentinelOneProductMappingKey, SentinelOneProductMapping>) {
  return Object.fromEntries(
    productKeys.map((key) => [
      key,
      {
        productCode: mappings[key].productCode,
        productName: mappings[key].productName,
        unitPrice: mappings[key].unitPrice?.amount,
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
