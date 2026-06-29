import assert from 'node:assert/strict';
import { getRawSyncDetails, isRawSyncIntegrationId, listRawSyncRuns } from './rawSyncReports';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'cove'") && sql.includes('order by started_at')) {
        return {
          rows: [
            {
              id: 'cove-sync-1',
              started_at: new Date('2026-06-15T12:00:00Z'),
              completed_at: new Date('2026-06-15T12:01:00Z'),
              status: 'complete',
              records_read: 2,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'usage-snapshots', mappedSnapshots: 1, unmappedSnapshots: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes('where integration_id = $1')) {
        assert.ok(values?.[0] === 'sentinelone' || values?.[0] === 'microsoft-365');
        assert.equal(values?.[1], 25);

        return {
          rows: [
            {
              id: values?.[0] === 'sentinelone' ? 'sentinel-sync-1' : `${values?.[0]}-sync-1`,
              started_at: new Date('2026-06-15T13:00:00Z'),
              completed_at: new Date('2026-06-15T13:01:00Z'),
              status: 'complete',
              records_read: 5,
              records_written: 5,
              error_message: null,
              metadata: { entity: 'agents' },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'microsoft-365'")) {
        return {
          rows: [
            {
              id: 'microsoft-365-sync-1',
              started_at: new Date('2026-06-15T14:00:00Z'),
              completed_at: new Date('2026-06-15T14:01:00Z'),
              status: 'complete',
              records_read: 1,
              records_written: 1,
              error_message: null,
              metadata: { entity: 'license-snapshots', mappedSnapshots: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'opentext-appriver'") && sql.includes('order by started_at')) {
        return {
          rows: [
            {
              id: 'appriver-sync-1',
              started_at: new Date('2026-06-15T15:00:00Z'),
              completed_at: new Date('2026-06-15T15:01:00Z'),
              status: 'complete',
              records_read: 2,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'subscription-snapshots', mappedSnapshots: 1, unmappedSnapshots: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'datto'") && sql.includes('order by started_at')) {
        return {
          rows: [
            {
              id: 'datto-sync-1',
              started_at: new Date('2026-06-15T16:00:00Z'),
              completed_at: new Date('2026-06-15T16:01:00Z'),
              status: 'complete',
              records_read: 44,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'usage-snapshots', bcdrAgentsRead: 1, saasSeatQuantityRead: 42 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'opentext-appriver'") && sql.includes('where id = $1')) {
        return {
          rows: [
            {
              id: 'appriver-sync-1',
              started_at: new Date('2026-06-15T15:00:00Z'),
              completed_at: new Date('2026-06-15T15:01:00Z'),
              status: 'complete',
              records_read: 2,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'subscription-snapshots', mappedSnapshots: 1, unmappedSnapshots: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes("integration_id = 'datto'") && sql.includes('where id = $1')) {
        return {
          rows: [
            {
              id: 'datto-sync-1',
              started_at: new Date('2026-06-15T16:00:00Z'),
              completed_at: new Date('2026-06-15T16:01:00Z'),
              status: 'complete',
              records_read: 44,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'usage-snapshots', bcdrAgentsRead: 1, saasSeatQuantityRead: 42 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes('and integration_id = $2')) {
        assert.deepEqual(values, ['sentinel-sync-1', 'sentinelone']);

        return {
          rows: [
            {
              id: 'sentinel-sync-1',
              started_at: new Date('2026-06-15T13:00:00Z'),
              completed_at: new Date('2026-06-15T13:01:00Z'),
              status: 'complete',
              records_read: 5,
              records_written: 5,
              error_message: null,
              metadata: { entity: 'agents' },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes('where id = $1')) {
        return {
          rows: [
            {
              id: 'cove-sync-1',
              started_at: new Date('2026-06-15T12:00:00Z'),
              completed_at: new Date('2026-06-15T12:01:00Z'),
              status: 'complete',
              records_read: 2,
              records_written: 2,
              error_message: null,
              metadata: { entity: 'usage-snapshots', mappedSnapshots: 1, unmappedSnapshots: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes("vendor_usage_snapshots.vendor_id = 'microsoft-365'")) {
        return {
          rows: [
            {
              customer_name: 'Mapped Client',
              agreement_name: 'Managed Services',
              external_account_id: 'tenant-1',
              vendor_product_key: 'SPB',
              product_code: 'CW-M365-BUSINESS-PREMIUM',
              product_name: 'Microsoft 365 Business Premium',
              quantity: '1',
              observed_at: new Date('2026-06-15T14:01:00Z'),
              dimensions: {
                tenantName: 'Mapped Client Tenant',
                tenantId: 'tenant-1',
                userPrincipalName: 'licensed.user@mapped.example',
                displayName: 'Licensed User',
                userState: 'active',
                skuName: 'Microsoft 365 Business Premium',
                skuId: 'sku-spb',
                consumedUnits: 1,
                servicePlans: [
                  {
                    serviceName: 'EXCHANGE_S_STANDARD',
                    capabilityStatus: 'Assigned',
                  },
                ],
              },
              raw_payload: { productSku: { skuPartNumber: 'SPB' } },
            },
          ] as T[],
        };
      }

      if (sql.includes('from microsoft365_subscription_snapshots')) {
        return {
          rows: [
            {
              customer_name: 'Mapped Client',
              agreement_name: 'Managed Services',
              external_account_id: 'tenant-1',
              tenant_name: 'Mapped Client Tenant',
              tenant_default_domain_name: 'mapped.example',
              sku_id: 'sku-spb',
              sku_part_number: 'SPB',
              sku_name: 'Microsoft 365 Business Premium',
              capability_status: 'Enabled',
              subscription_status: 'Enabled',
              subscription_ids: ['subscription-id-1'],
              commerce_subscription_ids: ['commerce-subscription-1'],
              subscription_count: 1,
              total_units: 3,
              assigned_units: 1,
              unassigned_units: 2,
              enabled_units: 3,
              suspended_units: 0,
              warning_units: 0,
              locked_out_units: 0,
              next_lifecycle_at: new Date('2027-01-01T00:00:00Z'),
              billing_type: null,
              billing_cycle: null,
              billing_term: null,
              is_trial: false,
              observed_at: new Date('2026-06-15T14:01:00Z'),
              dimensions: { billingTypeSource: 'not-returned-by-graph' },
              raw_payload: { subscribedSku: { skuPartNumber: 'SPB' } },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes("vendor_usage_snapshots.vendor_id = 'opentext-appriver'")) {
        const rows = [
          {
            customer_name: 'Mapped Client',
            agreement_name: 'Managed Services',
            external_account_id: 'customer-1',
            vendor_product_key: 'Microsoft 365 Business Premium|Annual|Monthly',
            product_code: 'CW-M365-BUSINESS-PREMIUM',
            product_name: 'Microsoft 365 Business Premium',
            quantity: '3',
            observed_at: new Date('2026-06-15T15:01:00Z'),
            dimensions: {
              customerName: 'Mapped Client',
              appRiverCustomerId: 'customer-1',
              domain: 'mapped.example',
              totalLicenses: 3,
              assignedLicenses: 1,
              unassignedLicenses: 2,
              subscriptionTerm: 'Annual',
              billingFrequency: 'Monthly',
              commitmentEndDate: '2027-01-01T00:00:00Z',
              isTrial: false,
              subscriptionKey: 'sub-1',
            },
            raw_payload: { subscription: { SubscriptionKey: 'sub-1' } },
          },
          {
            customer_name: null,
            agreement_name: null,
            external_account_id: 'customer-2',
            vendor_product_key: 'Exchange Online Plan 1|Monthly|Monthly',
            product_code: 'EXCHANGE-ONLINE-PLAN-1-MONTHLY-MONTHLY',
            product_name: 'Exchange Online Plan 1',
            quantity: '1',
            observed_at: new Date('2026-06-15T15:01:00Z'),
            dimensions: {
              customerName: 'Unmapped Client',
              appRiverCustomerId: 'customer-2',
              domain: 'unmapped.example',
              totalLicenses: 1,
              assignedLicenses: 1,
              unassignedLicenses: 0,
              subscriptionTerm: 'Monthly',
              billingFrequency: 'Monthly',
              subscriptionKey: 'sub-2',
            },
            raw_payload: { subscription: { SubscriptionKey: 'sub-2' } },
          },
        ];

        return {
          rows: (values?.[1] ? rows.filter((row) => row.customer_name === 'Mapped Client') : rows) as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes("vendor_usage_snapshots.vendor_id = 'datto'")) {
        return {
          rows: [
            {
              customer_name: 'Mapped Client',
              agreement_name: 'Managed Services',
              external_account_id: 'Mapped Client',
              vendor_product_key: 'datto-bcdr-agent',
              product_code: 'CW-DATTO-BCDR',
              product_name: 'CW Datto BCDR Agent',
              quantity: '1',
              observed_at: new Date('2026-06-15T16:01:00Z'),
              dimensions: {
                dattoProductFamily: 'bcdr',
                dattoCustomerName: 'Mapped Client',
                dattoDeviceHostname: 'siris-01',
                dattoDeviceSerial: 'ABC123',
                dattoAgentName: 'dc-01',
              },
              raw_payload: { backupVolume: { Agent: 'dc-01' } },
            },
            {
              customer_name: null,
              agreement_name: null,
              external_account_id: 'saas-2',
              vendor_product_key: 'datto-saas-office365-tbr',
              product_code: 'DATTO-SAAS-OFFICE365-TBR',
              product_name: 'Datto SaaS Protection Office 365 Time Based Retention',
              quantity: '42',
              observed_at: new Date('2026-06-15T16:01:00Z'),
              dimensions: {
                dattoProductFamily: 'saas',
                dattoSaasProductKey: 'datto-saas-office365-tbr',
                dattoSaasProductType: 'Office365',
                dattoSaasRetentionType: 'TBR',
                dattoSaasCustomerId: 'saas-2',
                dattoCustomerName: 'Unmapped Client',
                domain: 'unmapped.example',
                quantitySource: 'domain-seats-used',
              },
              raw_payload: { domain: { saasCustomerId: 'saas-2', productType: 'Office365', retentionType: 'TBR', seatsUsed: 42 } },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots')) {
        return {
          rows: [
            {
              customer_name: 'Mapped Client',
              agreement_name: 'Managed Services',
              external_account_id: '101',
              product_code: 'COVE-SERVER',
              product_name: 'Cove Server Backup',
              quantity: '1',
              observed_at: new Date('2026-06-15T12:01:00Z'),
              dimensions: {
                protectedSystemType: 'server',
                physicality: 'Virtual',
                selectedStorageGb: 1135,
                usedStorageGb: 940,
                hostname: 'mapped-server',
                coveCustomerName: 'Mapped Cove Client',
                covePartnerId: 101,
                accountId: 9001,
              },
              raw_payload: { AccountId: 9001 },
            },
            {
              customer_name: null,
              agreement_name: null,
              external_account_id: '202',
              product_code: 'COVE-WORKSTATION',
              product_name: 'Cove Workstation Backup',
              quantity: '1',
              observed_at: new Date('2026-06-15T12:01:00Z'),
              dimensions: {
                protectedSystemType: 'workstation',
                selectedStorageGb: 151,
                usedStorageGb: 208,
                hostname: 'unmapped-laptop',
                coveCustomerName: 'Unmapped Cove Client',
                covePartnerId: 202,
                accountId: 9002,
              },
              raw_payload: { AccountId: 9002 },
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const runs = await listRawSyncRuns(database, 'cove');
  assert.equal(runs[0]?.id, 'cove-sync-1');
  assert.equal(runs[0]?.metadata.mappedSnapshots, 1);

  const details = await getRawSyncDetails(database, 'cove', 'cove-sync-1');
  assert.equal(details?.integrationId, 'cove');
  assert.equal(details?.summary.rowCount, 2);
  assert.equal(details?.summary.companyCount, 2);
  assert.equal(details?.summary.agreementCount, 1);
  assert.equal(details?.summary.productCount, 2);
  assert.equal(details?.rows[0]?.Customer, 'Mapped Client');
  assert.equal(details?.rows[0]?.SelectedStorageGB, 1135);
  assert.equal(details?.rows[0]?.Mapped, true);
  assert.equal(details?.rows[1]?.Customer, null);
  assert.equal(details?.rows[1]?.CoveCustomer, 'Unmapped Cove Client');
  assert.equal(details?.rows[1]?.Mapped, false);
  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_snapshots')), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_account_mappings')), true);

  assert.equal(isRawSyncIntegrationId('pax8'), true);
  assert.equal(isRawSyncIntegrationId('unknown'), false);

  const genericRuns = await listRawSyncRuns(database, 'sentinelone');
  assert.equal(genericRuns[0]?.id, 'sentinel-sync-1');

  const microsoftRuns = await listRawSyncRuns(database, 'microsoft-365');
  assert.equal(microsoftRuns[0]?.id, 'microsoft-365-sync-1');

  const microsoftDetails = await getRawSyncDetails(database, 'microsoft-365', 'microsoft-365-sync-1');
  assert.equal(microsoftDetails?.integrationId, 'microsoft-365');
  assert.equal(microsoftDetails?.summary.rowCount, 1);
  assert.equal(microsoftDetails?.summary.companyCount, 1);
  assert.equal(microsoftDetails?.summary.productCount, 1);
  assert.equal(microsoftDetails?.rows[0]?.UserPrincipalName, '[redacted]');
  assert.equal(microsoftDetails?.rows[0]?.DisplayName, '[redacted]');
  assert.equal(microsoftDetails?.rows[0]?.RawPayload, null);
  assert.equal(microsoftDetails?.rows[0]?.ProductKey, 'SPB');
  assert.equal(microsoftDetails?.rows[0]?.ServicePlans, 'EXCHANGE_S_STANDARD');

  const sensitiveMicrosoftDetails = await getRawSyncDetails(database, 'microsoft-365', 'microsoft-365-sync-1', {
    includeSensitive: true,
  });
  assert.equal(sensitiveMicrosoftDetails?.rows[0]?.UserPrincipalName, 'licensed.user@mapped.example');
  assert.equal(sensitiveMicrosoftDetails?.rows[0]?.DisplayName, 'Licensed User');
  assert.equal(
    sensitiveMicrosoftDetails?.rows[0]?.RawPayload,
    JSON.stringify({ productSku: { skuPartNumber: 'SPB' } }),
  );

  const microsoftLicenseDetails = await getRawSyncDetails(database, 'microsoft-365', 'microsoft-365-sync-1', {
    dataset: 'licenses',
  });
  assert.equal(microsoftLicenseDetails?.integrationId, 'microsoft-365');
  assert.equal(microsoftLicenseDetails?.dataset, 'licenses');
  assert.equal(microsoftLicenseDetails?.summary.rowCount, 1);
  assert.equal(microsoftLicenseDetails?.rows[0]?.SkuPartNumber, 'SPB');
  assert.equal(microsoftLicenseDetails?.rows[0]?.TenantDefaultDomain, '[redacted]');
  assert.equal(microsoftLicenseDetails?.rows[0]?.RawPayload, null);
  assert.equal(microsoftLicenseDetails?.rows[0]?.TotalUnits, 3);
  assert.equal(microsoftLicenseDetails?.rows[0]?.AssignedUnits, 1);
  assert.equal(microsoftLicenseDetails?.rows[0]?.UnassignedUnits, 2);
  assert.equal(microsoftLicenseDetails?.rows[0]?.NextLifecycleAt, '2027-01-01T00:00:00.000Z');

  const appRiverRuns = await listRawSyncRuns(database, 'opentext-appriver');
  assert.equal(appRiverRuns[0]?.id, 'appriver-sync-1');

  const appRiverDetails = await getRawSyncDetails(database, 'opentext-appriver', 'appriver-sync-1');
  assert.equal(appRiverDetails?.integrationId, 'opentext-appriver');
  assert.equal(appRiverDetails?.summary.rowCount, 2);
  assert.equal(appRiverDetails?.summary.companyCount, 2);
  assert.equal(appRiverDetails?.summary.productCount, 2);
  assert.equal(appRiverDetails?.rows[0]?.AppRiverCustomer, 'Mapped Client');
  assert.equal(appRiverDetails?.rows[0]?.ProductKey, 'Microsoft 365 Business Premium|Annual|Monthly');
  assert.equal(appRiverDetails?.rows[0]?.Quantity, 3);
  assert.equal(appRiverDetails?.rows[0]?.AssignedLicenses, 1);
  assert.equal(appRiverDetails?.rows[1]?.Mapped, false);
  assert.equal(appRiverDetails?.rows[1]?.AppRiverCustomer, 'Unmapped Client');

  const scopedAppRiverDetails = await getRawSyncDetails(database, 'opentext-appriver', 'appriver-sync-1', {
    customerId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(scopedAppRiverDetails?.summary.rowCount, 1);
  assert.equal(scopedAppRiverDetails?.rows[0]?.Customer, 'Mapped Client');
  assert.equal(scopedAppRiverDetails?.rows[0]?.ProductKey, 'Microsoft 365 Business Premium|Annual|Monthly');

  const dattoRuns = await listRawSyncRuns(database, 'datto');
  assert.equal(dattoRuns[0]?.id, 'datto-sync-1');

  const dattoDetails = await getRawSyncDetails(database, 'datto', 'datto-sync-1');
  assert.equal(dattoDetails?.integrationId, 'datto');
  assert.equal(dattoDetails?.summary.rowCount, 2);
  assert.equal(dattoDetails?.summary.companyCount, 2);
  assert.equal(dattoDetails?.summary.productCount, 2);
  assert.equal(dattoDetails?.rows[0]?.DattoCustomer, 'Mapped Client');
  assert.equal(dattoDetails?.rows[0]?.ProductFamily, 'bcdr');
  assert.equal(dattoDetails?.rows[0]?.AgentName, 'dc-01');
  assert.equal(dattoDetails?.rows[1]?.Mapped, false);
  assert.equal(dattoDetails?.rows[1]?.SaaSDomain, 'unmapped.example');
  assert.equal(dattoDetails?.rows[1]?.ProductType, 'Office365');
  assert.equal(dattoDetails?.rows[1]?.RetentionType, 'TBR');
  assert.equal(dattoDetails?.rows[1]?.Quantity, 42);

  const genericDetails = await getRawSyncDetails(database, 'sentinelone', 'sentinel-sync-1');
  assert.equal(genericDetails?.integrationId, 'sentinelone');
  assert.equal(genericDetails?.syncRun.id, 'sentinel-sync-1');
  assert.deepEqual(genericDetails?.columns, []);
  assert.equal(genericDetails?.summary.rowCount, 0);

  console.log('raw sync report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
