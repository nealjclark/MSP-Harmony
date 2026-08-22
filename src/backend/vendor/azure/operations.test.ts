import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import type { AzureSubscription } from './client';
import {
  azureCheckpointCostWindows,
  azureCostMonthWindows,
  azureCostQueryWindow,
  azureProductKey,
  syncAzureCostUsage,
  testAzureConnection,
  type AzureUsageClient,
  type Queryable,
} from './operations';

const definition = getIntegrationSettingsDefinition('microsoft-azure');
assert.ok(definition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'microsoft-azure');
    return {
      definition,
      nonSecrets: {
        endpoint: 'https://management.azure.com',
        tenantId: 'msp-tenant',
        clientId: 'client-id',
        monthlyBackfillMonths: '3',
      },
      secrets: { clientSecret: 'client-secret' },
      secretSource: 'environment',
      validation: {
        integrationId: 'microsoft-azure',
        displayName: 'Azure - Lighthouse',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('microsoft-azure')];
  },
};

const subscriptions: AzureSubscription[] = [
  {
    subscriptionId: '11111111-1111-1111-1111-111111111111',
    displayName: 'Northstar Azure',
    tenantId: 'customer-tenant',
    state: 'Enabled',
    raw: {},
  },
];

const client: AzureUsageClient = {
  async listSubscriptions() {
    return subscriptions;
  },
  async listTenants() {
    throw new Error('Tenant projection is temporarily unavailable');
  },
  async queryCostUsage(input) {
    await input.onProgress?.({
      phase: 'waiting',
      message: 'Azure is generating the report · checking again in 20 seconds',
      pollCount: 1,
      retryAfterMs: 20_000,
    });
    return [
      {
        subscriptionId: input.subscriptionId,
        usageDate: '2026-07-24',
        serviceName: 'Virtual Machines',
        resourceId:
          `/subscriptions/${input.subscriptionId}/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1`,
        resourceGroup: 'rg-app',
        resourceType: 'microsoft.compute/virtualmachines',
        meterCategory: 'Virtual Machines',
        chargeType: 'Usage',
        cost: 12.34,
        usageQuantity: 24,
        currency: 'USD',
        raw: {},
      },
    ];
  },
};

async function run() {
  const inserted: unknown[][] = [];
  const canonicalCosts: unknown[][] = [];
  const completed: unknown[][] = [];
  const progress: Array<{ completed: number; total: number; failed?: number; currentItem?: string; unitLabel: string }> = [];
  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('insert into sync_runs')) {
        return { rows: [{ id: 'azure-sync-1' } as T] };
      }
      if (sql.includes('from vendor_account_mappings')) {
        return {
          rows: [
            {
              external_account_id: subscriptions[0]?.subscriptionId,
              customer_id: 'customer-1',
              customer_name: 'Northstar Legal',
              agreement_id: 'agreement-1',
              agreement_addition_id: 'agreement-addition-1',
            } as T,
          ],
        };
      }
      if (sql.includes('from vendor_product_mappings')) {
        return { rows: [] as T[] };
      }
      if (sql.includes('insert into vendor_usage_snapshots')) {
        inserted.push(values ?? []);
        return { rows: [] as T[] };
      }
      if (sql.includes('insert into azure_cost_daily')) {
        canonicalCosts.push(values ?? []);
        return { rows: [] as T[] };
      }
      if (sql.includes("set status = 'complete'")) {
        completed.push(values ?? []);
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const dailyWindow = azureCostQueryWindow({
    mode: 'daily',
    now: new Date('2026-08-13T12:00:00.000Z'),
  });
  assert.equal(dailyWindow.from, '2026-08-01T00:00:00.000Z');
  assert.equal(dailyWindow.to, '2026-08-13T00:00:00.000Z');

  const firstOfMonthWindow = azureCostQueryWindow({
    mode: 'daily',
    now: new Date('2026-08-01T12:00:00.000Z'),
  });
  assert.equal(firstOfMonthWindow.from, '2026-07-31T00:00:00.000Z');
  assert.equal(firstOfMonthWindow.to, '2026-08-01T00:00:00.000Z');

  const monthlyWindow = azureCostQueryWindow({
    mode: 'monthly',
    now: new Date('2026-08-13T12:00:00.000Z'),
    monthlyBackfillMonths: 3,
  });
  assert.equal(monthlyWindow.from, '2026-05-01T00:00:00.000Z');
  assert.equal(monthlyWindow.to, '2026-08-01T00:00:00.000Z');
  assert.equal(monthlyWindow.months, 3);
  assert.deepEqual(
    azureCostMonthWindows(monthlyWindow.from, monthlyWindow.to),
    [
      { from: '2026-05-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' },
      { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
      { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
    ],
  );
  assert.deepEqual(
    azureCheckpointCostWindows({
      mode: 'daily',
      fullWindow: dailyWindow,
      checkpoint: {
        subscriptionId: subscriptions[0]?.subscriptionId ?? '',
        syncMode: 'daily',
        coveredThrough: '2026-08-10',
        lastRowCount: 0,
        status: 'success',
      },
    }),
    [{
      from: '2026-08-08T00:00:00.000Z',
      to: '2026-08-13T00:00:00.000Z',
      coveredThrough: '2026-08-12',
    }],
  );
  assert.deepEqual(
    azureCheckpointCostWindows({
      mode: 'daily',
      fullWindow: dailyWindow,
      checkpoint: {
        subscriptionId: subscriptions[0]?.subscriptionId ?? '',
        syncMode: 'daily',
        coveredThrough: '2026-08-12',
        lastRowCount: 0,
        status: 'success',
      },
    }),
    [],
  );
  assert.deepEqual(
    azureCheckpointCostWindows({
      mode: 'monthly',
      fullWindow: monthlyWindow,
      checkpoint: {
        subscriptionId: subscriptions[0]?.subscriptionId ?? '',
        syncMode: 'monthly',
        coveredFrom: '2026-05-01',
        coveredThrough: '2026-05-31',
        cursorDate: '2026-06-01',
        lastRowCount: 0,
        status: 'success',
      },
    }),
    [
      {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        coveredThrough: '2026-06-30',
        cursorDate: '2026-07-01',
      },
      {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
        coveredThrough: '2026-07-31',
        cursorDate: '2026-08-01',
      },
    ],
  );

  const connection = await testAzureConnection({
    provider,
    client,
    now: '2026-07-25T12:00:00.000Z',
  });
  assert.equal(connection.subscriptionCount, 1);
  assert.equal(connection.sampleSubscriptions[0]?.displayName, 'Northstar Azure');
  assert.match(connection.tenantLookupWarning ?? '', /temporarily unavailable/);

  const result = await syncAzureCostUsage({
    pool: database,
    provider,
    client,
    now: '2026-07-25T12:00:00.000Z',
    onProgress: async (value) => {
      progress.push(value);
    },
  });
  assert.equal(result.syncRunId, 'azure-sync-1');
  assert.equal(result.recordsWritten, 1);
  assert.equal(result.mappedSnapshots, 1);
  assert.equal(result.totalCost, 12.34);
  assert.equal(result.mode, 'daily');
  assert.equal(result.queryWindow.from, '2026-07-01T00:00:00.000Z');
  assert.equal(result.queryWindow.to, '2026-07-25T00:00:00.000Z');
  assert.equal(inserted[0]?.[1], 'microsoft-azure');
  assert.equal(inserted[0]?.[2], 'customer-1');
  assert.equal(inserted[0]?.[4], 'agreement-addition-1');
  assert.equal(inserted[0]?.[5], subscriptions[0]?.subscriptionId);
  assert.equal(inserted[0]?.[6], 'azure:virtual-machines');
  assert.equal(inserted[0]?.[9], 24);
  assert.equal(JSON.parse(String(inserted[0]?.[11])).cost, 12.34);
  assert.equal(canonicalCosts.length, 1);
  assert.equal(canonicalCosts[0]?.[0], subscriptions[0]?.subscriptionId);
  assert.equal(canonicalCosts[0]?.[1], '2026-07-24');
  assert.equal(canonicalCosts[0]?.[7], 'Usage');
  assert.equal(canonicalCosts[0]?.[9], 12.34);
  assert.equal(JSON.parse(String(completed[0]?.[3])).successfulSubscriptions, 1);
  assert.equal(progress[0]?.total, 1);
  assert.equal(progress[0]?.unitLabel, 'subscriptions');
  const reportStatus = progress.find((item) => item.currentItem?.includes('Azure is generating the report'));
  assert.match(reportStatus?.currentItem ?? '', /Collecting Northstar Legal/);
  assert.ok(progress.some((item) => item.currentItem?.includes('Storing cost rows 1 of 1')));
  assert.match(progress.find((item) => item.completed === 1)?.currentItem ?? '', /Evaluating cost changes/);
  assert.equal(progress[progress.length - 1]?.completed, 1);
  assert.equal(progress[progress.length - 1]?.total, 1);
  const monthly = await syncAzureCostUsage({
    pool: database,
    provider,
    client,
    now: '2026-08-13T12:00:00.000Z',
    operationKey: 'azure-cost-monthly',
  });
  assert.equal(monthly.mode, 'monthly');
  assert.equal(monthly.operationKey, 'azure-cost-monthly');
  assert.equal(monthly.queryWindow.from, '2026-05-01T00:00:00.000Z');
  assert.equal(monthly.queryWindow.to, '2026-08-01T00:00:00.000Z');

  const emptyCheckpointWrites: Array<{ sql: string; values: unknown[] }> = [];
  const emptyDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('insert into sync_runs')) {
        return { rows: [{ id: 'azure-empty-sync' } as T] };
      }
      if (sql.includes('insert into azure_cost_sync_checkpoints')) {
        emptyCheckpointWrites.push({ sql, values: values ?? [] });
      }
      return { rows: [] as T[] };
    },
  };
  const emptyResult = await syncAzureCostUsage({
    pool: emptyDatabase,
    provider,
    client: {
      async listSubscriptions() {
        return subscriptions;
      },
      async queryCostUsage() {
        return [];
      },
    },
    now: '2026-08-13T12:00:00.000Z',
  });
  assert.equal(emptyResult.recordsRead, 0);
  const emptySuccess = emptyCheckpointWrites.find((write) => write.sql.includes('last_success_at'));
  assert.ok(emptySuccess);
  assert.equal(emptySuccess.values[3], '2026-08-12');
  assert.equal(emptySuccess.values[5], 0);

  const roundRobinCalls: Array<{ subscriptionId: string; from: string }> = [];
  const secondSubscription: AzureSubscription = {
    subscriptionId: '22222222-2222-2222-2222-222222222222',
    displayName: 'Southstar Azure',
    tenantId: 'second-customer-tenant',
    state: 'Enabled',
    raw: {},
  };
  await syncAzureCostUsage({
    pool: emptyDatabase,
    provider,
    client: {
      async listSubscriptions() {
        return [...subscriptions, secondSubscription];
      },
      async queryCostUsage(input) {
        roundRobinCalls.push({ subscriptionId: input.subscriptionId, from: input.from });
        return [];
      },
    },
    now: '2026-08-13T12:00:00.000Z',
    operationKey: 'azure-cost-monthly',
  });
  assert.deepEqual(roundRobinCalls.slice(0, 4), [
    { subscriptionId: subscriptions[0]?.subscriptionId ?? '', from: '2026-05-01T00:00:00.000Z' },
    { subscriptionId: secondSubscription.subscriptionId, from: '2026-05-01T00:00:00.000Z' },
    { subscriptionId: subscriptions[0]?.subscriptionId ?? '', from: '2026-06-01T00:00:00.000Z' },
    { subscriptionId: secondSubscription.subscriptionId, from: '2026-06-01T00:00:00.000Z' },
  ]);

  const stagedEvents: string[] = [];
  await syncAzureCostUsage({
    pool: emptyDatabase,
    provider,
    client: {
      async listSubscriptions() {
        return [...subscriptions, secondSubscription];
      },
      async queryCostUsage() {
        throw new Error('The staged Azure client should not use the combined query method.');
      },
      async requestCostUsageReport(input) {
        stagedEvents.push(`request:${input.subscriptionId}`);
        return {
          subscriptionId: input.subscriptionId,
          state: 'pending',
          location: `https://management.azure.com/operations/${input.subscriptionId}`,
          nextPollAt: 0,
          pollCount: 0,
        };
      },
      async collectCostUsageReport(request) {
        stagedEvents.push(`collect:${request.subscriptionId}`);
        return [];
      },
    },
    now: '2026-08-13T12:00:00.000Z',
  });
  assert.deepEqual(stagedEvents, [
    `request:${subscriptions[0]?.subscriptionId ?? ''}`,
    `request:${secondSubscription.subscriptionId}`,
    `collect:${subscriptions[0]?.subscriptionId ?? ''}`,
    `collect:${secondSubscription.subscriptionId}`,
  ]);

  const boundedCalls: Array<{ subscriptionId: string; from: string }> = [];
  const boundedWrites: string[] = [];
  const boundedDatabase: Queryable = {
    async query<T = unknown>(sql: string) {
      if (sql.includes("metadata->>'jobId'")) {
        return { rows: [{ id: 'azure-resumable-sync' } as T] };
      }
      boundedWrites.push(sql);
      return { rows: [] as T[] };
    },
  };
  const bounded = await syncAzureCostUsage({
    pool: boundedDatabase,
    provider,
    client: {
      async listSubscriptions() {
        return [...subscriptions, secondSubscription];
      },
      async queryCostUsage(input) {
        boundedCalls.push({ subscriptionId: input.subscriptionId, from: input.from });
        return [];
      },
    },
    now: '2026-08-13T12:00:00.000Z',
    operationKey: 'azure-cost-monthly',
    jobId: 'azure-job-1',
    maxCostQueryWindows: 1,
  });
  assert.equal(bounded.syncRunId, 'azure-resumable-sync');
  assert.equal(bounded.continuationPending, true);
  assert.equal(bounded.remainingCostQueryWindows, 5);
  assert.deepEqual(boundedCalls, [
    { subscriptionId: subscriptions[0]?.subscriptionId ?? '', from: '2026-05-01T00:00:00.000Z' },
  ]);
  assert.equal(boundedWrites.filter((sql) => sql.includes('delete from vendor_usage_snapshots')).length, 1);
  assert.equal(boundedWrites.filter((sql) => sql.includes("set status = 'complete'")).length, 0);
  assert.equal(boundedWrites.filter((sql) => sql.includes("and status = 'running'")).length, 1);

  let alreadyCoveredCostQueries = 0;
  let alreadyCoveredRunInserts = 0;
  const alreadyCoveredDatabase: Queryable = {
    async query<T = unknown>(sql: string) {
      if (sql.includes('from azure_cost_sync_checkpoints')) {
        return {
          rows: [subscriptions[0], secondSubscription].map((subscription) => ({
            subscription_id: subscription?.subscriptionId,
            sync_mode: 'monthly',
            covered_from: '2026-05-01',
            covered_through: '2026-07-31',
            cursor_date: '2026-08-01',
            last_attempt_at: '2026-08-13T12:00:00.000Z',
            last_success_at: '2026-08-13T12:00:00.000Z',
            last_row_count: 1,
            status: 'success',
            next_retry_at: null,
            last_error: null,
          } as T)),
        };
      }
      if (sql.includes("status = 'complete'") && sql.includes("metadata->>'entity'")) {
        return { rows: [{ id: 'azure-completed-backfill' } as T] };
      }
      if (sql.includes('insert into sync_runs')) alreadyCoveredRunInserts += 1;
      return { rows: [] as T[] };
    },
  };
  const alreadyCovered = await syncAzureCostUsage({
    pool: alreadyCoveredDatabase,
    provider,
    client: {
      async listSubscriptions() {
        return [...subscriptions, secondSubscription];
      },
      async queryCostUsage() {
        alreadyCoveredCostQueries += 1;
        return [];
      },
    },
    now: '2026-08-13T12:00:00.000Z',
    operationKey: 'azure-cost-monthly',
    maxCostQueryWindows: 1,
  });
  assert.equal(alreadyCovered.alreadyCovered, true);
  assert.equal(alreadyCovered.syncRunId, 'azure-completed-backfill');
  assert.equal(alreadyCoveredCostQueries, 0);
  assert.equal(alreadyCoveredRunInserts, 0);
  assert.equal(azureProductKey({ serviceName: 'Azure SQL Database' }), 'azure:azure-sql-database');

  console.log('azure operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
