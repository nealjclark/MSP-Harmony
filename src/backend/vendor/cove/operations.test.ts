import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { loadCoveRuleSet, syncCoveUsageSnapshots, testCoveConnection, type Queryable } from './operations';

const coveDefinition = getIntegrationSettingsDefinition('cove');
assert.ok(coveDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'cove');
    return {
      definition: coveDefinition,
      nonSecrets: {
        endpoint: 'https://api.backup.management',
        partnerName: 'BMB Consulting',
      },
      secrets: {
        username: 'api-user@example.com',
        password: 'secret',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'cove',
        displayName: 'Cove Data Protection',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('cove')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];
const queries: Array<{ sql: string; values?: unknown[] }> = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('insert into sync_runs')) {
      return { rows: [{ id: 'sync-cove-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: '101',
            customer_id: 'customer-1',
            agreement_id: 'agreement-1',
          } as T,
        ],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return {
        rows: [
          {
            vendor_product_key: 'cove-server',
            target_index: 0,
            connectwise_product_code: 'CW-COVE-SERVER',
            connectwise_product_name: 'CW Cove Server',
            unit_price: '120',
          } as T,
          {
            vendor_product_key: 'cove-workstation',
            target_index: 0,
            connectwise_product_code: 'CW-COVE-WORKSTATION',
            connectwise_product_name: 'CW Cove Workstation',
            unit_price: '15',
          } as T,
          {
            vendor_product_key: 'cove-server-storage-addon',
            target_index: 0,
            connectwise_product_code: 'CW-COVE-STORAGE',
            connectwise_product_name: 'CW Cove Storage Add-on',
            unit_price: '75',
          } as T,
        ],
      };
    }

    if (sql.includes('insert into vendor_usage_snapshots')) {
      insertedSnapshots.push(values ?? []);
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'complete'")) {
      completedRuns.push(values ?? []);
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  const testResult = await testCoveConnection({
    provider,
    now: '2026-06-15T12:00:00.000Z',
    client: {
      async login() {
        return {
          partnerId: 101,
          visa: 'visa',
          username: 'api-user@example.com',
        };
      },
      async listAccountStatistics() {
        return [];
      },
    },
  });

  assert.equal(testResult.partnerId, 101);
  assert.equal(testResult.username, 'api-user@example.com');

  const syncResult = await syncCoveUsageSnapshots({
    pool: database,
    provider,
    now: '2026-06-15T13:00:00.000Z',
    client: {
      async login() {
        return {
          partnerId: 101,
          visa: 'visa',
        };
      },
      async listAccountStatistics() {
        return [
          {
            accountId: 9001,
            partnerId: 101,
            customerName: 'Mapped Customer',
            computerName: 'mapped-server',
            deviceType: 'server',
            physicality: 'Virtual',
            selectedStorageGb: 1135,
            usedStorageGb: 940,
            raw: { AccountId: 9001 },
          },
          {
            accountId: 9002,
            partnerId: 202,
            customerName: 'Unmapped Customer',
            computerName: 'unmapped-laptop',
            deviceType: 'workstation',
            physicality: 'Physical',
            selectedStorageGb: 151,
            usedStorageGb: 208,
            raw: { AccountId: 9002 },
          },
          {
            accountId: 9003,
            partnerId: 303,
            customerName: 'Undefined Customer',
            computerName: 'unknown',
            deviceType: 'undefined',
            selectedStorageGb: 1,
            usedStorageGb: 1,
            raw: { AccountId: 9003 },
          },
        ];
      },
    },
  });

  assert.equal(syncResult.syncRunId, 'sync-cove-1');
  assert.equal(syncResult.recordsRead, 3);
  assert.equal(syncResult.recordsWritten, 2);
  assert.equal(syncResult.mappedSnapshots, 1);
  assert.equal(syncResult.unmappedSnapshots, 1);
  assert.equal(syncResult.skippedSnapshots, 1);
  assert.equal(syncResult.serverSnapshots, 1);
  assert.equal(syncResult.workstationSnapshots, 1);

  const mappedSnapshot = insertedSnapshots[0];
  assert.equal(mappedSnapshot?.[1], 'customer-1');
  assert.equal(mappedSnapshot?.[2], 'agreement-1');
  assert.equal(mappedSnapshot?.[3], '101');
  assert.equal(mappedSnapshot?.[4], 'cove-server');
  assert.equal(mappedSnapshot?.[5], 'CW-COVE-SERVER');
  assert.deepEqual(JSON.parse(String(mappedSnapshot?.[8])), {
    protectedSystemType: 'server',
    physicality: 'Virtual',
    selectedStorageGb: 1135,
    usedStorageGb: 940,
    hostname: 'mapped-server',
    coveCustomerName: 'Mapped Customer',
    covePartnerId: 101,
    accountId: 9001,
  });

  const unmappedSnapshot = insertedSnapshots[1];
  assert.equal(unmappedSnapshot?.[1], null);
  assert.equal(unmappedSnapshot?.[2], null);
  assert.equal(unmappedSnapshot?.[3], '202');
  assert.equal(unmappedSnapshot?.[4], 'cove-workstation');
  assert.equal(unmappedSnapshot?.[5], 'CW-COVE-WORKSTATION');

  const completeMetadata = JSON.parse(String(completedRuns[0]?.[3]));
  assert.equal(completeMetadata.mappedSnapshots, 1);
  assert.equal(completeMetadata.unmappedSnapshots, 1);
  assert.equal(completeMetadata.skippedSnapshots, 1);
  assert.equal(queries.some((query) => query.sql.includes('vendor_product_mappings')), true);

  const ruleSet = await loadCoveRuleSet(database);
  const serverRule = ruleSet.rules.find((rule) => rule.id === 'cove-server-selected-storage');
  assert.equal(serverRule?.productCode, 'CW-COVE-SERVER');
  assert.equal(serverRule?.addOn?.productCode, 'CW-COVE-STORAGE');
  assert.equal(serverRule?.addOn?.unitPrice.amount, 75);

  console.log('cove operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
