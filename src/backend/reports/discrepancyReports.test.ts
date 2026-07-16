import assert from 'node:assert/strict';
import {
  discrepancyComparisonDefinitions,
  getDiscrepancyReport,
  type Queryable,
} from './discrepancyReports';

const customerA = '11111111-1111-4111-8111-111111111111';
const customerB = '22222222-2222-4222-8222-222222222222';

type SnapshotFixture = {
  id: string;
  vendor_id: string;
  customer_id: string;
  connectwise_company_id: string;
  customer_name: string;
  external_account_id?: string;
  vendor_product_key?: string;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date;
  dimensions: Record<string, unknown>;
};

const syncRuns: Record<string, string> = {
  ncentral: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sentinelone: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'microsoft-365': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

const snapshots: Record<string, SnapshotFixture[]> = {
  ncentral: [
    device('ncentral-1', 'ncentral', customerA, 'Mapped Client', 'DESKTOP-01.contoso.local'),
    device('ncentral-2', 'ncentral', customerA, 'Mapped Client', 'LAPTOP-02'),
  ],
  sentinelone: [
    device('sentinel-1', 'sentinelone', customerA, 'Mapped Client', 'desktop-01'),
    device('sentinel-2', 'sentinelone', customerA, 'Mapped Client', 'SERVER-03'),
  ],
  'microsoft-365': [
    microsoftUser('m365-user-1', customerA, 'Mapped Client', 'alpha@contoso.com', true, ['EXCHANGE_S_STANDARD']),
    microsoftUser('m365-user-2', customerA, 'Mapped Client', 'bravo@contoso.com', true, ['EXCHANGE_S_ENTERPRISE']),
    microsoftUser('m365-user-disabled', customerA, 'Mapped Client', 'disabled@contoso.com', false, ['EXCHANGE_S_STANDARD']),
    microsoftUser('m365-user-sharepoint', customerA, 'Mapped Client', 'sharepoint@contoso.com', true, ['SHAREPOINTSTANDARD']),
    microsoftUser('m365-user-other-customer', customerB, 'Other Client', 'third@contoso.com', true, ['EXCHANGE_S_STANDARD']),
  ],
};

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    const vendorId = String(values?.[0] ?? '');

    if (sql.includes('from sync_runs')) {
      const syncRunId = syncRuns[vendorId];
      return {
        rows: syncRunId
          ? [
              {
                id: syncRunId,
                started_at: new Date('2026-06-29T09:00:00Z'),
                completed_at: new Date('2026-06-29T09:05:00Z'),
                metadata: vendorId === 'microsoft-365' ? { entity: 'm365-users' } : {},
              } as T,
            ]
          : [],
      };
    }

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: (snapshots[vendorId] ?? []) as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  await assert.rejects(
    () => getDiscrepancyReport(database, { includeMatched: true }),
    /comparisonId/,
  );

  assert.deepEqual(
    discrepancyComparisonDefinitions.map((definition) => definition.id),
    ['ncentral-sentinelone-devices', 'appriver-license-cleanup'],
  );

  const report = await getDiscrepancyReport(database, {
    comparisonId: 'ncentral-sentinelone-devices',
    includeMatched: true,
    now: '2026-06-29T10:30:00.000Z',
  });

  const deviceRow = report.rows.find((row) => row.comparisonPair.id === 'ncentral-sentinelone-devices');
  assert.ok(deviceRow);
  assert.equal(report.comparisonPairs.length, 1);
  assert.equal(report.comparisonPairs[0]?.id, 'ncentral-sentinelone-devices');
  assert.equal(deviceRow.customer.customerId, customerA);
  assert.equal(deviceRow.leftCount, 2);
  assert.equal(deviceRow.rightCount, 2);
  assert.equal(deviceRow.delta, 0);
  assert.equal(deviceRow.status, 'warning');
  assert.deepEqual(deviceRow.missingFromLeft.map((item) => item.displayName), ['SERVER-03']);
  assert.deepEqual(deviceRow.missingFromRight.map((item) => item.displayName), ['LAPTOP-02']);
  assert.equal(deviceRow.missingFromLeft[0]?.details.LastCheckIn, '2026-06-29T09:45:00Z');
  assert.equal(deviceRow.missingFromRight[0]?.details.LastCheckIn, '2026-06-29T09:30:00Z');
  assert.equal(deviceRow.syncTimestamps.left, '2026-06-29T09:05:00.000Z');
  assert.equal(deviceRow.syncTimestamps.right, '2026-06-29T09:05:00.000Z');

  const filtered = await getDiscrepancyReport(database, {
    comparisonId: 'ncentral-sentinelone-devices',
    basis: 'device',
    includeMatched: false,
    now: '2026-06-29T10:30:00.000Z',
  });
  assert.equal(filtered.rows.every((row) => row.basis === 'device'), true);
  assert.equal(filtered.rows.some((row) => row.status === 'matched'), false);

  console.log('discrepancy report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function device(
  id: string,
  vendorId: 'ncentral' | 'sentinelone',
  customerId: string,
  customerName: string,
  hostname: string,
): SnapshotFixture {
  const lastCheckIn =
    id === 'ncentral-2'
      ? '2026-06-29T09:30:00Z'
      : id === 'sentinel-2'
        ? '2026-06-29T09:45:00Z'
        : '2026-06-29T09:15:00Z';

  return {
    id,
    vendor_id: vendorId,
    customer_id: customerId,
    connectwise_company_id: customerId === customerA ? 'cw-101' : 'cw-202',
    customer_name: customerName,
    external_account_id: `${vendorId}-${customerId}`,
    vendor_product_key: `${vendorId}-workstation`,
    product_code: `${vendorId.toUpperCase()}-WORKSTATION`,
    product_name: `${vendorId} Workstation`,
    quantity: 1,
    observed_at: new Date('2026-06-29T10:00:00Z'),
    dimensions: {
      hostname,
      deviceName: hostname,
      ...(vendorId === 'ncentral'
        ? { lastApplianceCheckinTime: lastCheckIn }
        : { lastCheckIn, lastActiveDate: lastCheckIn }),
    },
  };
}

function microsoftUser(
  id: string,
  customerId: string,
  customerName: string,
  email: string,
  active: boolean,
  servicePlanNames: string[],
): SnapshotFixture {
  return {
    id,
    vendor_id: 'microsoft-365',
    customer_id: customerId,
    connectwise_company_id: customerId === customerA ? 'cw-101' : 'cw-202',
    customer_name: customerName,
    external_account_id: `tenant-${customerId}`,
    vendor_product_key: 'SPB',
    product_code: 'SPB',
    product_name: 'Microsoft 365 Business Premium',
    quantity: 1,
    observed_at: new Date('2026-06-29T10:00:00Z'),
    dimensions: {
      tenantName: `${customerName} Tenant`,
      tenantDefaultDomainName: email.split('@')[1],
      userPrincipalName: email,
      email,
      displayName: email.split('@')[0],
      accountEnabled: active,
      userState: active ? 'active' : 'disabled',
      skuName: 'Microsoft 365 Business Premium',
      servicePlans: servicePlanNames.map((serviceName) => ({
        serviceName,
        capabilityStatus: 'Success',
      })),
    },
  };
}
