import { getIntegrationSettingsDefinition } from '../../shared/integrationSettings';
import type { Queryable } from '../reports/agreementReports';

export type AuditSyncRun = {
  id: string;
  integrationId: string;
  integrationName: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
  sourceLabel?: string;
};

export type AuditEventSummary = {
  title: string;
  subtitle: string;
  status: string;
};

export type AuditEventRecord = {
  id: string;
  actor: string;
  eventType: string;
  eventLabel: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  summary: AuditEventSummary;
};

export type AuditBatchRecord = {
  batchId: string;
  eventId: string;
  actor: string;
  occurredAt: string;
  status: string;
  updateCount: number;
  discardedCount: number;
  written: number;
  failed: number;
  discarded: number;
};

export type AuditBatchItemRecord = {
  id: string;
  customerName?: string;
  agreementName?: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  currentLessIncluded?: number;
  proposedLessIncluded?: number;
  lessIncludedChanged: boolean;
  status: string;
  errorMessage?: string;
  writtenAt?: string;
};

export type AuditBatchDetail = {
  batchId: string;
  actor: string;
  occurredAt: string;
  status: string;
  updateCount: number;
  discardedCount: number;
  written: number;
  failed: number;
  discarded: number;
  items: AuditBatchItemRecord[];
};

type SyncRunRow = {
  id: string;
  integration_id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number;
  records_written: number;
  error_message: string | null;
  metadata: unknown;
};

type AuditEventRow = {
  id: string;
  actor: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  occurred_at: Date | string;
  payload: unknown;
};

type ApprovalBatchItemRow = {
  id: string;
  customer_name: string | null;
  agreement_name: string | null;
  product_code: string;
  product_name: string;
  current_quantity: string | number;
  proposed_quantity: string | number;
  current_less_included: string | number | null;
  proposed_less_included: string | number | null;
  less_included_changed: boolean;
  status: string;
  error_message: string | null;
  written_at: Date | string | null;
};

export async function listAuditSyncRuns(
  database: Queryable,
  options: { limit?: number } = {},
): Promise<AuditSyncRun[]> {
  const limit = clampLimit(options.limit);
  const result = await database.query<SyncRunRow>(
    `select id, integration_id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     order by started_at desc
     limit $1`,
    [limit],
  );

  return result.rows.map(mapSyncRun);
}

export async function listAuditEvents(
  database: Queryable,
  options: { limit?: number } = {},
): Promise<AuditEventRecord[]> {
  const limit = clampLimit(options.limit);
  const result = await database.query<AuditEventRow>(
    `select id, actor, event_type, entity_type, entity_id, occurred_at, payload
     from audit_events
     order by occurred_at desc
     limit $1`,
    [limit],
  );

  return result.rows.map(mapAuditEvent);
}

export async function getAuditEvent(database: Queryable, eventId: string): Promise<AuditEventRecord | undefined> {
  const result = await database.query<AuditEventRow>(
    `select id, actor, event_type, entity_type, entity_id, occurred_at, payload
     from audit_events
     where id = $1::uuid
     limit 1`,
    [eventId],
  );

  const row = result.rows[0];
  return row ? mapAuditEvent(row) : undefined;
}

export async function listAuditBatches(
  database: Queryable,
  options: { limit?: number } = {},
): Promise<AuditBatchRecord[]> {
  const limit = clampLimit(options.limit);
  const result = await database.query<AuditEventRow>(
    `select id, actor, event_type, entity_type, entity_id, occurred_at, payload
     from audit_events
     where event_type = 'reconciliation.connectwise.batch.created'
     order by occurred_at desc
     limit $1`,
    [limit],
  );

  const batches = await Promise.all(
    result.rows.map(async (row) => {
      const payload = recordFromJson(row.payload);
      const batchId = row.entity_id;
      const counts = await loadBatchItemCounts(database, batchId);

      return {
        batchId,
        eventId: row.id,
        actor: row.actor,
        occurredAt: isoDate(row.occurred_at) ?? new Date(0).toISOString(),
        status: counts.status,
        updateCount: numberValue(payload.updateCount) ?? 0,
        discardedCount: numberValue(payload.discardedCount) ?? 0,
        written: counts.written,
        failed: counts.failed,
        discarded: counts.discarded,
      } satisfies AuditBatchRecord;
    }),
  );

  return batches;
}

export async function getAuditBatchDetail(database: Queryable, batchId: string): Promise<AuditBatchDetail | undefined> {
  const batchEvent = await database.query<AuditEventRow>(
    `select id, actor, event_type, entity_type, entity_id, occurred_at, payload
     from audit_events
     where event_type = 'reconciliation.connectwise.batch.created'
       and entity_id = $1
     order by occurred_at desc
     limit 1`,
    [batchId],
  );
  const eventRow = batchEvent.rows[0];

  if (!eventRow) {
    return undefined;
  }

  const payload = recordFromJson(eventRow.payload);
  const itemsResult = await database.query<ApprovalBatchItemRow>(
    `select
       id,
       customer_name,
       agreement_name,
       product_code,
       product_name,
       current_quantity,
       proposed_quantity,
       current_less_included,
       proposed_less_included,
       less_included_changed,
       status,
       error_message,
       written_at
     from approval_batch_items
     where approval_batch_id = $1::uuid
     order by created_at asc`,
    [batchId],
  );
  const counts = summarizeBatchItems(itemsResult.rows);

  return {
    batchId,
    actor: eventRow.actor,
    occurredAt: isoDate(eventRow.occurred_at) ?? new Date(0).toISOString(),
    status: counts.status,
    updateCount: numberValue(payload.updateCount) ?? counts.written + counts.failed,
    discardedCount: numberValue(payload.discardedCount) ?? counts.discarded,
    written: counts.written,
    failed: counts.failed,
    discarded: counts.discarded,
    items: itemsResult.rows.map(mapBatchItem),
  };
}

function mapSyncRun(row: SyncRunRow): AuditSyncRun {
  const metadata = recordFromJson(row.metadata);
  const integrationId = row.integration_id;
  const definition = getIntegrationSettingsDefinition(integrationId as never);

  return {
    id: row.id,
    integrationId,
    integrationName: definition?.displayName ?? integrationId,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
    status: row.status,
    recordsRead: row.records_read,
    recordsWritten: row.records_written,
    errorMessage: row.error_message ?? undefined,
    sourceLabel: syncSourceLabel(metadata),
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEventRecord {
  const payload = recordFromJson(row.payload);

  return {
    id: row.id,
    actor: row.actor,
    eventType: row.event_type,
    eventLabel: auditEventLabel(row.event_type),
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt: isoDate(row.occurred_at) ?? new Date(0).toISOString(),
    payload,
    summary: summarizeAuditEvent(row.event_type, row.entity_type, row.entity_id, payload),
  };
}

function mapBatchItem(row: ApprovalBatchItemRow): AuditBatchItemRecord {
  return {
    id: row.id,
    customerName: stringValue(row.customer_name),
    agreementName: stringValue(row.agreement_name),
    productCode: row.product_code,
    productName: row.product_name,
    currentQuantity: numberValue(row.current_quantity) ?? 0,
    proposedQuantity: numberValue(row.proposed_quantity) ?? 0,
    currentLessIncluded: numberValue(row.current_less_included),
    proposedLessIncluded: numberValue(row.proposed_less_included),
    lessIncludedChanged: row.less_included_changed,
    status: row.status,
    errorMessage: stringValue(row.error_message),
    writtenAt: isoDate(row.written_at),
  };
}

async function loadBatchItemCounts(database: Queryable, batchId: string) {
  const result = await database.query<Pick<ApprovalBatchItemRow, 'status'>>(
    `select status
     from approval_batch_items
     where approval_batch_id = $1::uuid`,
    [batchId],
  );

  return summarizeBatchItems(result.rows);
}

function summarizeBatchItems(rows: Array<Pick<ApprovalBatchItemRow, 'status'>>) {
  const summary = rows.reduce(
    (totals, row) => {
      if (row.status === 'written') totals.written += 1;
      if (row.status === 'failed') totals.failed += 1;
      if (row.status === 'discarded') totals.discarded += 1;
      return totals;
    },
    { written: 0, failed: 0, discarded: 0 },
  );

  const status = summary.failed > 0 ? 'partial' : summary.written > 0 ? 'written' : 'discarded';
  return { ...summary, status };
}

function summarizeAuditEvent(
  eventType: string,
  _entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): AuditEventSummary {
  switch (eventType) {
    case 'reconciliation.connectwise.batch.created':
      return {
        title: 'Reconciliation approval batch',
        subtitle: `${numberValue(payload.updateCount) ?? 0} updates, ${numberValue(payload.discardedCount) ?? 0} discarded`,
        status: 'approved',
      };
    case 'reconciliation.connectwise.item.written':
      return {
        title: stringValue(payload.productName) ?? stringValue(payload.productCode) ?? 'ConnectWise update',
        subtitle: quantityChangeLabel(payload),
        status: 'updated',
      };
    case 'reconciliation.connectwise.item.discarded':
      return {
        title: stringValue(payload.productName) ?? stringValue(payload.productCode) ?? 'Discarded update',
        subtitle: 'Change was not applied',
        status: 'skipped',
      };
    case 'reconciliation.connectwise.item.failed':
      return {
        title: stringValue(payload.productName) ?? stringValue(payload.productCode) ?? 'Failed update',
        subtitle: stringValue(payload.error) ?? 'ConnectWise write failed',
        status: 'blocked',
      };
    case 'integration.settings.updated': {
      const definition = getIntegrationSettingsDefinition(entityId as never);
      return {
        title: definition?.displayName ?? entityId,
        subtitle: 'Integration settings saved',
        status: 'ready',
      };
    }
    case 'connectwise.invoice.notice.stubbed':
    case 'connectwise.invoice.notice.sent':
    case 'connectwise.invoice.notice.test-sent':
      return {
        title: stringValue(payload.companyName) ?? 'Invoice notice',
        subtitle: stringValue(payload.invoiceNumber)
          ? `Invoice ${stringValue(payload.invoiceNumber)}`
          : eventType === 'connectwise.invoice.notice.sent' || eventType === 'connectwise.invoice.notice.test-sent'
            ? 'Overdue notice sent'
            : 'Overdue notice recorded',
        status: 'approved',
      };
    case 'connectwise.invoice.notice.failed':
      return {
        title: stringValue(payload.companyName) ?? 'Invoice notice',
        subtitle: stringValue(payload.deliveryError) ?? 'Overdue notice failed',
        status: 'failed',
      };
    default:
      return {
        title: auditEventLabel(eventType),
        subtitle: stringValue(payload.productName) ?? stringValue(payload.companyName) ?? '',
        status: 'ready',
      };
  }
}

function quantityChangeLabel(payload: Record<string, unknown>) {
  const current = numberValue(payload.currentQuantity);
  const proposed = numberValue(payload.proposedQuantity);
  const parts: string[] = [];

  if (typeof current === 'number' && typeof proposed === 'number') {
    parts.push(`Qty ${current.toLocaleString()} → ${proposed.toLocaleString()}`);
  }

  if (payload.lessIncludedChanged === true) {
    const currentLess = numberValue(payload.currentLessIncluded) ?? 0;
    const proposedLess = numberValue(payload.proposedLessIncluded) ?? 0;
    parts.push(`Less ${currentLess.toLocaleString()} → ${proposedLess.toLocaleString()}`);
  }

  return parts.join(' · ') || 'Quantity update applied';
}

function auditEventLabel(eventType: string) {
  switch (eventType) {
    case 'reconciliation.connectwise.batch.created':
      return 'Approval batch created';
    case 'reconciliation.connectwise.item.written':
      return 'Quantity update applied';
    case 'reconciliation.connectwise.item.discarded':
      return 'Update discarded';
    case 'reconciliation.connectwise.item.failed':
      return 'Update failed';
    case 'integration.settings.updated':
      return 'Integration settings updated';
    case 'connectwise.invoice.notice.stubbed':
      return 'Invoice notice recorded';
    case 'connectwise.invoice.notice.sent':
      return 'Invoice notice sent';
    case 'connectwise.invoice.notice.test-sent':
      return 'Invoice notice test sent';
    case 'connectwise.invoice.notice.failed':
      return 'Invoice notice failed';
    default:
      return eventType.replace(/\./g, ' · ');
  }
}

function syncSourceLabel(metadata: Record<string, unknown>) {
  const entity = stringValue(metadata.entity);
  const source = stringValue(metadata.source);

  if (entity && source) {
    return `${entity} (${source})`;
  }

  return entity ?? source;
}

function clampLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return recordFromJson(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function stringValue(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
