import {
  applyDiscrepancyReportFilters,
  discrepancyComparisonDefinitions,
  findDiscrepancyComparisonDefinition,
  getDiscrepancyReport,
  getDiscrepancySourceSnapshot,
  type DiscrepancyReport,
  type DiscrepancyReportOptions,
  type DiscrepancySourceSnapshot,
  type Queryable,
} from './discrepancyReports';

export type DiscrepancyAuditSummary = {
  id: string;
  comparisonId: string;
  comparisonLabel: string;
  sourceKey: string;
  sourceSnapshot: DiscrepancySourceSnapshot;
  generatedAt: string;
  createdAt: string;
  createdBy: string | null;
  rowCount: number;
  openDiscrepancyCount: number;
};

export type DiscrepancyAuditState = {
  comparisonId: string;
  currentSourceKey: string;
  currentSourceSnapshot: DiscrepancySourceSnapshot;
  latestAudit?: DiscrepancyAuditSummary;
  hasNewerSnapshot: boolean;
  canRun: boolean;
};

export type DiscrepancyAuditReport = DiscrepancyReport & {
  audit: DiscrepancyAuditSummary;
  auditState: DiscrepancyAuditState;
  auditMode: 'saved' | 'new';
};

type DiscrepancyAuditRow = {
  id: string;
  comparison_id: string;
  comparison_label: string;
  source_key: string;
  source_snapshot: unknown;
  report_json?: unknown;
  generated_at: Date | string;
  created_at: Date | string;
  created_by: string | null;
  row_count: string | number;
  open_discrepancy_count: string | number;
};

type CleanupActionMergeRow = {
  row_id: string;
  pending_action_id: string | null;
  pending_action_status: string | null;
  pending_requested_quantity: string | number | null;
  pending_requested_reduction: string | number | null;
  pending_created_at: Date | string | null;
  latest_action_id: string | null;
  latest_action_status: string | null;
  latest_requested_quantity: string | number | null;
  latest_requested_reduction: string | number | null;
  latest_final_quantity: string | number | null;
  latest_error_message: string | null;
  latest_created_at: Date | string | null;
  latest_completed_at: Date | string | null;
  latest_updated_at: Date | string | null;
};

const activeAppRiverActionStatuses = ['queued', 'processing', 'accepted', 'verifying'];

export async function listDiscrepancyAuditStates(database: Queryable): Promise<DiscrepancyAuditState[]> {
  return Promise.all(
    discrepancyComparisonDefinitions.map(async (definition) => getDiscrepancyAuditState(database, definition.id)),
  );
}

export async function getDiscrepancyAuditState(
  database: Queryable,
  comparisonId: string,
): Promise<DiscrepancyAuditState> {
  const currentSourceSnapshot = await getDiscrepancySourceSnapshot(database, comparisonId);
  const latestAudit = await loadLatestAuditSummary(database, comparisonId);
  const hasNewerSnapshot = Boolean(
    latestAudit &&
      sourceSnapshotHasSyncRun(currentSourceSnapshot) &&
      latestAudit.sourceKey !== currentSourceSnapshot.sourceKey,
  );

  return {
    comparisonId,
    currentSourceKey: currentSourceSnapshot.sourceKey,
    currentSourceSnapshot,
    latestAudit,
    hasNewerSnapshot,
    canRun: !latestAudit || hasNewerSnapshot,
  };
}

export async function getLatestDiscrepancyAuditReport(
  database: Queryable,
  options: DiscrepancyReportOptions & { comparisonId: string },
): Promise<DiscrepancyAuditReport | undefined> {
  const row = await loadLatestAuditRow(database, options.comparisonId);
  if (!row) {
    return undefined;
  }

  const report = parseReportJson(row.report_json);
  if (!report) {
    return undefined;
  }

  const summary = mapAuditSummaryRow(row);
  const state = await getDiscrepancyAuditState(database, options.comparisonId);
  const mergedReport = await mergeDiscrepancyAuditExtras(database, report);

  return {
    ...applyDiscrepancyReportFilters(mergedReport, options),
    audit: summary,
    auditState: state,
    auditMode: 'saved',
  };
}

export async function runAndSaveDiscrepancyAudit(
  database: Queryable,
  input: DiscrepancyReportOptions & {
    comparisonId: string;
    createdBy?: string | null;
  },
): Promise<DiscrepancyAuditReport> {
  const definition = findDiscrepancyComparisonDefinition(input.comparisonId);
  if (!definition) {
    throw new Error('Discrepancy audit requires a supported comparisonId.');
  }

  const sourceSnapshot = await getDiscrepancySourceSnapshot(database, input.comparisonId);
  const fullReport = await getDiscrepancyReport(database, {
    ...input,
    includeMatched: true,
  });
  const saved = await saveDiscrepancyAudit(database, {
    comparisonId: definition.id,
    comparisonLabel: definition.label,
    sourceSnapshot,
    report: fullReport,
    createdBy: input.createdBy ?? null,
  });

  await insertAuditEvent(database, {
    actor: input.createdBy ?? 'system',
    eventType: 'reports.discrepancy-audit.saved',
    entityType: 'discrepancy_audit',
    entityId: saved.id,
    payload: {
      comparisonId: definition.id,
      sourceKey: sourceSnapshot.sourceKey,
      rowCount: saved.rowCount,
      openDiscrepancyCount: saved.openDiscrepancyCount,
    },
  });

  const state = await getDiscrepancyAuditState(database, input.comparisonId);

  return {
    ...applyDiscrepancyReportFilters(fullReport, input),
    audit: saved,
    auditState: state,
    auditMode: 'new',
  };
}

async function saveDiscrepancyAudit(
  database: Queryable,
  input: {
    comparisonId: string;
    comparisonLabel: string;
    sourceSnapshot: DiscrepancySourceSnapshot;
    report: DiscrepancyReport;
    createdBy: string | null;
  },
) {
  const result = await database.query<DiscrepancyAuditRow>(
    `insert into discrepancy_audits (
       comparison_id,
       comparison_label,
       source_key,
       source_snapshot,
       filters,
       report_json,
       summary_json,
       row_count,
       open_discrepancy_count,
       generated_at,
       created_by
     )
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10::timestamptz, $11)
     on conflict (comparison_id, source_key)
     do update set
       comparison_label = excluded.comparison_label,
       source_snapshot = excluded.source_snapshot,
       filters = excluded.filters,
       report_json = excluded.report_json,
       summary_json = excluded.summary_json,
       row_count = excluded.row_count,
       open_discrepancy_count = excluded.open_discrepancy_count,
       generated_at = excluded.generated_at,
       created_by = excluded.created_by,
       created_at = now()
     returning
       id,
       comparison_id,
       comparison_label,
       source_key,
       source_snapshot,
       generated_at,
       created_at,
       created_by,
       row_count,
       open_discrepancy_count`,
    [
      input.comparisonId,
      input.comparisonLabel,
      input.sourceSnapshot.sourceKey,
      JSON.stringify(input.sourceSnapshot),
      JSON.stringify(input.report.filters),
      JSON.stringify(input.report),
      JSON.stringify(input.report.summary),
      input.report.rows.length,
      input.report.summary.openDiscrepancyCount,
      input.report.generatedAt,
      input.createdBy,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to save discrepancy audit.');
  }

  return mapAuditSummaryRow(row);
}

async function loadLatestAuditSummary(database: Queryable, comparisonId: string) {
  const result = await database.query<DiscrepancyAuditRow>(
    `select
       id,
       comparison_id,
       comparison_label,
       source_key,
       source_snapshot,
       generated_at,
       created_at,
       created_by,
       row_count,
       open_discrepancy_count
     from discrepancy_audits
     where comparison_id = $1
     order by created_at desc
     limit 1`,
    [comparisonId],
  );

  const row = result.rows[0];
  return row ? mapAuditSummaryRow(row) : undefined;
}

async function loadLatestAuditRow(database: Queryable, comparisonId: string) {
  const result = await database.query<DiscrepancyAuditRow>(
    `select
       id,
       comparison_id,
       comparison_label,
       source_key,
       source_snapshot,
       report_json,
       generated_at,
       created_at,
       created_by,
       row_count,
       open_discrepancy_count
     from discrepancy_audits
     where comparison_id = $1
     order by created_at desc
     limit 1`,
    [comparisonId],
  );

  return result.rows[0];
}

async function mergeDiscrepancyAuditExtras(database: Queryable, report: DiscrepancyReport): Promise<DiscrepancyReport> {
  const cleanupKeys = report.rows
    .map((row) => ({
      rowId: row.id,
      externalCustomerId: row.cleanup?.externalCustomerId,
      subscriptionKey: row.cleanup?.subscriptionKey,
    }))
    .filter(
      (row): row is { rowId: string; externalCustomerId: string; subscriptionKey: string } =>
        Boolean(row.externalCustomerId && row.subscriptionKey),
    );

  if (cleanupKeys.length === 0) {
    return report;
  }

  const result = await database.query<CleanupActionMergeRow>(
    `with row_keys as (
       select *
       from jsonb_to_recordset($1::jsonb)
         as row_keys(row_id text, external_customer_id text, subscription_key text)
     )
     select
       row_keys.row_id,
       active_action.id as pending_action_id,
       active_action.status as pending_action_status,
       active_action.requested_quantity as pending_requested_quantity,
       active_action.requested_reduction as pending_requested_reduction,
       active_action.created_at as pending_created_at,
       latest_action.id as latest_action_id,
       latest_action.status as latest_action_status,
       latest_action.requested_quantity as latest_requested_quantity,
       latest_action.requested_reduction as latest_requested_reduction,
       latest_action.final_quantity as latest_final_quantity,
       latest_action.error_message as latest_error_message,
       latest_action.created_at as latest_created_at,
       latest_action.completed_at as latest_completed_at,
       latest_action.updated_at as latest_updated_at
     from row_keys
     left join lateral (
       select id, status, requested_quantity, requested_reduction, created_at
       from appriver_license_cleanup_actions
       where external_customer_id = row_keys.external_customer_id
         and subscription_key = row_keys.subscription_key
         and status = any($2::text[])
       order by created_at desc
       limit 1
     ) active_action on true
     left join lateral (
       select id, status, requested_quantity, requested_reduction, final_quantity, error_message, created_at, completed_at, updated_at
       from appriver_license_cleanup_actions
       where external_customer_id = row_keys.external_customer_id
         and subscription_key = row_keys.subscription_key
       order by created_at desc
       limit 1
     ) latest_action on true`,
    [
      JSON.stringify(
        cleanupKeys.map((row) => ({
          row_id: row.rowId,
          external_customer_id: row.externalCustomerId,
          subscription_key: row.subscriptionKey,
        })),
      ),
      activeAppRiverActionStatuses,
    ],
  );
  const actionsByRowId = new Map(result.rows.map((row) => [row.row_id, row]));

  return {
    ...report,
    rows: report.rows.map((row) => {
      if (!row.cleanup) {
        return row;
      }

      const actionRow = actionsByRowId.get(row.id);
      if (!actionRow) {
        return row;
      }

      const pendingAction = actionRow.pending_action_id
        ? {
            id: actionRow.pending_action_id,
            status: actionRow.pending_action_status ?? 'queued',
            requestedQuantity: integerValue(actionRow.pending_requested_quantity),
            requestedReduction: integerValue(actionRow.pending_requested_reduction),
            createdAt: isoDate(actionRow.pending_created_at) ?? new Date(0).toISOString(),
          }
        : undefined;
      const latestAction = actionRow.latest_action_id
        ? {
            id: actionRow.latest_action_id,
            status: actionRow.latest_action_status ?? 'queued',
            requestedQuantity: integerValue(actionRow.latest_requested_quantity),
            requestedReduction: integerValue(actionRow.latest_requested_reduction),
            finalQuantity: optionalInteger(actionRow.latest_final_quantity),
            errorMessage: stringValue(actionRow.latest_error_message),
            createdAt: isoDate(actionRow.latest_created_at) ?? new Date(0).toISOString(),
            completedAt: isoDate(actionRow.latest_completed_at),
            updatedAt: isoDate(actionRow.latest_updated_at),
          }
        : undefined;

      return {
        ...row,
        status: pendingAction ? 'warning' : row.status,
        cleanup: {
          ...row.cleanup,
          pendingAction,
          latestAction,
        },
      };
    }),
  };
}

async function insertAuditEvent(
  database: Queryable,
  input: {
    actor: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [input.actor, input.eventType, input.entityType, input.entityId, JSON.stringify(input.payload)],
  );
}

function mapAuditSummaryRow(row: DiscrepancyAuditRow): DiscrepancyAuditSummary {
  return {
    id: row.id,
    comparisonId: row.comparison_id,
    comparisonLabel: row.comparison_label,
    sourceKey: row.source_key,
    sourceSnapshot: parseSourceSnapshot(row.source_snapshot, row.comparison_id, row.source_key),
    generatedAt: isoDate(row.generated_at) ?? new Date(0).toISOString(),
    createdAt: isoDate(row.created_at) ?? new Date(0).toISOString(),
    createdBy: row.created_by,
    rowCount: integerValue(row.row_count),
    openDiscrepancyCount: integerValue(row.open_discrepancy_count),
  };
}

function parseReportJson(value: unknown): DiscrepancyReport | undefined {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const report = parsed as DiscrepancyReport;
  if (report.reportType !== 'discrepancies' || !Array.isArray(report.rows) || !Array.isArray(report.comparisonPairs)) {
    return undefined;
  }

  return report;
}

function parseSourceSnapshot(value: unknown, comparisonId: string, sourceKey: string): DiscrepancySourceSnapshot {
  const parsed = parseJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const snapshot = parsed as DiscrepancySourceSnapshot;
    if (Array.isArray(snapshot.sources) && typeof snapshot.sourceKey === 'string') {
      return snapshot;
    }
  }

  return {
    comparisonId,
    sourceKey,
    sources: [],
    missingSourceCount: 0,
  };
}

function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function sourceSnapshotHasSyncRun(snapshot: DiscrepancySourceSnapshot) {
  return snapshot.sources.some((source) => Boolean(source.syncRunId));
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function optionalInteger(value: unknown) {
  if (typeof value === 'undefined' || value === null || (typeof value === 'string' && value.trim().length === 0)) {
    return undefined;
  }

  return integerValue(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
