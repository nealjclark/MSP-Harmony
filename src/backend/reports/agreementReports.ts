export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type AgreementReportSyncRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
};

export type AgreementReportDetails = {
  syncRun: AgreementReportSyncRun;
  columns: readonly string[];
  rows: AgreementReportDetail[];
  summary: {
    rowCount: number;
    companyCount: number;
    agreementCount: number;
    productCount: number;
  };
};

export type AgreementReportDetail = Record<(typeof agreementReportColumns)[number], string | number | boolean | null>;

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

type AgreementReportDetailRow = {
  company_name: string;
  agreement_name: string;
  connectwise_agreement_id: string;
  connectwise_addition_id: string;
  product_code: string;
  product_name: string;
  observed_quantity: string | number;
  unit_price: string | number | null;
  raw_payload: unknown;
};

export const agreementReportColumns = [
  'Company',
  'Agreement',
  'ProductName',
  'id',
  'product',
  'quantity',
  'lessIncluded',
  'unitPrice',
  'unitCost',
  'billCustomer',
  'effectiveDate',
  'taxableFlag',
  'invoiceDescription',
  'purchaseItemFlag',
  'specialOrderFlag',
  'agreementId',
  'description',
  'billedQuantity',
  'uom',
  'extPrice',
  'extCost',
  'sequenceNumber',
  'margin',
  'prorateCost',
  'proratePrice',
  'extendedProrateCost',
  'extendedProratePrice',
  'prorateCurrentPeriodFlag',
  'agreementStatus',
  'additionStatus',
  '_info',
] as const;

export async function listAgreementReportSyncRuns(
  database: Queryable,
  options: { limit?: number } = {},
): Promise<AgreementReportSyncRun[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where integration_id = 'connectwise'
       and metadata->>'entity' = 'agreement-report'
     order by started_at desc
     limit $1`,
    [limit],
  );

  return result.rows.map(mapSyncRun);
}

export async function getAgreementReportDetails(
  database: Queryable,
  syncRunId: string,
): Promise<AgreementReportDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'connectwise'
       and metadata->>'entity' = 'agreement-report'
     limit 1`,
    [syncRunId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<AgreementReportDetailRow>(
    `select
       customers.name as company_name,
       agreements.name as agreement_name,
       agreements.connectwise_agreement_id,
       agreement_additions.connectwise_addition_id,
       agreement_additions.product_code,
       agreement_additions.product_name,
       addition_history.observed_quantity,
       addition_history.unit_price,
       addition_history.raw_payload
     from addition_history
     inner join customers on customers.id = addition_history.customer_id
     inner join agreements on agreements.id = addition_history.agreement_id
     inner join agreement_additions on agreement_additions.id = addition_history.agreement_addition_id
     where addition_history.sync_run_id = $1
       and coalesce(addition_history.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(addition_history.raw_payload->>'additionStatus', addition_history.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(addition_history.raw_payload->>'agreementStatus', addition_history.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     order by customers.name, agreements.name, agreement_additions.product_code, agreement_additions.connectwise_addition_id`,
    [syncRunId],
  );
  const rows = detailResult.rows.map(mapAgreementReportDetailRow);

  return {
    syncRun: mapSyncRun(syncRunRow),
    columns: agreementReportColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Company'),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductName'),
    },
  };
}

export function mapAgreementReportDetailRow(row: AgreementReportDetailRow): AgreementReportDetail {
  const raw = recordFromJson(row.raw_payload);
  const product = recordFromJson(raw.product);
  const info = recordFromJson(raw._info);

  return {
    Company: stringValue(raw.Company) ?? row.company_name,
    Agreement: stringValue(raw.Agreement) ?? row.agreement_name,
    ProductName: stringValue(raw.ProductName) ?? stringValue(product.identifier) ?? row.product_code,
    id: primitiveValue(raw.id) ?? row.connectwise_addition_id,
    product: primitiveValue(product.id) ?? primitiveValue(product.identifier) ?? row.product_code,
    quantity: numberValue(raw.quantity) ?? numberValue(row.observed_quantity) ?? 0,
    lessIncluded: numberValue(raw.lessIncluded) ?? null,
    unitPrice: numberValue(raw.unitPrice) ?? numberValue(row.unit_price) ?? null,
    unitCost: numberValue(raw.unitCost) ?? null,
    billCustomer: stringValue(raw.billCustomer) ?? null,
    effectiveDate: stringValue(raw.effectiveDate) ?? null,
    taxableFlag: booleanOrStringValue(raw.taxableFlag),
    invoiceDescription: stringValue(raw.invoiceDescription) ?? null,
    purchaseItemFlag: booleanOrStringValue(raw.purchaseItemFlag),
    specialOrderFlag: booleanOrStringValue(raw.specialOrderFlag),
    agreementId: primitiveValue(raw.agreementId) ?? row.connectwise_agreement_id,
    description: stringValue(raw.description) ?? row.product_name,
    billedQuantity: numberValue(raw.billedQuantity) ?? null,
    uom: stringValue(raw.uom) ?? null,
    extPrice: numberValue(raw.extPrice) ?? null,
    extCost: numberValue(raw.extCost) ?? null,
    sequenceNumber: numberValue(raw.sequenceNumber) ?? null,
    margin: numberValue(raw.margin) ?? null,
    prorateCost: numberValue(raw.prorateCost) ?? null,
    proratePrice: numberValue(raw.proratePrice) ?? null,
    extendedProrateCost: numberValue(raw.extendedProrateCost) ?? null,
    extendedProratePrice: numberValue(raw.extendedProratePrice) ?? null,
    prorateCurrentPeriodFlag: booleanOrStringValue(raw.prorateCurrentPeriodFlag),
    agreementStatus: stringValue(raw.agreementStatus) ?? null,
    additionStatus: stringValue(raw.additionStatus) ?? null,
    _info: stringValue(info.lastUpdated) ?? stringValue(info.dateEntered) ?? null,
  };
}

function mapSyncRun(row: SyncRunRow): AgreementReportSyncRun {
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

function isoDate(value: Date | string | null) {
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

function booleanOrStringValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return stringValue(value) ?? null;
}

function primitiveValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function uniqueCount(rows: AgreementReportDetail[], column: keyof AgreementReportDetail) {
  return new Set(rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined)).size;
}
