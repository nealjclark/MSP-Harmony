import type { IntegrationId, IntegrationTestResult } from '../../shared/integrationSettings';
import type { IntegrationOperationalStatus, IntegrationOperationalStatusReader } from '../api/integrations';
import type { IntegrationSettingsMetadata, IntegrationSettingsMetadataReader } from './settingsProvider';
import type { IntegrationSettingsRepository } from './settingsUpdater';

type QueryResult<T> = {
  rows: T[];
};

type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

type IntegrationSettingsRow = {
  endpoint: string | null;
  non_secret_settings: unknown;
  last_tested_at: Date | string | null;
  last_test_result: IntegrationTestResult | null;
};

type SyncRunSummaryRow = {
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number;
  records_written: number;
  error_message: string | null;
};

type CountRow = {
  count: string | number;
};

export type SaveIntegrationTestResultInput = {
  integrationId: IntegrationId;
  displayName: string;
  authMode: string;
  endpoint: string;
  syncFrequency: string;
  nonSecrets: Record<string, string | undefined>;
  requiredKeyVaultSecrets: string[];
  result: IntegrationTestResult;
};

export class PostgresIntegrationSettingsRepository
  implements IntegrationSettingsRepository, IntegrationSettingsMetadataReader, IntegrationOperationalStatusReader
{
  constructor(private readonly database: Queryable) {}

  async saveNonSecrets(input: {
    integrationId: IntegrationId;
    displayName: string;
    authMode: string;
    endpoint: string;
    syncFrequency: string;
    nonSecrets: Record<string, string | undefined>;
    requiredKeyVaultSecrets: string[];
    updatedBy: string;
  }) {
    const nonSecrets = cleanRecord({
      endpoint: input.endpoint,
      ...input.nonSecrets,
    });

    await this.database.query(
      `insert into integration_settings (
         integration_id,
         display_name,
         configured_status,
         auth_mode,
         endpoint,
         sync_frequency,
         non_secret_settings,
         required_key_vault_secrets,
         last_test_result,
         updated_at
       )
       values ($1, $2, 'degraded', $3, $4, $5, $6::jsonb, $7::jsonb, 'untested', now())
       on conflict (integration_id)
       do update set
         display_name = excluded.display_name,
         auth_mode = excluded.auth_mode,
         endpoint = excluded.endpoint,
         sync_frequency = excluded.sync_frequency,
         non_secret_settings = excluded.non_secret_settings,
         required_key_vault_secrets = excluded.required_key_vault_secrets,
         updated_at = now()`,
      [
        input.integrationId,
        input.displayName,
        input.authMode,
        nonSecrets.endpoint ?? input.endpoint,
        input.syncFrequency,
        JSON.stringify(nonSecrets),
        JSON.stringify(input.requiredKeyVaultSecrets),
      ],
    );

    await this.database.query(
      `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
       values ($1, 'integration.settings.updated', 'integration', $2, $3::jsonb)`,
      [
        input.updatedBy,
        input.integrationId,
        JSON.stringify({
          savedNonSecretKeys: Object.keys(nonSecrets),
          requiredKeyVaultSecrets: input.requiredKeyVaultSecrets,
        }),
      ],
    );
  }

  async loadMetadata(integrationId: IntegrationId): Promise<IntegrationSettingsMetadata | undefined> {
    const result = await this.database.query<IntegrationSettingsRow>(
      `select endpoint, non_secret_settings, last_tested_at, last_test_result
       from integration_settings
       where integration_id = $1`,
      [integrationId],
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      nonSecrets: cleanRecord({
        endpoint: row.endpoint ?? undefined,
        ...recordFromJson(row.non_secret_settings),
      }),
      lastTestedAt: isoDate(row.last_tested_at),
      lastTestResult: row.last_test_result ?? undefined,
    };
  }

  async saveTestResult(input: SaveIntegrationTestResultInput) {
    const nonSecrets = cleanRecord({
      endpoint: input.endpoint,
      ...input.nonSecrets,
    });
    const configuredStatus = input.result === 'success' ? 'connected' : 'degraded';

    await this.database.query(
      `insert into integration_settings (
         integration_id,
         display_name,
         configured_status,
         auth_mode,
         endpoint,
         sync_frequency,
         non_secret_settings,
         required_key_vault_secrets,
         last_tested_at,
         last_test_result,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now(), $9, now())
       on conflict (integration_id)
       do update set
         display_name = excluded.display_name,
         configured_status = excluded.configured_status,
         auth_mode = excluded.auth_mode,
         endpoint = excluded.endpoint,
         sync_frequency = excluded.sync_frequency,
         non_secret_settings = excluded.non_secret_settings,
         required_key_vault_secrets = excluded.required_key_vault_secrets,
         last_tested_at = now(),
         last_test_result = excluded.last_test_result,
         updated_at = now()`,
      [
        input.integrationId,
        input.displayName,
        configuredStatus,
        input.authMode,
        nonSecrets.endpoint ?? input.endpoint,
        input.syncFrequency,
        JSON.stringify(nonSecrets),
        JSON.stringify(input.requiredKeyVaultSecrets),
        input.result,
      ],
    );
  }

  async loadOperationalStatus(integrationId: IntegrationId): Promise<IntegrationOperationalStatus | undefined> {
    const syncRunResult = await this.database.query<SyncRunSummaryRow>(
      `select started_at, completed_at, status, records_read, records_written, error_message
       from sync_runs
       where integration_id = $1
       order by started_at desc
       limit 1`,
      [integrationId],
    );
    const latestSyncRun = syncRunResult.rows[0];
    const storedRecordCount = await this.loadStoredRecordCount(integrationId);

    if (!latestSyncRun && typeof storedRecordCount === 'undefined') {
      return undefined;
    }

    return {
      lastSyncAt: isoDate(latestSyncRun?.started_at ?? null),
      lastSyncCompletedAt: isoDate(latestSyncRun?.completed_at ?? null),
      lastSyncStatus: latestSyncRun?.status,
      lastSyncRecordsRead: latestSyncRun?.records_read,
      lastSyncRecordsWritten: latestSyncRun?.records_written,
      lastSyncError: latestSyncRun?.error_message ?? undefined,
      storedRecordCount,
    };
  }

  private async loadStoredRecordCount(integrationId: IntegrationId) {
    const result =
      integrationId === 'connectwise'
        ? await this.database.query<CountRow>('select count(*) as count from agreement_additions')
        : integrationId === 'cove'
          ? await this.database.query<CountRow>(
              `select count(*) as count
               from vendor_usage_snapshots
               where vendor_id = 'cove'`,
            )
          : undefined;
    if (!result) {
      return undefined;
    }
    const count = result.rows[0]?.count;

    return typeof count === 'number' ? count : Number.parseInt(count ?? '0', 10);
  }
}

function cleanRecord(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value?.trim()] as const)
      .filter(([, value]) => value && value.length > 0),
  );
}

function recordFromJson(value: unknown): Record<string, string | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === 'string')
      .map(([key, item]) => [key, item as string]),
  );
}

function isoDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
