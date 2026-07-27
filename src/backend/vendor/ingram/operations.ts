import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from '@e965/xlsx';
import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import { storeInvoiceFile, type StoredInvoiceFile } from '../../invoices/invoiceFileStorage';
import {
  IngramClient,
  ingramCredentialsFromSettings,
  ingramIntegrationId,
  ingramReportDateRange,
  type IngramReport,
} from './client';

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type IngramReportClient = Pick<IngramClient, 'listReports' | 'getReport' | 'downloadReport'>;

export async function testIngramConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: IngramReportClient;
  now?: string;
} = {}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(ingramIntegrationId);
  assertIngramReady(settings);
  const client = input.client ?? new IngramClient(ingramCredentialsFromSettings(settings));
  const reportDateRange = ingramReportDateRange(input.now ?? new Date());
  const reports = await client.listReports(reportDateRange);
  return {
    integrationId: ingramIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    reportCount: reports.length,
    reportDateRange,
    sampleReports: reports.slice(0, 10).map(({ id, name, status, createdAt }) => ({ id, name, status, createdAt })),
  };
}

export async function syncIngramInvoices(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: IngramReportClient;
  now?: string;
  onProgress?: SyncProgressReporter;
}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(ingramIntegrationId);
  assertIngramReady(settings);
  const client = input.client ?? new IngramClient(ingramCredentialsFromSettings(settings));
  const reportPrefix = String(settings.nonSecrets.reportNamePrefix ?? '').trim().toLowerCase();
  const excludedCustomerNames = parseIngramExcludedCustomerNames(settings.nonSecrets.excludedCustomerNames);
  const reportDateRange = ingramReportDateRange(input.now ?? new Date());
  const syncRunId = await startSyncRun(input.pool, {
    entity: 'ingram-invoices',
    reportPrefix,
    reportDateRange,
    excludedCustomerNames,
  });
  try {
    const normalizedExistingLines = await backfillIngramInvoiceLines(input.pool);
    const reports = (await client.listReports(reportDateRange))
      .filter((report) => !report.status || ['completed', 'complete', 'ready', 'success'].includes(report.status.toLowerCase()))
      .sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')));
    let recordsRead = 0;
    let recordsWritten = 0;
    let importedReports = 0;
    let archivedReports = 0;
    let archivedOnlyReports = 0;
    let skippedReports = 0;
    let excludedRows = 0;
    await input.onProgress?.({ completed: 0, total: reports.length, unitLabel: 'reports' });
    for (const [index, listedReport] of reports.entries()) {
      const report = listedReport.downloadUrl ? listedReport : await client.getReport(listedReport.id);
      if (!report.downloadUrl) continue;
      if (await reportAlreadyArchived(input.pool, report.id)) {
        skippedReports += 1;
      } else {
        const bytes = await client.downloadReport(report.downloadUrl);
        const hash = createHash('sha256').update(bytes).digest('hex');
        const existingFile = await archivedFileByHash(input.pool, hash);
        const stored = existingFile ?? await storeInvoiceFile({
          importId: randomUUID(),
          integrationId: ingramIntegrationId,
          fileName: workbookFileName(report.name),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes,
        });
        const archiveId = await insertReportArchive(input.pool, report, stored, hash);
        archivedReports += 1;
        const authoritative = !reportPrefix || report.name.toLowerCase().startsWith(reportPrefix);
        if (!authoritative) {
          archivedOnlyReports += 1;
        } else if (await reportAlreadyImported(input.pool, report.id) || await hashAlreadyImported(input.pool, hash)) {
          skippedReports += 1;
        } else {
          const rawRows = parseWorkbook(bytes);
          const rows = rawRows.filter((row) =>
            !isIngramCustomerExcluded(normalizeIngramRow(row).customerName, excludedCustomerNames));
          excludedRows += rawRows.length - rows.length;
          const importId = await insertInvoiceImport(input.pool, report, stored, hash, rows);
          for (const [rowIndex, row] of rows.entries()) {
            await insertInvoiceLine(input.pool, importId, row, rowIndex + 2);
          }
          await input.pool.query(
            `update ingram_report_archives set invoice_import_id = $2::uuid where id = $1::uuid`,
            [archiveId, importId],
          );
          recordsRead += rawRows.length;
          recordsWritten += rows.length;
          importedReports += 1;
        }
      }
      await input.onProgress?.({
        completed: index + 1,
        total: reports.length,
        currentItem: report.name,
        unitLabel: 'reports',
      });
    }
    await completeSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'ingram-invoices',
      reportPrefix,
      reportDateRange,
      importedReports,
      archivedReports,
      archivedOnlyReports,
      skippedReports,
      excludedRows,
      excludedCustomerNames,
      normalizedExistingLines,
    });
    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      importedReports,
      archivedReports,
      archivedOnlyReports,
      skippedReports,
      excludedRows,
      normalizedExistingLines,
      reportDateRange,
    };
  } catch (error) {
    await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function parseIngramWorkbook(bytes: Buffer) {
  return parseWorkbook(bytes);
}

export async function importIngramInvoiceWorkbook(input: {
  pool: Queryable;
  bytes: Buffer;
  fileName: string;
  reportCreatedAt?: string;
  excludedCustomerNames?: string[];
}) {
  const hash = createHash('sha256').update(input.bytes).digest('hex');
  if (await hashAlreadyImported(input.pool, hash)) {
    return { imported: false, reason: 'duplicate-file', recordsRead: 0, recordsWritten: 0 };
  }
  const report: IngramReport = {
    id: `historical-${hash}`,
    name: input.fileName.replace(/\.xlsx$/i, ''),
    format: 'XLSX',
    status: 'completed',
    createdAt: input.reportCreatedAt,
    raw: {
      source: 'historical-file-backfill',
      originalFileName: input.fileName,
    },
  };
  if (await reportAlreadyArchived(input.pool, report.id)) {
    return { imported: false, reason: 'duplicate-report', recordsRead: 0, recordsWritten: 0 };
  }
  const rawRows = parseWorkbook(input.bytes);
  const excludedCustomerNames = input.excludedCustomerNames ?? [];
  const rows = rawRows.filter((row) =>
    !isIngramCustomerExcluded(normalizeIngramRow(row).customerName, excludedCustomerNames));
  const existingFile = await archivedFileByHash(input.pool, hash);
  const stored = existingFile ?? await storeInvoiceFile({
    importId: randomUUID(),
    integrationId: ingramIntegrationId,
    fileName: input.fileName,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: input.bytes,
  });
  const archiveId = await insertReportArchive(input.pool, report, stored, hash);
  const importId = await insertInvoiceImport(input.pool, report, stored, hash, rows);
  for (const [rowIndex, row] of rows.entries()) {
    await insertInvoiceLine(input.pool, importId, row, rowIndex + 2);
  }
  await input.pool.query(
    `update ingram_report_archives set invoice_import_id = $2::uuid where id = $1::uuid`,
    [archiveId, importId],
  );
  return {
    imported: true,
    importId,
    recordsRead: rawRows.length,
    recordsWritten: rows.length,
    excludedRows: rawRows.length - rows.length,
  };
}

export function parseIngramExcludedCustomerNames(value: unknown) {
  return String(value ?? '')
    .split(/[,;\r\n]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function isIngramCustomerExcluded(
  customerName: string | undefined,
  excludedCustomerNames: string[],
) {
  const normalizedCustomerName = normalizedIngramCustomerName(customerName);
  return Boolean(
    normalizedCustomerName
    && excludedCustomerNames.some((name) => normalizedIngramCustomerName(name) === normalizedCustomerName),
  );
}

function parseWorkbook(bytes: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const worksheetName = workbook.SheetNames[0];
  const worksheet = worksheetName ? workbook.Sheets[worksheetName] : undefined;
  if (!worksheet) throw new Error('Ingram report workbook did not contain a worksheet.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: null, raw: false });
  const fingerprints = new Set<string>();
  return rows.filter((row) => {
    const fingerprint = JSON.stringify(row);
    if (fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  });
}

function normalizedIngramCustomerName(value: string | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

async function insertInvoiceImport(
  database: Queryable,
  report: IngramReport,
  stored: StoredInvoiceFile,
  hash: string,
  rows: Record<string, unknown>[],
) {
  const invoiceNumber = mostCommon(rows.map((row) => text(row, ['RESELLER_INVOICE_NUMBER', 'INVOICE_NUMBER'])));
  const invoiceDate = mostCommon(rows.map((row) => date(row, ['INVOICE_DATE', 'RESELLER_INVOICE_DATE'])));
  const periodStart = minimumDate(rows.map((row) => normalizeIngramRow(row).billingPeriodStart));
  const periodEnd = maximumDate(rows.map((row) => normalizeIngramRow(row).billingPeriodEnd));
  const result = await database.query<{ id: string }>(
    `insert into invoice_imports (
       vendor_id, data_source_key, file_name, invoice_number, invoice_date,
       billing_period_start, billing_period_end, row_count, matched_rows, exception_rows,
       status, raw_summary, imported_by, original_blob_name, original_content_type,
       original_file_size, original_sha256
     ) values (
       $1, 'ingram-azure-invoices', $2, $3, $4::date, $5::date, $6::date, $7, 0, $7,
       'review', $8::jsonb, 'api-sync', $9, $10, $11, $12
     ) returning id`,
    [
      ingramIntegrationId,
      report.name,
      invoiceNumber ?? null,
      invoiceDate ?? null,
      periodStart ?? null,
      periodEnd ?? null,
      rows.length,
      JSON.stringify({ externalReportId: report.id, report: report.raw, sha256: hash }),
      stored.blobName,
      stored.contentType,
      stored.fileSize,
      hash,
    ],
  );
  if (!result.rows[0]?.id) throw new Error(`Unable to create the invoice import for Ingram report ${report.id}.`);
  return result.rows[0].id;
}

async function reportAlreadyArchived(database: Queryable, reportId: string) {
  const result = await database.query(
    `select 1 from ingram_report_archives where external_report_id = $1 limit 1`,
    [reportId],
  );
  return result.rows.length > 0;
}

async function archivedFileByHash(database: Queryable, hash: string): Promise<StoredInvoiceFile | undefined> {
  const result = await database.query<{
    blob_name: string;
    content_type: string;
    file_size: string | number;
    file_sha256: string;
  }>(
    `select blob_name, content_type, file_size, file_sha256
     from ingram_report_archives
     where file_sha256 = $1
     order by downloaded_at
     limit 1`,
    [hash],
  );
  const row = result.rows[0];
  return row
    ? {
        blobName: row.blob_name,
        contentType: row.content_type,
        fileSize: Number(row.file_size),
        sha256: row.file_sha256,
      }
    : undefined;
}

async function insertReportArchive(
  database: Queryable,
  report: IngramReport,
  stored: StoredInvoiceFile,
  hash: string,
) {
  const result = await database.query<{ id: string }>(
    `insert into ingram_report_archives (
       external_report_id, report_name, report_status, report_created_at,
       file_sha256, file_size, content_type, blob_name, raw_payload
     ) values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb)
     on conflict (external_report_id) do nothing
     returning id`,
    [
      report.id,
      report.name,
      report.status ?? null,
      report.createdAt ?? null,
      hash,
      stored.fileSize,
      stored.contentType,
      stored.blobName,
      JSON.stringify(report.raw),
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Ingram report ${report.id} was archived by another sync.`);
  return id;
}

function workbookFileName(reportName: string) {
  return /\.xlsx$/i.test(reportName) ? reportName : `${reportName}.xlsx`;
}

async function insertInvoiceLine(
  database: Queryable,
  importId: string,
  row: Record<string, unknown>,
  rowNumber: number,
) {
  const normalized = normalizeIngramRow(row);
  await database.query(
    `insert into invoice_line_items (
       invoice_import_id, vendor_id, external_account_id, external_account_name,
       vendor_product_key, product_code, product_name, charge_type, charge_name,
       quantity, rate, amount, billed_amount, invoice_date,
       billing_period_start, billing_period_end, raw_row_number, raw_payload
     ) values (
       $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $12, $13::date, $14::date, $15::date, $16, $17::jsonb
     )`,
    [
      importId,
      ingramIntegrationId,
      normalized.customerAccountId,
      normalized.customerName,
      normalized.vendorProductKey,
      normalized.productCode,
      normalized.productName,
      normalized.chargeType,
      normalized.chargeName,
      normalized.quantity,
      normalized.unitCost,
      normalized.extendedCost,
      normalized.invoiceDate,
      normalized.billingPeriodStart,
      normalized.billingPeriodEnd,
      rowNumber,
      JSON.stringify(row),
    ],
  );
}

export function normalizeIngramRow(row: Record<string, unknown>) {
  const subscriptionId = text(row, ['SUBSCRIPTION_ID', 'VENDOR_SUBSCRIPTION_NUMBER', 'CUSTOMER_PLAN_ID']);
  const productCode =
    text(row, [
      'RESELLER_RESOURCE_MPN',
      'CUSTOMER_RESOURCE_MPN',
      'RESELLER_DETAIL_SKU',
      'CUSTOMER_DETAIL_SKU',
      'SKU',
      'PRODUCT_CODE',
      'MPN',
    ]) ??
    subscriptionId ??
    'AZURE';
  const productName =
    text(row, [
      'CUSTOMER_DETAIL_DESCRIPTION',
      'RESELLER_DETAIL_DESCRIPTION',
      'CUSTOMER_RESOURCE_NAME',
      'RESELLER_RESOURCE_NAME',
      'PRODUCT_NAME',
      'DESCRIPTION',
      'SKU_DESCRIPTION',
      'SUBSCRIPTION_NAME',
    ]) ?? 'Microsoft subscription';
  return {
    subscriptionId,
    customerAccountId: text(row, ['CUSTOMER_ACCOUNT_ID', 'END_CUSTOMER_ACCOUNT_ID']) ?? subscriptionId,
    customerName: text(row, ['CUSTOMER_NAME', 'END_CUSTOMER_NAME', 'CUSTOMER']),
    vendorProductKey: `ingram:${productCode}`,
    productCode,
    productName,
    chargeType: text(row, [
      'RESELLER_DETAIL_TYPE',
      'CUSTOMER_DETAIL_TYPE',
      'CHARGE_TYPE',
      'LINE_TYPE',
      'TRANSACTION_TYPE',
      'ADJUSTMENT_TYPE',
      'CREDIT_TYPE',
    ]),
    chargeName: text(row, [
      'RESELLER_DETAIL_DESCRIPTION',
      'CUSTOMER_DETAIL_DESCRIPTION',
      'CHARGE_NAME',
      'DESCRIPTION',
      'ADJUSTMENT_DESCRIPTION',
      'CREDIT_DESCRIPTION',
    ]),
    quantity: numeric(row, ['RESELLER_DETAIL_QTY', 'CUSTOMER_DETAIL_QTY', 'QTY', 'QUANTITY']),
    unitCost: numeric(row, [
      'RESELLER_DETAIL_UNIT_PRICE',
      'RESELLER_DETAIL_SALES_UNIT_PRICE',
      'CUSTOMER_DETAIL_UNIT_PRICE',
      'UNIT_PRICE',
      'RATE',
    ]),
    extendedCost: numeric(row, [
      'RESELLER_DETAIL_TOTAL',
      'RESELLER_DETAIL_NET_TOTAL',
      'RESELLER_DETAIL_SALES_TOTAL',
      'TOTAL',
      'EXTENDED_COST',
      'AMOUNT',
      'RESELLER_TOTAL',
    ]),
    invoiceDate: date(row, ['RESELLER_INVOICE_DATE', 'INVOICE_DATE', 'CUSTOMER_INVOICE_DATE']),
    billingPeriodStart: date(row, [
      'RESELLER_ACTUAL_DETAIL_START_DATE',
      'CUSTOMER_ACTUAL_DETAIL_START_DATE',
      'RESELLER_DETAIL_START_DATE',
      'CUSTOMER_DETAIL_START_DATE',
      'BILLING_PERIOD_START',
      'START_DATE',
    ]),
    billingPeriodEnd: date(row, [
      'RESELLER_ACTUAL_DETAIL_END_DATE',
      'CUSTOMER_ACTUAL_DETAIL_END_DATE',
      'RESELLER_DETAIL_END_DATE',
      'CUSTOMER_DETAIL_END_DATE',
      'BILLING_PERIOD_END',
      'END_DATE',
    ]),
  };
}

export async function backfillIngramInvoiceLines(database: Queryable) {
  const source = await database.query<{ id: string; raw_payload: Record<string, unknown> }>(
    `select id, raw_payload
     from invoice_line_items
     where vendor_id = $1`,
    [ingramIntegrationId],
  );
  let updated = 0;
  for (const row of source.rows) {
    const normalized = normalizeIngramRow(recordValue(row.raw_payload));
    const result = await database.query<{ id: string }>(
      `update invoice_line_items
       set external_account_id = $2,
           external_account_name = $3,
           vendor_product_key = $4,
           product_code = $5,
           product_name = $6,
           charge_type = $7,
           charge_name = $8,
           quantity = $9,
           rate = $10,
           amount = $11,
           billed_amount = $11,
           invoice_date = $12::date,
           billing_period_start = $13::date,
           billing_period_end = $14::date
       where id = $1::uuid
       returning id`,
      [
        row.id,
        normalized.customerAccountId ?? null,
        normalized.customerName ?? null,
        normalized.vendorProductKey,
        normalized.productCode,
        normalized.productName,
        normalized.chargeType ?? null,
        normalized.chargeName ?? null,
        normalized.quantity,
        normalized.unitCost,
        normalized.extendedCost,
        normalized.invoiceDate ?? null,
        normalized.billingPeriodStart ?? null,
        normalized.billingPeriodEnd ?? null,
      ],
    );
    updated += result.rows.length;
  }
  await database.query(
    `update invoice_imports imports
     set invoice_date = source.invoice_date,
         billing_period_start = source.billing_period_start,
         billing_period_end = source.billing_period_end
     from (
       select
         invoice_import_id,
         min(invoice_date) as invoice_date,
         min(billing_period_start) as billing_period_start,
         max(billing_period_end) as billing_period_end
       from invoice_line_items
       where vendor_id = $1
       group by invoice_import_id
     ) source
     where imports.id = source.invoice_import_id`,
    [ingramIntegrationId],
  );
  await migrateIngramAccountMappings(database);
  return updated;
}

async function migrateIngramAccountMappings(database: Queryable) {
  await database.query(
    `insert into vendor_account_mappings (
       vendor_id, external_account_id, external_account_name, customer_id, agreement_id,
       mapping_status, confidence, match_score, mapping_source, reviewed_by, reviewed_at,
       last_seen_at, match_evidence, active, raw_payload
     )
     select distinct on (lines.raw_payload->>'CUSTOMER_ACCOUNT_ID')
       $1,
       lines.raw_payload->>'CUSTOMER_ACCOUNT_ID',
       coalesce(nullif(lines.raw_payload->>'CUSTOMER_NAME', ''), mappings.external_account_name),
       mappings.customer_id,
       mappings.agreement_id,
       mappings.mapping_status,
       mappings.confidence,
       mappings.match_score,
       'migrated-subscription-mapping',
       mappings.reviewed_by,
       mappings.reviewed_at,
       now(),
       mappings.match_evidence,
       mappings.active,
       jsonb_build_object('migratedFromSubscriptionId', mappings.external_account_id)
     from vendor_account_mappings mappings
     inner join invoice_line_items lines
       on lines.vendor_id = $1
      and lines.raw_payload->>'SUBSCRIPTION_ID' = mappings.external_account_id
     where mappings.vendor_id = $1
       and nullif(lines.raw_payload->>'CUSTOMER_ACCOUNT_ID', '') is not null
     order by lines.raw_payload->>'CUSTOMER_ACCOUNT_ID', mappings.active desc, mappings.updated_at desc
     on conflict (vendor_id, external_account_id)
     do update set
       external_account_name = excluded.external_account_name,
       customer_id = excluded.customer_id,
       agreement_id = excluded.agreement_id,
       mapping_status = excluded.mapping_status,
       confidence = excluded.confidence,
       match_score = excluded.match_score,
       mapping_source = excluded.mapping_source,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = excluded.reviewed_at,
       last_seen_at = excluded.last_seen_at,
       match_evidence = excluded.match_evidence,
       active = excluded.active,
       raw_payload = excluded.raw_payload,
       updated_at = now()`,
    [ingramIntegrationId],
  );
  await database.query(
    `update vendor_account_mappings mappings
     set active = false,
         mapping_status = 'rejected',
         mapping_source = 'superseded-subscription-mapping',
         updated_at = now()
     where mappings.vendor_id = $1
       and not exists (
         select 1
         from invoice_line_items lines
         where lines.vendor_id = $1
           and lines.external_account_id = mappings.external_account_id
       )`,
    [ingramIntegrationId],
  );
}

async function reportAlreadyImported(database: Queryable, reportId: string) {
  const result = await database.query(
    `select 1 from invoice_imports
     where vendor_id = $1 and raw_summary ->> 'externalReportId' = $2
     limit 1`,
    [ingramIntegrationId, reportId],
  );
  return result.rows.length > 0;
}

async function hashAlreadyImported(database: Queryable, hash: string) {
  const result = await database.query(
    `select 1 from invoice_imports where vendor_id = $1 and original_sha256 = $2 limit 1`,
    [ingramIntegrationId, hash],
  );
  return result.rows.length > 0;
}

function assertIngramReady(settings: IntegrationRuntimeSettings) {
  if (!settings.validation.missingSecrets.length && !settings.validation.missingNonSecrets.length) return;
  throw new Error('Ingram Micro settings are incomplete. Configure API credentials and Key Vault secrets.');
}

async function startSyncRun(database: Queryable, metadata: Record<string, unknown>) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata) values ($1, 'running', $2::jsonb) returning id`,
    [ingramIntegrationId, JSON.stringify(metadata)],
  );
  return result.rows[0].id;
}

async function completeSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete', completed_at = now(), records_read = $2, records_written = $3, metadata = $4::jsonb
     where id = $1::uuid`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs set status = 'failed', completed_at = now(), error_message = $2 where id = $1::uuid`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function valueFor(row: Record<string, unknown>, keys: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.trim().toUpperCase(), value]));
  for (const key of keys) {
    const value = normalized.get(key);
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return undefined;
}

function text(row: Record<string, unknown>, keys: string[]) {
  const value = valueFor(row, keys);
  return value === undefined ? undefined : String(value).trim();
}

function numeric(row: Record<string, unknown>, keys: string[]) {
  const parsed = Number(String(valueFor(row, keys) ?? 0).replace(/[$,()]/g, (match) => (match === '(' ? '-' : '')));
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(row: Record<string, unknown>, keys: string[]) {
  const parsed = Date.parse(String(valueFor(row, keys) ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function mostCommon(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function minimumDate(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort()[0];
}

function maximumDate(values: Array<string | undefined>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates[dates.length - 1];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
