import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import type { Queryable } from './agreementReports';
import { getAgreementReportDetails, listAgreementReportSyncRuns, type AgreementReportSyncRun } from './agreementReports';

export type RawSyncIntegrationId = IntegrationId;

export type RawSyncRun = AgreementReportSyncRun;

export type RawSyncDetail = Record<string, string | number | boolean | null>;

export type RawSyncDetails = {
  integrationId: RawSyncIntegrationId;
  syncRun: RawSyncRun;
  columns: readonly string[];
  rows: RawSyncDetail[];
  summary: {
    rowCount: number;
    companyCount: number;
    agreementCount: number;
    productCount: number;
  };
};

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number;
  records_written: number;
  error_message: string | null;
  metadata: unknown;
};

type CoveSnapshotRow = {
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

export const coveRawSyncColumns = [
  'Customer',
  'Agreement',
  'CoveCustomer',
  'CovePartnerId',
  'Hostname',
  'ProtectedSystemType',
  'Physicality',
  'ProductCode',
  'ProductName',
  'Quantity',
  'SelectedStorageGB',
  'UsedStorageGB',
  'AccountId',
  'OS',
  'DataSources',
  'CreationDate',
  'ExpirationDate',
  'LastComplete',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export async function listRawSyncRuns(
  database: Queryable,
  integrationId: RawSyncIntegrationId,
  options: { limit?: number } = {},
): Promise<RawSyncRun[]> {
  if (integrationId === 'connectwise') {
    return listAgreementReportSyncRuns(database, options);
  }

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  if (integrationId !== 'cove') {
    const result = await database.query<SyncRunRow>(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
       from sync_runs
       where integration_id = $1
       order by started_at desc
       limit $2`,
      [integrationId, limit],
    );

    return result.rows.map(mapSyncRun);
  }

  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where integration_id = 'cove'
       and metadata->>'entity' = 'usage-snapshots'
     order by started_at desc
     limit $1`,
    [limit],
  );

  return result.rows.map(mapSyncRun);
}

export async function getRawSyncDetails(
  database: Queryable,
  integrationId: RawSyncIntegrationId,
  syncRunId: string,
): Promise<RawSyncDetails | undefined> {
  if (integrationId === 'connectwise') {
    const details = await getAgreementReportDetails(database, syncRunId);
    return details
      ? {
          integrationId,
          ...details,
        }
      : undefined;
  }

  if (integrationId === 'cove') {
    return getCoveRawSyncDetails(database, syncRunId);
  }

  return getGenericRawSyncDetails(database, integrationId, syncRunId);
}

export function isRawSyncIntegrationId(value: string | undefined): value is RawSyncIntegrationId {
  return typeof value === 'string' && Boolean(getIntegrationSettingsDefinition(value as IntegrationId));
}

async function getGenericRawSyncDetails(
  database: Queryable,
  integrationId: IntegrationId,
  syncRunId: string,
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = $2
     limit 1`,
    [syncRunId, integrationId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  return {
    integrationId,
    syncRun: mapSyncRun(syncRunRow),
    columns: [],
    rows: [],
    summary: {
      rowCount: 0,
      companyCount: 0,
      agreementCount: 0,
      productCount: 0,
    },
  };
}

async function getCoveRawSyncDetails(database: Queryable, syncRunId: string): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'cove'
       and metadata->>'entity' = 'usage-snapshots'
     limit 1`,
    [syncRunId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<CoveSnapshotRow>(
    `select
       customers.name as customer_name,
       agreements.name as agreement_name,
       vendor_usage_snapshots.external_account_id,
       vendor_usage_snapshots.product_code,
       vendor_usage_snapshots.product_name,
       vendor_usage_snapshots.quantity,
       vendor_usage_snapshots.observed_at,
       vendor_usage_snapshots.dimensions,
       vendor_usage_snapshots.raw_payload
     from vendor_usage_snapshots
     left join customers on customers.id = vendor_usage_snapshots.customer_id
     left join agreements on agreements.id = vendor_usage_snapshots.agreement_id
     where vendor_usage_snapshots.sync_run_id = $1
       and vendor_usage_snapshots.vendor_id = 'cove'
     order by coalesce(customers.name, vendor_usage_snapshots.dimensions->>'coveCustomerName', vendor_usage_snapshots.external_account_id),
       vendor_usage_snapshots.product_code,
       vendor_usage_snapshots.dimensions->>'hostname'`,
    [syncRunId],
  );
  const rows = detailResult.rows.map(mapCoveSnapshotRow);

  return {
    integrationId: 'cove',
    syncRun: mapSyncRun(syncRunRow),
    columns: coveRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedCustomerCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductCode'),
    },
  };
}

function mapCoveSnapshotRow(row: CoveSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);

  return {
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    CoveCustomer: stringValue(dimensions.coveCustomerName),
    CovePartnerId: primitiveValue(dimensions.covePartnerId),
    Hostname: stringValue(dimensions.hostname),
    ProtectedSystemType: stringValue(dimensions.protectedSystemType),
    Physicality: stringValue(dimensions.physicality),
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    SelectedStorageGB: numberValue(dimensions.selectedStorageGb) ?? 0,
    UsedStorageGB: numberValue(dimensions.usedStorageGb) ?? 0,
    AccountId: primitiveValue(dimensions.accountId),
    OS: stringValue(dimensions.os),
    DataSources: stringValue(dimensions.dataSources),
    CreationDate: stringValue(dimensions.creationDate),
    ExpirationDate: stringValue(dimensions.expirationDate),
    LastComplete: stringValue(dimensions.lastComplete),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

function mapSyncRun(row: SyncRunRow): RawSyncRun {
  return {
    id: row.id,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
    status: row.status,
    recordsRead: row.records_read,
    recordsWritten: row.records_written,
    errorMessage: row.error_message ?? undefined,
    metadata: recordFromJson(row.metadata),
  };
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return recordFromJson(parsed);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function compactJson(value: unknown) {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}

function isoDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function stringValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function primitiveValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function uniqueCount(rows: RawSyncDetail[], column: keyof RawSyncDetail) {
  return new Set(rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== '')).size;
}

function uniqueUnmappedCustomerCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.CoveCustomer)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}
