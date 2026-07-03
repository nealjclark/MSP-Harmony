import { integrationIdsWithCapability, type IntegrationId } from '../../shared/integrationSettings';
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

export type InvoiceImportMode = 'merge' | 'overwrite';

export type DetectedInvoiceVendor = {
  vendorId: IntegrationId;
  vendorName: string;
  confidence: 'high' | 'medium';
  reason: string;
};

export type InvoiceExceptionSummary = {
  exceptionRows: number;
  missingCustomerRows: number;
  missingAgreementRows: number;
  missingProductRows: number;
  renewalExceptionRows: number;
  otherExceptionRows: number;
};

export type InvoiceExceptionLine = {
  id: string;
  rawRowNumber: number;
  externalAccountId?: string;
  externalAccountName?: string;
  vendorProductKey?: string;
  vendorProductKeyCandidates: string[];
  productCode: string;
  productName: string;
  connectWiseProductCode?: string;
  connectWiseProductName?: string;
  chargeType?: string;
  quantity: number;
  billedAmount?: number;
  term?: string;
  billingFrequency?: string;
  invoiceDate?: string;
  primaryDomain?: string;
  missingCustomer: boolean;
  missingAgreement: boolean;
  missingProduct: boolean;
};

export type InvoiceAccountExistingMapping = {
  customerId: string;
  customerName: string;
  agreementId?: string;
  agreementName?: string;
  status: string;
  active: boolean;
};

export type InvoiceAccountException = {
  externalAccountId: string;
  externalAccountName: string;
  rowCount: number;
  quantity: number;
  missingCustomer: boolean;
  missingAgreement: boolean;
  missingProduct: boolean;
  currentMapping?: InvoiceAccountExistingMapping;
  sampleRows: InvoiceExceptionLine[];
};

export type InvoiceProductExistingMapping = {
  connectWiseProductCode: string;
  connectWiseProductName: string;
  status: string;
  active: boolean;
};

export type InvoiceProductException = {
  vendorProductKey: string;
  vendorProductKeyCandidates: string[];
  productCode: string;
  productName: string;
  term?: string;
  billingFrequency?: string;
  rowCount: number;
  quantity: number;
  missingProduct: boolean;
  existingMappings: InvoiceProductExistingMapping[];
  sampleRows: InvoiceExceptionLine[];
};

export type InvoiceImportExceptionReview = {
  import: InvoiceImportSummary;
  summary: InvoiceExceptionSummary;
  accountExceptions: InvoiceAccountException[];
  productExceptions: InvoiceProductException[];
  lines: InvoiceExceptionLine[];
};

export type InvoiceImportRefreshResult = {
  import: InvoiceImportSummary;
  accountRowsUpdated: number;
  productRowsUpdated: number;
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

type InvoiceExceptionLineRow = {
  id: string;
  raw_row_number: string | number;
  external_account_id: string | null;
  external_account_name: string | null;
  vendor_product_key: string | null;
  vendor_product_key_candidates: unknown;
  product_code: string;
  product_name: string;
  connectwise_product_code: string | null;
  connectwise_product_name: string | null;
  charge_type: string | null;
  quantity: string | number;
  billed_amount: string | number | null;
  term: string | null;
  billing_frequency: string | null;
  invoice_date: Date | string | null;
  primary_domain: string | null;
  customer_id: string | null;
  agreement_id: string | null;
};

type InvoiceAccountExistingMappingRow = {
  external_account_id: string;
  customer_id: string;
  customer_name: string;
  agreement_id: string | null;
  agreement_name: string | null;
  mapping_status: string;
  active: boolean;
};

type InvoiceProductExistingMappingRow = {
  vendor_product_key: string;
  connectwise_product_code: string;
  connectwise_product_name: string;
  mapping_status: string;
  active: boolean;
};

type AccountMappingRow = {
  external_account_id: string;
  external_account_name: string | null;
  customer_id: string;
  agreement_id: string;
};

type AppRiverSnapshotAccountRow = {
  external_account_id: string | null;
  external_customer_account_number: string | null;
  app_river_customer_id: string | null;
  customer_name: string | null;
  app_river_customer_name: string | null;
  domain: string | null;
  customer_id: string;
  agreement_id: string;
};

type AppRiverSnapshotProductAliasRow = {
  vendor_product_key: string | null;
  source_product_code: string | null;
  source_product_name: string | null;
  subscription_term: string | null;
  billing_frequency: string | null;
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

type AccountMappingIndex = {
  byKey: Map<string, AccountMappingRow>;
};

type ProductAlias = {
  keys: string[];
  mapping: AppRiverProductMapping;
};

const appRiverInvoiceVendorId = appRiverIntegrationId as IntegrationId;
export const supportedInvoiceVendorIds: IntegrationId[] = integrationIdsWithCapability('invoice-import');

const appRiverInvoiceRequiredHeaders = [
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
];

export function detectInvoiceVendor(input: { fileName?: string; content: string }): DetectedInvoiceVendor | undefined {
  const parsed = parseCsv(input.content);
  const headerSet = new Set(parsed.headers.map((header) => normalizeHeader(header)));
  const hasAllAppRiverHeaders = appRiverInvoiceRequiredHeaders.every((header) => headerSet.has(normalizeHeader(header)));
  if (hasAllAppRiverHeaders) {
    return {
      vendorId: appRiverInvoiceVendorId,
      vendorName: 'AppRiver - OpenText',
      confidence: 'high',
      reason: 'Matched AppRiver invoice column headers.',
    };
  }

  const fileName = input.fileName?.toLowerCase() ?? '';
  const hasAppRiverHints =
    headerSet.has(normalizeHeader('Appriver Charge Name')) ||
    (fileName.includes('accounthistory') &&
      headerSet.has(normalizeHeader('Customer Account Number')) &&
      headerSet.has(normalizeHeader('Invoice Number')));
  if (hasAppRiverHints) {
    return {
      vendorId: appRiverInvoiceVendorId,
      vendorName: 'AppRiver - OpenText',
      confidence: 'medium',
      reason: 'Matched AppRiver invoice hints. Import will still validate required columns.',
    };
  }

  return undefined;
}

export async function importAppRiverInvoiceCsv(
  database: Queryable,
  input: { fileName: string; content: string; importMode?: InvoiceImportMode },
): Promise<InvoiceImportSummary> {
  const importMode = input.importMode ?? 'merge';
  const parsed = parseCsv(input.content);
  if (parsed.rows.length === 0) {
    throw new Error('AppRiver invoice CSV did not contain any data rows.');
  }

  assertRequiredHeaders(parsed.headers, appRiverInvoiceRequiredHeaders);

  const [accountIndex, productMappings] = await Promise.all([
    loadAppRiverAccountIndex(database),
    loadAppRiverProductMappings(database),
  ]);
  const productIndex = buildProductMappingIndex(
    productMappings,
    await loadAppRiverProductAliases(database, productMappings),
  );
  const lines = parsed.rows.map((row) => normalizeInvoiceLine(row, accountIndex, productIndex));
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

  if (importMode === 'overwrite') {
    await deleteExistingInvoiceImports(database, {
      currentImportId: importId,
      fileName: input.fileName,
      invoiceDate,
      invoiceNumber,
    });
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

export async function getInvoiceImportExceptionReview(
  database: Queryable,
  vendorId: IntegrationId,
  importId: string,
): Promise<InvoiceImportExceptionReview | undefined> {
  const invoiceImport = await loadInvoiceImportForVendor(database, importId, vendorId);
  if (!invoiceImport) {
    return undefined;
  }

  const result = await database.query<InvoiceExceptionLineRow>(
    `select id,
            raw_row_number,
            external_account_id,
            external_account_name,
            vendor_product_key,
            vendor_product_key_candidates,
            product_code,
            product_name,
            connectwise_product_code,
            connectwise_product_name,
            charge_type,
            quantity,
            billed_amount,
            term,
            billing_frequency,
            invoice_date,
            primary_domain,
            customer_id,
            agreement_id
       from invoice_line_items
      where invoice_import_id = $1::uuid
        and vendor_id = $2
        and (customer_id is null or agreement_id is null or connectwise_product_code is null)
      order by raw_row_number`,
    [importId, vendorId],
  );

  const lines = result.rows.map(mapInvoiceExceptionLineRow);
  const [accountMappingsById, productMappingsByKey] = await Promise.all([
    loadInvoiceAccountExistingMappings(database, vendorId, [
      ...new Set(
        lines
          .filter((line) => line.missingCustomer || line.missingAgreement)
          .map((line) => line.externalAccountId)
          .filter((value): value is string => Boolean(value)),
      ),
    ]),
    loadInvoiceProductExistingMappings(database, vendorId, [
      ...new Set(
        lines
          .filter((line) => line.missingProduct)
          .map((line) => line.vendorProductKey)
          .filter((value): value is string => Boolean(value)),
      ),
    ]),
  ]);

  return {
    import: invoiceImport,
    summary: invoiceExceptionSummary(lines),
    accountExceptions: buildInvoiceAccountExceptions(lines, accountMappingsById),
    productExceptions: buildInvoiceProductExceptions(lines, productMappingsByKey),
    lines,
  };
}

export async function refreshInvoiceImportMappings(
  database: Queryable,
  vendorId: IntegrationId,
  importId: string,
): Promise<InvoiceImportRefreshResult | undefined> {
  const invoiceImport = await loadInvoiceImportForVendor(database, importId, vendorId);
  if (!invoiceImport) {
    return undefined;
  }

  const accountResult = await database.query<{ updated_count: string | number }>(
    `with updated as (
       update invoice_line_items
          set customer_id = vendor_account_mappings.customer_id,
              agreement_id = vendor_account_mappings.agreement_id
         from vendor_account_mappings
        where invoice_line_items.invoice_import_id = $1::uuid
          and invoice_line_items.vendor_id = $2
          and vendor_account_mappings.vendor_id = $2
          and vendor_account_mappings.external_account_id = invoice_line_items.external_account_id
          and vendor_account_mappings.active = true
          and vendor_account_mappings.mapping_status = 'approved'
          and vendor_account_mappings.agreement_id is not null
          and (invoice_line_items.customer_id is distinct from vendor_account_mappings.customer_id
            or invoice_line_items.agreement_id is distinct from vendor_account_mappings.agreement_id)
        returning invoice_line_items.id
     )
     select count(*) as updated_count from updated`,
    [importId, vendorId],
  );

  const productResult = await database.query<{ updated_count: string | number }>(
    `with approved_product_mappings as (
       select distinct on (vendor_id, replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/'))
              vendor_id,
              replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
              connectwise_product_code,
              connectwise_product_name
         from vendor_product_mappings
        where vendor_id = $2
          and active = true
          and mapping_status = 'approved'
        order by vendor_id,
                 replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/'),
                 target_index,
                 connectwise_product_code
     ),
     updated as (
       update invoice_line_items
          set connectwise_product_code = approved_product_mappings.connectwise_product_code,
              connectwise_product_name = approved_product_mappings.connectwise_product_name
         from approved_product_mappings
        where invoice_line_items.invoice_import_id = $1::uuid
          and invoice_line_items.vendor_id = $2
          and invoice_line_items.vendor_product_key = approved_product_mappings.vendor_product_key
          and (invoice_line_items.connectwise_product_code is distinct from approved_product_mappings.connectwise_product_code
            or invoice_line_items.connectwise_product_name is distinct from approved_product_mappings.connectwise_product_name)
        returning invoice_line_items.id
     )
     select count(*) as updated_count from updated`,
    [importId, vendorId],
  );

  const refreshedImport = await recountInvoiceImport(database, importId, vendorId);
  if (!refreshedImport) {
    return undefined;
  }

  return {
    import: refreshedImport,
    accountRowsUpdated: integerValue(accountResult.rows[0]?.updated_count),
    productRowsUpdated: integerValue(productResult.rows[0]?.updated_count),
  };
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
  accountIndex: AccountMappingIndex,
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
  const accountMapping = findAccountMapping(accountIndex, values);

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

async function loadInvoiceImportForVendor(
  database: Queryable,
  importId: string,
  vendorId: IntegrationId,
) {
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
      where id = $1::uuid
        and vendor_id = $2`,
    [importId, vendorId],
  );

  return result.rows[0] ? mapInvoiceImportRow(result.rows[0]) : undefined;
}

async function recountInvoiceImport(
  database: Queryable,
  importId: string,
  vendorId: IntegrationId,
) {
  const result = await database.query<InvoiceImportRow>(
    `with counts as (
       select count(*)::int as row_count,
              count(*) filter (
                where customer_id is not null
                  and agreement_id is not null
                  and connectwise_product_code is not null
              )::int as matched_rows,
              count(*) filter (
                where customer_id is null
                   or agreement_id is null
                   or connectwise_product_code is null
              )::int as exception_rows
         from invoice_line_items
        where invoice_import_id = $1::uuid
          and vendor_id = $2
     )
     update invoice_imports
        set row_count = counts.row_count,
            matched_rows = counts.matched_rows,
            exception_rows = counts.exception_rows,
            status = case when counts.exception_rows = 0 then 'ready' else 'review' end
       from counts
      where invoice_imports.id = $1::uuid
        and invoice_imports.vendor_id = $2
      returning invoice_imports.id,
                invoice_imports.vendor_id,
                invoice_imports.file_name,
                invoice_imports.invoice_number,
                invoice_imports.imported_at,
                invoice_imports.invoice_date,
                invoice_imports.billing_period_start,
                invoice_imports.billing_period_end,
                invoice_imports.row_count,
                invoice_imports.matched_rows,
                invoice_imports.exception_rows,
                invoice_imports.status`,
    [importId, vendorId],
  );

  return result.rows[0] ? mapInvoiceImportRow(result.rows[0]) : undefined;
}

async function loadInvoiceAccountExistingMappings(
  database: Queryable,
  vendorId: IntegrationId,
  externalAccountIds: string[],
): Promise<Map<string, InvoiceAccountExistingMapping>> {
  if (externalAccountIds.length === 0) {
    return new Map();
  }

  const result = await database.query<InvoiceAccountExistingMappingRow>(
    `select distinct on (vendor_account_mappings.external_account_id)
            vendor_account_mappings.external_account_id,
            vendor_account_mappings.customer_id,
            customers.name as customer_name,
            vendor_account_mappings.agreement_id,
            agreements.name as agreement_name,
            vendor_account_mappings.mapping_status,
            vendor_account_mappings.active
       from vendor_account_mappings
       inner join customers
         on customers.id = vendor_account_mappings.customer_id
       left join agreements
         on agreements.id = vendor_account_mappings.agreement_id
      where vendor_account_mappings.vendor_id = $1
        and vendor_account_mappings.external_account_id = any($2::text[])
      order by vendor_account_mappings.external_account_id,
               vendor_account_mappings.active desc,
               (vendor_account_mappings.mapping_status = 'approved') desc,
               vendor_account_mappings.reviewed_at desc nulls last,
               vendor_account_mappings.updated_at desc nulls last`,
    [vendorId, externalAccountIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        customerName: row.customer_name,
        agreementId: row.agreement_id ?? undefined,
        agreementName: row.agreement_name ?? undefined,
        status: row.mapping_status,
        active: row.active,
      },
    ]),
  );
}

async function loadInvoiceProductExistingMappings(
  database: Queryable,
  vendorId: IntegrationId,
  vendorProductKeys: string[],
): Promise<Map<string, InvoiceProductExistingMapping[]>> {
  if (vendorProductKeys.length === 0) {
    return new Map();
  }

  const result = await database.query<InvoiceProductExistingMappingRow>(
    `select vendor_product_key,
            connectwise_product_code,
            connectwise_product_name,
            mapping_status,
            active
       from vendor_product_mappings
      where vendor_id = $1
        and vendor_product_key = any($2::text[])
      order by vendor_product_key,
               active desc,
               (mapping_status = 'approved') desc,
               target_index,
               connectwise_product_code`,
    [vendorId, vendorProductKeys],
  );

  const byKey = new Map<string, InvoiceProductExistingMapping[]>();
  for (const row of result.rows) {
    byKey.set(row.vendor_product_key, [
      ...(byKey.get(row.vendor_product_key) ?? []),
      {
        connectWiseProductCode: row.connectwise_product_code,
        connectWiseProductName: row.connectwise_product_name,
        status: row.mapping_status,
        active: row.active,
      },
    ]);
  }

  return byKey;
}

function invoiceExceptionSummary(lines: InvoiceExceptionLine[]): InvoiceExceptionSummary {
  return {
    exceptionRows: lines.length,
    missingCustomerRows: lines.filter((line) => line.missingCustomer).length,
    missingAgreementRows: lines.filter((line) => line.missingAgreement).length,
    missingProductRows: lines.filter((line) => line.missingProduct).length,
    renewalExceptionRows: lines.filter((line) => line.chargeType === 'Renewal').length,
    otherExceptionRows: lines.filter((line) => line.chargeType !== 'Renewal').length,
  };
}

function buildInvoiceAccountExceptions(
  lines: InvoiceExceptionLine[],
  accountMappingsById: Map<string, InvoiceAccountExistingMapping>,
): InvoiceAccountException[] {
  const groups = new Map<string, InvoiceExceptionLine[]>();
  for (const line of lines) {
    if (!line.externalAccountId || (!line.missingCustomer && !line.missingAgreement)) {
      continue;
    }
    groups.set(line.externalAccountId, [...(groups.get(line.externalAccountId) ?? []), line]);
  }

  return [...groups.entries()]
    .map(([externalAccountId, groupLines]) => {
      const first = groupLines[0];
      return {
        externalAccountId,
        externalAccountName: first?.externalAccountName ?? externalAccountId,
        rowCount: groupLines.length,
        quantity: sumNumbers(groupLines.map((line) => line.quantity)),
        missingCustomer: groupLines.some((line) => line.missingCustomer),
        missingAgreement: groupLines.some((line) => line.missingAgreement),
        missingProduct: groupLines.some((line) => line.missingProduct),
        currentMapping: accountMappingsById.get(externalAccountId),
        sampleRows: groupLines.slice(0, 5),
      };
    })
    .sort((left, right) => right.rowCount - left.rowCount || left.externalAccountName.localeCompare(right.externalAccountName));
}

function buildInvoiceProductExceptions(
  lines: InvoiceExceptionLine[],
  productMappingsByKey: Map<string, InvoiceProductExistingMapping[]>,
): InvoiceProductException[] {
  const groups = new Map<string, InvoiceExceptionLine[]>();
  for (const line of lines) {
    if (!line.missingProduct) {
      continue;
    }
    const key = line.vendorProductKey ?? `${line.productCode}|${line.term ?? ''}|${line.billingFrequency ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  return [...groups.entries()]
    .map(([vendorProductKey, groupLines]) => {
      const first = groupLines[0];
      const candidateKeys = [
        ...new Set(groupLines.flatMap((line) => [line.vendorProductKey, ...line.vendorProductKeyCandidates])),
      ].filter((value): value is string => Boolean(value));
      return {
        vendorProductKey,
        vendorProductKeyCandidates: candidateKeys,
        productCode: first?.productCode ?? vendorProductKey,
        productName: first?.productName ?? vendorProductKey,
        term: first?.term,
        billingFrequency: first?.billingFrequency,
        rowCount: groupLines.length,
        quantity: sumNumbers(groupLines.map((line) => line.quantity)),
        missingProduct: true,
        existingMappings: productMappingsByKey.get(vendorProductKey) ?? [],
        sampleRows: groupLines.slice(0, 5),
      };
    })
    .sort((left, right) => right.rowCount - left.rowCount || left.productName.localeCompare(right.productName));
}

function mapInvoiceExceptionLineRow(row: InvoiceExceptionLineRow): InvoiceExceptionLine {
  return {
    id: row.id,
    rawRowNumber: integerValue(row.raw_row_number),
    externalAccountId: row.external_account_id ?? undefined,
    externalAccountName: row.external_account_name ?? undefined,
    vendorProductKey: row.vendor_product_key ?? undefined,
    vendorProductKeyCandidates: stringArrayValue(row.vendor_product_key_candidates),
    productCode: row.product_code,
    productName: row.product_name,
    connectWiseProductCode: row.connectwise_product_code ?? undefined,
    connectWiseProductName: row.connectwise_product_name ?? undefined,
    chargeType: row.charge_type ?? undefined,
    quantity: numericValue(row.quantity),
    billedAmount: optionalNumericValue(row.billed_amount),
    term: row.term ?? undefined,
    billingFrequency: row.billing_frequency ?? undefined,
    invoiceDate: isoDateOnly(row.invoice_date),
    primaryDomain: row.primary_domain ?? undefined,
    missingCustomer: !row.customer_id,
    missingAgreement: !row.agreement_id,
    missingProduct: !row.connectwise_product_code,
  };
}

async function deleteExistingInvoiceImports(
  database: Queryable,
  input: {
    currentImportId: string;
    fileName: string;
    invoiceNumber?: string;
    invoiceDate?: string;
  },
) {
  if (input.invoiceNumber) {
    await database.query(
      `delete from invoice_imports
        where vendor_id = $1
          and invoice_number = $2
          and id <> $3::uuid`,
      [appRiverInvoiceVendorId, input.invoiceNumber, input.currentImportId],
    );
    return;
  }

  await database.query(
    `delete from invoice_imports
      where vendor_id = $1
        and invoice_number is null
        and file_name = $2
        and invoice_date is not distinct from $3::date
        and id <> $4::uuid`,
    [appRiverInvoiceVendorId, input.fileName, input.invoiceDate ?? null, input.currentImportId],
  );
}

async function loadAppRiverAccountIndex(database: Queryable): Promise<AccountMappingIndex> {
  const result = await database.query<AccountMappingRow>(
    `select external_account_id,
            external_account_name,
            customer_id,
            agreement_id
       from vendor_account_mappings
      where vendor_id = $1
        and active = true
        and mapping_status = 'approved'
        and agreement_id is not null`,
    [appRiverInvoiceVendorId],
  );

  const snapshotResult = await database.query<AppRiverSnapshotAccountRow>(
    `select distinct
            external_account_id,
            nullif(dimensions->>'externalCustomerAccountNumber', '') as external_customer_account_number,
            nullif(dimensions->>'appRiverCustomerId', '') as app_river_customer_id,
            nullif(dimensions->>'customerName', '') as customer_name,
            nullif(dimensions->>'appRiverCustomerName', '') as app_river_customer_name,
            nullif(dimensions->>'domain', '') as domain,
            customer_id,
            agreement_id
       from vendor_usage_snapshots
      where vendor_id = $1
        and customer_id is not null
        and agreement_id is not null`,
    [appRiverInvoiceVendorId],
  );

  const entries: Array<{ keys: Array<string | null | undefined>; mapping: AccountMappingRow }> = [
    ...result.rows.map((row) => ({
      keys: [row.external_account_id, row.external_account_name],
      mapping: row,
    })),
    ...snapshotResult.rows.map((row) => ({
      keys: [
        row.external_account_id,
        row.external_customer_account_number,
        row.app_river_customer_id,
        row.customer_name,
        row.app_river_customer_name,
        row.domain,
      ],
      mapping: {
        external_account_id: row.external_account_id ?? row.external_customer_account_number ?? row.app_river_customer_id ?? '',
        external_account_name: row.customer_name ?? row.app_river_customer_name,
        customer_id: row.customer_id,
        agreement_id: row.agreement_id,
      },
    })),
  ];

  return {
    byKey: uniqueMappingIndex(entries),
  };
}

function isMappedInvoiceLine(line: NormalizedInvoiceLine) {
  return Boolean(line.customerId && line.agreementId && line.connectWiseProductCode);
}

async function loadAppRiverProductAliases(
  database: Queryable,
  mappings: Record<string, AppRiverProductMapping>,
): Promise<ProductAlias[]> {
  const result = await database.query<AppRiverSnapshotProductAliasRow>(
    `select distinct
            vendor_product_key,
            nullif(dimensions->>'productCode', '') as source_product_code,
            nullif(dimensions->>'productName', '') as source_product_name,
            nullif(dimensions->>'subscriptionTerm', '') as subscription_term,
            nullif(dimensions->>'billingFrequency', '') as billing_frequency
       from vendor_usage_snapshots
      where vendor_id = $1
        and vendor_product_key is not null`,
    [appRiverInvoiceVendorId],
  );

  return result.rows.flatMap((row) => {
    const mapping = row.vendor_product_key ? mappings[row.vendor_product_key] : undefined;
    if (!mapping) {
      return [];
    }

    return [
      {
        keys: [
          ...productKeyCandidates(
            row.source_product_code ?? '',
            row.source_product_name ?? '',
            row.subscription_term ?? undefined,
            row.billing_frequency ?? undefined,
          ),
          row.vendor_product_key ?? '',
        ],
        mapping,
      },
    ];
  });
}

function buildProductMappingIndex(
  mappings: Record<string, AppRiverProductMapping>,
  aliases: ProductAlias[] = [],
): ProductMappingIndex {
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

  for (const alias of aliases) {
    for (const key of alias.keys) {
      const normalizedKey = normalizeMatchKey(key);
      if (normalizedKey && !byKey.has(key)) {
        byKey.set(key, alias.mapping);
        byKey.set(normalizedKey, alias.mapping);
      }
      const baseKey = baseProductKey(key);
      if (baseKey && !byBaseKey.has(baseKey)) {
        byBaseKey.set(baseKey, alias.mapping);
      }
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
    const exact = index.byKey.get(candidate) ?? index.byKey.get(normalizeMatchKey(candidate));
    if (exact) {
      return exact;
    }
  }

  return (
    index.byBaseKey.get(productCode) ??
    index.byBaseKey.get(productName) ??
    index.byBaseKey.get(normalizeMatchKey(productCode)) ??
    index.byBaseKey.get(normalizeMatchKey(productName))
  );
}

function findAccountMapping(index: AccountMappingIndex, values: Record<string, string>) {
  const candidates = [
    stringValue(values['Customer Account Number']),
    stringValue(values['External Account Number']),
    stringValue(values['Company Name']),
    stringValue(values['Primary Domain']),
    ...splitAliasDomains(values['Alias Domains']),
  ];

  for (const candidate of candidates) {
    const mapping = index.byKey.get(normalizeMatchKey(candidate));
    if (mapping) {
      return mapping;
    }
  }

  return undefined;
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
  return normalizeMatchKey(value.split('|')[0]?.trim() ?? '');
}

function uniqueMappingIndex(entries: Array<{ keys: Array<string | null | undefined>; mapping: AccountMappingRow }>) {
  const grouped = new Map<string, AccountMappingRow[]>();
  for (const entry of entries) {
    for (const key of entry.keys) {
      const normalized = normalizeMatchKey(key);
      if (!normalized) {
        continue;
      }
      grouped.set(normalized, [...(grouped.get(normalized) ?? []), entry.mapping]);
    }
  }

  const index = new Map<string, AccountMappingRow>();
  for (const [key, mappings] of grouped.entries()) {
    const uniqueTargets = new Map(mappings.map((mapping) => [`${mapping.customer_id}|${mapping.agreement_id}`, mapping]));
    if (uniqueTargets.size === 1) {
      index.set(key, [...uniqueTargets.values()][0]);
    }
  }

  return index;
}

function splitAliasDomains(value: string | undefined) {
  return (value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMatchKey(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited)\b\.?/g, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function normalizeHeader(value: string) {
  return value.trim().toLowerCase();
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

function stringArrayValue(value: unknown) {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
