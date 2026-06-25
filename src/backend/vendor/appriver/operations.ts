import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import { KeyVaultIntegrationSecretWriter } from '../../config/settingsUpdater';
import {
  AppRiverApiError,
  AppRiverClient,
  appRiverCredentialsFromSettings,
  appRiverIntegrationId,
  appRiverLicenseQuantity,
  appRiverProductKeyForSubscription,
  appRiverSubscriptionSource,
  fallbackAppRiverProductCode,
  type AppRiverAccessToken,
  type AppRiverCustomer,
  type AppRiverSubscription,
  type AppRiverSubscriptionDetail,
} from './client';
import { buildAppRiverRuleSet, type AppRiverProductBundleMapping, type AppRiverProductMapping } from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type ReleasableQueryable = Queryable & {
  release?: () => void;
};

export type LockableQueryable = Queryable & {
  connect?: () => Promise<ReleasableQueryable>;
};

export type AppRiverSecureCloudClient = {
  authenticate: () => Promise<AppRiverAccessToken | unknown>;
  listCustomers: (options?: { pageSize?: number; maxPages?: number }) => Promise<AppRiverCustomer[]>;
  listCustomerSubscriptions: (
    customerId: string,
    options?: { pageSize?: number; maxPages?: number },
  ) => Promise<AppRiverSubscription[]>;
  getCustomerSubscriptionDetails: (
    customerId: string,
    subscriptionKey: string,
  ) => Promise<AppRiverSubscriptionDetail>;
};

export type AppRiverConnectionTestResult = {
  integrationId: typeof appRiverIntegrationId;
  testedAt: string;
  customerCount: number;
  sampleCustomers: Array<{ customerId: string; name: string; customerType?: string }>;
  firstCustomerSubscriptionCount: number;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type AppRiverSubscriptionSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  customersRead: number;
  subscriptionsRead: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedPartnerCustomers: number;
  failedCustomers: number;
  failedSubscriptions: number;
  productSnapshots: Record<string, number>;
};

export type AppRiverQueuedSubscriptionSyncStartResult = {
  syncRunId: string;
  status: 'queued' | 'complete';
  customersRead: number;
  queuedCustomers: number;
  skippedPartnerCustomers: number;
};

export type AppRiverQueuedCustomerProcessResult = {
  syncRunId: string;
  status: 'processed' | 'retrying' | 'completed' | 'failed' | 'waiting' | 'locked';
  shouldContinue: boolean;
  processedCustomerId?: string;
  recordsRead?: number;
  recordsWritten?: number;
  errorMessage?: string;
};

type VendorAccountMappingRow = {
  external_account_id: string;
  external_account_name?: string | null;
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

type VendorProductBundleRow = {
  bundle_key: string;
  bundle_name: string;
  components: unknown;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

type AppRiverAccountMapping = {
  customerId: string;
  agreementId?: string;
};

type AppRiverSyncError = {
  customerId: string;
  customerName?: string;
  subscriptionKey?: string;
  message: string;
};

type AppRiverSyncWorkItemRow = {
  id: string;
  sync_run_id: string;
  external_customer_id: string;
  customer_name: string | null;
  customer_type: string | null;
  attempts: string | number;
  raw_payload: unknown;
};

type AppRiverWorkItemFinalizeRow = {
  status: string;
  external_customer_id: string;
  customer_name: string | null;
  records_read: string | number | null;
  records_written: string | number | null;
  subscriptions_read: string | number | null;
  mapped_snapshots: string | number | null;
  unmapped_snapshots: string | number | null;
  failed_subscriptions: string | number | null;
  error_message: string | null;
  result_payload: unknown;
};

type AppRiverSyncRunMetadataRow = {
  metadata: unknown;
};

type AppRiverPendingWorkItemCountRow = {
  queued_count: string | number;
  processing_count: string | number;
};

type AppRiverCustomerProcessingStats = {
  recordsRead: number;
  recordsWritten: number;
  subscriptionsRead: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  failedSubscriptions: number;
  failedSubscriptionDetails: AppRiverSyncError[];
  productSnapshots: Record<string, number>;
};

const appRiverSyncEntity = 'subscription-snapshots';
const appRiverQueuedSyncMode = 'queued-customers';
const appRiverWorkerLockKey = 'msp-harmony:opentext-appriver:sync-worker';
const defaultAppRiverQueuedMaxAttempts = 3;

export async function testAppRiverConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  now?: string;
} = {}): Promise<AppRiverConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(appRiverIntegrationId);
  assertAppRiverReady(settings);

  const client = input.client ?? createAppRiverClient(settings);
  await client.authenticate();
  const customers = await client.listCustomers({ pageSize: 1000, maxPages: 1 });
  const firstCustomer = customers.find((customer) => !isPartnerCustomer(customer)) ?? customers[0];
  if (!firstCustomer) {
    throw new Error('AppRiver - OpenText did not return any SecureCloud customers.');
  }
  const firstCustomerSubscriptions = isPartnerCustomer(firstCustomer)
    ? []
    : await client.listCustomerSubscriptions(firstCustomer.customerId, { pageSize: 100, maxPages: 1 });

  return {
    integrationId: appRiverIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    customerCount: customers.length,
    sampleCustomers: customers.slice(0, 5).map((customer) => ({
      customerId: customer.customerId,
      name: customer.name,
      customerType: customer.customerType,
    })),
    firstCustomerSubscriptionCount: firstCustomerSubscriptions.length,
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncAppRiverSubscriptionSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  pageSize?: number;
  maxPages?: number;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  now?: string;
}): Promise<AppRiverSubscriptionSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(appRiverIntegrationId);
  assertAppRiverReady(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startAppRiverSyncRun(input.pool);
  const client = input.client ?? createAppRiverClient(settings);

  try {
    const [accountMappings, productMappings, customers] = await Promise.all([
      loadAppRiverAccountMappings(input.pool),
      loadAppRiverProductMappings(input.pool),
      client.listCustomers({
        pageSize: input.pageSize,
        maxPages: input.maxPages,
      }),
    ]);

    let recordsRead = 0;
    let recordsWritten = 0;
    let subscriptionsRead = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedPartnerCustomers = 0;
    const productSnapshots: Record<string, number> = {};
    const failedCustomerDetails: AppRiverSyncError[] = [];
    const failedSubscriptionDetails: AppRiverSyncError[] = [];

    for (const customer of customers) {
      if (isPartnerCustomer(customer)) {
        skippedPartnerCustomers += 1;
        continue;
      }

      let subscriptions: AppRiverSubscription[] = [];
      try {
        subscriptions = await client.listCustomerSubscriptions(customer.customerId, {
          pageSize: input.subscriptionPageSize ?? 100,
          maxPages: input.subscriptionMaxPages ?? 25,
        });
        subscriptionsRead += subscriptions.length;
        recordsRead += subscriptions.length;
      } catch (error) {
        failedCustomerDetails.push({
          customerId: customer.customerId,
          customerName: customer.name,
          message: errorMessage(error),
        });
        continue;
      }

      const accountMapping = accountMappings.get(customer.customerId);

      for (const subscription of subscriptions) {
        let detail: AppRiverSubscriptionDetail;
        try {
          detail = await client.getCustomerSubscriptionDetails(customer.customerId, subscription.subscriptionKey);
        } catch (error) {
          failedSubscriptionDetails.push({
            customerId: customer.customerId,
            customerName: customer.name,
            subscriptionKey: subscription.subscriptionKey,
            message: errorMessage(error),
          });
          continue;
        }

        const vendorProductKey = appRiverProductKeyForSubscription(detail);
        const productMapping = productMappings[vendorProductKey] ?? defaultProductMapping(vendorProductKey, detail);

        if (accountMapping?.customerId && accountMapping.agreementId) {
          mappedSnapshots += 1;
        } else {
          unmappedSnapshots += 1;
        }

        productSnapshots[vendorProductKey] = (productSnapshots[vendorProductKey] ?? 0) + 1;

        await insertAppRiverUsageSnapshot(input.pool, {
          syncRunId,
          customerId: accountMapping?.customerId,
          agreementId: accountMapping?.agreementId,
          externalAccountId: customer.customerId,
          vendorProductKey,
          productCode: productMapping.productCode,
          productName: productMapping.productName,
          quantity: appRiverLicenseQuantity(detail),
          observedAt,
          customer,
          detail,
        });
        recordsWritten += 1;
      }
    }

    await completeAppRiverSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: appRiverSyncEntity,
      customersRead: customers.length,
      subscriptionsRead,
      mappedSnapshots,
      unmappedSnapshots,
      skippedPartnerCustomers,
      failedCustomers: failedCustomerDetails.length,
      failedCustomerDetails,
      failedSubscriptions: failedSubscriptionDetails.length,
      failedSubscriptionDetails,
      productSnapshots,
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      customersRead: customers.length,
      subscriptionsRead,
      mappedSnapshots,
      unmappedSnapshots,
      skippedPartnerCustomers,
      failedCustomers: failedCustomerDetails.length,
      failedSubscriptions: failedSubscriptionDetails.length,
      productSnapshots,
    };
  } catch (error) {
    await failAppRiverSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export async function startAppRiverQueuedSubscriptionSync(input: {
  pool: LockableQueryable;
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  pageSize?: number;
  maxPages?: number;
}): Promise<AppRiverQueuedSubscriptionSyncStartResult> {
  return withAppRiverWorkerLock<AppRiverQueuedSubscriptionSyncStartResult>(
    input.pool,
    () => {
      throw new Error('AppRiver - OpenText sync is already running. Try again after the current customer finishes.');
    },
    async (database) =>
      startAppRiverQueuedSubscriptionSyncWithLock({
        ...input,
        pool: database,
      }),
  );
}

async function startAppRiverQueuedSubscriptionSyncWithLock(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  pageSize?: number;
  maxPages?: number;
}): Promise<AppRiverQueuedSubscriptionSyncStartResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(appRiverIntegrationId);
  assertAppRiverReady(settings);
  await assertNoRunningAppRiverSync(input.pool);

  const syncRunId = await startAppRiverSyncRun(input.pool, { mode: appRiverQueuedSyncMode });
  const client = input.client ?? createAppRiverClient(settings);

  try {
    const customers = await client.listCustomers({
      pageSize: input.pageSize,
      maxPages: input.maxPages,
    });
    const billableCustomers = customers.filter((customer) => !isPartnerCustomer(customer));
    const skippedPartnerCustomers = customers.length - billableCustomers.length;

    for (const customer of billableCustomers) {
      await insertAppRiverSyncWorkItem(input.pool, syncRunId, customer);
    }

    await updateAppRiverSyncRunMetadata(input.pool, syncRunId, {
      entity: appRiverSyncEntity,
      mode: appRiverQueuedSyncMode,
      customersRead: customers.length,
      queuedCustomers: billableCustomers.length,
      skippedPartnerCustomers,
    });

    if (billableCustomers.length === 0) {
      await completeAppRiverSyncRun(input.pool, syncRunId, 0, 0, {
        entity: appRiverSyncEntity,
        mode: appRiverQueuedSyncMode,
        customersRead: customers.length,
        subscriptionsRead: 0,
        mappedSnapshots: 0,
        unmappedSnapshots: 0,
        skippedPartnerCustomers,
        failedCustomers: 0,
        failedCustomerDetails: [],
        failedSubscriptions: 0,
        failedSubscriptionDetails: [],
        productSnapshots: {},
      });

      return {
        syncRunId,
        status: 'complete',
        customersRead: customers.length,
        queuedCustomers: 0,
        skippedPartnerCustomers,
      };
    }

    return {
      syncRunId,
      status: 'queued',
      customersRead: customers.length,
      queuedCustomers: billableCustomers.length,
      skippedPartnerCustomers,
    };
  } catch (error) {
    await failAppRiverSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export async function processNextAppRiverQueuedCustomer(input: {
  pool: LockableQueryable;
  syncRunId: string;
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  maxAttempts?: number;
  now?: string;
}): Promise<AppRiverQueuedCustomerProcessResult> {
  return withAppRiverWorkerLock<AppRiverQueuedCustomerProcessResult>(
    input.pool,
    () =>
      ({
        syncRunId: input.syncRunId,
        status: 'locked',
        shouldContinue: true,
      }) satisfies AppRiverQueuedCustomerProcessResult,
    async (database) =>
      processNextAppRiverQueuedCustomerWithLock({
        ...input,
        pool: database,
      }),
  );
}

export function assertAppRiverReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `AppRiver - OpenText settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadAppRiverProductMappings(
  database: Queryable,
): Promise<Record<string, AppRiverProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
    [appRiverIntegrationId],
  );
  const mappings: Record<string, AppRiverProductMapping> = {};
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

  const targetAliases = await loadAppRiverTargetProductCodeAliases(database, Object.values(mappings));
  for (const mapping of Object.values(mappings)) {
    mapping.targetProductCodes = [
      ...new Set([...(mapping.targetProductCodes ?? []), ...(targetAliases.get(mapping.productName) ?? [])]),
    ];
  }

  return withEquivalentAppRiverProductMappings(mappings);
}

async function loadAppRiverTargetProductCodeAliases(
  database: Queryable,
  mappings: AppRiverProductMapping[],
): Promise<Map<string, string[]>> {
  const productNames = [...new Set(mappings.map((mapping) => mapping.productName).filter(Boolean))];
  if (productNames.length === 0) {
    return new Map();
  }

  const result = await database.query<{ product_name: string; product_code: string }>(
    `with target_names as (
       select unnest($1::text[]) as product_name
     )
     select target_names.product_name,
            products.connectwise_product_code as product_code
     from target_names
     inner join products
       on products.vendor_id = 'connectwise'
      and products.active = true
      and products.display_name = target_names.product_name
      and products.connectwise_product_code is not null
     union
     select target_names.product_name,
            agreement_additions.product_code as product_code
     from target_names
     inner join agreement_additions
       on agreement_additions.product_name = target_names.product_name
      and agreement_additions.product_code is not null
      and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
      and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     order by product_name, product_code`,
    [productNames],
  );

  const aliases = new Map<string, string[]>();
  for (const row of result.rows) {
    aliases.set(row.product_name, [...(aliases.get(row.product_name) ?? []), row.product_code]);
  }

  return aliases;
}

export async function loadAppRiverProductBundleMappings(
  database: Queryable,
): Promise<AppRiverProductBundleMapping[]> {
  const result = await database.query<VendorProductBundleRow>(
    `select bundle_key,
            bundle_name,
            components,
            connectwise_product_code,
            connectwise_product_name,
            unit_price
     from vendor_product_bundles
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     order by bundle_name, bundle_key`,
    [appRiverIntegrationId],
  );

  return result.rows.flatMap((row) => {
    const componentProductKeys = appRiverBundleComponentKeys(row.components);
    if (componentProductKeys.length === 0) {
      return [];
    }

    return [
      {
        bundleKey: row.bundle_key,
        bundleName: row.bundle_name,
        componentProductKeys,
        productCode: row.connectwise_product_code,
        productName: row.connectwise_product_name,
        targetProductCodes: [row.connectwise_product_code],
        unitPrice: nullableMoney(row.unit_price),
      },
    ];
  });
}

export async function loadAppRiverRuleSet(database: Queryable) {
  const [productMappings, bundleMappings] = await Promise.all([
    loadAppRiverProductMappings(database),
    loadAppRiverProductBundleMappings(database),
  ]);

  return buildAppRiverRuleSet(productMappings, bundleMappings);
}

async function processNextAppRiverQueuedCustomerWithLock(input: {
  pool: Queryable;
  syncRunId: string;
  provider?: IntegrationSettingsProvider;
  client?: AppRiverSecureCloudClient;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  maxAttempts?: number;
  now?: string;
}): Promise<AppRiverQueuedCustomerProcessResult> {
  await requeueStaleAppRiverWorkItems(input.pool, input.syncRunId);
  const workItem = await claimNextAppRiverWorkItem(input.pool, input.syncRunId);

  if (!workItem) {
    const pending = await loadAppRiverPendingWorkItemCounts(input.pool, input.syncRunId);
    if (pending.processingCount > 0) {
      return {
        syncRunId: input.syncRunId,
        status: 'waiting',
        shouldContinue: true,
      };
    }

    const result = await finalizeAppRiverQueuedSync(input.pool, input.syncRunId);
    return {
      syncRunId: input.syncRunId,
      status: 'completed',
      shouldContinue: false,
      recordsRead: result.recordsRead,
      recordsWritten: result.recordsWritten,
    };
  }

  try {
    const stats = await processAppRiverCustomerWorkItem(input.pool, workItem, {
      provider: input.provider,
      client: input.client,
      subscriptionPageSize: input.subscriptionPageSize,
      subscriptionMaxPages: input.subscriptionMaxPages,
      now: input.now,
    });
    await completeAppRiverWorkItem(input.pool, workItem.id, stats);

    const completed = await completeAppRiverQueuedSyncIfFinished(input.pool, input.syncRunId);
    return {
      syncRunId: input.syncRunId,
      status: completed ? 'completed' : 'processed',
      shouldContinue: !completed,
      processedCustomerId: workItem.external_customer_id,
      recordsRead: stats.recordsRead,
      recordsWritten: stats.recordsWritten,
    };
  } catch (error) {
    const message = errorMessage(error);
    if (isFatalAppRiverSyncError(error)) {
      await failAppRiverWorkItem(input.pool, workItem.id, message);
      await failAppRiverSyncRun(input.pool, input.syncRunId, error);
      return {
        syncRunId: input.syncRunId,
        status: 'failed',
        shouldContinue: false,
        processedCustomerId: workItem.external_customer_id,
        errorMessage: message,
      };
    }

    if (integerValue(workItem.attempts) >= (input.maxAttempts ?? defaultAppRiverQueuedMaxAttempts)) {
      await failAppRiverWorkItem(input.pool, workItem.id, message);
      const completed = await completeAppRiverQueuedSyncIfFinished(input.pool, input.syncRunId);
      return {
        syncRunId: input.syncRunId,
        status: completed ? 'completed' : 'processed',
        shouldContinue: !completed,
        processedCustomerId: workItem.external_customer_id,
        errorMessage: message,
      };
    }

    await retryAppRiverWorkItem(input.pool, workItem.id, message);
    return {
      syncRunId: input.syncRunId,
      status: 'retrying',
      shouldContinue: true,
      processedCustomerId: workItem.external_customer_id,
      errorMessage: message,
    };
  }
}

async function processAppRiverCustomerWorkItem(
  database: Queryable,
  workItem: AppRiverSyncWorkItemRow,
  input: {
    provider?: IntegrationSettingsProvider;
    client?: AppRiverSecureCloudClient;
    subscriptionPageSize?: number;
    subscriptionMaxPages?: number;
    now?: string;
  },
): Promise<AppRiverCustomerProcessingStats> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(appRiverIntegrationId);
  assertAppRiverReady(settings);

  const client = input.client ?? createAppRiverClient(settings);
  const customer = customerFromWorkItem(workItem);
  const observedAt = input.now ?? new Date().toISOString();
  const [accountMappings, productMappings] = await Promise.all([
    loadAppRiverAccountMappings(database),
    loadAppRiverProductMappings(database),
  ]);

  await deleteAppRiverUsageSnapshotsForCustomer(database, workItem.sync_run_id, customer.customerId);

  const subscriptions = await client.listCustomerSubscriptions(customer.customerId, {
    pageSize: input.subscriptionPageSize ?? 100,
    maxPages: input.subscriptionMaxPages ?? 25,
  });
  const accountMapping = accountMappings.get(customer.customerId);
  const failedSubscriptionDetails: AppRiverSyncError[] = [];
  const productSnapshots: Record<string, number> = {};
  let recordsWritten = 0;
  let mappedSnapshots = 0;
  let unmappedSnapshots = 0;

  for (const subscription of subscriptions) {
    let detail: AppRiverSubscriptionDetail;
    try {
      detail = await client.getCustomerSubscriptionDetails(customer.customerId, subscription.subscriptionKey);
    } catch (error) {
      if (isFatalAppRiverSyncError(error)) {
        throw error;
      }

      failedSubscriptionDetails.push({
        customerId: customer.customerId,
        customerName: customer.name,
        subscriptionKey: subscription.subscriptionKey,
        message: errorMessage(error),
      });
      continue;
    }

    const vendorProductKey = appRiverProductKeyForSubscription(detail);
    const productMapping = productMappings[vendorProductKey] ?? defaultProductMapping(vendorProductKey, detail);

    if (accountMapping?.customerId && accountMapping.agreementId) {
      mappedSnapshots += 1;
    } else {
      unmappedSnapshots += 1;
    }

    productSnapshots[vendorProductKey] = (productSnapshots[vendorProductKey] ?? 0) + 1;

    await insertAppRiverUsageSnapshot(database, {
      syncRunId: workItem.sync_run_id,
      customerId: accountMapping?.customerId,
      agreementId: accountMapping?.agreementId,
      externalAccountId: customer.customerId,
      vendorProductKey,
      productCode: productMapping.productCode,
      productName: productMapping.productName,
      quantity: appRiverLicenseQuantity(detail),
      observedAt,
      customer,
      detail,
    });
    recordsWritten += 1;
  }

  return {
    recordsRead: subscriptions.length,
    recordsWritten,
    subscriptionsRead: subscriptions.length,
    mappedSnapshots,
    unmappedSnapshots,
    failedSubscriptions: failedSubscriptionDetails.length,
    failedSubscriptionDetails,
    productSnapshots,
  };
}

function createAppRiverClient(settings: IntegrationRuntimeSettings) {
  const credentials = appRiverCredentialsFromSettings(settings);

  return new AppRiverClient(credentials, {
    onRefreshTokenRotated: rotatedRefreshTokenWriter(settings, credentials.refreshTokenCachePath),
  });
}

function rotatedRefreshTokenWriter(settings: IntegrationRuntimeSettings, refreshTokenCachePath?: string) {
  const refreshTokenSecretName = settings.definition.requiredSecrets.find((secret) => secret.key === 'refreshToken')
    ?.keyVaultSecretName;

  if (settings.secretSource === 'key-vault' && settings.keyVaultUrl && refreshTokenSecretName) {
    const writer = new KeyVaultIntegrationSecretWriter(settings.keyVaultUrl);
    return (refreshToken: string) => writer.setSecret(refreshTokenSecretName, refreshToken);
  }

  if (settings.secretSource === 'environment' && refreshTokenCachePath) {
    return async (refreshToken: string) => {
      const resolvedPath = resolve(refreshTokenCachePath);
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, refreshToken, 'utf8');
    };
  }

  return undefined;
}

async function loadAppRiverAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, external_account_name, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'`,
    [appRiverIntegrationId],
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id ?? undefined,
      },
    ]),
  );
}

async function assertNoRunningAppRiverSync(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `select id
     from sync_runs
     where integration_id = $1
       and status = 'running'
       and completed_at is null
     order by started_at desc
     limit 1`,
    [appRiverIntegrationId],
  );
  const runningSyncRunId = result.rows[0]?.id;

  if (runningSyncRunId) {
    throw new Error(`AppRiver - OpenText sync ${runningSyncRunId} is already running.`);
  }
}

async function insertAppRiverSyncWorkItem(database: Queryable, syncRunId: string, customer: AppRiverCustomer) {
  await database.query(
    `insert into appriver_sync_work_items (
       sync_run_id,
       external_customer_id,
       customer_name,
       customer_type,
       raw_payload
     )
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (sync_run_id, external_customer_id)
     do update set
       customer_name = excluded.customer_name,
       customer_type = excluded.customer_type,
       raw_payload = excluded.raw_payload,
       status = 'queued',
       error_message = null,
       updated_at = now()`,
    [
      syncRunId,
      customer.customerId,
      customer.name,
      customer.customerType ?? null,
      JSON.stringify(customer.raw ?? {}),
    ],
  );
}

async function updateAppRiverSyncRunMetadata(
  database: Queryable,
  syncRunId: string,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set metadata = metadata || $2::jsonb
     where id = $1`,
    [syncRunId, JSON.stringify(metadata)],
  );
}

async function requeueStaleAppRiverWorkItems(database: Queryable, syncRunId: string) {
  await database.query(
    `update appriver_sync_work_items
     set status = 'queued',
         error_message = coalesce(error_message, 'Processing timed out before completion; retrying.'),
         updated_at = now()
     where sync_run_id = $1
       and status = 'processing'
       and started_at < now() - interval '15 minutes'`,
    [syncRunId],
  );
}

async function claimNextAppRiverWorkItem(database: Queryable, syncRunId: string) {
  const result = await database.query<AppRiverSyncWorkItemRow>(
    `update appriver_sync_work_items
     set status = 'processing',
         attempts = attempts + 1,
         started_at = now(),
         completed_at = null,
         error_message = null,
         updated_at = now()
     where id = (
       select id
       from appriver_sync_work_items
       where sync_run_id = $1
         and status = 'queued'
       order by created_at, id
       for update skip locked
       limit 1
     )
     returning id, sync_run_id, external_customer_id, customer_name, customer_type, attempts, raw_payload`,
    [syncRunId],
  );

  return result.rows[0];
}

async function deleteAppRiverUsageSnapshotsForCustomer(
  database: Queryable,
  syncRunId: string,
  externalCustomerId: string,
) {
  await database.query(
    `delete from vendor_usage_snapshots
     where sync_run_id = $1
       and vendor_id = $2
       and external_account_id = $3`,
    [syncRunId, appRiverIntegrationId, externalCustomerId],
  );
}

async function completeAppRiverWorkItem(
  database: Queryable,
  workItemId: string,
  stats: AppRiverCustomerProcessingStats,
) {
  await database.query(
    `update appriver_sync_work_items
     set status = 'complete',
         completed_at = now(),
         records_read = $2,
         records_written = $3,
         subscriptions_read = $4,
         mapped_snapshots = $5,
         unmapped_snapshots = $6,
         failed_subscriptions = $7,
         result_payload = $8::jsonb,
         error_message = null,
         updated_at = now()
     where id = $1`,
    [
      workItemId,
      stats.recordsRead,
      stats.recordsWritten,
      stats.subscriptionsRead,
      stats.mappedSnapshots,
      stats.unmappedSnapshots,
      stats.failedSubscriptions,
      JSON.stringify({
        failedSubscriptionDetails: stats.failedSubscriptionDetails,
        productSnapshots: stats.productSnapshots,
      }),
    ],
  );
}

async function retryAppRiverWorkItem(database: Queryable, workItemId: string, message: string) {
  await database.query(
    `update appriver_sync_work_items
     set status = 'queued',
         completed_at = null,
         error_message = $2,
         updated_at = now()
     where id = $1`,
    [workItemId, message],
  );
}

async function failAppRiverWorkItem(database: Queryable, workItemId: string, message: string) {
  await database.query(
    `update appriver_sync_work_items
     set status = 'failed',
         completed_at = now(),
         error_message = $2,
         updated_at = now()
     where id = $1`,
    [workItemId, message],
  );
}

async function loadAppRiverPendingWorkItemCounts(database: Queryable, syncRunId: string) {
  const result = await database.query<AppRiverPendingWorkItemCountRow>(
    `select
       count(*) filter (where status = 'queued') as queued_count,
       count(*) filter (where status = 'processing') as processing_count
     from appriver_sync_work_items
     where sync_run_id = $1`,
    [syncRunId],
  );
  const row = result.rows[0];

  return {
    queuedCount: integerValue(row?.queued_count),
    processingCount: integerValue(row?.processing_count),
  };
}

async function completeAppRiverQueuedSyncIfFinished(database: Queryable, syncRunId: string) {
  const pending = await loadAppRiverPendingWorkItemCounts(database, syncRunId);
  if (pending.queuedCount > 0 || pending.processingCount > 0) {
    return undefined;
  }

  return finalizeAppRiverQueuedSync(database, syncRunId);
}

async function finalizeAppRiverQueuedSync(database: Queryable, syncRunId: string) {
  const [workItemsResult, syncRunResult] = await Promise.all([
    database.query<AppRiverWorkItemFinalizeRow>(
      `select status,
              external_customer_id,
              customer_name,
              records_read,
              records_written,
              subscriptions_read,
              mapped_snapshots,
              unmapped_snapshots,
              failed_subscriptions,
              error_message,
              result_payload
       from appriver_sync_work_items
       where sync_run_id = $1
       order by created_at, id`,
      [syncRunId],
    ),
    database.query<AppRiverSyncRunMetadataRow>(
      `select metadata
       from sync_runs
       where id = $1`,
      [syncRunId],
    ),
  ]);
  const metadata = recordFromJson(syncRunResult.rows[0]?.metadata);
  const workItems = workItemsResult.rows;
  const productSnapshots: Record<string, number> = {};
  const failedCustomerDetails: AppRiverSyncError[] = [];
  const failedSubscriptionDetails: AppRiverSyncError[] = [];

  let recordsRead = 0;
  let recordsWritten = 0;
  let subscriptionsRead = 0;
  let mappedSnapshots = 0;
  let unmappedSnapshots = 0;
  let failedSubscriptions = 0;

  for (const item of workItems) {
    recordsRead += integerValue(item.records_read);
    recordsWritten += integerValue(item.records_written);
    subscriptionsRead += integerValue(item.subscriptions_read);
    mappedSnapshots += integerValue(item.mapped_snapshots);
    unmappedSnapshots += integerValue(item.unmapped_snapshots);
    failedSubscriptions += integerValue(item.failed_subscriptions);

    if (item.status === 'failed') {
      failedCustomerDetails.push({
        customerId: item.external_customer_id,
        customerName: item.customer_name ?? undefined,
        message: item.error_message ?? 'Customer processing failed.',
      });
    }

    const resultPayload = recordFromJson(item.result_payload);
    for (const detail of arrayFromJson(resultPayload.failedSubscriptionDetails)) {
      const record = recordFromJson(detail);
      const customerId = stringFromUnknown(record.customerId);
      const message = stringFromUnknown(record.message);
      if (customerId && message) {
        failedSubscriptionDetails.push({
          customerId,
          customerName: stringFromUnknown(record.customerName),
          subscriptionKey: stringFromUnknown(record.subscriptionKey),
          message,
        });
      }
    }

    const itemProductSnapshots = recordFromJson(resultPayload.productSnapshots);
    for (const [vendorProductKey, count] of Object.entries(itemProductSnapshots)) {
      productSnapshots[vendorProductKey] = (productSnapshots[vendorProductKey] ?? 0) + integerValue(count);
    }
  }

  await completeAppRiverSyncRun(database, syncRunId, recordsRead, recordsWritten, {
    entity: appRiverSyncEntity,
    mode: appRiverQueuedSyncMode,
    customersRead: integerValue(metadata.customersRead) || workItems.length,
    subscriptionsRead,
    mappedSnapshots,
    unmappedSnapshots,
    skippedPartnerCustomers: integerValue(metadata.skippedPartnerCustomers),
    failedCustomers: failedCustomerDetails.length,
    failedCustomerDetails,
    failedSubscriptions,
    failedSubscriptionDetails,
    productSnapshots,
  });

  return {
    recordsRead,
    recordsWritten,
    subscriptionsRead,
    mappedSnapshots,
    unmappedSnapshots,
    failedCustomers: failedCustomerDetails.length,
    failedSubscriptions,
    productSnapshots,
  };
}

async function withAppRiverWorkerLock<T>(
  database: LockableQueryable,
  onLocked: () => T | Promise<T>,
  action: (database: Queryable) => Promise<T>,
) {
  if (!database.connect) {
    return action(database);
  }

  const client = await database.connect();
  try {
    const lockResult = await client.query<{ acquired: boolean | string }>(
      `select pg_try_advisory_lock(hashtext($1)) as acquired`,
      [appRiverWorkerLockKey],
    );
    const acquired = booleanValue(lockResult.rows[0]?.acquired);
    if (!acquired) {
      return onLocked();
    }

    try {
      return await action(client);
    } finally {
      await client.query(`select pg_advisory_unlock(hashtext($1))`, [appRiverWorkerLockKey]);
    }
  } finally {
    client.release?.();
  }
}

async function startAppRiverSyncRun(database: Queryable, metadata: Record<string, unknown> = {}) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [appRiverIntegrationId, JSON.stringify({ entity: appRiverSyncEntity, ...metadata })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create AppRiver - OpenText subscription snapshot sync run.');
  }

  return syncRunId;
}

async function insertAppRiverUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId: string;
    vendorProductKey: string;
    productCode: string;
    productName: string;
    quantity: number;
    observedAt: string;
    customer: AppRiverCustomer;
    detail: AppRiverSubscriptionDetail;
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
      appRiverIntegrationId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.quantity,
      input.observedAt,
      JSON.stringify(dimensionsForSubscription(input.customer, input.detail)),
      JSON.stringify({
        customer: input.customer.raw,
        subscription: input.detail.raw,
      }),
    ],
  );
}

async function completeAppRiverSyncRun(
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

async function failAppRiverSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, errorMessage(error)],
  );
}

function isPartnerCustomer(customer: AppRiverCustomer) {
  return /partner/i.test(customer.customerType ?? '');
}

function customerFromWorkItem(workItem: AppRiverSyncWorkItemRow): AppRiverCustomer {
  return {
    customerId: workItem.external_customer_id,
    name: workItem.customer_name ?? workItem.external_customer_id,
    customerType: workItem.customer_type ?? undefined,
    raw: recordFromJson(workItem.raw_payload),
  };
}

function dimensionsForSubscription(customer: AppRiverCustomer, detail: AppRiverSubscriptionDetail) {
  return {
    subscriptionSource: appRiverSubscriptionSource,
    customerName: customer.name,
    appRiverCustomerName: customer.name,
    appRiverCustomerId: customer.customerId,
    appRiverCustomerType: customer.customerType,
    externalCustomerAccountNumber: customer.externalCustomerAccountNumber,
    subscriptionKey: detail.subscriptionKey,
    productName: detail.productName,
    productCode: detail.productCode,
    totalLicenses: detail.totalLicenses,
    assignedLicenses: detail.assignedLicenses,
    unassignedLicenses: detail.unassignedLicenses,
    subscriptionQuantity: detail.subscriptionQuantity,
    commitmentEndDate: detail.commitmentEndDate,
    expirationDate: detail.expirationDate,
    subscriptionTerm: detail.subscriptionTerm,
    billingFrequency: detail.billingFrequency,
    isTrial: detail.isTrial,
    expirationBehavior: detail.expirationBehavior,
    domain: detail.domain,
    notes: detail.notes,
  };
}

function defaultProductMapping(vendorProductKey: string, detail: AppRiverSubscriptionDetail): AppRiverProductMapping {
  return {
    vendorProductKey,
    productCode: fallbackAppRiverProductCode(vendorProductKey),
    productName: detail.productName ?? vendorProductKey,
  };
}

function withEquivalentAppRiverProductMappings(
  mappings: Record<string, AppRiverProductMapping>,
): Record<string, AppRiverProductMapping> {
  const expanded: Record<string, AppRiverProductMapping> = { ...mappings };

  for (const mapping of Object.values(mappings)) {
    const equivalentKeys = equivalentAppRiverProductKeys(mapping.vendorProductKey).filter((key) => !mappings[key]);
    const vendorProductKeys = [...new Set([mapping.vendorProductKey, ...(mapping.vendorProductKeys ?? []), ...equivalentKeys])];
    const expandedMapping = {
      ...mapping,
      vendorProductKeys,
    };

    expanded[mapping.vendorProductKey] = expandedMapping;
    for (const equivalentKey of equivalentKeys) {
      expanded[equivalentKey] = {
        ...expandedMapping,
        vendorProductKey: equivalentKey,
      };
    }
  }

  return expanded;
}

function equivalentAppRiverProductKeys(vendorProductKey: string) {
  const parts = vendorProductKey.split('|');
  const productName = parts[0]?.trim();
  if (!productName) {
    return [];
  }
  if (!/^(Microsoft|Office)\s+365\b/i.test(productName) || /\(no\s+Teams\)/i.test(productName)) {
    return [];
  }

  const equivalentProductNames = /\s+\(T\)$/i.test(productName)
    ? [productName.replace(/\s+\(T\)$/i, '')]
    : [`${productName} (T)`];

  return equivalentProductNames.map((equivalentProductName) => [equivalentProductName, ...parts.slice(1)].join('|'));
}

function nullableMoney(value: string | number | null | undefined) {
  const amount = typeof value === 'number' ? value : value ? Number.parseFloat(value) : undefined;
  return typeof amount === 'number' && Number.isFinite(amount) ? { amount, currency: 'USD' as const } : undefined;
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function booleanValue(value: boolean | string | undefined) {
  if (typeof value === 'boolean') {
    return value;
  }

  return typeof value === 'string' && /^true$/i.test(value);
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return recordFromJson(parsed);
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function appRiverBundleComponentKeys(value: unknown) {
  return [
    ...new Set(
      arrayFromJson(parseJson(value))
        .flatMap((item) => {
          const record = recordFromJson(item);
          return stringFromUnknown(record.vendorProductKey) ?? [];
        }),
    ),
  ];
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function arrayFromJson(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringFromUnknown(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function isFatalAppRiverSyncError(error: unknown) {
  if (error instanceof AppRiverApiError) {
    return error.status === 400 || error.status === 401 || /refresh token|persist/i.test(error.message);
  }

  return error instanceof Error && /refresh token|persist/i.test(error.message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
