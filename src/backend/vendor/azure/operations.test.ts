import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import type { AzureSubscription } from './client';
import {
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
        lookbackDays: '35',
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
  assert.equal(progress[0]?.total, 2);
  assert.equal(progress[0]?.unitLabel, 'monitoring steps');
  assert.match(progress.find((item) => item.completed === 1)?.currentItem ?? '', /Evaluating cost changes/);
  assert.equal(progress[progress.length - 1]?.completed, 2);
  assert.equal(progress[progress.length - 1]?.total, 2);
  assert.equal(azureProductKey({ serviceName: 'Azure SQL Database' }), 'azure:azure-sql-database');

  console.log('azure operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
