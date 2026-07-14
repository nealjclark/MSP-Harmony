import assert from 'node:assert/strict';
import { getChangeReport } from './changeReports';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('from sync_runs')) {
        const syncRunId = String(values?.[0] ?? '');
        const vendorId = String(values?.[1] ?? '');
        const metadataEntity = syncRunId.includes('license') ? 'm365-licenses' : vendorId === 'microsoft-365' ? 'm365-users' : 'usage-snapshots';
        return {
          rows: [
            {
              id: syncRunId,
              started_at: new Date(syncRunId.includes('start') ? '2026-05-01T12:00:00Z' : '2026-06-01T12:00:00Z'),
              completed_at: new Date(syncRunId.includes('start') ? '2026-05-01T12:01:00Z' : '2026-06-01T12:01:00Z'),
              status: 'complete',
              records_read: 10,
              records_written: 10,
              error_message: null,
              metadata: { entity: metadataEntity },
            },
          ] as T[],
        };
      }

      if (sql.includes('from microsoft365_subscription_snapshots')) {
        const syncRunId = String(values?.[0] ?? '');
        return {
          rows: [
            {
              id: `${syncRunId}-spb`,
              vendor_id: 'microsoft-365',
              customer_id: customerId,
              connectwise_company_id: 'cw-101',
              customer_name: 'Acme Services',
              agreement_id: agreementId,
              agreement_name: 'Managed Services',
              external_account_id: 'tenant-1',
              vendor_product_key: 'SPB',
              product_code: 'SPB',
              product_name: 'Microsoft 365 Business Premium',
              quantity: syncRunId.includes('start') ? '20' : '24',
              observed_at: new Date(syncRunId.includes('start') ? '2026-05-01T12:01:00Z' : '2026-06-01T12:01:00Z'),
              dimensions: { tenantName: 'Acme Tenant', skuPartNumber: 'SPB' },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots')) {
        const syncRunId = String(values?.[0] ?? '');
        const vendorId = String(values?.[1] ?? '');
        if (vendorId === 'cove') {
          return {
            rows: coveRows(syncRunId) as T[],
          };
        }
        if (vendorId === 'microsoft-365') {
          return {
            rows: microsoftUserRows(syncRunId) as T[],
          };
        }
      }

      return { rows: [] as T[] };
    },
  };

  const report = await getChangeReport(database, [
    {
      vendorId: 'cove',
      mode: 'counts',
      startSyncRunId: 'cove-start',
      endSyncRunId: 'cove-end',
    },
    {
      vendorId: 'microsoft-365',
      mode: 'users',
      startSyncRunId: 'm365-start',
      endSyncRunId: 'm365-end',
    },
    {
      vendorId: 'microsoft-365',
      mode: 'microsoft365-license-counts',
      startSyncRunId: 'm365-license-start',
      endSyncRunId: 'm365-license-end',
    },
  ], { now: '2026-06-02T00:00:00Z' });

  assert.equal(report.reportType, 'change-report');
  assert.equal(report.comparisons.length, 3);
  assert.equal(report.summary.comparisonCount, 3);
  assert.equal(report.summary.changedRowCount, 5);

  const cove = report.comparisons[0];
  assert.equal(cove?.summary.changedRowCount, 3);
  assert.equal(cove?.summary.addedCount, 1);
  assert.equal(cove?.summary.removedCount, 1);
  assert.equal(cove?.summary.increasedCount, 1);
  assert.equal(cove?.summary.netQuantityDelta, 0);
  assert.deepEqual(
    cove?.rows.map((row) => [row.productKey, row.startCount, row.endCount, row.delta, row.changeType]),
    [
      ['cove-new-storage', 0, 4, 4, 'added'],
      ['cove-workstation', 5, 0, -5, 'removed'],
      ['cove-server', 2, 3, 1, 'increased'],
    ],
  );

  const users = report.comparisons[1];
  assert.equal(users?.summary.changedRowCount, 1);
  assert.equal(users?.summary.changedCount, 1);
  assert.equal(users?.summary.detailAddedCount, 1);
  assert.equal(users?.summary.detailRemovedCount, 1);
  assert.equal(users?.rows[0]?.addedItems[0]?.identity, 'cara@acme.example');
  assert.equal(users?.rows[0]?.removedItems[0]?.identity, 'alice@acme.example');

  const licenses = report.comparisons[2];
  assert.equal(licenses?.summary.changedRowCount, 1);
  assert.equal(licenses?.summary.netQuantityDelta, 4);
  assert.equal(queries.some((query) => query.sql.includes('from microsoft365_subscription_snapshots')), true);

  console.log('change report tests passed');
}

const customerId = '11111111-1111-4111-8111-111111111111';
const agreementId = '22222222-2222-4222-8222-222222222222';

function coveRows(syncRunId: string) {
  const common = {
    vendor_id: 'cove',
    customer_id: customerId,
    connectwise_company_id: 'cw-101',
    customer_name: 'Acme Services',
    agreement_id: agreementId,
    agreement_name: 'Managed Services',
    external_account_id: 'cove-acme',
    observed_at: new Date(syncRunId.includes('start') ? '2026-05-01T12:01:00Z' : '2026-06-01T12:01:00Z'),
    dimensions: { coveCustomerName: 'Acme Services' },
  };

  if (syncRunId.includes('start')) {
    return [
      {
        ...common,
        id: 'cove-start-server',
        vendor_product_key: 'cove-server',
        product_code: 'COVE-SERVER',
        product_name: 'Cove Server Backup',
        quantity: '2',
      },
      {
        ...common,
        id: 'cove-start-workstation',
        vendor_product_key: 'cove-workstation',
        product_code: 'COVE-WORKSTATION',
        product_name: 'Cove Workstation Backup',
        quantity: '5',
      },
    ];
  }

  return [
    {
      ...common,
      id: 'cove-end-server',
      vendor_product_key: 'cove-server',
      product_code: 'COVE-SERVER',
      product_name: 'Cove Server Backup',
      quantity: '3',
    },
    {
      ...common,
      id: 'cove-end-new-storage',
      vendor_product_key: 'cove-new-storage',
      product_code: 'COVE-STORAGE',
      product_name: 'Cove Extra Storage',
      quantity: '4',
    },
  ];
}

function microsoftUserRows(syncRunId: string) {
  const common = {
    vendor_id: 'microsoft-365',
    customer_id: customerId,
    connectwise_company_id: 'cw-101',
    customer_name: 'Acme Services',
    agreement_id: agreementId,
    agreement_name: 'Managed Services',
    external_account_id: 'tenant-1',
    vendor_product_key: 'EXCHANGE',
    product_code: 'EXCHANGE',
    product_name: 'Exchange Online',
    quantity: '1',
    observed_at: new Date(syncRunId.includes('start') ? '2026-05-01T12:01:00Z' : '2026-06-01T12:01:00Z'),
  };

  const users = syncRunId.includes('start')
    ? [
        ['alice@acme.example', 'Alice'],
        ['bob@acme.example', 'Bob'],
      ]
    : [
        ['bob@acme.example', 'Bob'],
        ['cara@acme.example', 'Cara'],
      ];

  return users.map(([email, displayName]) => ({
    ...common,
    id: `${syncRunId}-${email}`,
    dimensions: {
      email,
      userPrincipalName: email,
      displayName,
      tenantName: 'Acme Tenant',
      userState: 'active',
    },
  }));
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
