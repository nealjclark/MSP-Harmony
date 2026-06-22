import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import {
  loadAppRiverRuleSet,
  processNextAppRiverQueuedCustomer,
  startAppRiverQueuedSubscriptionSync,
  syncAppRiverSubscriptionSnapshots,
  testAppRiverConnection,
  type AppRiverSecureCloudClient,
  type Queryable,
} from './operations';

const appRiverDefinition = getIntegrationSettingsDefinition('opentext-appriver');
assert.ok(appRiverDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'opentext-appriver');
    return {
      definition: appRiverDefinition,
      nonSecrets: {
        endpoint: 'https://unityapi.webrootcloudav.com',
        clientId: 'client-id',
      },
      secrets: {
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'opentext-appriver',
        displayName: 'AppRiver - OpenText',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('opentext-appriver')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];

const mappedProductKey = 'Microsoft 365 Business Premium|Annual|Monthly';

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) {
      assert.equal(values?.[0], 'opentext-appriver');
      return { rows: [{ id: 'sync-appriver-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: 'customer-1',
            external_account_name: 'Mapped Client',
            customer_id: 'cw-customer-1',
            agreement_id: 'cw-agreement-1',
          } as T,
        ],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return {
        rows: [
          {
            vendor_product_key: mappedProductKey,
            target_index: 0,
            connectwise_product_code: 'CW-M365-BUSINESS-PREMIUM',
            connectwise_product_name: 'Microsoft 365 Business Premium',
            unit_price: '22',
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

const client: AppRiverSecureCloudClient = {
  async authenticate() {
    return {};
  },
  async listCustomers() {
    return [
      {
        customerId: 'customer-1',
        name: 'Mapped Client',
        customerType: 'Customer',
        externalCustomerAccountNumber: 'cw-123',
        raw: { CustomerID: 'customer-1' },
      },
      {
        customerId: 'partner-1',
        name: 'Parent Partner',
        customerType: 'Partner',
        raw: { CustomerID: 'partner-1' },
      },
      {
        customerId: 'customer-2',
        name: 'Unmapped Client',
        customerType: 'Customer',
        raw: { CustomerID: 'customer-2' },
      },
    ];
  },
  async listCustomerSubscriptions(customerId: string) {
    if (customerId === 'customer-1') {
      return [
        {
          subscriptionKey: 'sub-1',
          productName: 'Microsoft 365 Business Premium',
          raw: { SubscriptionKey: 'sub-1' },
        },
        {
          subscriptionKey: 'sub-fail',
          productName: 'Broken Subscription',
          raw: { SubscriptionKey: 'sub-fail' },
        },
      ];
    }

    return [
      {
        subscriptionKey: 'sub-2',
        productName: 'Exchange Online Plan 1',
        raw: { SubscriptionKey: 'sub-2' },
      },
    ];
  },
  async getCustomerSubscriptionDetails(_customerId: string, subscriptionKey: string) {
    if (subscriptionKey === 'sub-fail') {
      throw new Error('Subscription details failed');
    }

    if (subscriptionKey === 'sub-1') {
      return {
        subscriptionKey,
        productName: 'Microsoft 365 Business Premium',
        totalLicenses: 3,
        assignedLicenses: 1,
        unassignedLicenses: 2,
        subscriptionQuantity: 3,
        commitmentEndDate: '2027-01-01T00:00:00Z',
        subscriptionTerm: 'Annual',
        billingFrequency: 'Monthly',
        domain: 'mapped.example',
        isTrial: false,
        raw: { SubscriptionKey: subscriptionKey, ProductName: 'Microsoft 365 Business Premium' },
      };
    }

    return {
      subscriptionKey,
      productName: 'Exchange Online Plan 1',
      totalLicenses: 1,
      assignedLicenses: 1,
      unassignedLicenses: 0,
      subscriptionQuantity: 1,
      subscriptionTerm: 'Monthly',
      billingFrequency: 'Monthly',
      domain: 'unmapped.example',
      isTrial: false,
      raw: { SubscriptionKey: subscriptionKey, ProductName: 'Exchange Online Plan 1' },
    };
  },
};

type QueuedWorkItem = {
  id: string;
  sync_run_id: string;
  external_customer_id: string;
  customer_name: string | null;
  customer_type: string | null;
  status: string;
  attempts: number;
  records_read: number;
  records_written: number;
  subscriptions_read: number;
  mapped_snapshots: number;
  unmapped_snapshots: number;
  failed_subscriptions: number;
  error_message: string | null;
  raw_payload: unknown;
  result_payload: unknown;
};

function createQueuedDatabase() {
  const workItems: QueuedWorkItem[] = [];
  const snapshots: unknown[][] = [];
  const completed: unknown[][] = [];
  let syncMetadata: Record<string, unknown> = {};

  const queuedDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('from sync_runs') && sql.includes("status = 'running'")) {
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into sync_runs')) {
        syncMetadata = JSON.parse(String(values?.[1]));
        return { rows: [{ id: 'queued-sync-1' } as T] };
      }

      if (sql.includes('insert into appriver_sync_work_items')) {
        workItems.push({
          id: `work-${workItems.length + 1}`,
          sync_run_id: String(values?.[0]),
          external_customer_id: String(values?.[1]),
          customer_name: values?.[2] ? String(values[2]) : null,
          customer_type: values?.[3] ? String(values[3]) : null,
          status: 'queued',
          attempts: 0,
          records_read: 0,
          records_written: 0,
          subscriptions_read: 0,
          mapped_snapshots: 0,
          unmapped_snapshots: 0,
          failed_subscriptions: 0,
          error_message: null,
          raw_payload: JSON.parse(String(values?.[4])),
          result_payload: {},
        });
        return { rows: [] as T[] };
      }

      if (sql.includes('update sync_runs') && sql.includes('metadata = metadata ||') && !sql.includes("set status = 'complete'")) {
        syncMetadata = {
          ...syncMetadata,
          ...JSON.parse(String(values?.[1])),
        };
        return { rows: [] as T[] };
      }

      if (sql.includes('update appriver_sync_work_items') && sql.includes("status = 'queued'") && sql.includes('15 minutes')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('update appriver_sync_work_items') && sql.includes("status = 'processing'") && sql.includes('returning')) {
        const next = workItems.find((item) => item.sync_run_id === values?.[0] && item.status === 'queued');
        if (!next) {
          return { rows: [] as T[] };
        }

        next.status = 'processing';
        next.attempts += 1;
        next.error_message = null;
        return {
          rows: [
            {
              id: next.id,
              sync_run_id: next.sync_run_id,
              external_customer_id: next.external_customer_id,
              customer_name: next.customer_name,
              customer_type: next.customer_type,
              attempts: next.attempts,
              raw_payload: next.raw_payload,
            } as T,
          ],
        };
      }

      if (sql.includes('from vendor_account_mappings')) {
        return {
          rows: [
            {
              external_account_id: 'customer-1',
              external_account_name: 'Mapped Client',
              customer_id: 'cw-customer-1',
              agreement_id: 'cw-agreement-1',
            } as T,
          ],
        };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return {
          rows: [
            {
              vendor_product_key: mappedProductKey,
              target_index: 0,
              connectwise_product_code: 'CW-M365-BUSINESS-PREMIUM',
              connectwise_product_name: 'Microsoft 365 Business Premium',
              unit_price: '22',
            } as T,
          ],
        };
      }

      if (sql.includes('delete from vendor_usage_snapshots')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into vendor_usage_snapshots')) {
        snapshots.push(values ?? []);
        return { rows: [] as T[] };
      }

      if (sql.includes('update appriver_sync_work_items') && sql.includes("status = 'complete'")) {
        const item = workItems.find((candidate) => candidate.id === values?.[0]);
        assert.ok(item);
        item.status = 'complete';
        item.records_read = Number(values?.[1] ?? 0);
        item.records_written = Number(values?.[2] ?? 0);
        item.subscriptions_read = Number(values?.[3] ?? 0);
        item.mapped_snapshots = Number(values?.[4] ?? 0);
        item.unmapped_snapshots = Number(values?.[5] ?? 0);
        item.failed_subscriptions = Number(values?.[6] ?? 0);
        item.result_payload = JSON.parse(String(values?.[7]));
        item.error_message = null;
        return { rows: [] as T[] };
      }

      if (sql.includes('update appriver_sync_work_items') && sql.includes("status = 'failed'")) {
        const item = workItems.find((candidate) => candidate.id === values?.[0]);
        assert.ok(item);
        item.status = 'failed';
        item.error_message = String(values?.[1] ?? '');
        return { rows: [] as T[] };
      }

      if (sql.includes('update appriver_sync_work_items') && sql.includes("status = 'queued'")) {
        const item = workItems.find((candidate) => candidate.id === values?.[0]);
        assert.ok(item);
        item.status = 'queued';
        item.error_message = String(values?.[1] ?? '');
        return { rows: [] as T[] };
      }

      if (sql.includes('count(*) filter')) {
        return {
          rows: [
            {
              queued_count: workItems.filter((item) => item.sync_run_id === values?.[0] && item.status === 'queued').length,
              processing_count: workItems.filter((item) => item.sync_run_id === values?.[0] && item.status === 'processing').length,
            } as T,
          ],
        };
      }

      if (sql.includes('from appriver_sync_work_items') && sql.includes('result_payload')) {
        return { rows: workItems as unknown as T[] };
      }

      if (sql.includes('select metadata') && sql.includes('from sync_runs')) {
        return { rows: [{ metadata: syncMetadata } as T] };
      }

      if (sql.includes("set status = 'complete'")) {
        completed.push(values ?? []);
        return { rows: [] as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  return {
    database: queuedDatabase,
    workItems,
    snapshots,
    completed,
  };
}

async function run() {
  const testResult = await testAppRiverConnection({
    provider,
    client,
    now: '2026-06-19T12:00:00.000Z',
  });
  assert.equal(testResult.integrationId, 'opentext-appriver');
  assert.equal(testResult.customerCount, 3);
  assert.equal(testResult.firstCustomerSubscriptionCount, 2);

  const syncResult = await syncAppRiverSubscriptionSnapshots({
    pool: database,
    provider,
    client,
    now: '2026-06-19T13:00:00.000Z',
  });

  assert.equal(syncResult.syncRunId, 'sync-appriver-1');
  assert.equal(syncResult.recordsRead, 3);
  assert.equal(syncResult.recordsWritten, 2);
  assert.equal(syncResult.customersRead, 3);
  assert.equal(syncResult.subscriptionsRead, 3);
  assert.equal(syncResult.mappedSnapshots, 1);
  assert.equal(syncResult.unmappedSnapshots, 1);
  assert.equal(syncResult.skippedPartnerCustomers, 1);
  assert.equal(syncResult.failedSubscriptions, 1);
  assert.equal(syncResult.productSnapshots[mappedProductKey], 1);

  const mappedSnapshot = insertedSnapshots[0];
  assert.equal(mappedSnapshot?.[1], 'opentext-appriver');
  assert.equal(mappedSnapshot?.[2], 'cw-customer-1');
  assert.equal(mappedSnapshot?.[3], 'cw-agreement-1');
  assert.equal(mappedSnapshot?.[4], 'customer-1');
  assert.equal(mappedSnapshot?.[5], mappedProductKey);
  assert.equal(mappedSnapshot?.[6], 'CW-M365-BUSINESS-PREMIUM');
  assert.equal(mappedSnapshot?.[8], 3);
  const mappedDimensions = JSON.parse(String(mappedSnapshot?.[10]));
  assert.equal(mappedDimensions.subscriptionSource, 'appriver-securecloud-subscription');
  assert.equal(mappedDimensions.customerName, 'Mapped Client');
  assert.equal(mappedDimensions.assignedLicenses, 1);
  assert.equal(mappedDimensions.unassignedLicenses, 2);
  assert.equal(mappedDimensions.domain, 'mapped.example');

  const fallbackSnapshot = insertedSnapshots[1];
  assert.equal(fallbackSnapshot?.[2], null);
  assert.equal(fallbackSnapshot?.[3], null);
  assert.equal(fallbackSnapshot?.[4], 'customer-2');
  assert.equal(fallbackSnapshot?.[6], 'EXCHANGE-ONLINE-PLAN-1-MONTHLY-MONTHLY');
  assert.equal(fallbackSnapshot?.[8], 1);

  const metadata = JSON.parse(String(completedRuns[0]?.[3]));
  assert.equal(metadata.entity, 'subscription-snapshots');
  assert.equal(metadata.failedSubscriptions, 1);
  assert.equal(metadata.failedSubscriptionDetails[0]?.subscriptionKey, 'sub-fail');

  const queued = createQueuedDatabase();
  const queuedStart = await startAppRiverQueuedSubscriptionSync({
    pool: queued.database,
    provider,
    client,
  });
  assert.equal(queuedStart.status, 'queued');
  assert.equal(queuedStart.customersRead, 3);
  assert.equal(queuedStart.queuedCustomers, 2);
  assert.equal(queuedStart.skippedPartnerCustomers, 1);
  assert.equal(queued.workItems.length, 2);
  assert.deepEqual(
    queued.workItems.map((item) => item.external_customer_id),
    ['customer-1', 'customer-2'],
  );

  const firstQueuedWork = await processNextAppRiverQueuedCustomer({
    pool: queued.database,
    provider,
    client,
    syncRunId: queuedStart.syncRunId,
    now: '2026-06-19T14:00:00.000Z',
  });
  assert.equal(firstQueuedWork.status, 'processed');
  assert.equal(firstQueuedWork.shouldContinue, true);
  assert.equal(firstQueuedWork.processedCustomerId, 'customer-1');
  assert.equal(firstQueuedWork.recordsRead, 2);
  assert.equal(firstQueuedWork.recordsWritten, 1);

  const secondQueuedWork = await processNextAppRiverQueuedCustomer({
    pool: queued.database,
    provider,
    client,
    syncRunId: queuedStart.syncRunId,
    now: '2026-06-19T14:05:00.000Z',
  });
  assert.equal(secondQueuedWork.status, 'completed');
  assert.equal(secondQueuedWork.shouldContinue, false);
  assert.equal(secondQueuedWork.processedCustomerId, 'customer-2');
  assert.equal(queued.snapshots.length, 2);
  assert.equal(queued.completed[0]?.[1], 3);
  assert.equal(queued.completed[0]?.[2], 2);
  const queuedMetadata = JSON.parse(String(queued.completed[0]?.[3]));
  assert.equal(queuedMetadata.mode, 'queued-customers');
  assert.equal(queuedMetadata.customersRead, 3);
  assert.equal(queuedMetadata.failedSubscriptions, 1);

  const ruleSet = await loadAppRiverRuleSet(database);
  const businessPremiumRule = ruleSet.rules.find((rule) => rule.vendorProductKey === mappedProductKey);
  assert.equal(businessPremiumRule?.vendorId, 'opentext-appriver');
  assert.equal(businessPremiumRule?.productCode, 'CW-M365-BUSINESS-PREMIUM');
  assert.equal(businessPremiumRule?.dimensions?.subscriptionSource, 'appriver-securecloud-subscription');

  console.log('appriver operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
