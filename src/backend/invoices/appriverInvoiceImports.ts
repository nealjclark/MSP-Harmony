import {
  getIntegrationSettingsDefinition,
  getIntegrationDataSource,
  integrationDataSourceRequiresCustomerMapping,
  integrationHasCapability,
  integrationIdsWithCapability,
  type IntegrationDataSourceType,
  type IntegrationId,
} from '../../shared/integrationSettings';
import { isVendorDatapointId, type VendorDatapointId, type VendorKey } from '../../shared/vendorDatapoints';
import { CONSTANT_QUANTITY_ONE, isConstantQuantityOne, normalizeImportedCustomerLabel } from '../../shared/invoiceTableMapping';
import { appRiverIntegrationId } from '../vendor/appriver/client';
import { loadAppRiverProductMappings, type Queryable } from '../vendor/appriver/operations';
import type { AppRiverProductMapping } from '../vendor/appriver/rules';

export type InvoiceImportSummary = {
  id: string;
  vendorId: VendorKey;
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
export type ManualImportSyncMode = 'info-only' | 'full-vendor-sync';

export type InvoiceTableColumnMap = {
  externalAccountId?: string;
  externalAccountName?: string;
  productCode?: string;
  productName?: string;
  licenseId?: string;
  licenseName?: string;
  userPrincipalName?: string;
  email?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  deviceClass?: string;
  lastCheckIn?: string;
  quantity?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  chargeType?: string;
  billedAmount?: string;
  term?: string;
  billingFrequency?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  primaryDomain?: string;
};

export type InvoiceImportSourceType = IntegrationDataSourceType;

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
  import_sync_mode?: string | null;
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

type GenericProductMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
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
  vendorId: VendorKey;
  importVendorId: VendorKey;
  mappingVendorId: VendorKey;
  sourceType: InvoiceImportSourceType;
  syncMode: ManualImportSyncMode;
  requiresCustomerMapping: boolean;
  requiresProductMapping: boolean;
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
  userPrincipalName?: string;
  email?: string;
  licenseId?: string;
  licenseName?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  deviceClass?: string;
  deviceCategory?: string;
  deviceCategoryLabel?: string;
  lastCheckIn?: string;
};

type ProductMappingIndex = {
  byKey: Map<string, InvoiceProductMapping>;
  byBaseKey: Map<string, InvoiceProductMapping>;
};

type AccountMappingIndex = {
  byKey: Map<string, AccountMappingRow>;
};

type ProductAlias = {
  keys: string[];
  mapping: InvoiceProductMapping;
};

type InvoiceProductMapping = {
  vendorProductKey: string;
  vendorProductKeys?: string[];
  productCode: string;
  productName: string;
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
      vendorId: appRiverInvoiceVendorId,
    });
  }

  await syncInvoiceImportUsageSnapshots(database, appRiverInvoiceVendorId, importId);

  const imported = await loadInvoiceImport(database, importId);
  if (!imported) {
    throw new Error('Unable to load AppRiver invoice import after save.');
  }

  return imported;
}

export async function importMappedInvoiceTableCsv(
  database: Queryable,
  input: {
    vendorId: IntegrationId;
    linkedIntegrationId?: IntegrationId;
    datapointId?: string;
    datapointVendorId?: VendorDatapointId;
    storageVendorIdOverride?: VendorKey;
    fileName: string;
    content: string;
    columnMap: InvoiceTableColumnMap;
    sourceType?: InvoiceImportSourceType;
    syncMode?: ManualImportSyncMode;
    importMode?: InvoiceImportMode;
  },
): Promise<InvoiceImportSummary> {
  assertInvoiceImportCapable(input.vendorId);
  const importVendorId = input.datapointVendorId ?? input.vendorId;
  const mappingVendorId = input.storageVendorIdOverride ?? linkedMappingVendorId(input.vendorId, input.linkedIntegrationId);
  const storageVendorId = mappingVendorId;
  assertMappedImportStorageVendor(storageVendorId);
  const importMode = input.importMode ?? 'merge';
  const syncMode = input.syncMode ?? 'full-vendor-sync';
  const sourceType = supportedInvoiceImportSourceType(input.vendorId, input.sourceType);
  const parsed = parseTabularContent({ fileName: input.fileName, content: input.content });
  if (parsed.rows.length === 0) {
    throw new Error('Invoice table import did not contain any data rows.');
  }

  const columnMap = normalizedInvoiceTableColumnMap(input.columnMap, parsed.headers);
  assertRequiredTableColumns(columnMap, sourceType);

  const [accountIndex, productMappings] = await Promise.all([
    loadGenericAccountIndex(database, mappingVendorId),
    loadGenericProductMappings(database, mappingVendorId),
  ]);
  const productIndex = buildProductMappingIndex(productMappings);
  const lines = parsed.rows.map((row) =>
    normalizeMappedInvoiceLine(
      row,
      storageVendorId,
      importVendorId,
      mappingVendorId,
      sourceType,
      syncMode,
      columnMap,
      accountIndex,
      productIndex,
    ),
  );
  const invoiceNumber = mostCommonString(lines.map((line) => stringValue(line.raw[columnMap.invoiceNumber ?? ''])));
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
      storageVendorId,
      input.fileName,
      invoiceNumber ?? null,
      invoiceDate ?? null,
      billingPeriodStart ?? null,
      billingPeriodEnd ?? null,
      lines.length,
      matchedRows,
      exceptionRows,
      status,
      JSON.stringify({
        ...rawSummary(input.fileName, parsed.headers, lines),
        importType: 'mapped-table',
        importVendorId,
        mappingVendorId,
        linkedIntegrationId: input.linkedIntegrationId ?? undefined,
        datapointId: input.datapointId ?? undefined,
        datapointVendorId: input.datapointVendorId ?? undefined,
        syncMode,
        sourceType,
        columnMap,
      }),
    ],
  );

  const importId = result.rows[0]?.id;
  if (!importId) {
    throw new Error('Unable to create invoice table import record.');
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
      vendorId: storageVendorId,
    });
  }

  await syncInvoiceImportUsageSnapshots(database, storageVendorId, importId);

  const imported = await loadInvoiceImport(database, importId);
  if (!imported) {
    throw new Error('Unable to load invoice table import after save.');
  }

  return imported;
}

export async function listInvoiceImports(
  database: Queryable,
  options: { vendorId?: VendorKey; datapointId?: string; limit?: number } = {},
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
        and ($3::text is null or raw_summary->>'datapointId' = $3)
      order by invoice_date desc nulls last, imported_at desc
      limit $2`,
    [options.vendorId ?? null, limit, options.datapointId ?? null],
  );

  return result.rows.map(mapInvoiceImportRow);
}

export async function deleteInvoiceImport(
  database: Queryable,
  vendorId: VendorKey,
  importId: string,
): Promise<InvoiceImportSummary | undefined> {
  const invoiceImport = await loadInvoiceImportForVendor(database, importId, vendorId);
  if (!invoiceImport) {
    return undefined;
  }

  const syncRuns = await database.query<{ id: string }>(
    `select id
       from sync_runs
      where integration_id = $1
        and metadata->>'invoiceImportId' = $2`,
    [vendorId, importId],
  );

  for (const syncRun of syncRuns.rows) {
    await database.query('delete from vendor_usage_snapshots where sync_run_id = $1::uuid', [syncRun.id]);
    await database.query('delete from sync_runs where id = $1::uuid', [syncRun.id]);
  }

  await database.query(
    `delete from invoice_imports
      where id = $1::uuid
        and vendor_id = $2`,
    [importId, vendorId],
  );

  return invoiceImport;
}

export async function getInvoiceImportExceptionReview(
  database: Queryable,
  vendorId: VendorKey,
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
            agreement_id,
            coalesce(invoice_imports.raw_summary->>'syncMode', 'full-vendor-sync') as import_sync_mode
       from invoice_line_items
      inner join invoice_imports
         on invoice_imports.id = invoice_line_items.invoice_import_id
      where invoice_line_items.invoice_import_id = $1::uuid
        and invoice_line_items.vendor_id = $2
        and (
          (
            invoice_line_items.connectwise_product_code is null
            and coalesce(invoice_imports.raw_summary->>'syncMode', 'full-vendor-sync') <> 'info-only'
          )
          or (
            coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown') <> 'reseller-product-total'
            and (invoice_line_items.customer_id is null or invoice_line_items.agreement_id is null)
          )
        )
      order by invoice_line_items.raw_row_number`,
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
  vendorId: VendorKey,
  importId: string,
): Promise<InvoiceImportRefreshResult | undefined> {
  const invoiceImport = await loadInvoiceImportForVendor(database, importId, vendorId);
  if (!invoiceImport) {
    return undefined;
  }

  const accountResult = await database.query<{ updated_count: string | number }>(
    `with approved_account_mapping_keys as (
       select
         lower(trim(alias_value)) as match_key,
         vendor_account_mappings.customer_id,
         vendor_account_mappings.agreement_id,
         0 as match_priority
       from vendor_account_mappings
       cross join lateral (
         values
           (vendor_account_mappings.external_account_id),
           (vendor_account_mappings.external_account_name)
       ) aliases(alias_value)
       where vendor_account_mappings.vendor_id = $2
         and vendor_account_mappings.active = true
         and vendor_account_mappings.mapping_status = 'approved'
         and vendor_account_mappings.agreement_id is not null
         and nullif(trim(alias_value), '') is not null
       union all
       select
         lower(trim(alias_value)) as match_key,
         vendor_account_mappings.customer_id,
         vendor_account_mappings.agreement_id,
         1 as match_priority
       from vendor_usage_snapshots
       left join sync_runs
         on sync_runs.id = vendor_usage_snapshots.sync_run_id
       inner join vendor_account_mappings
         on vendor_account_mappings.vendor_id = $2
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
        and vendor_account_mappings.agreement_id is not null
       cross join lateral (
         values
           (vendor_usage_snapshots.external_account_id),
           (nullif(vendor_usage_snapshots.dimensions->>'externalCustomerAccountNumber', '')),
           (nullif(vendor_usage_snapshots.dimensions->>'appRiverCustomerId', '')),
           (nullif(vendor_usage_snapshots.dimensions->>'customerName', '')),
           (nullif(vendor_usage_snapshots.dimensions->>'appRiverCustomerName', '')),
           (nullif(vendor_usage_snapshots.dimensions->>'domain', ''))
       ) aliases(alias_value)
       where $2 = $3
         and vendor_usage_snapshots.vendor_id = $2
         and coalesce(sync_runs.metadata->>'source', '') <> 'invoice-table'
         and nullif(trim(alias_value), '') is not null
     ),
     unique_account_mapping_keys as (
       select distinct on (approved_account_mapping_keys.match_key)
         approved_account_mapping_keys.match_key,
         approved_account_mapping_keys.customer_id,
         approved_account_mapping_keys.agreement_id,
         approved_account_mapping_keys.match_priority
       from approved_account_mapping_keys
       where not exists (
         select 1
         from approved_account_mapping_keys other
         where other.match_key = approved_account_mapping_keys.match_key
           and (
             other.customer_id <> approved_account_mapping_keys.customer_id
             or other.agreement_id is distinct from approved_account_mapping_keys.agreement_id
           )
       )
       order by approved_account_mapping_keys.match_key,
                approved_account_mapping_keys.match_priority
     ),
     line_account_matches as (
       select distinct on (invoice_line_items.id)
         invoice_line_items.id,
         unique_account_mapping_keys.customer_id,
         unique_account_mapping_keys.agreement_id
       from invoice_line_items
       inner join unique_account_mapping_keys
         on unique_account_mapping_keys.match_key in (
           lower(trim(coalesce(invoice_line_items.external_account_id, ''))),
           lower(trim(coalesce(invoice_line_items.external_account_name, '')))
         )
       where invoice_line_items.invoice_import_id = $1::uuid
         and invoice_line_items.vendor_id = $2
       order by invoice_line_items.id,
                case
                  when unique_account_mapping_keys.match_key = lower(trim(coalesce(invoice_line_items.external_account_id, ''))) then 0
                  else 1
                end,
                unique_account_mapping_keys.match_priority
     ),
     updated as (
       update invoice_line_items
          set customer_id = line_account_matches.customer_id,
              agreement_id = line_account_matches.agreement_id
         from line_account_matches
        where invoice_line_items.id = line_account_matches.id
          and (invoice_line_items.customer_id is distinct from line_account_matches.customer_id
            or invoice_line_items.agreement_id is distinct from line_account_matches.agreement_id)
        returning invoice_line_items.id
     )
     select count(*) as updated_count from updated`,
    [importId, vendorId, appRiverInvoiceVendorId],
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

  await database.query(
    `update invoice_line_items
        set quantity = 1,
            charge_type = 'Renewal'
       from invoice_imports
      where invoice_line_items.invoice_import_id = invoice_imports.id
        and invoice_imports.id = $1::uuid
        and invoice_line_items.vendor_id = $2
        and coalesce(invoice_imports.raw_summary->>'sourceType', '') = 'device-count'
        and (
          invoice_line_items.quantity is distinct from 1
          or coalesce(invoice_line_items.charge_type, '') is distinct from 'Renewal'
        )`,
    [importId, vendorId],
  );

  const refreshedImport = await recountInvoiceImport(database, importId, vendorId);
  if (!refreshedImport) {
    return undefined;
  }
  await syncInvoiceImportUsageSnapshots(database, vendorId, importId);

  return {
    import: refreshedImport,
    accountRowsUpdated: integerValue(accountResult.rows[0]?.updated_count),
    productRowsUpdated: integerValue(productResult.rows[0]?.updated_count),
  };
}

export async function loadLatestInvoiceImportSummary(
  database: Queryable,
  vendorId: VendorKey,
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
        and coalesce(raw_summary->>'syncMode', 'full-vendor-sync') <> 'info-only'
        and coalesce(raw_summary->>'sourceType', 'customer-product-breakdown') not in ('device-count', 'license-count')
      order by invoice_date desc nulls last, imported_at desc
      limit 1`,
    [vendorId],
  );

  return result.rows[0] ? mapInvoiceImportRow(result.rows[0]) : undefined;
}

export async function loadLatestInvoiceQuantitiesForLines(
  database: Queryable,
  vendorId: VendorKey,
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
    vendorId: appRiverInvoiceVendorId,
    importVendorId: appRiverInvoiceVendorId,
    mappingVendorId: appRiverInvoiceVendorId,
    sourceType: 'customer-product-breakdown',
    syncMode: 'full-vendor-sync',
    requiresCustomerMapping: true,
    requiresProductMapping: true,
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

function normalizeMappedInvoiceLine(
  row: ParsedCsv['rows'][number],
  vendorId: VendorKey,
  importVendorId: VendorKey,
  mappingVendorId: VendorKey,
  sourceType: InvoiceImportSourceType,
  syncMode: ManualImportSyncMode,
  columnMap: Required<Pick<InvoiceTableColumnMap, 'externalAccountId' | 'productName' | 'quantity'>> &
    InvoiceTableColumnMap,
  accountIndex: AccountMappingIndex,
  productIndex: ProductMappingIndex,
): NormalizedInvoiceLine {
  const values = row.values;
  const externalAccountId = normalizeImportedCustomerLabel(mappedString(values, columnMap.externalAccountId)) ?? '';
  const externalAccountName =
    normalizeImportedCustomerLabel(mappedString(values, columnMap.externalAccountName)) ?? externalAccountId;
  const deviceType = mappedString(values, columnMap.deviceType);
  const deviceClass = mappedString(values, columnMap.deviceClass);
  const deviceCategory = sourceType === 'device-count' ? deviceCategoryForValues(deviceType, deviceClass) : undefined;
  const licenseName = mappedString(values, columnMap.licenseName);
  const licenseId = mappedString(values, columnMap.licenseId);
  const productName =
    mappedString(values, columnMap.productName) ??
    (sourceType === 'license-count' ? licenseName : undefined) ??
    deviceCategory?.label ??
    '';
  const productCode =
    mappedString(values, columnMap.productCode) ??
    (sourceType === 'license-count' ? licenseId : undefined) ??
    deviceCategory?.key ??
    productName;
  const term = mappedString(values, columnMap.term);
  const billingFrequency = mappedString(values, columnMap.billingFrequency);
  const vendorProductKeyCandidates = manualProductKeyCandidates(sourceType, productCode, productName, term, billingFrequency, {
    deviceCategoryKey: deviceCategory?.key,
    deviceCategoryLabel: deviceCategory?.label,
    licenseId,
    licenseName,
  });
  const productMapping = findProductMapping(productIndex, vendorProductKeyCandidates, productCode, productName);
  const requiresCustomerMapping = integrationDataSourceRequiresCustomerMapping(sourceType);
  const requiresProductMapping = importRequiresProductMapping(sourceType, syncMode);
  const accountMapping = requiresCustomerMapping
    ? findAccountMapping(accountIndex, {
        'Customer Account Number': externalAccountId,
        'External Account Number': externalAccountId,
        'Company Name': externalAccountName,
        'Primary Domain': mappedString(values, columnMap.primaryDomain) ?? '',
      })
    : undefined;
  const chargeType =
    sourceType === 'device-count' || sourceType === 'license-count'
      ? 'Renewal'
      : mappedString(values, columnMap.chargeType) ?? 'Renewal';

  return {
    vendorId,
    importVendorId,
    mappingVendorId,
    sourceType,
    syncMode,
    requiresCustomerMapping,
    requiresProductMapping,
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
    chargeType,
    quantity: resolvedImportQuantity(sourceType, columnMap.quantity, values),
    billedAmount: optionalNumericValue(mappedString(values, columnMap.billedAmount)),
    invoiceDate: parseInvoiceDate(mappedString(values, columnMap.invoiceDate)),
    billingPeriodStart: parseInvoiceDate(mappedString(values, columnMap.billingPeriodStart)),
    billingPeriodEnd: parseInvoiceDate(mappedString(values, columnMap.billingPeriodEnd)),
    term,
    billingFrequency,
    primaryDomain: mappedString(values, columnMap.primaryDomain),
    userPrincipalName: mappedString(values, columnMap.userPrincipalName),
    email: mappedString(values, columnMap.email),
    licenseId,
    licenseName,
    deviceId: mappedString(values, columnMap.deviceId),
    deviceName: mappedString(values, columnMap.deviceName),
    deviceType,
    deviceClass,
    deviceCategory: deviceCategory?.key,
    deviceCategoryLabel: deviceCategory?.label,
    lastCheckIn: parseInvoiceDate(mappedString(values, columnMap.lastCheckIn)),
  };
}

function mappedString(values: Record<string, string>, columnName: string | undefined) {
  if (!columnName || isConstantQuantityOne(columnName)) {
    return undefined;
  }
  return stringValue(values[columnName]);
}

function resolvedImportQuantity(
  sourceType: InvoiceImportSourceType,
  quantityColumn: string | undefined,
  values: Record<string, string>,
) {
  // Device lists are one device per CSV row. Never treat core/CPU counts as quantity.
  if (sourceType === 'device-count') {
    return 1;
  }

  if (isConstantQuantityOne(quantityColumn)) {
    return 1;
  }

  return numericValue(mappedString(values, quantityColumn));
}

function linkedMappingVendorId(vendorId: IntegrationId, linkedIntegrationId: IntegrationId | undefined): VendorKey {
  if (vendorId !== 'custom-table') {
    return vendorId;
  }

  return linkedIntegrationId && getIntegrationSettingsDefinition(linkedIntegrationId) ? linkedIntegrationId : vendorId;
}

function importRequiresProductMapping(sourceType: InvoiceImportSourceType, syncMode: ManualImportSyncMode) {
  if (syncMode === 'info-only') {
    return false;
  }

  return true;
}

function sourceProductRequirementLabel(sourceType: InvoiceImportSourceType) {
  if (sourceType === 'device-count') {
    return 'Product, DeviceType, or DeviceClass column';
  }
  if (sourceType === 'license-count') {
    return 'Product or license column';
  }

  return 'Product name or code column';
}

function manualProductKeyCandidates(
  sourceType: InvoiceImportSourceType,
  productCode: string,
  productName: string,
  term: string | undefined,
  billingFrequency: string | undefined,
  options: {
    deviceCategoryKey?: string;
    deviceCategoryLabel?: string;
    licenseId?: string;
    licenseName?: string;
  },
) {
  const candidates = productKeyCandidates(productCode, productName, term, billingFrequency);
  if (sourceType === 'device-count' && options.deviceCategoryKey) {
    candidates.unshift(options.deviceCategoryKey);
    if (options.deviceCategoryLabel) {
      candidates.push(options.deviceCategoryLabel);
    }
  }
  if (sourceType === 'license-count') {
    candidates.push(
      ...productKeyCandidates(options.licenseId ?? '', options.licenseName ?? '', term, billingFrequency),
    );
  }

  return [...new Set(candidates.filter(Boolean))];
}

function deviceCategoryForValues(deviceType: string | undefined, deviceClass: string | undefined) {
  const combined = normalizeDeviceCategoryInput([deviceType, deviceClass].filter(Boolean).join(' '));
  if (!combined) {
    return undefined;
  }

  const hasServer = /\b(server|srv|domain controller|hypervisor|host)\b/.test(combined);
  const hasVirtual = /\b(virtual|vm|hyper v|hyper-v|vmware|vcenter|esxi)\b/.test(combined);
  const hasPhysical = /\b(physical|bare metal|baremetal)\b/.test(combined);

  if (hasServer && hasVirtual) {
    return { key: 'device:virtual-server', label: 'Device Count - Virtual Server' };
  }
  if (hasServer && hasPhysical) {
    return { key: 'device:physical-server', label: 'Device Count - Physical Server' };
  }
  if (hasServer) {
    return { key: 'device:server', label: 'Device Count - Server' };
  }
  if (/\b(workstation|desktop|laptop|notebook|pc|client|mac|windows workstation)\b/.test(combined)) {
    return { key: 'device:workstation', label: 'Device Count - Workstation' };
  }
  if (/\b(firewall|router|switch|access point|ap|network|printer|nas|san|appliance)\b/.test(combined)) {
    return { key: 'device:network-device', label: 'Device Count - Network Device' };
  }
  if (/\b(phone|tablet|mobile|ios|android)\b/.test(combined)) {
    return { key: 'device:mobile-device', label: 'Device Count - Mobile Device' };
  }

  return { key: 'device:other-device', label: 'Device Count - Other Device' };
}

function normalizeDeviceCategoryInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9.+ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedInvoiceTableColumnMap(
  columnMap: InvoiceTableColumnMap,
  headers: string[],
): Required<Pick<InvoiceTableColumnMap, 'externalAccountId' | 'productName' | 'quantity'>> & InvoiceTableColumnMap {
  const byNormalizedHeader = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const normalized = Object.fromEntries(
    Object.entries(columnMap).flatMap(([key, value]) => {
      if (typeof value !== 'string') {
        return [];
      }
      if (isConstantQuantityOne(value)) {
        return [[key, CONSTANT_QUANTITY_ONE]];
      }
      const header = byNormalizedHeader.get(normalizeHeader(value));
      return header ? [[key, header]] : [];
    }),
  ) as InvoiceTableColumnMap;

  return {
    ...normalized,
    externalAccountId: normalized.externalAccountId ?? '',
    productName: normalized.productName ?? '',
    quantity: normalized.quantity ?? '',
  };
}

function assertRequiredTableColumns(
  columnMap: Required<Pick<InvoiceTableColumnMap, 'externalAccountId' | 'productName' | 'quantity'>> &
    InvoiceTableColumnMap,
  sourceType: InvoiceImportSourceType,
) {
  const requiresCustomerMapping = integrationDataSourceRequiresCustomerMapping(sourceType);
  const hasProductColumn = Boolean(columnMap.productName || columnMap.productCode);
  const hasLicenseColumn = Boolean(columnMap.licenseName || columnMap.licenseId);
  const hasDeviceCategoryColumn = Boolean(columnMap.deviceType || columnMap.deviceClass);
  const hasSourceProduct =
    sourceType === 'device-count'
      ? hasProductColumn || hasDeviceCategoryColumn
      : sourceType === 'license-count'
        ? hasProductColumn || hasLicenseColumn
        : hasProductColumn;
  const missing = [
    requiresCustomerMapping && !columnMap.externalAccountId ? 'Customer/account column' : undefined,
    hasSourceProduct ? undefined : sourceProductRequirementLabel(sourceType),
    sourceType === 'device-count' || columnMap.quantity ? undefined : 'Quantity column',
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`Invoice table import is missing required mappings: ${missing.join(', ')}.`);
  }
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
      line.vendorId,
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
      JSON.stringify(rawPayloadForLine(line)),
    ],
  );
}

function rawPayloadForLine(line: NormalizedInvoiceLine) {
  return {
    ...line.raw,
    importVendorId: line.importVendorId,
    mappingVendorId: line.mappingVendorId,
    sourceType: line.sourceType,
    syncMode: line.syncMode,
    userPrincipalName: line.userPrincipalName,
    email: line.email,
    licenseId: line.licenseId,
    licenseName: line.licenseName,
    deviceId: line.deviceId,
    deviceName: line.deviceName,
    deviceType: line.deviceType,
    deviceClass: line.deviceClass,
    deviceCategory: line.deviceCategory,
    deviceCategoryLabel: line.deviceCategoryLabel,
    lastCheckIn: line.lastCheckIn,
    lastApplianceCheckinTime: line.lastCheckIn,
  };
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
  vendorId: VendorKey,
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
  vendorId: VendorKey,
) {
  const result = await database.query<InvoiceImportRow>(
    `with import_scope as (
       select coalesce(raw_summary->>'sourceType', 'customer-product-breakdown') as source_type,
              coalesce(raw_summary->>'syncMode', 'full-vendor-sync') as sync_mode
       from invoice_imports
       where id = $1::uuid
         and vendor_id = $2
     ),
     counts as (
       select count(*)::int as row_count,
               count(*) filter (
                 where (
                     connectwise_product_code is not null
                     or (select sync_mode from import_scope) = 'info-only'
                   )
                   and (
                     (select source_type from import_scope) = 'reseller-product-total'
                     or (customer_id is not null and agreement_id is not null)
                  )
              )::int as matched_rows,
               count(*) filter (
                 where (
                     connectwise_product_code is null
                     and (select sync_mode from import_scope) <> 'info-only'
                   )
                   or (
                     (select source_type from import_scope) <> 'reseller-product-total'
                     and (customer_id is null or agreement_id is null)
                   )
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
  vendorId: VendorKey,
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
  vendorId: VendorKey,
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
    missingProduct: row.import_sync_mode !== 'info-only' && !row.connectwise_product_code,
  };
}

async function deleteExistingInvoiceImports(
  database: Queryable,
  input: {
    currentImportId: string;
    fileName: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    vendorId: VendorKey;
  },
) {
  if (input.invoiceNumber) {
    await database.query(
      `delete from invoice_imports
        where vendor_id = $1
          and invoice_number = $2
          and id <> $3::uuid`,
      [input.vendorId, input.invoiceNumber, input.currentImportId],
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
    [input.vendorId, input.fileName, input.invoiceDate ?? null, input.currentImportId],
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

async function loadGenericAccountIndex(
  database: Queryable,
  vendorId: VendorKey,
): Promise<AccountMappingIndex> {
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
    [vendorId],
  );

  return {
    byKey: uniqueMappingIndex(
      result.rows.map((row) => ({
        keys: [row.external_account_id, row.external_account_name],
        mapping: row,
      })),
    ),
  };
}

async function loadGenericProductMappings(
  database: Queryable,
  vendorId: VendorKey,
): Promise<Record<string, InvoiceProductMapping>> {
  const result = await database.query<GenericProductMappingRow>(
    `select vendor_product_key,
            target_index,
            connectwise_product_code,
            connectwise_product_name
       from vendor_product_mappings
      where vendor_id = $1
        and active = true
        and mapping_status = 'approved'
      order by vendor_product_key, target_index, connectwise_product_code`,
    [vendorId],
  );
  const mappings: Record<string, InvoiceProductMapping> = {};
  const rowsByKey = new Map<string, GenericProductMappingRow[]>();

  for (const row of result.rows) {
    rowsByKey.set(row.vendor_product_key, [...(rowsByKey.get(row.vendor_product_key) ?? []), row]);
  }

  for (const [vendorProductKey, rows] of rowsByKey.entries()) {
    const primary = [...rows].sort(
      (left, right) =>
        integerValue(left.target_index) - integerValue(right.target_index) ||
        left.connectwise_product_code.localeCompare(right.connectwise_product_code),
    )[0];
    if (!primary) {
      continue;
    }

    mappings[vendorProductKey] = {
      vendorProductKey,
      productCode: primary.connectwise_product_code,
      productName: primary.connectwise_product_name,
      vendorProductKeys: [...new Set(rows.map((row) => row.vendor_product_key))],
    };
  }

  return mappings;
}

function isMappedInvoiceLine(line: NormalizedInvoiceLine) {
  return Boolean(
    (!line.requiresCustomerMapping || (line.customerId && line.agreementId)) &&
      (!line.requiresProductMapping || line.connectWiseProductCode),
  );
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
  mappings: Record<string, InvoiceProductMapping>,
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
    sourceTypes: sortedUnique(lines.map((line) => line.sourceType)),
    requiresCustomerMapping: lines.some((line) => line.requiresCustomerMapping),
    chargeTypes: Object.fromEntries(groupCounts(lines.map((line) => line.chargeType ?? ''))),
    renewalRows: renewalLines.length,
    adjustmentRows: adjustmentLines.length,
    renewalQuantity: sumNumbers(renewalLines.map((line) => line.quantity)),
    billedAmount: sumNumbers(lines.map((line) => line.billedAmount ?? 0)),
  };
}

function assertInvoiceImportCapable(vendorId: IntegrationId) {
  if (!getIntegrationSettingsDefinition(vendorId) || !integrationHasCapability(vendorId, 'invoice-import')) {
    throw new Error(`Invoice table import is not available for integration "${vendorId}".`);
  }
}

function assertMappedImportStorageVendor(vendorId: VendorKey) {
  if (isVendorDatapointId(vendorId)) {
    return;
  }

  assertInvoiceImportCapable(vendorId);
}

function supportedInvoiceImportSourceType(
  vendorId: IntegrationId,
  requestedSourceType: InvoiceImportSourceType | undefined,
): InvoiceImportSourceType {
  const sourceType = requestedSourceType ?? 'customer-product-breakdown';
  const dataSource = getIntegrationDataSource(vendorId, sourceType);
  if (
    !dataSource ||
    !dataSource.ingestionMethods.some((method) => method === 'csv' || method === 'excel' || method === 'json')
  ) {
    throw new Error(`Invoice table import source type "${sourceType}" is not available for integration "${vendorId}".`);
  }

  return sourceType;
}

async function syncInvoiceImportUsageSnapshots(database: Queryable, vendorId: VendorKey, importId: string) {
  const syncRunId = await ensureInvoiceImportSyncRun(database, vendorId, importId);
  await database.query('delete from vendor_usage_snapshots where sync_run_id = $1::uuid', [syncRunId]);
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id,
       vendor_id,
       customer_id,
       agreement_id,
       external_account_id,
       vendor_product_key,
       product_code,
       product_name,
       quantity,
       observed_at,
       dimensions,
       raw_payload
     )
     select
       $1::uuid,
       invoice_line_items.vendor_id,
       invoice_line_items.customer_id,
       invoice_line_items.agreement_id,
       invoice_line_items.external_account_id,
       invoice_line_items.vendor_product_key,
       coalesce(invoice_line_items.connectwise_product_code, invoice_line_items.product_code),
       coalesce(invoice_line_items.connectwise_product_name, invoice_line_items.product_name),
       invoice_line_items.quantity,
       coalesce(invoice_line_items.invoice_date::timestamptz, invoice_imports.imported_at),
       jsonb_build_object(
         'invoiceImportId', invoice_imports.id,
         'invoiceNumber', invoice_imports.invoice_number,
         'invoiceDate', invoice_imports.invoice_date,
         'invoiceFileName', invoice_imports.file_name,
         'invoiceTableImport', true,
         'manualImport', true,
         'sourceType', coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown'),
         'syncMode', coalesce(invoice_imports.raw_summary->>'syncMode', 'full-vendor-sync'),
         'detailOnlySync', coalesce(invoice_imports.raw_summary->>'syncMode', 'full-vendor-sync') = 'info-only',
         'importVendorId', invoice_imports.raw_summary->>'importVendorId',
         'mappingVendorId', invoice_imports.raw_summary->>'mappingVendorId',
         'linkedIntegrationId', invoice_imports.raw_summary->>'linkedIntegrationId',
         'externalAccountName', invoice_line_items.external_account_name,
         'productName', invoice_line_items.product_name,
         'productCode', invoice_line_items.product_code,
         'chargeType', invoice_line_items.charge_type,
         'billingFrequency', invoice_line_items.billing_frequency,
         'term', invoice_line_items.term,
         'userPrincipalName', invoice_line_items.raw_payload->>'userPrincipalName',
         'email', invoice_line_items.raw_payload->>'email',
         'licenseId', invoice_line_items.raw_payload->>'licenseId',
         'licenseName', invoice_line_items.raw_payload->>'licenseName',
         'deviceId', invoice_line_items.raw_payload->>'deviceId',
         'deviceName', invoice_line_items.raw_payload->>'deviceName',
         'deviceType', invoice_line_items.raw_payload->>'deviceType',
         'deviceClass', invoice_line_items.raw_payload->>'deviceClass',
         'deviceCategory', invoice_line_items.raw_payload->>'deviceCategory',
         'deviceCategoryLabel', invoice_line_items.raw_payload->>'deviceCategoryLabel',
         'lastCheckIn', invoice_line_items.raw_payload->>'lastCheckIn',
         'lastApplianceCheckinTime', coalesce(
           invoice_line_items.raw_payload->>'lastApplianceCheckinTime',
           invoice_line_items.raw_payload->>'lastCheckIn'
         )
       ) || invoice_line_items.raw_payload,
       invoice_line_items.raw_payload
     from invoice_line_items
     inner join invoice_imports
       on invoice_imports.id = invoice_line_items.invoice_import_id
     where invoice_line_items.invoice_import_id = $2::uuid
       and invoice_line_items.vendor_id = $3
       and coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown') <> 'reseller-product-total'
       and (
         coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown') in ('device-count', 'license-count')
         or coalesce(invoice_line_items.charge_type, 'Renewal') = 'Renewal'
       )`,
    [syncRunId, importId, vendorId],
  );
  await database.query(
    `update sync_runs
        set completed_at = now(),
            status = 'complete',
            records_read = invoice_imports.row_count,
            records_written = (
              select count(*)::int
              from invoice_line_items
              where invoice_line_items.invoice_import_id = invoice_imports.id
                and coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown') <> 'reseller-product-total'
                and (
                  coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown') in ('device-count', 'license-count')
                  or coalesce(invoice_line_items.charge_type, 'Renewal') = 'Renewal'
                )
            ),
            metadata = sync_runs.metadata || jsonb_build_object(
              'source',
                coalesce(
                  sync_runs.metadata->>'source',
                  case
                    when coalesce(invoice_imports.raw_summary->>'syncMode', '') = 'info-only' then 'manual-info-only'
                    when nullif(invoice_imports.raw_summary->>'syncMode', '') is not null then 'manual-full-sync'
                    else 'invoice-table'
                  end
                ),
              'entity',
                coalesce(
                  sync_runs.metadata->>'entity',
                  case coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown')
                    when 'device-count' then 'manual-device-counts'
                    when 'license-count' then 'manual-license-counts'
                    when 'invoice' then 'manual-invoice-lines'
                    else 'invoice-lines'
                  end
                ),
              'sourceType', coalesce(invoice_imports.raw_summary->>'sourceType', 'customer-product-breakdown'),
              'syncMode', coalesce(invoice_imports.raw_summary->>'syncMode', 'full-vendor-sync'),
              'invoiceImportId', invoice_imports.id,
              'invoiceNumber', invoice_imports.invoice_number,
              'fileName', invoice_imports.file_name
            )
       from invoice_imports
      where sync_runs.id = $1::uuid
        and invoice_imports.id = $2::uuid`,
    [syncRunId, importId],
  );
}

async function ensureInvoiceImportSyncRun(database: Queryable, vendorId: VendorKey, importId: string) {
  const existing = await database.query<{ id: string }>(
    `select id
       from sync_runs
      where integration_id = $1
        and metadata->>'invoiceImportId' = $2
      order by started_at desc
      limit 1`,
    [vendorId, importId],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    return existingId;
  }

  const created = await database.query<{ id: string }>(
    `insert into sync_runs (
       integration_id,
       status,
       records_read,
       records_written,
       metadata,
       completed_at
     )
     values ($1, 'complete', 0, 0, $2::jsonb, now())
     returning id`,
    [
      vendorId,
      JSON.stringify({
        invoiceImportId: importId,
      }),
    ],
  );
  const createdId = created.rows[0]?.id;
  if (!createdId) {
    throw new Error('Unable to create invoice table sync run.');
  }

  return createdId;
}

function parseTabularContent(input: { fileName: string; content: string }): ParsedCsv {
  if (looksLikeJsonTable(input.fileName, input.content)) {
    return parseJsonTable(input.content);
  }

  return parseCsv(input.content);
}

function looksLikeJsonTable(fileName: string, content: string) {
  const trimmed = content.trimStart();
  return fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{');
}

function parseJsonTable(content: string): ParsedCsv {
  const parsed = parseJson(content);
  const rows = jsonRows(parsed);
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  if (Array.isArray(rows[0])) {
    const arrayRows = rows.filter(Array.isArray) as unknown[][];
    const headerRow = arrayRows[0].map((value) => stringFromJsonCell(value).trim()).filter(Boolean);
    return {
      headers: headerRow,
      rows: arrayRows.slice(1).map((values, index) => ({
        recordNumber: index + 2,
        values: Object.fromEntries(headerRow.map((header, headerIndex) => [header, stringFromJsonCell(values[headerIndex])])),
      })),
    };
  }

  const objectRows = rows.filter(isJsonRecord);
  const headers = [
    ...new Set(
      objectRows.flatMap((row) =>
        Object.keys(row).filter((key) => typeof row[key] !== 'undefined' && row[key] !== null),
      ),
    ),
  ];

  return {
    headers,
    rows: objectRows.map((row, index) => ({
      recordNumber: index + 2,
      values: Object.fromEntries(headers.map((header) => [header, stringFromJsonCell(row[header])])),
    })),
  };
}

function jsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isJsonRecord(value)) {
    for (const key of ['rows', 'data', 'items', 'records', 'results']) {
      const candidate = value[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return [];
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringFromJsonCell(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return JSON.stringify(value);
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

  const headers = rows[0]?.map((header) => (header ?? '').trim()).filter(Boolean) ?? [];
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

function normalizeHeader(value: string | undefined) {
  return (value ?? '').trim().toLowerCase();
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
