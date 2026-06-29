import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { loadDattoRuleSet, syncDattoUsageSnapshots, testDattoConnection, type Queryable } from './operations';

const dattoDefinition = getIntegrationSettingsDefinition('datto');
assert.ok(dattoDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'datto');
    return {
      definition: dattoDefinition,
      nonSecrets: {
        endpoint: 'https://api.datto.com',
      },
      secrets: {
        apiKey: 'public',
        apiSecret: 'private',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'datto',
        displayName: 'Datto Backup',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('datto')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];
const queries: Array<{ sql: string; values?: unknown[] }> = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('insert into sync_runs')) {
      return { rows: [{ id: 'sync-datto-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: 'Mapped Client',
            customer_id: 'customer-1',
            agreement_id: 'agreement-1',
          } as T,
          {
            external_account_id: 'saas-1|datto-saas-office365-icr',
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
            vendor_product_key: 'datto-bcdr-agent',
            target_index: 0,
            connectwise_product_code: 'CW-DATTO-BCDR',
            connectwise_product_name: 'CW Datto BCDR Agent',
            unit_price: '99',
          } as T,
          {
            vendor_product_key: 'datto-saas-office365-icr',
            target_index: 0,
            connectwise_product_code: 'CW-DATTO-SAAS-O365-ICR',
            connectwise_product_name: 'CW Datto SaaS O365 ICR',
            unit_price: '3',
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
  const client = {
    async listBcdrProtectedAgents() {
      return [
        {
          customerName: 'Mapped Client',
          deviceHostname: 'siris-01',
          deviceSerial: 'ABC123',
          agentName: 'dc-01',
          raw: { device: { Hostname: 'siris-01' }, backupVolume: { Agent: 'dc-01' } },
        },
        {
          customerName: 'Unmapped Client',
          deviceHostname: 'siris-02',
          agentName: 'fs-01',
          raw: { device: { Hostname: 'siris-02' }, backupVolume: { Agent: 'fs-01' } },
        },
      ];
    },
    async listSaasDomains() {
      return [
        {
          saasCustomerId: 'saas-1',
          customerName: 'Mapped Client',
          domain: 'mapped.example',
          raw: { saasCustomerId: 'saas-1' },
        },
      ];
    },
    async listSaasUsageSummaries() {
      return [
        {
          saasCustomerId: 'saas-1',
          customerName: 'Mapped Client',
          domain: 'mapped.example',
          productKey: 'datto-saas-office365-icr' as const,
          productType: 'Office365',
          retentionType: 'ICR',
          quantity: 42,
          source: 'domain-seats-used' as const,
          raw: { domain: { saasCustomerId: 'saas-1' }, productType: 'Office365', retentionType: 'ICR', seatsUsed: 42 },
        },
      ];
    },
  };

  const testResult = await testDattoConnection({
    provider,
    client,
    now: '2026-06-15T12:00:00.000Z',
  });

  assert.equal(testResult.bcdrAgentCount, 2);
  assert.equal(testResult.saasDomainCount, 1);
  assert.equal(testResult.sampleBcdrAgents[0]?.agentName, 'dc-01');

  const syncResult = await syncDattoUsageSnapshots({
    pool: database,
    provider,
    client,
    includeBcdr: true,
    now: '2026-06-15T13:00:00.000Z',
  });

  assert.equal(syncResult.syncRunId, 'sync-datto-1');
  assert.equal(syncResult.recordsRead, 44);
  assert.equal(syncResult.recordsWritten, 3);
  assert.equal(syncResult.bcdrAgentsRead, 2);
  assert.equal(syncResult.saasSeatQuantityRead, 42);
  assert.equal(syncResult.mappedSnapshots, 2);
  assert.equal(syncResult.unmappedSnapshots, 1);

  const mappedBcdrSnapshot = insertedSnapshots[0];
  assert.equal(mappedBcdrSnapshot?.[1], 'datto');
  assert.equal(mappedBcdrSnapshot?.[2], 'customer-1');
  assert.equal(mappedBcdrSnapshot?.[3], 'agreement-1');
  assert.equal(mappedBcdrSnapshot?.[4], 'Mapped Client');
  assert.equal(mappedBcdrSnapshot?.[5], 'datto-bcdr-agent');
  assert.equal(mappedBcdrSnapshot?.[6], 'CW-DATTO-BCDR');
  assert.deepEqual(JSON.parse(String(mappedBcdrSnapshot?.[10])), {
    dattoProductFamily: 'bcdr',
    dattoExternalAccountName: 'Mapped Client / BCDR',
    dattoCustomerName: 'Mapped Client',
    dattoDeviceHostname: 'siris-01',
    dattoDeviceSerial: 'ABC123',
    dattoAgentName: 'dc-01',
  });

  const saasSnapshot = insertedSnapshots[2];
  assert.equal(saasSnapshot?.[4], 'saas-1|datto-saas-office365-icr');
  assert.equal(saasSnapshot?.[5], 'datto-saas-office365-icr');
  assert.equal(saasSnapshot?.[6], 'CW-DATTO-SAAS-O365-ICR');
  assert.equal(saasSnapshot?.[8], 42);
  assert.equal(
    JSON.parse(String(saasSnapshot?.[10])).dattoExternalAccountName,
    'Mapped Client / Office 365 Infinite Cloud Retention',
  );

  const completeMetadata = JSON.parse(String(completedRuns[0]?.[3]));
  assert.equal(completeMetadata.bcdrAgentsRead, 2);
  assert.equal(completeMetadata.saasSeatQuantityRead, 42);
  assert.equal(queries.some((query) => query.sql.includes('vendor_product_mappings')), true);

  const ruleSet = await loadDattoRuleSet(database);
  const bcdrRule = ruleSet.rules.find((rule) => rule.id === 'datto-bcdr-agent-count');
  const saasRule = ruleSet.rules.find((rule) => rule.id === 'datto-saas-office365-icr-count');
  assert.equal(bcdrRule?.productCode, 'CW-DATTO-BCDR');
  assert.equal(saasRule?.productCode, 'CW-DATTO-SAAS-O365-ICR');

  console.log('datto operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
