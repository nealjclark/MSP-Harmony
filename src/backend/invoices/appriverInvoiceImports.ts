import type { IntegrationId } from '../../shared/integrationSettings';
import { appRiverIntegrationId } from '../vendor/appriver/client';
import { loadAppRiverProductMappings, type Queryable } from '../vendor/appriver/operations';
import type { AppRiverProductMapping } from '../vendor/appriver/rules';

export type InvoiceImportSummary = {
  id: string;
  vendorId: IntegrationId;
  fileName: string;
  invoiceNumber?: string;
  importedAt: string;
  invoiceDate?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  rowCount: number;
  matchedRows: number;
  exceptionRows: number;
  status: 'ready' | 'review';
};

export type InvoiceQuantity = {
  invoiceImportId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  importedAt: string;
  invoiceQuantity: number;
  invoiceLineCount: number;
};

type InvoiceImportRow = {
  id: string;
  vendor_id: IntegrationId;
  file_name: string;
  invoice_number: string | null;
  imported_at: Date | string;
  invoice_date: Date | string | null;
  billing_period_start: Date | string | null;
  billing_period_end: Date | string | null;
  row_count: string | number;
  matched_rows: string | number;
  exception_rows: string | number;
  status: string;
};

type AccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string | null;
};

type InvoiceQuantityRow = {
  customer_id: string;
  agreement_id: string;
  connectwise_product_code: string;
  invoice_quantity: string | number;
  invoice_line_count: string | number;
};

type ParsedCsv = {
  headers: string[];
  rows: Array<{
    recordNumber: number;
    values: Record<string, string>;
  }>;
};

type NormalizedInvoiceLine = {
  rawRowNumber: number;
  raw: Record<string, string>;
  externalAccountId: string;
  externalAccountName: string;
  customerId?: string;
  agreementId?: string;
  vendorProductKey?: string;
  vendorProductKeyCandidates: string[];
  productCode: string;
  productName: string;
  connectWiseProductCode?: string;
  connectWiseProductName?: string;
  chargeType?: string;
  chargeName?: string;
  quantity: number;
  previousQuantity?: number;
  postQuantity?: number;
  rate?: number;
  months?: number;
  amount?: number;
  billedAmount?: number;
  effectiveDate?: string;
  invoiceDate?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  term?: string;
  billingFrequency?: string;
  primaryDomain?: string;
  aliasDomains?: string;
};

type ProductMappingIndex = {
  byKey: Map<string, AppRiverProductMapping>;
  byBaseKey: Map<string, AppRiverProductMapping>;
};

const appRiverInvoiceVendorId = appRiverIntegrationId as IntegrationId;

export async function importAppRiverInvoiceCsv(
  database: Queryable,
  input: { fileName: string; content: string },
): Promise<InvoiceImportSummary> {
  const parsed = parseCsv(input.content);
  if (parsed.rows.length === 0) {
    throw new Error('AppRiver invoice CSV did not contain any data rows.');
  }

  assertRequiredHeaders(parsed.headers, [
    'Customer Account Number',
    'Company Name',
    'Charge Type',
    'Product',
    'Product Code',
    'Appriver Charge Name',
    'Charge Qty',
    'Rate',
    'Amount',
    'Billed Amount',
    'Start',
    'End',
    'Invoice Date',
    'Invoice Number',
    'Term',
    'Billing Frequency',
  ]);

  const [accountMappings, productMappings] = await Promise.all([
    loadAppRiverAccountMappings(database),
    loadAppRiverProductMappings(database),
  ]);
  const productIndex = buildProductMappingIndex(productMappings);
  const lines = parsed.rows.map((row) => normalizeInvoiceLine(row, accountMappings, productIndex));
  const invoiceNumber = mostCommonString(lines.map((line) => stringValue(line.raw['Invoice Number'])));
  const invoiceDate = mostCommonString(lines.map((line) => line.invoiceDate));
  const billingPeriodStart = minimumDate(lines.map((line) => line.billingPeriodStart));
  const billingPeriodEnd = maximumDate(lines.map((line) => line.billingPeriodEnd));
  const matchedRows = lines.filter(isMappedInvoiceLine).length;
  const exceptionRows = lines.length - matchedRows;
  const status = exceptionRows === 0 ? 'ready' : 'review';

  const result = await database.query<{ id: string }>(
    `insert into invoice_imports (
       vendor_id,
       file_name,
       invoice_number,
       invoice_date,
       billing_period_start,
       billing_period_end,
       row_count,
       matched_rows,
       exception_rows,
       status,
       raw_summary
     )
     values ($1, $2, $3, $4::date, $5::date, $6::date, $7, $8, $9, $10, $11::jsonb)
     returning id`,
    [
      appRiverInvoiceVendorId,
      input.fileName,
      invoiceNumber ?? null,
      invoiceDate ?? null,
      billingPeriodStart ?? null,
      billingPeriodEnd ?? null,
      lines.length,
      matchedRows,
      exceptionRows,
      status,
      JSON.stringify(rawSummary(input.fileName, parsed.headers, lines)),
    ],
  );

  const importId = result.rows[0]?.id;
  if (!importId) {
    throw new Error('Unable to create AppRiver invoice import record.');
  }

  for (const line of lines) {
    await insertInvoiceLine(database, importId, line);
  }

  const imported = await loadInvoiceImport(database, importId);
  if (!imported) {
    throw new Error('Unable to load AppRiver invoice import after save.');
  }

  return imported;
}

export async function listInvoiceImports(
  database: Queryable,
  options: { vendorId?: IntegrationId; limit?: number } = {},
): Promise<InvoiceImportSummary[]> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100));
  const result = await database.query<InvoiceImportRow>(
    `select id,
            vendor_id,
            file_name,
            invoice_number,
            imported_at,
            invoice_date,
            billing_period_start,
            billing_period_end,
            row_count,
            matched_rows,
            exception_rows,
            status
       from invoice_imports
      where ($1::text is null or vendor_id = $1)
      order by invoice_date desc nulls last, imported_at desc
      limit $2`,
    [options.vendorId ?? null, limit],
  );

  return result.rows.map(mapInvoiceImportRow);
}

export async function loadLatestInvoiceImportSummary(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<InvoiceImportSummary | undefined> {
  const result = await database.query<InvoiceImportRow>(
    `select id,
            vendor_id,
            file_name,
            invoice_number,
            imported_at,
            invoice_date,
            billing_period_start,
            billing_period_end,
            row_count,
            matched_rows,
            exception_rows,
            status
       from invoice_imports
      where vendor_id = $1
      order by invoice_date desc nulls last, imported_at desc
      limit 1`,
    [vendorId],
  );

  return result.rows[0] ? mapInvoiceImportRow(result.rows[0]) : undefined;
}

export async function loadLatestInvoiceQuantitiesForLines(
  database: Queryable,
  vendorId: IntegrationId,
  lines: Array<{ clientId: string; agreementId: string; productCode: string }>,
): Promise<{ latestInvoice?: InvoiceImportSummary; quantities: Map<string, InvoiceQuantity> }> {
  const latestInvoice = await loadLatestInvoiceImportSummary(database, vendorId);
  if (!latestInvoice || lines.length === 0) {
    return {
      latestInvoice,
      quantities: new Map(),
    };
  }

  const customerIds = [...new Set(lines.map((line) => line.clientId))];
  const agreementIds = [...new Set(lines.map((line) => line.agreementId))];
  const productCodes = [...new Set(lines.map((line) => line.productCode))];
  const result = await database.query<InvoiceQuantityRow>(
    `select customer_id,
            agreement_id,
            connectwise_product_code,
            sum(quantity) as invoice_quantity,
            count(*) as invoice_line_count
       from invoice_line_items
      where invoice_import_id = $1::uuid
        and vendor_id = $2
        and charge_type = 'Renewal'
        and customer_id = any($3::uuid[])
        and agreement_id = any($4::uuid[])
        and connectwise_product_code = any($5::text[])
      group by customer_id, agreement_id, connectwise_product_code`,
    [latestInvoice.id, vendorId, customerIds, agreementIds, productCodes],
  );

  const quantities = new Map<string, InvoiceQuantity>();
  for (const row of result.rows) {
    quantities.set(invoiceQuantityKey(row.customer_id, row.agreement_id, row.connectwise_product_code), {
      invoiceImportId: latestInvoice.id,
      invoiceNumber: latestInvoice.invoiceNumber,
      invoiceDate: latestInvoice.invoiceDate,
      importedAt: latestInvoice.importedAt,
      invoiceQuantity: numericValue(row.invoice_quantity),
      invoiceLineCount: integerValue(row.invoice_line_count),
    });
  }

  return {
    latestInvoice,
    quantities,
  };
}

export function invoiceQuantityKey(customerId: string, agreementId: string, productCode: string) {
  return `${customerId}|${agreementId}|${productCode}`;
}

function normalizeInvoiceLine(
  row: ParsedCsv['rows'][number],
  accountMappings: Map<string, AccountMappingRow>,
  productIndex: ProductMappingIndex,
): NormalizedInvoiceLine {
  const values = row.values;
  const externalAccountId = stringValue(values['Customer Account Number']) ?? '';
  const externalAccountName = stringValue(values['Company Name']) ?? externalAccountId;
  const productCode = stringValue(values['Product Code']) ?? '';
  const productName = stringValue(values['Product']) ?? productCode;
  const term = stringValue(values['Term']);
  const billingFrequency = stringValue(values['Billing Frequency']);
  const vendorProductKeyCandidates = productKeyCandidates(productCode, productName, term, billingFrequency);
  const productMapping = findProductMapping(productIndex, vendorProductKeyCandidates, productCode, productName);
  const accountMapping = accountMappings.get(externalAccountId);

  return {
    rawRowNumber: row.recordNumber,
    raw: values,
    externalAccountId,
    externalAccountName,
    customerId: accountMapping?.customer_id,
    agreementId: accountMapping?.agreement_id ?? undefined,
    vendorProductKey: productMapping?.vendorProductKey ?? vendorProductKeyCandidates[0],
    vendorProductKeyCandidates,
    productCode,
    productName,
    connectWiseProductCode: productMapping?.productCode,
    connectWiseProductName: productMapping?.productName,
    chargeType: stringValue(values['Charge Type']),
    chargeName: stringValue(values['Appriver Charge Name']),
    quantity: numericValue(values['Charge Qty']),
    previousQuantity: optionalNumericValue(values['Previous Adjustment Qty']),
    postQuantity: optionalNumericValue(values['Post Adjustment Qty']),
    rate: optionalNumericValue(values['Rate']),
    months: optionalNumericValue(values['Months']),
    amount: optionalNumericValue(values['Amount']),
    billedAmount: optionalNumericValue(values['Billed Amount']),
    effectiveDate: parseInvoiceDate(values['Effective Date']),
    invoiceDate: parseInvoiceDate(values['Invoice Date']),
    billingPeriodStart: parseInvoiceDate(values['Start']),
    billingPeriodEnd: parseInvoiceDate(values['End']),
    term,
    billingFrequency,
    primaryDomain: stringValue(values['Primary Domain']),
    aliasDomains: stringValue(values['Alias Domains']),
  };
}

async function insertInvoiceLine(database: Queryable, invoiceImportId: string, line: NormalizedInvoiceLine) {
  await database.query(
    `insert into invoice_line_items (
       invoice_import_id,
       vendor_id,
       customer_id,
       agreement_id,
       external_account_id,
       external_account_name,
       vendor_product_key,
       vendor_product_key_candidates,
       product_code,
       product_name,
       connectwise_product_code,
       connectwise_product_name,
       charge_type,
       charge_name,
       quantity,
       previous_quantity,
       post_quantity,
       rate,
       months,
       amount,
       billed_amount,
       effective_date,
       invoice_date,
       billing_period_start,
       billing_period_end,
       term,
       billing_frequency,
       primary_domain,
       alias_domains,
       raw_row_number,
       raw_payload
     )
     values (
       $1::uuid,
       $2,
       $3::uuid,
       $4::uuid,
       $5,
       $6,
       $7,
       $8::jsonb,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14,
       $15,
       $16,
       $17,
       $18,
       $19,
       $20,
       $21,
       $22::date,
       $23::date,
       $24::date,
       $25::date,
       $26,
       $27,
       $28,
       $29,
       $30,
       $31::jsonb
     )`,
    [
      invoiceImportId,
      appRiverInvoiceVendorId,
      line.customerId ?? null,
      line.agreementId ?? null,
      line.externalAccountId,
      line.externalAccountName,
      line.vendorProductKey ?? null,
      JSON.stringify(line.vendorProductKeyCandidates),
      line.productCode,
      line.productName,
      line.connectWiseProductCode ?? null,
      line.connectWiseProductName ?? null,
      line.chargeType ?? null,
      line.chargeName ?? null,
      line.quantity,
      line.previousQuantity ?? null,
      line.postQuantity ?? null,
      line.rate ?? null,
      line.months ?? null,
      line.amount ?? null,
      line.billedAmount ?? null,
      line.effectiveDate ?? null,
      line.invoiceDate ?? null,
      line.billingPeriodStart ?? null,
      line.billingPeriodEnd ?? null,
      line.term ?? null,
      line.billingFrequency ?? null,
      line.primaryDomain ?? null,
      line.aliasDomains ?? null,
      line.rawRowNumber,
      JSON.stringify(line.raw),
    ],
  );
}

async function loadInvoiceImport(database: Queryable, importId: string) {
  const result = await database.query<InvoiceImportRow>(
    `select id,
            vendor_id,
            file_name,
            invoice_number,
            imported_at,
            invoice_date,
            billing_period_start,
            billing_period_end,
            row_count,
            matched_rows,
            exception_rows,
            status
       from invoice_imports
      where id = $1::uuid`,
    [importId],
  );

  return result.rows[0] ? mapInvoiceImportRow(result.rows[0]) : undefined;
}

async function loadAppRiverAccountMappings(database: Queryable) {
  const result = await database.query<AccountMappingRow>(
    `select external_account_id,
            customer_id,
            agreement_id
       from vendor_account_mappings
      where vendor_id = $1
        and active = true
        and mapping_status = 'approved'`,
    [appRiverInvoiceVendorId],
  );

  return new Map(result.rows.map((row) => [row.external_account_id, row]));
}

function isMappedInvoiceLine(line: NormalizedInvoiceLine) {
  return Boolean(line.customerId && line.agreementId && line.connectWiseProductCode);
}

function buildProductMappingIndex(mappings: Record<string, AppRiverProductMapping>): ProductMappingIndex {
  const byKey = new Map(Object.entries(mappings));
  const groupedBaseMappings = new Map<string, AppRiverProductMapping[]>();

  for (const mapping of Object.values(mappings)) {
    const keys = [mapping.vendorProductKey, ...(mapping.vendorProductKeys ?? [])];
    for (const key of keys) {
      const baseKey = baseProductKey(key);
      if (!baseKey) {
        continue;
      }
      groupedBaseMappings.set(baseKey, [...(groupedBaseMappings.get(baseKey) ?? []), mapping]);
    }
  }

  const byBaseKey = new Map<string, AppRiverProductMapping>();
  for (const [baseKey, groupedMappings] of groupedBaseMappings.entries()) {
    const targets = new Map(
      groupedMappings.map((mapping) => [`${mapping.productCode}\u0001${mapping.productName}`, mapping] as const),
    );
    if (targets.size === 1) {
      byBaseKey.set(baseKey, [...targets.values()][0]);
    }
  }

  return { byKey, byBaseKey };
}

function findProductMapping(
  index: ProductMappingIndex,
  candidates: string[],
  productCode: string,
  productName: string,
) {
  for (const candidate of candidates) {
    const exact = index.byKey.get(candidate);
    if (exact) {
      return exact;
    }
  }

  return index.byBaseKey.get(productCode) ?? index.byBaseKey.get(productName);
}

function productKeyCandidates(
  productCode: string,
  productName: string,
  term: string | undefined,
  billingFrequency: string | undefined,
) {
  const candidates = [
    productKey(productCode, term, billingFrequency),
    productKey(productName, term, billingFrequency),
    productCode,
    productName,
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
}

function productKey(product: string, term: string | undefined, billingFrequency: string | undefined) {
  return [product, term, billingFrequency]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('|');
}

function baseProductKey(value: string) {
  return value.split('|')[0]?.trim();
}

function rawSummary(fileName: string, headers: string[], lines: NormalizedInvoiceLine[]) {
  const renewalLines = lines.filter((line) => line.chargeType === 'Renewal');
  const adjustmentLines = lines.filter((line) => line.chargeType === 'Adjustment');

  return {
    fileName,
    headers,
    invoiceNumbers: sortedUnique(lines.map((line) => stringValue(line.raw['Invoice Number']))),
    invoiceDates: sortedUnique(lines.map((line) => line.invoiceDate)),
    chargeTypes: Object.fromEntries(groupCounts(lines.map((line) => line.chargeType ?? ''))),
    renewalRows: renewalLines.length,
    adjustmentRows: adjustmentLines.length,
    renewalQuantity: sumNumbers(renewalLines.map((line) => line.quantity)),
    billedAmount: sumNumbers(lines.map((line) => line.billedAmount ?? 0)),
  };
}

function parseCsv(content: string): ParsedCsv {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const text = content.replace(/^\uFEFF/, '');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      row.push(field);
      field = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  return {
    headers,
    rows: rows.slice(1).map((values, index) => ({
      recordNumber: index + 2,
      values: Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ''])),
    })),
  };
}

function assertRequiredHeaders(headers: string[], requiredHeaders: string[]) {
  const headerSet = new Set(headers);
  const missing = requiredHeaders.filter((header) => !headerSet.has(header));
  if (missing.length > 0) {
    throw new Error(`AppRiver invoice CSV is missing required columns: ${missing.join(', ')}.`);
  }
}

function mapInvoiceImportRow(row: InvoiceImportRow): InvoiceImportSummary {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    fileName: row.file_name,
    invoiceNumber: row.invoice_number ?? undefined,
    importedAt: isoDateTime(row.imported_at) ?? new Date(0).toISOString(),
    invoiceDate: isoDateOnly(row.invoice_date),
    billingPeriodStart: isoDateOnly(row.billing_period_start),
    billingPeriodEnd: isoDateOnly(row.billing_period_end),
    rowCount: integerValue(row.row_count),
    matchedRows: integerValue(row.matched_rows),
    exceptionRows: integerValue(row.exception_rows),
    status: row.status === 'ready' ? 'ready' : 'review',
  };
}

function parseInvoiceDate(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const appRiverDate = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/.exec(trimmed);
  if (appRiverDate) {
    const month = monthNumber(appRiverDate[2]);
    if (month) {
      return `${appRiverDate[1]}-${month}-${appRiverDate[3].padStart(2, '0')}`;
    }
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDate) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function monthNumber(value: string) {
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    value.toLowerCase(),
  );
  return month < 0 ? undefined : String(month + 1).padStart(2, '0');
}

function isoDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoDateOnly(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function stringValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumericValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericValue(value: unknown) {
  return optionalNumericValue(value) ?? 0;
}

function integerValue(value: unknown) {
  return Math.trunc(numericValue(value));
}

function mostCommonString(values: Array<string | undefined>) {
  const counts = groupCounts(values);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function minimumDate(values: Array<string | undefined>) {
  return sortedUnique(values).sort()[0];
}

function maximumDate(values: Array<string | undefined>) {
  const dates = sortedUnique(values).sort();
  return dates[dates.length - 1];
}

function sortedUnique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function groupCounts(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
