import { getIntegrationSettingsDefinition, listIntegrationApiOperations, type IntegrationId, type IntegrationTestResult } from '../../shared/integrationSettings';
import type { IntegrationOperationalStatus, IntegrationOperationalStatusReader, IntegrationSyncJob } from '../api/integrations';
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
  required_key_vault_secrets: unknown;
  last_tested_at: Date | string | null;
  last_test_result: IntegrationTestResult | null;
};

type SyncRunSummaryRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number;
  records_written: number;
  error_message: string | null;
  metadata?: unknown;
};

type AppRiverSyncProgressRow = {
  total_customers: string | number;
  completed_customers: string | number;
  failed_customers: string | number;
  queued_customers: string | number;
  processing_customers: string | number;
  current_customer_name: string | null;
};

type CountRow = {
  count: string | number;
};

type IntegrationSyncJobRow = {
  id: string;
  integration_id: IntegrationId;
  operation_key: string;
  operation_label: string;
  status: IntegrationSyncJob['status'];
  requested_by: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  sync_run_id: string | null;
  error_message: string | null;
  progress_completed: number | null;
  progress_total: number | null;
  progress_failed: number;
  progress_current_item: string | null;
  progress_unit_label: string | null;
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

  async createSyncJob(input: {
    integrationId: IntegrationId;
    integrationName: string;
    operationKey: string;
    operationLabel: string;
    requestedBy: string;
    requestedAt: string;
  }) {
    const result = await this.database.query<{ id: string }>(
      `insert into integration_sync_jobs (
         integration_id, operation_key, operation_label, status, requested_by, requested_at
       ) values ($1, $2, $3, 'queued', $4, $5::timestamptz)
       returning id`,
      [input.integrationId, input.operationKey, input.operationLabel, input.requestedBy, input.requestedAt],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`Unable to create ${input.integrationName} sync job.`);
    return id;
  }

  async markSyncJobRunning(jobId: string) {
    await this.database.query(
      `update integration_sync_jobs
       set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
       where id = $1::uuid and status in ('queued', 'running')`,
      [jobId],
    );
  }

  async attachSyncJobRun(jobId: string, syncRunId: string) {
    await this.database.query(
      `update integration_sync_jobs set sync_run_id = $2::uuid, updated_at = now() where id = $1::uuid`,
      [jobId, syncRunId],
    );
  }

  async updateSyncJobProgress(jobId: string, progress: {
    completed: number;
    total: number;
    failed?: number;
    currentItem?: string;
    unitLabel: string;
  }) {
    await this.database.query(
      `update integration_sync_jobs
       set progress_completed = $2, progress_total = $3, progress_failed = $4,
           progress_current_item = $5, progress_unit_label = $6, updated_at = now()
       where id = $1::uuid and status in ('queued', 'running')`,
      [jobId, progress.completed, progress.total, progress.failed ?? 0, progress.currentItem ?? null, progress.unitLabel],
    );
  }

  async completeSyncJob(jobId: string, syncRunId?: string) {
    await this.database.query(
      `update integration_sync_jobs
       set status = 'complete', completed_at = now(), sync_run_id = coalesce($2::uuid, sync_run_id),
           error_message = null, updated_at = now()
       where id = $1::uuid`,
      [jobId, syncRunId ?? null],
    );
  }

  async failSyncJob(jobId: string, error: string, syncRunId?: string) {
    await this.database.query(
      `update integration_sync_jobs
       set status = 'failed', completed_at = now(), sync_run_id = coalesce($3::uuid, sync_run_id),
           error_message = $2, updated_at = now()
       where id = $1::uuid`,
      [jobId, error, syncRunId ?? null],
    );
  }

  async listRecentSyncJobs(limit = 20): Promise<IntegrationSyncJob[]> {
    const result = await this.database.query<IntegrationSyncJobRow>(
      `select id, integration_id, operation_key, operation_label, status, requested_by, requested_at,
              started_at, completed_at, sync_run_id, error_message, progress_completed, progress_total,
              progress_failed, progress_current_item, progress_unit_label
       from integration_sync_jobs
       where status in ('queued', 'running') or requested_at >= now() - interval '24 hours'
       order by requested_at desc
       limit $1`,
      [limit],
    );

    return Promise.all(result.rows.map(async (row) => {
      let progress: IntegrationSyncJob['progress'] =
        row.progress_total != null && row.progress_completed != null && row.progress_unit_label
          ? {
              completed: row.progress_completed,
              total: row.progress_total,
              failed: row.progress_failed,
              currentItem: row.progress_current_item ?? undefined,
              unitLabel: row.progress_unit_label,
            }
          : undefined;
      if (row.integration_id === 'opentext-appriver' && row.sync_run_id) {
        const appRiver = await this.loadAppRiverSyncProgress(row.sync_run_id);
        if (appRiver) {
          progress = {
            completed: appRiver.processedCustomers,
            total: appRiver.totalCustomers,
            failed: appRiver.failedCustomers,
            currentItem: appRiver.currentCustomerName,
            unitLabel: 'customers',
          };
        }
      }
      return {
        id: row.id,
        integrationId: row.integration_id,
        integrationName: getIntegrationSettingsDefinition(row.integration_id)?.displayName ?? row.integration_id,
        operationKey: row.operation_key,
        operationLabel: row.operation_label,
        status: row.status,
        requestedBy: row.requested_by,
        requestedAt: isoDate(row.requested_at) ?? new Date(0).toISOString(),
        startedAt: isoDate(row.started_at) ?? undefined,
        completedAt: isoDate(row.completed_at) ?? undefined,
        syncRunId: row.sync_run_id ?? undefined,
        error: row.error_message ?? undefined,
        progress,
      };
    }));
  }

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
      `select endpoint, non_secret_settings, required_key_vault_secrets, last_tested_at, last_test_result
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
      availableKeyVaultSecrets: stringArrayFromJson(row.required_key_vault_secrets),
      lastTestedAt: isoDate(row.last_tested_at),
      lastTestResult: row.last_test_result ?? undefined,
    };
  }

  async loadAllMetadata(integrationIds: IntegrationId[]): Promise<Map<IntegrationId, IntegrationSettingsMetadata>> {
    if (integrationIds.length === 0) {
      return new Map();
    }

    const result = await this.database.query<IntegrationSettingsRow & { integration_id: IntegrationId }>(
      `select integration_id, endpoint, non_secret_settings, required_key_vault_secrets, last_tested_at, last_test_result
       from integration_settings
       where integration_id = any($1::text[])`,
      [integrationIds],
    );

    return new Map(
      result.rows.map((row) => [
        row.integration_id,
        {
          nonSecrets: cleanRecord({
            endpoint: row.endpoint ?? undefined,
            ...recordFromJson(row.non_secret_settings),
          }),
          availableKeyVaultSecrets: stringArrayFromJson(row.required_key_vault_secrets),
          lastTestedAt: isoDate(row.last_tested_at),
          lastTestResult: row.last_test_result ?? undefined,
        },
      ]),
    );
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
      `select id, started_at, completed_at, status, records_read, records_written, error_message
       from sync_runs
       where integration_id = $1
         and ($1 <> 'connectwise' or coalesce(metadata->>'entity', '') <> 'companies')
       order by started_at desc
       limit 1`,
      [integrationId],
    );
    const latestSyncRun = syncRunResult.rows[0];
    const storedRecordCount = await this.loadStoredRecordCount(integrationId);
    const syncProgress = integrationId === 'opentext-appriver' && latestSyncRun
      ? await this.loadAppRiverSyncProgress(latestSyncRun.id)
      : undefined;
    const operations = await this.loadOperationStatuses([integrationId]);

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
      syncProgress,
      operations: operations.get(integrationId),
    };
  }

  async loadOperationalStatuses(integrationIds: IntegrationId[]): Promise<Map<IntegrationId, IntegrationOperationalStatus>> {
    if (integrationIds.length === 0) {
      return new Map();
    }

    const latestSyncRuns = await this.database.query<SyncRunSummaryRow & { integration_id: IntegrationId }>(
      `select distinct on (integration_id)
         integration_id,
         id,
         started_at,
         completed_at,
         status,
         records_read,
         records_written,
         error_message
       from sync_runs
       where integration_id = any($1::text[])
         and (integration_id <> 'connectwise' or coalesce(metadata->>'entity', '') <> 'companies')
       order by integration_id, started_at desc`,
      [integrationIds],
    );
    const syncRunsById = new Map(latestSyncRuns.rows.map((row) => [row.integration_id, row]));
    const storedCountsById = await this.loadStoredRecordCounts(integrationIds);
    const operationStatusesById = await this.loadOperationStatuses(integrationIds);
    const statuses = new Map<IntegrationId, IntegrationOperationalStatus>();

    for (const integrationId of integrationIds) {
      const latestSyncRun = syncRunsById.get(integrationId);
      const storedRecordCount = storedCountsById.get(integrationId);
      const syncProgress = integrationId === 'opentext-appriver' && latestSyncRun
        ? await this.loadAppRiverSyncProgress(latestSyncRun.id)
        : undefined;

      if (!latestSyncRun && typeof storedRecordCount === 'undefined') {
        continue;
      }

      statuses.set(integrationId, {
        lastSyncAt: isoDate(latestSyncRun?.started_at ?? null),
        lastSyncCompletedAt: isoDate(latestSyncRun?.completed_at ?? null),
        lastSyncStatus: latestSyncRun?.status,
        lastSyncRecordsRead: latestSyncRun?.records_read,
        lastSyncRecordsWritten: latestSyncRun?.records_written,
        lastSyncError: latestSyncRun?.error_message ?? undefined,
        storedRecordCount,
        syncProgress,
        operations: operationStatusesById.get(integrationId),
      });
    }

    return statuses;
  }

  private async loadAppRiverSyncProgress(syncRunId: string) {
    const result = await this.database.query<AppRiverSyncProgressRow>(
      `select
         count(*) as total_customers,
         count(*) filter (where status = 'complete') as completed_customers,
         count(*) filter (where status = 'failed') as failed_customers,
         count(*) filter (where status = 'queued') as queued_customers,
         count(*) filter (where status = 'processing') as processing_customers,
         max(customer_name) filter (where status = 'processing') as current_customer_name
       from appriver_sync_work_items
       where sync_run_id = $1::uuid`,
      [syncRunId],
    );
    const row = result.rows[0];
    const totalCustomers = normalizeCount(row?.total_customers);
    if (totalCustomers === 0) return undefined;
    const completedCustomers = normalizeCount(row?.completed_customers);
    const failedCustomers = normalizeCount(row?.failed_customers);
    return {
      totalCustomers,
      processedCustomers: completedCustomers + failedCustomers,
      completedCustomers,
      failedCustomers,
      queuedCustomers: normalizeCount(row?.queued_customers),
      processingCustomers: normalizeCount(row?.processing_customers),
      currentCustomerName: row?.current_customer_name ?? undefined,
    };
  }

  private async loadOperationStatuses(integrationIds: IntegrationId[]) {
    const result = await this.database.query<SyncRunSummaryRow & { integration_id: IntegrationId }>(
      `select distinct on (
         integration_id,
         coalesce(metadata->>'operationKey', metadata->>'entity', 'legacy')
       )
         integration_id,
         id,
         started_at,
         completed_at,
         status,
         records_read,
         records_written,
         error_message,
         metadata
       from sync_runs
       where integration_id = any($1::text[])
       order by
         integration_id,
         coalesce(metadata->>'operationKey', metadata->>'entity', 'legacy'),
         started_at desc`,
      [integrationIds],
    );
    const statuses = new Map<IntegrationId, IntegrationOperationalStatus['operations']>();

    for (const row of result.rows) {
      const metadata = recordFromJson(row.metadata);
      const operationKey = String(metadata.operationKey ?? metadata.entity ?? 'legacy');
      const definition = listIntegrationApiOperations(row.integration_id).find((item) => item.key === operationKey);
      // Historical sync runs remain available to reports and audit history, but
      // only operations in the current registry are actionable in Integrations.
      if (!definition) continue;
      const dataSourceKey = typeof metadata.dataSourceKey === 'string' ? metadata.dataSourceKey : definition?.dataSourceKey;
      const currentItem = row.integration_id === 'opentext-appriver' && row.status !== 'complete' && row.status !== 'failed'
        ? (await this.loadAppRiverSyncProgress(row.id))?.currentCustomerName
        : undefined;
      const operation = {
        operationKey,
        label: definition?.label ?? legacyOperationLabel(row.integration_id, operationKey),
        dataSourceKey,
        status: row.status,
        startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
        completedAt: isoDate(row.completed_at ?? null),
        recordsRead: row.records_read,
        recordsWritten: row.records_written,
        error: row.error_message ?? undefined,
        currentItem,
      };
      statuses.set(row.integration_id, [...(statuses.get(row.integration_id) ?? []), operation]);
    }

    for (const integrationId of integrationIds) {
      const existing = statuses.get(integrationId) ?? [];
      const existingKeys = new Set(existing.map((item) => item.operationKey));
      const neverRun = listIntegrationApiOperations(integrationId)
        .filter((definition) => !existingKeys.has(definition.key))
        .map((definition) => ({
          operationKey: definition.key,
          label: definition.label,
          dataSourceKey: definition.dataSourceKey,
          status: 'never',
          startedAt: '',
        }));
      if (existing.length > 0 || neverRun.length > 0) {
        statuses.set(integrationId, [...existing, ...neverRun]);
      }
    }

    return statuses;
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
          : integrationId === 'datto'
            ? await this.database.query<CountRow>(
                `select count(*) as count
                 from vendor_usage_snapshots
                 where vendor_id = 'datto'`,
              )
          : integrationId === 'opentext-appriver'
            ? await this.database.query<CountRow>(
                `select count(*) as count
                 from vendor_usage_snapshots
                 where vendor_id = 'opentext-appriver'`,
              )
          : await this.database.query<CountRow>(
              `select count(*) as count
               from vendor_usage_snapshots
               where vendor_id = $1`,
              [integrationId],
            );
    if (!result) {
      return undefined;
    }
    const count = result.rows[0]?.count;

    return typeof count === 'number' ? count : Number.parseInt(count ?? '0', 10);
  }

  private async loadStoredRecordCounts(integrationIds: IntegrationId[]) {
    const counts = new Map<IntegrationId, number>();

    if (integrationIds.includes('connectwise')) {
      const result = await this.database.query<CountRow>('select count(*) as count from agreement_additions');
      counts.set('connectwise', normalizeCount(result.rows[0]?.count));
    }

    const vendorIds = integrationIds.filter((integrationId) => integrationId !== 'connectwise');
    if (vendorIds.length > 0) {
      const result = await this.database.query<CountRow & { vendor_id: IntegrationId }>(
        `select vendor_id, count(*) as count
         from vendor_usage_snapshots
         where vendor_id = any($1::text[])
         group by vendor_id`,
        [vendorIds],
      );

      for (const row of result.rows) {
        counts.set(row.vendor_id, normalizeCount(row.count));
      }
    }

    return counts;
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

function stringArrayFromJson(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isoDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function legacyOperationLabel(integrationId: IntegrationId, operationKey: string) {
  if (integrationId === 'datto' && operationKey === 'usage-snapshots') return 'Combined Datto sync (legacy)';
  if (operationKey === 'legacy') return 'Legacy sync';
  return operationKey
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeCount(count: string | number | undefined) {
  return typeof count === 'number' ? count : Number.parseInt(count ?? '0', 10);
}
