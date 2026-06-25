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

    if (sql.includes('count(*) as count from agreement_additions')) {
      return {
        rows: [{ count: '12' } as T],
      };
    }

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [{ count: '34' } as T],
      };
    }

    if (sql.includes('from integration_settings')) {
      return {
        rows: [
          {
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

  const metadata = await repository.loadMetadata('connectwise');
  assert.equal(metadata?.nonSecrets.companyId, 'bmb');
  assert.deepEqual(metadata?.availableKeyVaultSecrets, [
    'mspharmony-connectwise-public-key',
    'mspharmony-connectwise-private-key',
  ]);
  assert.equal(metadata?.lastTestedAt, '2026-06-13T11:00:00.000Z');
  assert.equal(metadata?.lastTestResult, 'success');

  console.log('integration settings repository tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
