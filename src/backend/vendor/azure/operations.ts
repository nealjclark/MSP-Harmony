import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import {
  AzureCostManagementClient,
  azureCredentialsFromSettings,
  azureIntegrationId,
  azureSubscriptionAllowlist,
  type AzureCostUsageRow,
  type AzureSubscription,
} from './client';

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type AzureUsageClient = {
  listSubscriptions: AzureCostManagementClient['listSubscriptions'];
  queryCostUsage: AzureCostManagementClient['queryCostUsage'];
  listResources?: AzureCostManagementClient['listResources'];
  getVmInstanceView?: AzureCostManagementClient['getVmInstanceView'];
  queryDailyMetrics?: AzureCostManagementClient['queryDailyMetrics'];
  getAvdActivity?: AzureCostManagementClient['getAvdActivity'];
};

type AccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string | null;
};

type ProductMappingRow = {
  vendor_product_key: string;
  connectwise_product_code: string;
  connectwise_product_name: string;
};

export async function testAzureConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  now?: string;
} = {}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(azureIntegrationId);
  assertAzureReady(settings);
  const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
  const subscriptions = filterSubscriptions(await client.listSubscriptions(5), settings);

  return {
    integrationId: azureIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    subscriptionCount: subscriptions.length,
    sampleSubscriptions: subscriptions.slice(0, 10).map(subscriptionSummary),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncAzureCostUsage(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  now?: string;
  onProgress?: SyncProgressReporter;
}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(azureIntegrationId);
  assertAzureReady(settings);

  const now = input.now ? new Date(input.now) : new Date();
  const window = azureQueryWindow(settings, now);
  const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
  const subscriptions = filterSubscriptions(await client.listSubscriptions(100), settings);
  const syncRunId = await startSyncRun(input.pool, window, subscriptions.length);

  try {
    const [accountMappings, productMappings] = await Promise.all([
      loadAccountMappings(input.pool),
      loadProductMappings(input.pool),
    ]);
    let recordsRead = 0;
    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let totalCost = 0;
    let resourceSnapshots = 0;
    let metricSnapshots = 0;
    const failures: Array<{ subscriptionId: string; error: string }> = [];

    await input.onProgress?.({ completed: 0, total: subscriptions.length, unitLabel: 'subscriptions' });
    for (const [index, subscription] of subscriptions.entries()) {
      await input.onProgress?.({
        completed: index,
        total: subscriptions.length,
        currentItem: subscription.displayName ?? subscription.subscriptionId,
        unitLabel: 'subscriptions',
      });

      try {
        const rows = await client.queryCostUsage({
          subscriptionId: subscription.subscriptionId,
          from: window.from,
          to: window.to,
        });
        recordsRead += rows.length;

        for (const row of rows) {
          if (row.cost === 0 && row.usageQuantity === 0) continue;
          const mapping = accountMappings.get(subscription.subscriptionId.toLowerCase());
          const productKey = azureProductKey(row);
          const product = productMappings.get(productKey.toLowerCase());
          if (mapping?.customerId) mappedSnapshots += 1;
          else unmappedSnapshots += 1;
          totalCost += row.cost;

          await insertSnapshot(input.pool, {
            syncRunId,
            subscription,
            row,
            customerId: mapping?.customerId,
            agreementId: mapping?.agreementId,
            vendorProductKey: productKey,
            productCode: product?.productCode ?? productKey,
            productName: product?.productName ?? row.serviceName ?? 'Azure consumption',
          });
          recordsWritten += 1;
        }
        if (client.listResources) {
          const inventory = await collectAzureResourceInventory(input.pool, client, syncRunId, subscription, window);
          resourceSnapshots += inventory.resourceSnapshots;
          metricSnapshots += inventory.metricSnapshots;
          recordsWritten += inventory.resourceSnapshots + inventory.metricSnapshots;
        }
      } catch (error) {
        failures.push({
          subscriptionId: subscription.subscriptionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await input.onProgress?.({
      completed: subscriptions.length,
      total: subscriptions.length,
      unitLabel: 'subscriptions',
    });

    if (subscriptions.length > 0 && failures.length === subscriptions.length) {
      throw new Error(`Azure Cost Management failed for every delegated subscription: ${failures[0]?.error ?? 'unknown error'}`);
    }

    await completeSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'azure-cost-usage',
      queryWindow: window,
      subscriptionCount: subscriptions.length,
      successfulSubscriptions: subscriptions.length - failures.length,
      failedSubscriptions: failures,
      mappedSnapshots,
      unmappedSnapshots,
      totalCost: roundMoney(totalCost),
      resourceSnapshots,
      metricSnapshots,
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      subscriptionCount: subscriptions.length,
      successfulSubscriptions: subscriptions.length - failures.length,
      failedSubscriptions: failures.length,
      mappedSnapshots,
      unmappedSnapshots,
      totalCost: roundMoney(totalCost),
      resourceSnapshots,
      metricSnapshots,
      queryWindow: window,
    };
  } catch (error) {
    await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

async function collectAzureResourceInventory(
  database: Queryable,
  client: AzureUsageClient,
  syncRunId: string,
  subscription: AzureSubscription,
  window: { from: string; to: string },
) {
  if (!client.listResources) return { resourceSnapshots: 0, metricSnapshots: 0 };
  const resources = await client.listResources(subscription.subscriptionId, 100);
  let resourceSnapshots = 0;
  let metricSnapshots = 0;
  for (const resource of resources) {
    let powerState: string | undefined;
    let properties: Record<string, unknown> = resource.properties;
    try {
      if (resource.type?.toLowerCase() === 'microsoft.compute/virtualmachines' && client.getVmInstanceView) {
        const instanceView = await client.getVmInstanceView(resource.id);
        powerState = powerStateFromInstanceView(instanceView);
        properties = { ...properties, instanceView };
      }
      if (resource.type?.toLowerCase() === 'microsoft.desktopvirtualization/hostpools' && client.getAvdActivity) {
        const activity = await client.getAvdActivity(resource.id);
        properties = {
          ...properties,
          activeSessions: activity.activeSessions,
          disconnectedSessions: activity.disconnectedSessions,
          sessionHosts: activity.sessionHosts,
        };
      }
    } catch (error) {
      properties = {
        ...properties,
        telemetryWarning: error instanceof Error ? error.message : String(error),
      };
    }
    await database.query(
      `insert into azure_resource_snapshots (
         sync_run_id, subscription_id, resource_id, resource_name, resource_type,
         resource_group, location, power_state, tags, properties, observed_at, raw_payload
       ) values (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, now(), $11::jsonb
       )
       on conflict (sync_run_id, resource_id) do nothing`,
      [
        syncRunId,
        subscription.subscriptionId,
        resource.id,
        resource.name,
        resource.type ?? null,
        resource.resourceGroup ?? null,
        resource.location ?? null,
        powerState ?? null,
        JSON.stringify(resource.tags),
        JSON.stringify(properties),
        JSON.stringify(resource.raw),
      ],
    );
    resourceSnapshots += 1;

    if (resource.type?.toLowerCase() === 'microsoft.compute/virtualmachines' && client.queryDailyMetrics) {
      try {
        const metrics = await client.queryDailyMetrics({
          resourceId: resource.id,
          metricNames: ['Percentage CPU'],
          from: window.from,
          to: window.to,
        });
        try {
          metrics.push(...await client.queryDailyMetrics({
            resourceId: resource.id,
            metricNames: ['Available Memory Bytes'],
            from: window.from,
            to: window.to,
          }));
        } catch {
          // Guest memory is optional and only exists when the customer's existing
          // Azure Monitor Agent / Log Analytics configuration publishes it.
        }
        for (const metric of metrics) {
          await database.query(
            `insert into azure_resource_metric_daily (
               sync_run_id, resource_id, metric_date, metric_name,
               average_value, maximum_value, total_value, unit, raw_payload
             ) values ($1::uuid, $2, $3::date, $4, $5, $6, $7, $8, $9::jsonb)
             on conflict (sync_run_id, resource_id, metric_date, metric_name) do nothing`,
            [
              syncRunId,
              resource.id,
              metric.date,
              metric.metricName,
              metric.average ?? null,
              metric.maximum ?? null,
              metric.total ?? null,
              metric.unit ?? null,
              JSON.stringify(metric.raw),
            ],
          );
          metricSnapshots += 1;
        }
      } catch {
        // Cost collection remains usable when Monitor metrics are not delegated.
      }
    }
  }
  return { resourceSnapshots, metricSnapshots };
}

function powerStateFromInstanceView(instanceView: Record<string, unknown>) {
  const statuses = Array.isArray(instanceView.statuses) ? instanceView.statuses : [];
  for (const status of statuses) {
    if (!status || typeof status !== 'object') continue;
    const code = String((status as Record<string, unknown>).code ?? '');
    if (code.toLowerCase().startsWith('powerstate/')) return code.split('/')[1];
  }
  return undefined;
}

export function assertAzureReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) return;
  throw new Error(
    `Microsoft Azure settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export function azureProductKey(row: Pick<AzureCostUsageRow, 'serviceName' | 'meterCategory'>) {
  return `azure:${slug(row.serviceName ?? row.meterCategory ?? 'consumption')}`;
}

function filterSubscriptions(subscriptions: AzureSubscription[], settings: IntegrationRuntimeSettings) {
  const allowlist = new Set(azureSubscriptionAllowlist(settings));
  return subscriptions
    .filter((subscription) => subscription.state?.toLowerCase() !== 'disabled')
    .filter((subscription) => allowlist.size === 0 || allowlist.has(subscription.subscriptionId.toLowerCase()))
    .sort((left, right) =>
      (left.displayName ?? left.subscriptionId).localeCompare(right.displayName ?? right.subscriptionId),
    );
}

function subscriptionSummary(subscription: AzureSubscription) {
  return {
    subscriptionId: subscription.subscriptionId,
    displayName: subscription.displayName,
    tenantId: subscription.tenantId,
    state: subscription.state,
  };
}

function azureQueryWindow(settings: IntegrationRuntimeSettings, now: Date) {
  const lookbackDays = boundedInteger(settings.nonSecrets.lookbackDays, 35, 1, 366);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - lookbackDays);
  return { from: from.toISOString(), to: to.toISOString(), lookbackDays };
}

async function loadAccountMappings(database: Queryable) {
  const result = await database.query<AccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'`,
    [azureIntegrationId],
  );
  return new Map(
    result.rows.map((row) => [
      row.external_account_id.toLowerCase(),
      { customerId: row.customer_id, agreementId: row.agreement_id ?? undefined },
    ]),
  );
}

async function loadProductMappings(database: Queryable) {
  const result = await database.query<ProductMappingRow>(
    `select vendor_product_key, connectwise_product_code, connectwise_product_name
     from vendor_product_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     order by target_index`,
    [azureIntegrationId],
  );
  return new Map(
    result.rows.map((row) => [
      row.vendor_product_key.toLowerCase(),
      {
        productCode: row.connectwise_product_code,
        productName: row.connectwise_product_name,
      },
    ]),
  );
}

async function startSyncRun(
  database: Queryable,
  window: { from: string; to: string; lookbackDays: number },
  subscriptionCount: number,
) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [azureIntegrationId, JSON.stringify({ entity: 'azure-cost-usage', queryWindow: window, subscriptionCount })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to create Microsoft Azure cost usage sync run.');
  return id;
}

async function insertSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    subscription: AzureSubscription;
    row: AzureCostUsageRow;
    customerId?: string;
    agreementId?: string;
    vendorProductKey: string;
    productCode: string;
    productName: string;
  },
) {
  const observedAt = input.row.usageDate
    ? new Date(`${input.row.usageDate}T00:00:00.000Z`).toISOString()
    : new Date().toISOString();
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id, vendor_id, customer_id, agreement_id, external_account_id,
       vendor_product_key, product_code, product_name, quantity, observed_at, dimensions, raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
    [
      input.syncRunId,
      azureIntegrationId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.subscription.subscriptionId,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.row.usageQuantity,
      observedAt,
      JSON.stringify({
        sourceType: 'azure-cost-management',
        syncMode: 'live-api',
        externalAccountName: input.subscription.displayName,
        subscriptionId: input.subscription.subscriptionId,
        subscriptionName: input.subscription.displayName,
        tenantId: input.subscription.tenantId,
        usageDate: input.row.usageDate,
        serviceName: input.row.serviceName,
        resourceId: input.row.resourceId,
        resourceGroup: input.row.resourceGroup,
        meterCategory: input.row.meterCategory,
        cost: input.row.cost,
        currency: input.row.currency,
      }),
      JSON.stringify(input.row.raw),
    ],
  );
}

async function completeSyncRun(
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

async function failSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed', completed_at = now(), error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'consumption';
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
