import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { loadSentinelOneRuleSet, syncSentinelOneUsageSnapshots, testSentinelOneConnection, type Queryable } from './operations';

const sentinelOneDefinition = getIntegrationSettingsDefinition('sentinelone');
assert.ok(sentinelOneDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'sentinelone');
    return {
      definition: sentinelOneDefinition,
      nonSecrets: {
        endpoint: 'https://usea1.sentinelone.net',
      },
      secrets: {
        apiToken: 'token',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'sentinelone',
        displayName: 'SentinelOne',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('sentinelone')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) {
      return { rows: [{ id: 'sync-sentinel-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: 'site-1',
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
            vendor_product_key: 'sentinelone-server',
            target_index: 0,
            connectwise_product_code: 'CW-S1-SERVER',
            connectwise_product_name: 'CW SentinelOne Server',
            unit_price: '12',
          } as T,
          {
            vendor_product_key: 'sentinelone-workstation',
            target_index: 0,
            connectwise_product_code: 'CW-S1-WORKSTATION',
            connectwise_product_name: 'CW SentinelOne Workstation',
            unit_price: '4',
          } as T,
        ],
      };
    }

    if (sql.includes('insert into vendor_usage_snapshots')) {
      insertedSnapshots.push(values ?? []);
      return { rows: [] };
    }

    if (sql.includes("set status = 'complete'")) {
      completedRuns.push(values ?? []);
      return { rows: [] };
    }

    return { rows: [] };
  },
};

async function run() {
  const testResult = await testSentinelOneConnection({
    provider,
    now: '2026-07-07T12:00:00.000Z',
    client: {
      async listAccounts() {
        return [{ accountId: 'acct-1', accountName: 'Partner Account', raw: {} }];
      },
      async listSites() {
        return [
          { siteId: 'site-1', siteName: 'Northstar Dental', accountId: 'acct-1', raw: {} },
          { siteId: 'site-2', siteName: 'Summit Legal', accountId: 'acct-1', raw: {} },
        ];
      },
      async listAgents() {
        return [];
      },
    },
  });

  assert.equal(testResult.accountCount, 1);
  assert.equal(testResult.siteCount, 2);
  assert.equal(testResult.sampleSites[0]?.siteId, 'site-1');

  const syncResult = await syncSentinelOneUsageSnapshots({
    pool: database,
    provider,
    now: '2026-07-07T12:05:00.000Z',
    client: {
      async listAccounts() {
        return [];
      },
      async listSites() {
        return [];
      },
      async listAgents() {
        return [
          {
            agentId: 'agent-1',
            computerName: 'desktop-01',
            machineType: 'workstation',
            siteId: 'site-1',
            siteName: 'Northstar Dental',
            accountId: 'acct-1',
            lastActiveDate: '2026-06-29T09:15:00Z',
            raw: { id: 'agent-1' },
          },
          {
            agentId: 'agent-2',
            computerName: 'SERVER-03',
            machineType: 'server',
            siteId: 'site-1',
            siteName: 'Northstar Dental',
            accountId: 'acct-1',
            lastActiveDate: '2026-06-29T09:45:00Z',
            raw: { id: 'agent-2' },
          },
          {
            agentId: 'agent-3',
            computerName: 'unknown-device',
            machineType: 'unknown',
            siteId: 'site-2',
            raw: { id: 'agent-3' },
          },
        ];
      },
    },
  });

  assert.equal(syncResult.recordsRead, 3);
  assert.equal(syncResult.recordsWritten, 2);
  assert.equal(syncResult.mappedSnapshots, 2);
  assert.equal(syncResult.unmappedSnapshots, 0);
  assert.equal(syncResult.skippedSnapshots, 1);
  assert.equal(syncResult.serverSnapshots, 1);
  assert.equal(syncResult.workstationSnapshots, 1);
  assert.equal(insertedSnapshots.length, 2);
  assert.equal(insertedSnapshots[0]?.[3], 'site-1');
  // Live API snapshots use device:* keys when product mappings are present so CSV and API reconcile together.
  assert.equal(insertedSnapshots[0]?.[4], 'device:workstation');
  assert.equal(insertedSnapshots[1]?.[4], 'device:server');
  assert.equal(JSON.parse(String(insertedSnapshots[0]?.[8])).lastCheckIn, '2026-06-29T09:15:00Z');
  assert.equal(JSON.parse(String(insertedSnapshots[1]?.[8])).lastActiveDate, '2026-06-29T09:45:00Z');

  const ruleSet = await loadSentinelOneRuleSet(database);
  assert.equal(ruleSet.vendorId, 'sentinelone');
  assert.equal(ruleSet.rules.some((rule) => rule.vendorProductKey === 'device:server'), true);
  assert.equal(ruleSet.rules.some((rule) => rule.vendorProductKey === 'device:workstation'), true);
  assert.equal(ruleSet.rules.some((rule) => rule.productCode === 'CW-S1-SERVER'), true);

  console.log('sentinelone operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
