import assert from 'node:assert/strict';
import {
  getCustomerLicenseReport,
  listCustomerLicenseReportCustomers,
  type CustomerLicenseReport,
} from './customerLicenseReports';

const customerId = '11111111-1111-4111-8111-111111111111';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('from customers') && sql.includes('mapped_vendor_ids')) {
        return {
          rows: [
            {
              customer_id: customerId,
              connectwise_company_id: 'cw-101',
              customer_name: 'Mapped Client',
              agreement_count: '2',
              mapped_vendor_ids: ['cove', 'microsoft-365', 'unsupported-vendor'],
            },
          ] as T[],
        };
      }

      if (sql.includes('from customers') && sql.includes('where id = $1')) {
        return {
          rows: [
            {
              customer_id: customerId,
              connectwise_company_id: 'cw-101',
              customer_name: 'Mapped Client',
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('sum(mapped_snapshots.quantity)')) {
        assert.equal(values?.[1], customerId);
        assert.equal(values?.[2], 12);
        if (values?.[0] === 'ncentral') {
          return {
            rows: [
              {
                observed_month: new Date('2026-06-01T00:00:00Z'),
                product_key: 'ncentral-workstation',
                product_code: 'NC-WORKSTATION',
                product_name: 'N-central Managed Workstation',
                count: '7',
              },
            ] as T[],
          };
        }

        if (values?.[0] === 'opentext-appriver') {
          return {
            rows: [
              {
                observed_month: new Date('2026-06-01T00:00:00Z'),
                product_key: 'Exchange Online Plan 1|Monthly|Monthly',
                product_code: 'EXCHANGE-ONLINE-PLAN-1',
                product_name: 'Exchange Online Plan 1',
                count: '2',
              },
            ] as T[],
          };
        }

        assert.equal(values?.[0], 'cove');

        return {
          rows: [
            {
              observed_month: new Date('2026-05-01T00:00:00Z'),
              product_key: 'cove-server',
              product_code: 'COVE-SERVER',
              product_name: 'Cove Server Backup',
              count: '2',
            },
            {
              observed_month: new Date('2026-06-01T00:00:00Z'),
              product_key: 'cove-server',
              product_code: 'COVE-SERVER',
              product_name: 'Cove Server Backup',
              count: '3',
            },
            {
              observed_month: new Date('2026-06-01T00:00:00Z'),
              product_key: 'cove-workstation',
              product_code: 'COVE-WORKSTATION',
              product_name: 'Cove Workstation Backup',
              count: '1',
            },
          ] as T[],
        };
      }

      if (sql.includes("vendor_usage_snapshots.vendor_id = 'microsoft-365'")) {
        return {
          rows: [
            {
              product_key: 'SPB',
              product_code: 'SPB',
              product_name: 'Microsoft 365 Business Premium',
              quantity: '1',
              observed_at: new Date('2026-06-15T11:05:00Z'),
              external_account_id: 'tenant-1',
              dimensions: {
                tenantName: 'Mapped Tenant',
                userPrincipalName: '[redacted]',
                email: 'licensed.user@mapped.example',
                mail: 'licensed.user@mapped.example',
                displayName: '[redacted]',
                userState: 'active',
                skuName: 'Microsoft 365 Business Premium',
                skuId: 'sku-spb',
              },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('mapped_snapshots.dimensions')) {
        if (values?.[0] === 'ncentral') {
          return {
            rows: [
              {
                product_key: 'ncentral-workstation',
                product_code: 'NC-WORKSTATION',
                product_name: 'N-central Managed Workstation',
                quantity: '1',
                observed_at: new Date('2026-06-15T09:00:00Z'),
                external_account_id: 'ncentral-101',
                dimensions: {
                  ncentralDeviceId: 123,
                  hostname: 'desktop-01',
                  deviceClass: 'Workstations - Windows',
                  productFilterName: 'Billing - Workstations and Laptops',
                },
              },
            ] as T[],
          };
        }

        if (values?.[0] === 'opentext-appriver') {
          return {
            rows: [
              {
                product_key: 'Exchange Online Plan 1|Monthly|Monthly',
                product_code: 'EXCHANGE-ONLINE-PLAN-1',
                product_name: 'Exchange Online Plan 1',
                quantity: '2',
                observed_at: new Date('2026-06-15T12:00:00Z'),
                external_account_id: 'appriver-101',
                dimensions: {
                  customerName: 'Mapped Client',
                  appRiverCustomerId: 'appriver-101',
                  domain: 'mapped.example',
                  totalLicenses: 2,
                  assignedLicenses: 2,
                  unassignedLicenses: 0,
                  subscriptionTerm: 'Monthly',
                  billingFrequency: 'Monthly',
                  subscriptionKey: 'sub-1',
                },
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              product_key: 'cove-server',
              product_code: 'COVE-SERVER',
              product_name: 'Cove Server Backup',
              quantity: '1',
              observed_at: new Date('2026-06-15T10:00:00Z'),
              external_account_id: 'cove-101',
              dimensions: {
                hostname: 'server-01',
                protectedSystemType: 'server',
                physicality: 'Virtual',
                selectedStorageGb: 500,
                usedStorageGb: 325,
                os: 'Windows Server',
              },
            },
            {
              product_key: 'cove-workstation',
              product_code: 'COVE-WORKSTATION',
              product_name: 'Cove Workstation Backup',
              quantity: '1',
              observed_at: new Date('2026-06-15T10:00:00Z'),
              external_account_id: 'cove-101',
              dimensions: {
                hostname: 'laptop-01',
                protectedSystemType: 'workstation',
              },
            },
          ] as T[],
        };
      }

      if (sql.includes('from microsoft365_subscription_snapshots') && sql.includes('sum(coalesce')) {
        assert.equal(values?.[0], customerId);
        assert.equal(values?.[1], 12);

        return {
          rows: [
            {
              observed_month: new Date('2026-06-01T00:00:00Z'),
              product_key: 'SPB',
              product_code: 'SPB',
              product_name: 'Microsoft 365 Business Premium',
              count: '5',
            },
          ] as T[],
        };
      }

      if (sql.includes('from microsoft365_subscription_snapshots')) {
        return {
          rows: [
            {
              product_key: 'SPB',
              product_code: 'SPB',
              product_name: 'Microsoft 365 Business Premium',
              external_account_id: 'tenant-1',
              tenant_name: 'Mapped Tenant',
              tenant_default_domain_name: 'mapped.example',
              sku_id: 'sku-spb',
              sku_part_number: 'SPB',
              sku_name: 'Microsoft 365 Business Premium',
              capability_status: 'Enabled',
              subscription_status: 'Enabled',
              subscription_count: 1,
              total_units: 5,
              assigned_units: 4,
              unassigned_units: 1,
              enabled_units: 5,
              suspended_units: 0,
              warning_units: 0,
              locked_out_units: 0,
              next_lifecycle_at: new Date('2027-01-01T00:00:00Z'),
              is_trial: false,
              observed_at: new Date('2026-06-15T11:00:00Z'),
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const customers = await listCustomerLicenseReportCustomers(database);
  assert.equal(customers.customers.length, 1);
  assert.equal(customers.customers[0]?.customerName, 'Mapped Client');
  assert.deepEqual(customers.customers[0]?.mappedVendorIds, ['cove', 'microsoft-365']);

  const coveReport = await getCustomerLicenseReport(database, {
    customerId,
    vendorId: 'cove',
  });
  assert.ok(coveReport);
  assert.equal(coveReport.reportType, 'customer-license');
  assert.equal(coveReport.startMonth, '2025-07');
  assert.equal(coveReport.endMonth, '2026-06');
  assert.equal(coveReport.summary.productCount, 2);
  assert.equal(coveReport.summary.vendorCount, 1);
  assert.equal(coveReport.summary.totalCurrentCount, 4);
  assert.equal(coveReport.summary.detailRowCount, 2);
  assert.equal(coveReport.products.find((product) => product.productKey === 'cove-server')?.currentCount, 3);
  assert.equal(coveReport.products.find((product) => product.productKey === 'cove-server')?.vendor.integrationId, 'cove');
  assert.equal(coveReport.products.find((product) => product.productKey === 'cove-server')?.detailRows[0]?.Hostname, 'server-01');
  assertNoCostFields(coveReport);

  const microsoftReport = await getCustomerLicenseReport(database, {
    customerId,
    vendorId: 'microsoft-365',
    includeMicrosoftUserDetails: true,
  });
  assert.ok(microsoftReport);
  assert.equal(microsoftReport.summary.totalCurrentCount, 5);
  assert.equal(microsoftReport.summary.vendorCount, 1);
  assert.equal(microsoftReport.summary.microsoftUserDetailCount, 1);
  const microsoftDetails = microsoftReport.products[0]?.detailRows ?? [];
  assert.equal(microsoftDetails.some((row) => row.DetailType === 'License total'), true);
  assert.equal(microsoftDetails.some((row) => row.UserPrincipalName === 'licensed.user@mapped.example'), true);
  assert.equal(microsoftDetails.some((row) => row.Email === 'licensed.user@mapped.example'), true);
  assert.equal(microsoftDetails.some((row) => row.DisplayName === '[redacted]'), false);
  assertNoCostFields(microsoftReport);

  const combinedReport = await getCustomerLicenseReport(database, {
    customerId,
    vendorId: 'all',
  });
  assert.ok(combinedReport);
  assert.equal(combinedReport.vendor.integrationId, 'all');
  assert.equal(combinedReport.vendor.integrationName, 'All licenses');
  assert.equal(combinedReport.summary.vendorCount, 4);
  assert.equal(combinedReport.summary.productCount, 5);
  assert.equal(combinedReport.summary.totalCurrentCount, 18);
  assert.equal(combinedReport.summary.microsoftUserDetailCount, 0);
  assert.equal(combinedReport.products.find((product) => product.productKey === 'cove:cove-server')?.currentCount, 3);
  assert.equal(
    combinedReport.products.find((product) => product.productKey === 'microsoft-365:SPB')?.vendor.integrationName,
    'Microsoft 365',
  );
  assert.equal(
    combinedReport.products.find((product) => product.productKey === 'opentext-appriver:Exchange Online Plan 1|Monthly|Monthly')?.detailRows[0]?.Vendor,
    'AppRiver - OpenText',
  );
  assertNoCostFields(combinedReport);
  assert.equal(queries.some((query) => query.sql.includes('vendor_account_mappings')), true);
  assert.equal(
    queries.some((query) => query.sql.includes('monthly_earliest') && query.sql.includes('min(observed_at)')),
    true,
  );

  console.log('customer license report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function assertNoCostFields(report: CustomerLicenseReport) {
  const blocked = findBlockedKeys(report);
  assert.deepEqual(blocked, []);
}

function findBlockedKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findBlockedKeys(item, `${path}[${index}]`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nextPath = path ? `${path}.${key}` : key;
    return /cost|price|revenue|profit|rawpayload/i.test(key) ? [nextPath] : findBlockedKeys(nested, nextPath);
  });
}
