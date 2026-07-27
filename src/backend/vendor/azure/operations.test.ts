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
        displayName: 'Microsoft Azure',
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
  async queryCostUsage(input) {
    return [
      {
        subscriptionId: input.subscriptionId,
        usageDate: '2026-07-24',
        serviceName: 'Virtual Machines',
        resourceId:
          `/subscriptions/${input.subscriptionId}/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1`,
        resourceGroup: 'rg-app',
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
  const completed: unknown[][] = [];
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

  const result = await syncAzureCostUsage({
    pool: database,
    provider,
    client,
    now: '2026-07-25T12:00:00.000Z',
  });
  assert.equal(result.syncRunId, 'azure-sync-1');
  assert.equal(result.recordsWritten, 1);
  assert.equal(result.mappedSnapshots, 1);
  assert.equal(result.totalCost, 12.34);
  assert.equal(inserted[0]?.[1], 'microsoft-azure');
  assert.equal(inserted[0]?.[2], 'customer-1');
  assert.equal(inserted[0]?.[4], subscriptions[0]?.subscriptionId);
  assert.equal(inserted[0]?.[5], 'azure:virtual-machines');
  assert.equal(inserted[0]?.[8], 24);
  assert.equal(JSON.parse(String(inserted[0]?.[10])).cost, 12.34);
  assert.equal(JSON.parse(String(completed[0]?.[3])).successfulSubscriptions, 1);
  assert.equal(azureProductKey({ serviceName: 'Azure SQL Database' }), 'azure:azure-sql-database');

  console.log('azure operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
