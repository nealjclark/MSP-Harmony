import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { loadCaveloRuleSet, syncCaveloUsageSnapshots, testCaveloConnection, type Queryable } from './operations';

const definition = getIntegrationSettingsDefinition('cavelo');
assert.ok(definition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'cavelo');
    return {
      definition,
      nonSecrets: { endpoint: definition.endpoint },
      secrets: { apiKey: 'secret-key' },
      secretSource: 'environment',
      validation: {
        integrationId: 'cavelo',
        displayName: 'Cavelo',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('cavelo')];
  },
};

const snapshots: unknown[][] = [];
const completions: unknown[][] = [];
const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) return { rows: [{ id: 'cavelo-sync-1' } as T] };
    if (sql.includes('from vendor_account_mappings')) {
      return { rows: [{ external_account_id: 'org-1', customer_id: 'customer-1', agreement_id: 'agreement-1' } as T] };
    }
    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [{ connectwise_product_code: 'CW-CAVELO', connectwise_product_name: 'CW Cavelo Agent' } as T] };
    }
    if (sql.includes('insert into vendor_usage_snapshots')) snapshots.push(values ?? []);
    if (sql.includes("set status = 'complete'")) completions.push(values ?? []);
    return { rows: [] as T[] };
  },
};

const organizations = [{
  organizationUuid: 'org-1',
  organizationId: '101',
  name: 'Mapped Customer',
  raw: { organizationUuid: 'org-1' },
}];

async function run() {
  const ruleSet = await loadCaveloRuleSet({
    async query<T = unknown>() {
      return {
        rows: [
          {
            vendor_product_key: 'cavelo-agent', target_index: 0,
            connectwise_product_code: 'BMB Vulnerability Monitoring',
            connectwise_product_name: 'BMB Vulnerability Monitoring', unit_price: null,
          },
          {
            vendor_product_key: 'cavelo-agent', target_index: 1,
            connectwise_product_code: 'Vulnerability Management',
            connectwise_product_name: 'Vulnerability Management', unit_price: null,
          },
        ] as T[],
      };
    },
  });
  assert.equal(ruleSet.rules.length, 1);
  assert.deepEqual(ruleSet.rules[0]?.targetProductCodes, [
    'BMB Vulnerability Monitoring',
    'Vulnerability Management',
  ]);
  assert.equal(ruleSet.rules[0]?.requiresExistingAgreementProduct, undefined);

  const testResult = await testCaveloConnection({
    provider,
    now: '2026-07-18T13:00:00.000Z',
    client: { async listOrganizations() { return organizations; }, async listOrganizationAgents() { return []; } },
  });
  assert.equal(testResult.organizationCount, 1);
  assert.equal(testResult.sampleOrganizations[0]?.name, 'Mapped Customer');

  const result = await syncCaveloUsageSnapshots({
    pool: database,
    provider,
    now: '2026-07-18T13:00:00.000Z',
    client: {
      async listOrganizations() { return organizations; },
      async listOrganizationAgents(organizationUuid) {
        assert.equal(organizationUuid, 'org-1');
        return [
          {
            agentId: 'agent-active', hostname: 'PC-ACTIVE', enabled: true,
            latestHeartbeatTime: '2026-07-17T13:00:00.000Z', organizationUuid,
            raw: { id: 'agent-active' },
          },
          {
            agentId: 'agent-stale', hostname: 'PC-STALE', enabled: true,
            latestHeartbeatTime: '2026-05-01T13:00:00.000Z', organizationUuid,
            raw: { id: 'agent-stale' },
          },
          {
            agentId: 'agent-disabled', hostname: 'PC-DISABLED', enabled: false,
            latestHeartbeatTime: '2026-07-18T12:00:00.000Z', organizationUuid,
            raw: { id: 'agent-disabled' },
          },
        ];
      },
    },
  });

  assert.deepEqual(result, {
    syncRunId: 'cavelo-sync-1', recordsRead: 3, recordsWritten: 1,
    mappedSnapshots: 1, unmappedSnapshots: 0, inactiveAgents: 2, organizationsRead: 1,
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.[1], 'customer-1');
  assert.equal(snapshots[0]?.[2], 'agreement-1');
  assert.equal(snapshots[0]?.[3], 'org-1');
  assert.equal(snapshots[0]?.[4], 'cavelo-agent');
  assert.equal(snapshots[0]?.[5], 'CW-CAVELO');
  assert.equal(JSON.parse(String(snapshots[0]?.[8])).hostname, 'PC-ACTIVE');
  const metadata = JSON.parse(String(completions[0]?.[3]));
  assert.equal(metadata.inactiveAgents, 2);
  assert.equal(metadata.activeAgents, 1);

  console.log('cavelo operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
