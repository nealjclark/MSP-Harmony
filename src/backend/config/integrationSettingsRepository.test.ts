import assert from 'node:assert/strict';
import { PostgresIntegrationSettingsRepository } from './integrationSettingsRepository';

const queries: Array<{ sql: string; values?: unknown[] }> = [];
const repository = new PostgresIntegrationSettingsRepository({
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('from sync_runs')) {
      return {
        rows: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            integration_id: 'connectwise',
            started_at: new Date('2026-06-13T10:00:00.000Z'),
            completed_at: new Date('2026-06-13T10:01:00.000Z'),
            status: 'complete',
            records_read: 15,
            records_written: 12,
            error_message: null,
          },
        ] as T[],
      };
    }

    if (sql.includes('from appriver_sync_work_items')) {
      return {
        rows: [{
          total_customers: '212',
          completed_customers: '9',
          failed_customers: '1',
          queued_customers: '201',
          processing_customers: '1',
          current_customer_name: 'Blue Whale',
        } as T],
      };
    }

    if (sql.includes('count(*) as count from agreement_additions')) {
      return {
        rows: [{ count: '12' } as T],
      };
    }

    if (sql.includes('from vendor_usage_snapshots')) {
      if (sql.includes('group by vendor_id')) {
        return {
          rows: [{ vendor_id: 'cove', count: '34' } as T],
        };
      }

      return {
        rows: [{ count: '34' } as T],
      };
    }

    if (sql.includes('from integration_settings')) {
      return {
        rows: [
          {
            integration_id: 'connectwise',
            endpoint: 'https://api-na.myconnectwise.net',
            non_secret_settings: {
              companyId: 'bmb',
              clientId: '00000000-0000-0000-0000-000000000000',
            },
            required_key_vault_secrets: [
              'mspharmony-connectwise-public-key',
              'mspharmony-connectwise-private-key',
            ],
            last_tested_at: new Date('2026-06-13T11:00:00.000Z'),
            last_test_result: 'success',
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
});

async function run() {
  const status = await repository.loadOperationalStatus('connectwise');

  assert.equal(status?.lastSyncAt, '2026-06-13T10:00:00.000Z');
  assert.equal(status?.lastSyncCompletedAt, '2026-06-13T10:01:00.000Z');
  assert.equal(status?.lastSyncStatus, 'complete');
  assert.equal(status?.lastSyncRecordsRead, 15);
  assert.equal(status?.lastSyncRecordsWritten, 12);
  assert.equal(status?.storedRecordCount, 12);
  assert.equal(queries[0]?.values?.[0], 'connectwise');

  const coveStatus = await repository.loadOperationalStatus('cove');
  assert.equal(coveStatus?.storedRecordCount, 34);

  const appRiverStatus = await repository.loadOperationalStatus('opentext-appriver');
  assert.equal(appRiverStatus?.storedRecordCount, 34);
  assert.deepEqual(appRiverStatus?.syncProgress, {
    totalCustomers: 212,
    processedCustomers: 10,
    completedCustomers: 9,
    failedCustomers: 1,
    queuedCustomers: 201,
    processingCustomers: 1,
    currentCustomerName: 'Blue Whale',
  });

  const metadata = await repository.loadMetadata('connectwise');
  assert.equal(metadata?.nonSecrets.companyId, 'bmb');
  assert.deepEqual(metadata?.availableKeyVaultSecrets, [
    'mspharmony-connectwise-public-key',
    'mspharmony-connectwise-private-key',
  ]);
  assert.equal(metadata?.lastTestedAt, '2026-06-13T11:00:00.000Z');
  assert.equal(metadata?.lastTestResult, 'success');

  const metadataById = await repository.loadAllMetadata(['connectwise', 'cove']);
  assert.equal(metadataById.get('connectwise')?.nonSecrets.companyId, 'bmb');

  const statusesById = await repository.loadOperationalStatuses(['connectwise', 'cove']);
  assert.equal(statusesById.get('connectwise')?.storedRecordCount, 12);
  assert.equal(statusesById.get('cove')?.storedRecordCount, 34);

  const microsoft365Repository = new PostgresIntegrationSettingsRepository({
    async query<T = unknown>(sql: string) {
      if (sql.includes('from sync_runs') && sql.includes('select distinct on')) {
        return {
          rows: [
            {
              integration_id: 'microsoft-365',
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              started_at: new Date('2026-06-19T20:09:00.000Z'),
              completed_at: new Date('2026-06-19T20:10:00.000Z'),
              status: 'complete',
              records_read: 6654,
              records_written: 6654,
              error_message: null,
              metadata: { entity: 'license-snapshots' },
            },
            {
              integration_id: 'microsoft-365',
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              started_at: new Date('2026-07-06T20:04:00.000Z'),
              completed_at: new Date('2026-07-06T20:05:00.000Z'),
              status: 'complete',
              records_read: 763,
              records_written: 763,
              error_message: null,
              metadata: { operationKey: 'm365-licenses', entity: 'm365-licenses' },
            },
            {
              integration_id: 'microsoft-365',
              id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              started_at: new Date('2026-07-06T20:03:00.000Z'),
              completed_at: new Date('2026-07-06T20:04:00.000Z'),
              status: 'complete',
              records_read: 6675,
              records_written: 6675,
              error_message: null,
              metadata: { operationKey: 'm365-users', entity: 'm365-users' },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs')) {
        return {
          rows: [{
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            started_at: new Date('2026-07-06T20:04:00.000Z'),
            completed_at: new Date('2026-07-06T20:05:00.000Z'),
            status: 'complete',
            records_read: 763,
            records_written: 763,
            error_message: null,
          } as T],
        };
      }

      if (sql.includes('from vendor_usage_snapshots')) {
        return { rows: [{ count: '7438' } as T] };
      }

      return { rows: [] as T[] };
    },
  });
  const microsoft365Status = await microsoft365Repository.loadOperationalStatus('microsoft-365');
  assert.deepEqual(
    microsoft365Status?.operations?.map((operation) => operation.operationKey),
    ['m365-licenses', 'm365-users'],
  );

  console.log('integration settings repository tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
