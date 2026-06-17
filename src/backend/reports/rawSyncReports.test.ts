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

  assert.equal(isRawSyncIntegrationId('pax8'), true);
  assert.equal(isRawSyncIntegrationId('unknown'), false);

  const genericRuns = await listRawSyncRuns(database, 'sentinelone');
  assert.equal(genericRuns[0]?.id, 'sentinel-sync-1');

  const microsoftRuns = await listRawSyncRuns(database, 'microsoft-365');
  assert.equal(microsoftRuns[0]?.id, 'microsoft-365-sync-1');

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
