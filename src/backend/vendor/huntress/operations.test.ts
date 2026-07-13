import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import {
  HuntressApiError,
  huntressExternalAccountId,
} from './client';
import {
  loadHuntressRuleSet,
  syncHuntressUsageSnapshots,
  testHuntressConnection,
  type HuntressUsageClient,
  type Queryable,
} from './operations';

const huntressDefinition = getIntegrationSettingsDefinition('huntress');
assert.ok(huntressDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'huntress');
    return {
      definition: huntressDefinition,
      nonSecrets: {
        endpoint: 'https://api.huntress.io',
        productClasses: 'itdr',
      },
      secrets: {
        apiKey: 'hk_public',
        apiSecret: 'hs_private',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'huntress',
        displayName: 'Huntress',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('huntress')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) {
      return { rows: [{ id: 'sync-huntress-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: huntressExternalAccountId('101', 'itdr'),
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
            vendor_product_key: 'huntress-itdr',
            target_index: 0,
            connectwise_product_code: 'CW-HUNTRESS-ITDR',
            connectwise_product_name: 'CW Huntress ITDR',
            unit_price: '2.5',
          } as T,
          {
            vendor_product_key: 'huntress-agent',
            target_index: 0,
            connectwise_product_code: 'HUNTRESS',
            connectwise_product_name: 'Huntress Legacy Agent',
            unit_price: null,
          } as T,
        ],
      };
    }

    if (sql.includes('select distinct on (vendor_product_key)')) {
      return {
        rows: [
          {
            vendor_product_key: 'huntress-agent',
            product_code: 'HUNTRESS',
            product_name: 'Huntress Legacy Agent',
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

const client: HuntressUsageClient = {
  async getActor() {
    return {
      reseller: { id: '7', name: 'BMB Consulting' },
      user: { email: 'admin@example.com' },
      raw: {},
    };
  },
  async listOrganizations() {
    return [
      {
        organizationId: '101',
        organizationName: 'Northstar Dental',
        accountId: '7',
        agentsCount: 8,
        billableIdentityCount: 12,
        satLearnerCount: 0,
        logsSourcesCount: 1,
        raw: { id: 101 },
      },
    ];
  },
  async listAgents() {
    return [
      {
        agentId: 'agent-1',
        organizationId: '101',
        hostname: 'laptop-01',
        raw: { id: 'agent-1' },
      },
    ];
  },
  async listResellerInvoices() {
    return [
      {
        invoiceId: '9001',
        status: 'paid',
        createdAt: '2026-07-01T00:00:00Z',
        hasUsage: true,
        raw: { id: 9001 },
      },
    ];
  },
  async listResellerOrganizationUsageLineItems() {
    return [
      {
        lineItemId: 'line-1',
        accountId: '7',
        accountName: 'BMB Consulting',
        organizationId: '101',
        organizationName: 'Northstar Dental',
        periodStart: '2026-06-01T00:00:00Z',
        periodEnd: '2026-06-30T23:59:59Z',
        actualUsage: {
          edr: 8,
          itdr: 12,
        },
        raw: { id: 'line-1' },
      },
    ];
  },
};

async function run() {
  const testResult = await testHuntressConnection({
    provider,
    client,
    now: '2026-07-13T12:00:00.000Z',
  });

  assert.equal(testResult.organizationCount, 1);
  assert.equal(testResult.agentCount, 1);
  assert.equal(testResult.resellerInvoiceCount, 1);
  assert.deepEqual(testResult.productClasses, ['itdr']);

  const accountScopedTestResult = await testHuntressConnection({
    provider,
    now: '2026-07-13T12:01:00.000Z',
    client: {
      ...client,
      async listResellerInvoices() {
        throw new HuntressApiError('This endpoint is only available to multi-account API credentials.', 400);
      },
    },
  });

  assert.equal(accountScopedTestResult.organizationCount, 1);
  assert.equal(accountScopedTestResult.agentCount, 1);
  assert.equal(accountScopedTestResult.resellerInvoiceCount, undefined);

  const syncResult = await syncHuntressUsageSnapshots({
    pool: database,
    provider,
    client,
    now: '2026-07-13T12:05:00.000Z',
  });

  assert.equal(syncResult.syncRunId, 'sync-huntress-1');
  assert.equal(syncResult.usageSource, 'reseller-invoice-usage');
  assert.equal(syncResult.recordsRead, 12);
  assert.equal(syncResult.recordsWritten, 1);
  assert.equal(syncResult.mappedSnapshots, 1);
  assert.equal(syncResult.productSnapshots['huntress-itdr'], 12);
  assert.equal(insertedSnapshots.length, 1);
  assert.equal(insertedSnapshots[0]?.[1], 'huntress');
  assert.equal(insertedSnapshots[0]?.[2], 'customer-1');
  assert.equal(insertedSnapshots[0]?.[3], 'agreement-1');
  assert.equal(insertedSnapshots[0]?.[4], '101|huntress-itdr');
  assert.equal(insertedSnapshots[0]?.[5], 'huntress-itdr');
  assert.equal(insertedSnapshots[0]?.[6], 'CW-HUNTRESS-ITDR');
  assert.equal(insertedSnapshots[0]?.[8], 12);
  assert.equal(JSON.parse(String(insertedSnapshots[0]?.[10])).huntressProductClass, 'itdr');
  assert.equal(JSON.parse(String(completedRuns[0]?.[3])).productClasses[0], 'itdr');

  const fallbackResult = await syncHuntressUsageSnapshots({
    pool: database,
    provider,
    now: '2026-07-13T12:10:00.000Z',
    client: {
      ...client,
      async listResellerInvoices() {
        throw new HuntressApiError('This endpoint is only available to multi-account API credentials.', 400);
      },
    },
  });

  assert.equal(fallbackResult.usageSource, 'organization-summary');
  assert.equal(fallbackResult.recordsRead, 12);

  const ruleSet = await loadHuntressRuleSet(database);
  assert.equal(ruleSet.vendorId, 'huntress');
  assert.equal(ruleSet.rules.some((rule) => rule.vendorProductKey === 'huntress-itdr'), true);
  assert.equal(ruleSet.rules.some((rule) => rule.vendorProductKey === 'huntress-agent'), true);

  console.log('huntress operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
