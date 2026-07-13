import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import { sqlLatestReconcilableSyncRunIdExpression } from '../../shared/reconcilableSyncRuns';
import {
  HuntressApiError,
  HuntressClient,
  huntressCredentialsFromSettings,
  huntressExternalAccountId,
  huntressProductClassesFromSettings,
  type HuntressActor,
  type HuntressInvoice,
  type HuntressOrganization,
  type HuntressOrganizationUsageLineItem,
} from './client';
import {
  buildHuntressRuleSet,
  defaultHuntressProductMappings,
  huntressIntegrationId,
  huntressVendorProductKey,
  productClassLabel,
  type HuntressProductClass,
  type HuntressProductMapping,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type HuntressUsageClient = {
  getActor: HuntressClient['getActor'];
  listOrganizations: HuntressClient['listOrganizations'];
  listAgents: HuntressClient['listAgents'];
  listResellerInvoices: HuntressClient['listResellerInvoices'];
  listResellerOrganizationUsageLineItems: HuntressClient['listResellerOrganizationUsageLineItems'];
};

export type HuntressConnectionTestResult = {
  integrationId: typeof huntressIntegrationId;
  testedAt: string;
  actor: {
    resellerName?: string;
    accountName?: string;
    userEmail?: string;
  };
  organizationCount: number;
  agentCount: number;
  resellerInvoiceCount?: number;
  sampleOrganizations: Array<{ organizationId: string; organizationName?: string }>;
  productClasses: HuntressProductClass[];
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type HuntressUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedSnapshots: number;
  productSnapshots: Record<string, number>;
  usageSource: 'reseller-invoice-usage' | 'organization-summary';
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

type HuntressAccountMapping = {
  customerId: string;
  agreementId?: string;
};

type HuntressSnapshotInput = {
  externalAccountId: string;
  vendorProductKey: string;
  productClass: HuntressProductClass;
  productCode: string;
  productName: string;
  quantity: number;
  dimensions: Record<string, unknown>;
  rawPayload: unknown;
};

export async function testHuntressConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: HuntressUsageClient;
  now?: string;
} = {}): Promise<HuntressConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(huntressIntegrationId);
  assertHuntressReady(settings);

  const client = input.client ?? createHuntressClient(settings);
  const [actor, organizations, agents, resellerInvoices] = await Promise.all([
    client.getActor(),
    client.listOrganizations({ pageSize: 25, maxPages: 1 }),
    client.listAgents({ pageSize: 25, maxPages: 1 }),
    tryListResellerInvoices(client, { pageSize: 25, maxPages: 1 }),
  ]);

  return {
    integrationId: huntressIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    actor: actorSummary(actor),
    organizationCount: organizations.length,
    agentCount: agents.length,
    resellerInvoiceCount: resellerInvoices.available ? resellerInvoices.invoices.length : undefined,
    sampleOrganizations: organizations.slice(0, 5).map((organization) => ({
      organizationId: organization.organizationId,
      organizationName: organization.organizationName,
    })),
    productClasses: huntressProductClassesFromSettings(settings),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncHuntressUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: HuntressUsageClient;
  pageSize?: number;
  maxPages?: number;
  now?: string;
}): Promise<HuntressUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(huntressIntegrationId);
  assertHuntressReady(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const productClasses = huntressProductClassesFromSettings(settings);
  const syncRunId = await startHuntressSyncRun(input.pool, productClasses);
  const client = input.client ?? createHuntressClient(settings);

  try {
    const [accountMappings, productMappings] = await Promise.all([
      loadHuntressAccountMappings(input.pool),
      loadHuntressProductMappings(input.pool),
    ]);
    const invoiceSnapshots = await buildInvoiceUsageSnapshots(client, productMappings, productClasses, {
      pageSize: input.pageSize,
      maxPages: input.maxPages,
    });
    const usageSource = invoiceSnapshots.length > 0 ? 'reseller-invoice-usage' : 'organization-summary';
    const snapshots =
      invoiceSnapshots.length > 0
        ? invoiceSnapshots
        : await buildOrganizationSummarySnapshots(client, productMappings, productClasses, {
            pageSize: input.pageSize,
            maxPages: input.maxPages,
          });

    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedSnapshots = 0;
    const productSnapshots: Record<string, number> = {};

    for (const snapshot of snapshots) {
      if (snapshot.quantity <= 0) {
        skippedSnapshots += 1;
        continue;
      }

      const accountMapping = accountMappings.get(snapshot.externalAccountId);
      if (accountMapping?.customerId && accountMapping.agreementId) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      productSnapshots[snapshot.vendorProductKey] = (productSnapshots[snapshot.vendorProductKey] ?? 0) + snapshot.quantity;
      await insertHuntressUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId,
        observedAt,
        snapshot,
      });
      recordsWritten += 1;
    }

    const recordsRead = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    await completeHuntressSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'usage-snapshots',
      usageSource,
      productClasses,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
      productMappings: productMappingMetadata(productMappings, productClasses),
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
      usageSource,
    };
  } catch (error) {
    await failHuntressSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertHuntressReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `Huntress settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadHuntressProductMappings(
  database: Queryable,
): Promise<Record<string, HuntressProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
    [huntressIntegrationId],
  );
  const mappings: Record<string, HuntressProductMapping> = Object.fromEntries(
    Object.values(defaultHuntressProductMappings).map((mapping) => [mapping.vendorProductKey, mapping]),
  );
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

export async function loadHuntressRuleSet(database: Queryable) {
  const [productMappings, snapshotProducts] = await Promise.all([
    loadHuntressProductMappings(database),
    loadDistinctHuntressSnapshotProducts(database),
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

  return buildHuntressRuleSet(resolvedMappings);
}

function createHuntressClient(settings: IntegrationRuntimeSettings) {
  return new HuntressClient(huntressCredentialsFromSettings(settings));
}

async function buildInvoiceUsageSnapshots(
  client: HuntressUsageClient,
  productMappings: Record<string, HuntressProductMapping>,
  productClasses: HuntressProductClass[],
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<HuntressSnapshotInput[]> {
  const invoicesResult = await tryListResellerInvoices(client, options);
  if (!invoicesResult.available || invoicesResult.invoices.length === 0) {
    return [];
  }

  const invoices = invoicesResult.invoices
    .filter((invoice) => invoice.hasUsage !== false)
    .sort((left, right) => invoiceTimestamp(right) - invoiceTimestamp(left));

  for (const invoice of invoices.slice(0, 5)) {
    const lineItems = await tryListOrganizationUsageLineItems(client, invoice.invoiceId, options);
    if (lineItems.length === 0) {
      continue;
    }

    return lineItems.flatMap((lineItem) => invoiceLineItemSnapshots(invoice, lineItem, productMappings, productClasses));
  }

  return [];
}

async function buildOrganizationSummarySnapshots(
  client: HuntressUsageClient,
  productMappings: Record<string, HuntressProductMapping>,
  productClasses: HuntressProductClass[],
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<HuntressSnapshotInput[]> {
  const organizations = await client.listOrganizations(options);

  return organizations.flatMap((organization) =>
    productClasses
      .map((productClass) => organizationSummarySnapshot(organization, productMappings, productClass))
      .filter((snapshot): snapshot is HuntressSnapshotInput => Boolean(snapshot)),
  );
}

function invoiceLineItemSnapshots(
  invoice: HuntressInvoice,
  lineItem: HuntressOrganizationUsageLineItem,
  productMappings: Record<string, HuntressProductMapping>,
  productClasses: HuntressProductClass[],
): HuntressSnapshotInput[] {
  const snapshots: HuntressSnapshotInput[] = [];

  for (const productClass of productClasses) {
    const quantity = numericQuantity(lineItem.actualUsage[productClass]);
    if (quantity <= 0) {
      continue;
    }

    const vendorProductKey = huntressVendorProductKey(productClass);
    const productMapping = productMappings[vendorProductKey] ?? defaultHuntressProductMappings[productClass];
    snapshots.push({
      externalAccountId: huntressExternalAccountId(lineItem.organizationId, productClass),
      vendorProductKey,
      productClass,
      productCode: productMapping.productCode,
      productName: productMapping.productName,
      quantity,
      dimensions: {
        source: 'reseller-invoice-organization-usage',
        customerName: lineItem.organizationName,
        productName: productMapping.productName,
        huntressProductClass: productClass,
        huntressProductClassLabel: productClassLabel(productClass),
        huntressOrganizationId: lineItem.organizationId,
        huntressOrganizationName: lineItem.organizationName,
        huntressAccountId: lineItem.accountId,
        huntressAccountName: lineItem.accountName,
        huntressInvoiceId: invoice.invoiceId,
        huntressInvoiceStatus: invoice.status,
        huntressInvoiceCreatedAt: invoice.createdAt,
        huntressInvoiceUpdatedAt: invoice.updatedAt,
        billingPeriodStart: lineItem.periodStart,
        billingPeriodEnd: lineItem.periodEnd,
        quantitySource: 'actual_usage',
      },
      rawPayload: {
        invoice: invoice.raw,
        lineItem: lineItem.raw,
        productClass,
        quantity,
      },
    });
  }

  return snapshots;
}

function organizationSummarySnapshot(
  organization: HuntressOrganization,
  productMappings: Record<string, HuntressProductMapping>,
  productClass: HuntressProductClass,
): HuntressSnapshotInput | undefined {
  const quantity = quantityForOrganizationProductClass(organization, productClass);
  if (typeof quantity !== 'number' || quantity <= 0) {
    return undefined;
  }

  const vendorProductKey = huntressVendorProductKey(productClass);
  const productMapping = productMappings[vendorProductKey] ?? defaultHuntressProductMappings[productClass];
  return {
    externalAccountId: huntressExternalAccountId(organization.organizationId, productClass),
    vendorProductKey,
    productClass,
    productCode: productMapping.productCode,
    productName: productMapping.productName,
    quantity,
    dimensions: {
      source: 'organization-summary',
      customerName: organization.organizationName,
      productName: productMapping.productName,
      huntressProductClass: productClass,
      huntressProductClassLabel: productClassLabel(productClass),
      huntressOrganizationId: organization.organizationId,
      huntressOrganizationName: organization.organizationName,
      huntressOrganizationKey: organization.key,
      huntressAccountId: organization.accountId,
      agentsCount: organization.agentsCount,
      billableIdentityCount: organization.billableIdentityCount,
      logsSourcesCount: organization.logsSourcesCount,
      satLearnerCount: organization.satLearnerCount,
      quantitySource: organizationQuantitySource(productClass),
    },
    rawPayload: {
      organization: organization.raw,
      productClass,
      quantity,
    },
  };
}

async function tryListResellerInvoices(
  client: HuntressUsageClient,
  options: { pageSize?: number; maxPages?: number },
): Promise<{ available: boolean; invoices: HuntressInvoice[] }> {
  try {
    return {
      available: true,
      invoices: await client.listResellerInvoices(options),
    };
  } catch (error) {
    if (isUnavailableResellerScopeError(error)) {
      return { available: false, invoices: [] };
    }

    throw error;
  }
}

async function tryListOrganizationUsageLineItems(
  client: HuntressUsageClient,
  invoiceId: string,
  options: { pageSize?: number; maxPages?: number },
) {
  try {
    return await client.listResellerOrganizationUsageLineItems(invoiceId, options);
  } catch (error) {
    if (isUnavailableResellerScopeError(error)) {
      return [];
    }

    throw error;
  }
}

function isUnavailableResellerScopeError(error: unknown) {
  if (!(error instanceof HuntressApiError)) {
    return false;
  }

  if (error.status === 403 || error.status === 404) {
    return true;
  }

  return error.status === 400 && /multi-account api credentials|reseller/i.test(error.message);
}

async function loadHuntressAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'`,
    [huntressIntegrationId],
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id ?? undefined,
      } satisfies HuntressAccountMapping,
    ]),
  );
}

async function loadDistinctHuntressSnapshotProducts(database: Queryable) {
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
     where vendor_id = $1
       and vendor_product_key is not null
       and sync_run_id = (${sqlLatestReconcilableSyncRunIdExpression('$1')})
     order by vendor_product_key, observed_at desc`,
    [huntressIntegrationId],
  );

  return result.rows;
}

async function startHuntressSyncRun(database: Queryable, productClasses: HuntressProductClass[]) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [huntressIntegrationId, JSON.stringify({ entity: 'usage-snapshots', productClasses })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create Huntress usage snapshot sync run.');
  }

  return syncRunId;
}

async function insertHuntressUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    observedAt: string;
    snapshot: HuntressSnapshotInput;
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
      huntressIntegrationId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.snapshot.externalAccountId,
      input.snapshot.vendorProductKey,
      input.snapshot.productCode,
      input.snapshot.productName,
      input.snapshot.quantity,
      input.observedAt,
      JSON.stringify(input.snapshot.dimensions),
      JSON.stringify(input.snapshot.rawPayload ?? {}),
    ],
  );
}

async function completeHuntressSyncRun(
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

async function failHuntressSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function actorSummary(actor: HuntressActor) {
  return {
    resellerName: actor.reseller?.name,
    accountName: actor.account?.name,
    userEmail: actor.user?.email,
  };
}

function invoiceTimestamp(invoice: HuntressInvoice) {
  return Math.max(Date.parse(invoice.createdAt ?? ''), Date.parse(invoice.updatedAt ?? ''), 0);
}

function quantityForOrganizationProductClass(
  organization: HuntressOrganization,
  productClass: HuntressProductClass,
) {
  if (productClass === 'edr') return organization.agentsCount;
  if (productClass === 'itdr') return organization.billableIdentityCount;
  if (productClass === 'sat') return organization.satLearnerCount;
  if (productClass === 'siem') return organization.logsSourcesCount;
  return undefined;
}

function organizationQuantitySource(productClass: HuntressProductClass) {
  if (productClass === 'edr') return 'agents_count';
  if (productClass === 'itdr') return 'billable_identity_count';
  if (productClass === 'sat') return 'sat_learner_count';
  if (productClass === 'siem') return 'logs_sources_count';
  return undefined;
}

function productMappingMetadata(
  mappings: Record<string, HuntressProductMapping>,
  productClasses: HuntressProductClass[],
) {
  return Object.fromEntries(
    productClasses.map((productClass) => {
      const key = huntressVendorProductKey(productClass);
      const mapping = mappings[key] ?? defaultHuntressProductMappings[productClass];
      return [
        key,
        {
          productClass,
          productCode: mapping.productCode,
          productName: mapping.productName,
          unitPrice: mapping.unitPrice?.amount,
        },
      ];
    }),
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

function numericQuantity(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
