import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import {
  loadMicrosoft365RuleSet,
  syncMicrosoft365ProductSubscriptionSnapshots,
  syncMicrosoft365UserLicenseSnapshots,
  testMicrosoft365Connection,
  type Queryable,
} from './operations';

const microsoft365Definition = getIntegrationSettingsDefinition('microsoft-365');
assert.ok(microsoft365Definition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'microsoft-365');
    return {
      definition: microsoft365Definition,
      nonSecrets: {
        endpoint: 'https://graph.microsoft.com',
        clientId: 'client-id',
        tenantId: 'partner-tenant',
      },
      secrets: {
        clientSecret: 'client-secret',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'microsoft-365',
        displayName: 'Microsoft 365',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('microsoft-365')];
  },
};

const insertedSnapshots: unknown[][] = [];
const insertedSubscriptionSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) {
      const metadata = JSON.parse(String(values?.[0] ?? '{}')) as { entity?: string };
      return { rows: [{ id: metadata.entity === 'm365-licenses' ? 'sync-m365-licenses-1' : 'sync-m365-users-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: 'tenant-1',
            external_account_name: 'Mapped Client',
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
            vendor_product_key: 'SPB',
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

    if (sql.includes('insert into microsoft365_subscription_snapshots')) {
      insertedSubscriptionSnapshots.push(values ?? []);
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
    async authenticate() {
      return {};
    },
    async listPartnerCustomerContracts() {
      return [
        {
          tenantId: 'tenant-1',
          displayName: 'Mapped Client',
          defaultDomainName: 'mapped.example',
          contractType: 'ResellerPartner',
        },
        {
          tenantId: 'tenant-no-consent',
          displayName: 'No Consent Client',
          defaultDomainName: 'no-consent.example',
          contractType: 'BreadthPartner',
        },
      ];
    },
    async listTenantUsers(tenantId: string) {
      if (tenantId === 'tenant-no-consent') {
        throw new Error('Forbidden: app is not consented in this tenant');
      }

      return [
        {
          id: 'user-1',
          userPrincipalName: 'licensed.user@mapped.example',
          mail: 'licensed.user@mapped.example',
          displayName: 'Licensed User',
          accountEnabled: true,
          assignedLicenses: [
            {
              skuId: 'sku-spb',
              disabledPlans: [],
              servicePlans: [],
              raw: { skuId: 'sku-spb' },
            },
          ],
          raw: { id: 'user-1' },
        },
      ];
    },
    async listTenantSubscribedSkus(tenantId: string) {
      if (tenantId === 'tenant-no-consent') {
        throw new Error('Forbidden: app is not consented in this tenant');
      }

      return [
        {
          skuId: 'sku-spb',
          skuPartNumber: 'SPB',
          skuName: 'Microsoft 365 Business Premium',
          subscriptionIds: ['subscription-id-1'],
          servicePlans: [
            {
              serviceName: 'EXCHANGE_S_STANDARD',
              capabilityStatus: 'Success',
              raw: { serviceName: 'EXCHANGE_S_STANDARD' },
            },
          ],
          consumedUnits: 1,
          enabledUnits: 3,
          suspendedUnits: 0,
          warningUnits: 0,
          lockedOutUnits: 0,
          raw: { skuId: 'sku-spb', skuPartNumber: 'SPB' },
        },
      ];
    },
    async listTenantDirectorySubscriptions(tenantId: string) {
      if (tenantId === 'tenant-no-consent') {
        return [];
      }

      return [
        {
          id: 'directory-subscription-1',
          commerceSubscriptionId: 'commerce-subscription-1',
          skuId: 'sku-spb',
          skuPartNumber: 'SPB',
          status: 'Enabled',
          totalLicenses: 3,
          isTrial: false,
          nextLifecycleDateTime: '2027-01-01T00:00:00Z',
          serviceStatus: [
            {
              serviceName: 'EXCHANGE_S_STANDARD',
              capabilityStatus: 'Success',
              raw: { serviceName: 'EXCHANGE_S_STANDARD' },
            },
          ],
          raw: { id: 'directory-subscription-1', totalLicenses: 3 },
        },
      ];
    },
  };

  const testResult = await testMicrosoft365Connection({
    provider,
    client,
    now: '2026-06-19T12:00:00.000Z',
  });
  assert.equal(testResult.tenantCount, 2);
  assert.equal(testResult.sampleTenants[0]?.tenantId, 'tenant-1');

  const userSyncResult = await syncMicrosoft365UserLicenseSnapshots({
    pool: database,
    provider,
    client,
    now: '2026-06-19T13:00:00.000Z',
  });

  assert.equal(userSyncResult.dataset, 'users');
  assert.equal(userSyncResult.syncRunId, 'sync-m365-users-1');
  assert.equal(userSyncResult.tenantsRead, 2);
  assert.equal(userSyncResult.usersRead, 1);
  assert.equal(userSyncResult.recordsRead, 1);
  assert.equal(userSyncResult.recordsWritten, 1);
  assert.equal(userSyncResult.mappedSnapshots, 1);
  assert.equal(userSyncResult.unmappedSnapshots, 0);
  assert.equal(userSyncResult.failedTenants, 1);
  assert.equal(userSyncResult.productSnapshots.SPB, 1);

  const snapshot = insertedSnapshots[0];
  assert.equal(snapshot?.[1], 'customer-1');
  assert.equal(snapshot?.[2], 'agreement-1');
  assert.equal(snapshot?.[3], 'tenant-1');
  assert.equal(snapshot?.[4], 'SPB');
  assert.equal(snapshot?.[5], 'CW-M365-BUSINESS-PREMIUM');
  const dimensions = JSON.parse(String(snapshot?.[8]));
  assert.equal(dimensions.licenseSource, 'assigned-user-license');
  assert.equal(dimensions.authModel, 'graph-app-only');
  assert.equal(dimensions.tenantDefaultDomainName, 'mapped.example');
  assert.equal(dimensions.tenantContractType, 'ResellerPartner');
  assert.equal(dimensions.userPrincipalName, 'licensed.user@mapped.example');
  assert.equal(dimensions.consumedUnits, 1);
  assert.equal(dimensions.servicePlans[0]?.serviceName, 'EXCHANGE_S_STANDARD');

  const licenseSyncResult = await syncMicrosoft365ProductSubscriptionSnapshots({
    pool: database,
    provider,
    client,
    now: '2026-06-19T14:00:00.000Z',
  });

  assert.equal(licenseSyncResult.dataset, 'licenses');
  assert.equal(licenseSyncResult.syncRunId, 'sync-m365-licenses-1');
  assert.equal(licenseSyncResult.tenantsRead, 2);
  assert.equal(licenseSyncResult.recordsRead, 2);
  assert.equal(licenseSyncResult.recordsWritten, 1);
  assert.equal(licenseSyncResult.companySubscriptionsRead, 1);
  assert.equal(licenseSyncResult.productSubscriptionsWritten, 1);
  assert.equal(licenseSyncResult.failedTenants, 1);
  assert.equal(licenseSyncResult.failedProductSubscriptionTenants, 0);

  const subscriptionSnapshot = insertedSubscriptionSnapshots[0];
  assert.equal(subscriptionSnapshot?.[1], 'customer-1');
  assert.equal(subscriptionSnapshot?.[2], 'agreement-1');
  assert.equal(subscriptionSnapshot?.[3], 'tenant-1');
  assert.equal(subscriptionSnapshot?.[6], 'sku-spb');
  assert.equal(subscriptionSnapshot?.[7], 'SPB');
  assert.equal(subscriptionSnapshot?.[13], 1);
  assert.equal(subscriptionSnapshot?.[14], 3);
  assert.equal(subscriptionSnapshot?.[15], 1);
  assert.equal(subscriptionSnapshot?.[16], 2);
  assert.equal(subscriptionSnapshot?.[21], '2027-01-01T00:00:00Z');
  assert.equal(subscriptionSnapshot?.[25], false);
  const subscriptionDimensions = JSON.parse(String(subscriptionSnapshot?.[27]));
  assert.equal(subscriptionDimensions.billingTypeSource, 'not-returned-by-graph');
  assert.deepEqual(JSON.parse(String(subscriptionSnapshot?.[12])), ['commerce-subscription-1']);

  const userMetadata = JSON.parse(String(completedRuns[0]?.[3]));
  assert.equal(userMetadata.entity, 'm365-users');
  assert.equal(userMetadata.dataset, 'users');
  assert.equal(userMetadata.failedTenants, 1);
  assert.equal(userMetadata.failedTenantDetails[0]?.tenantId, 'tenant-no-consent');

  const licenseMetadata = JSON.parse(String(completedRuns[1]?.[3]));
  assert.equal(licenseMetadata.entity, 'm365-licenses');
  assert.equal(licenseMetadata.dataset, 'licenses');
  assert.equal(licenseMetadata.productSubscriptionsWritten, 1);

  const ruleSet = await loadMicrosoft365RuleSet(database);
  const businessPremiumRule = ruleSet.rules.find((rule) => rule.vendorProductKey === 'SPB');
  assert.equal(businessPremiumRule?.productCode, 'CW-M365-BUSINESS-PREMIUM');
  assert.equal(businessPremiumRule?.billableUnit, 'license');

  console.log('microsoft365 operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
