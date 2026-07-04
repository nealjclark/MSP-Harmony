import assert from 'node:assert/strict';
import {
  detectInvoiceVendor,
  getInvoiceImportExceptionReview,
  importAppRiverInvoiceCsv,
  importMappedInvoiceTableCsv,
  loadLatestInvoiceQuantitiesForLines,
  refreshInvoiceImportMappings,
  type InvoiceImportSummary,
} from './appriverInvoiceImports';
import type { Queryable } from '../vendor/cove/operations';

const customerId = '11111111-1111-1111-1111-111111111111';
const agreementId = '22222222-2222-2222-2222-222222222222';

async function run() {
  const insertedImports: Array<{ sql: string; values?: unknown[] }> = [];
  const insertedLines: Array<{ sql: string; values?: unknown[] }> = [];
  const deletedImports: Array<{ sql: string; values?: unknown[] }> = [];
  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('from vendor_account_mappings')) {
        return {
          rows: [
            {
              external_account_id: '119793',
              external_account_name: 'Absolute Electric, Inc.',
              customer_id: customerId,
              agreement_id: agreementId,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return {
          rows: [
            {
              vendor_product_key: 'O365CSP-1|Monthly|Monthly',
              target_index: 0,
              connectwise_product_code: 'CW-EXCHANGE-P1',
              connectwise_product_name: 'Exchange Online Plan 1',
              unit_price: '4.22',
            },
          ] as T[],
        };
      }

      if (sql.includes('from target_names')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into invoice_imports')) {
        insertedImports.push({ sql, values });
        return { rows: [{ id: '33333333-3333-3333-3333-333333333333' }] as T[] };
      }

      if (sql.includes('insert into invoice_line_items')) {
        insertedLines.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('delete from invoice_imports')) {
        deletedImports.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into sync_runs') && sql.includes('returning id')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-4444-444444444444',
            },
          ] as T[],
        };
      }

      if (sql.includes('from invoice_imports') && sql.includes('where id = $1::uuid')) {
        const importValues = insertedImports[insertedImports.length - 1]?.values ?? [];
        return {
          rows: [
            {
              id: '33333333-3333-3333-3333-333333333333',
              vendor_id: 'opentext-appriver',
              file_name: importValues[1],
              invoice_number: importValues[2],
              imported_at: '2026-07-01T12:00:00Z',
              invoice_date: importValues[3],
              billing_period_start: importValues[4],
              billing_period_end: importValues[5],
              row_count: importValues[6],
              matched_rows: importValues[7],
              exception_rows: importValues[8],
              status: importValues[9],
            },
          ] as T[],
        };
      }

      if (sql.includes('from invoice_imports') && sql.includes('order by invoice_date desc')) {
        return {
          rows: [
            {
              id: '33333333-3333-3333-3333-333333333333',
              vendor_id: 'opentext-appriver',
              file_name: 'AccountHistory.csv',
              invoice_number: '4032091',
              imported_at: '2026-07-01T12:00:00Z',
              invoice_date: '2026-06-21',
              billing_period_start: '2026-05-22',
              billing_period_end: '2026-07-17',
              row_count: 3,
              matched_rows: 3,
              exception_rows: 0,
              status: 'ready',
            },
          ] as T[],
        };
      }

      if (sql.includes('from invoice_line_items') && sql.includes("charge_type = 'Renewal'")) {
        return {
          rows: [
            {
              customer_id: customerId,
              agreement_id: agreementId,
              connectwise_product_code: 'CW-EXCHANGE-P1',
              invoice_quantity: '27',
              invoice_line_count: '1',
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const csv = [
    'Customer Account Number,External Account Number,Company Name,Effective Date,Charge Type,Product,Product Code,Appriver Charge Name,Custom Charge Name,Previous Adjustment Qty,Post Adjustment Qty,Charge Qty,Rate,Months,Amount,Billed Amount,Primary Domain,Alias Domains,Term,Start,End,Invoice Date,Invoice Number,Group Name,External Id,Billing Frequency,Comments',
    '119793,,"Absolute Electric, Inc.",2026-May-22,Adjustment,Exchange Online (Plan 1),O365CSP-1,Adjustment - Exchange Online (Plan 1),,0,0,0,0,,-6.75,-6.75,absoluteelectric.com,,,"2026-May-22",2026-Jun-17,2026-Jun-21,4032091,,,,"Removed 2 Licenses',
    'Commerce Mode: NCE"',
    '119793,,"Absolute Electric, Inc.",2026-May-22,Adjustment,Exchange Online (Plan 1),O365CSP-1,Added Licenses,,30,28,-2,0,,,,absoluteelectric.com,,,"2026-May-22",2026-Jun-17,2026-Jun-21,4032091,,,,',
    '119793,,"Absolute Electric, Inc.",2026-Jun-17,Renewal,Exchange Online (Plan 1),O365CSP-1,Licenses,,0,0,27,4.22,1,113.94,113.94,absoluteelectric.com,,Monthly,2026-Jun-17,2026-Jul-17,2026-Jun-21,4032091,,,Monthly,Commerce Mode: NCE.',
  ].join('\n');

  const detectedVendor = detectInvoiceVendor({ fileName: 'AccountHistory.csv', content: csv });
  assert.equal(detectedVendor?.vendorId, 'opentext-appriver');
  assert.equal(detectedVendor?.confidence, 'high');

  const imported = await importAppRiverInvoiceCsv(database, {
    fileName: 'AccountHistory.csv',
    content: csv,
  });

  assert.deepEqual(
    imported satisfies InvoiceImportSummary,
    {
      id: '33333333-3333-3333-3333-333333333333',
      vendorId: 'opentext-appriver',
      fileName: 'AccountHistory.csv',
      invoiceNumber: '4032091',
      importedAt: '2026-07-01T12:00:00.000Z',
      invoiceDate: '2026-06-21',
      billingPeriodStart: '2026-05-22',
      billingPeriodEnd: '2026-07-17',
      rowCount: 3,
      matchedRows: 3,
      exceptionRows: 0,
      status: 'ready',
    },
  );
  assert.equal(insertedLines.length, 3);
  assert.equal(insertedLines[2]?.values?.[14], 27);
  assert.equal(insertedLines[2]?.values?.[21], '2026-06-17');
  assert.equal(insertedLines[0]?.values?.[20], -6.75);
  assert.match(String(insertedLines[0]?.values?.[30]), /Removed 2 Licenses\\nCommerce Mode/);

  await importAppRiverInvoiceCsv(database, {
    fileName: 'AccountHistory.csv',
    content: csv,
    importMode: 'overwrite',
  });
  assert.equal(deletedImports.length, 1);
  assert.match(deletedImports[0]?.sql ?? '', /delete from invoice_imports/);
  assert.deepEqual(deletedImports[0]?.values, [
    'opentext-appriver',
    '4032091',
    '33333333-3333-3333-3333-333333333333',
  ]);

  const fallbackInsertedImports: Array<{ sql: string; values?: unknown[] }> = [];
  const fallbackInsertedLines: Array<{ sql: string; values?: unknown[] }> = [];
  const fallbackDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('from vendor_account_mappings')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('external_customer_account_number')) {
        return {
          rows: [
            {
              external_account_id: 'app-river-api-customer-119793',
              external_customer_account_number: '119793',
              app_river_customer_id: 'app-river-api-customer-119793',
              customer_name: 'Absolute Electric',
              app_river_customer_name: 'Absolute Electric',
              domain: 'absoluteelectric.com',
              customer_id: customerId,
              agreement_id: agreementId,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return {
          rows: [
            {
              vendor_product_key: 'Exchange Online (Plan 1)|Monthly|Monthly',
              target_index: 0,
              connectwise_product_code: 'CW-EXCHANGE-P1',
              connectwise_product_name: 'Exchange Online Plan 1',
              unit_price: '4.22',
            },
          ] as T[],
        };
      }

      if (sql.includes('from target_names')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('source_product_code')) {
        return {
          rows: [
            {
              vendor_product_key: 'Exchange Online (Plan 1)|Monthly|Monthly',
              source_product_code: 'O365CSP-1',
              source_product_name: 'Exchange Online (Plan 1)',
              subscription_term: 'Monthly',
              billing_frequency: 'Monthly',
            },
          ] as T[],
        };
      }

      if (sql.includes('insert into invoice_imports')) {
        fallbackInsertedImports.push({ sql, values });
        return { rows: [{ id: '44444444-4444-4444-4444-444444444444' }] as T[] };
      }

      if (sql.includes('insert into invoice_line_items')) {
        fallbackInsertedLines.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into sync_runs') && sql.includes('returning id')) {
        return {
          rows: [
            {
              id: '77777777-7777-7777-7777-777777777777',
            },
          ] as T[],
        };
      }

      if (sql.includes('from invoice_imports') && sql.includes('where id = $1::uuid')) {
        const importValues = fallbackInsertedImports[0]?.values ?? [];
        return {
          rows: [
            {
              id: '44444444-4444-4444-4444-444444444444',
              vendor_id: 'opentext-appriver',
              file_name: importValues[1],
              invoice_number: importValues[2],
              imported_at: '2026-07-01T12:30:00Z',
              invoice_date: importValues[3],
              billing_period_start: importValues[4],
              billing_period_end: importValues[5],
              row_count: importValues[6],
              matched_rows: importValues[7],
              exception_rows: importValues[8],
              status: importValues[9],
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const fallbackImported = await importAppRiverInvoiceCsv(fallbackDatabase, {
    fileName: 'AccountHistory.csv',
    content: csv,
  });
  assert.equal(fallbackImported.matchedRows, 3);
  assert.equal(fallbackImported.exceptionRows, 0);
  assert.equal(fallbackInsertedLines[2]?.values?.[2], customerId);
  assert.equal(fallbackInsertedLines[2]?.values?.[3], agreementId);
  assert.equal(fallbackInsertedLines[2]?.values?.[10], 'CW-EXCHANGE-P1');

  const invoiceState = await loadLatestInvoiceQuantitiesForLines(database, 'opentext-appriver', [
    {
      clientId: customerId,
      agreementId,
      productCode: 'CW-EXCHANGE-P1',
    },
  ]);
  const quantity = invoiceState.quantities.get(`${customerId}|${agreementId}|CW-EXCHANGE-P1`);
  assert.equal(invoiceState.latestInvoice?.invoiceNumber, '4032091');
  assert.equal(quantity?.invoiceQuantity, 27);
  assert.equal(quantity?.invoiceLineCount, 1);

  const reviewDatabase: Queryable = {
    async query<T = unknown>(sql: string) {
      if (
        sql.includes('from invoice_imports') &&
        sql.includes('where id = $1::uuid') &&
        sql.includes('and vendor_id = $2') &&
        !sql.includes('update invoice_imports')
      ) {
        return {
          rows: [
            {
              id: '55555555-5555-5555-5555-555555555555',
              vendor_id: 'opentext-appriver',
              file_name: 'AccountHistory.csv',
              invoice_number: '4032091',
              imported_at: '2026-07-01T12:00:00Z',
              invoice_date: '2026-06-21',
              billing_period_start: '2026-05-22',
              billing_period_end: '2026-07-17',
              row_count: 2,
              matched_rows: 0,
              exception_rows: 2,
              status: 'review',
            },
          ] as T[],
        };
      }

      if (sql.includes('from invoice_line_items') && sql.includes("raw_summary->>'sourceType'")) {
        return {
          rows: [
            {
              id: 'line-account',
              raw_row_number: 7,
              external_account_id: '522801',
              external_account_name: 'Stetson Cybergroup',
              vendor_product_key: 'Exchange Online (Plan 1)|Monthly|Monthly',
              vendor_product_key_candidates: ['Exchange Online (Plan 1)|Monthly|Monthly'],
              product_code: 'O365CSP-1',
              product_name: 'Exchange Online (Plan 1)',
              connectwise_product_code: 'CW-EXCHANGE-P1',
              connectwise_product_name: 'Exchange Online Plan 1',
              charge_type: 'Renewal',
              quantity: '3',
              billed_amount: '12.66',
              term: 'Monthly',
              billing_frequency: 'Monthly',
              invoice_date: '2026-06-21',
              primary_domain: 'stetson.example',
              customer_id: null,
              agreement_id: null,
            },
            {
              id: 'line-product',
              raw_row_number: 8,
              external_account_id: '119793',
              external_account_name: 'Absolute Electric',
              vendor_product_key: 'SAT-1|Monthly|Monthly',
              vendor_product_key_candidates: ['SAT-1|Monthly|Monthly', 'Security Awareness Training|Monthly|Monthly'],
              product_code: 'SAT-1',
              product_name: 'Security Awareness Training',
              connectwise_product_code: null,
              connectwise_product_name: null,
              charge_type: 'Renewal',
              quantity: '12',
              billed_amount: '24',
              term: 'Monthly',
              billing_frequency: 'Monthly',
              invoice_date: '2026-06-21',
              primary_domain: 'absolute.example',
              customer_id: customerId,
              agreement_id: agreementId,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_account_mappings') && sql.includes('distinct on')) {
        return {
          rows: [
            {
              external_account_id: '522801',
              customer_id: customerId,
              customer_name: 'Stetson Cybergroup Inc.',
              agreement_id: agreementId,
              agreement_name: 'Stetson Monthly Services',
              mapping_status: 'approved',
              active: true,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_product_mappings') && sql.includes('vendor_product_key = any')) {
        return { rows: [] as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  const review = await getInvoiceImportExceptionReview(
    reviewDatabase,
    'opentext-appriver',
    '55555555-5555-5555-5555-555555555555',
  );
  assert.equal(review?.summary.exceptionRows, 2);
  assert.equal(review?.summary.missingAgreementRows, 1);
  assert.equal(review?.summary.missingProductRows, 1);
  assert.equal(review?.accountExceptions[0]?.externalAccountId, '522801');
  assert.equal(review?.accountExceptions[0]?.currentMapping?.agreementName, 'Stetson Monthly Services');
  assert.equal(review?.productExceptions[0]?.vendorProductKey, 'SAT-1|Monthly|Monthly');
  assert.equal(review?.productExceptions[0]?.quantity, 12);

  const refreshQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const refreshDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      refreshQueries.push({ sql, values });
      if (
        sql.includes('from invoice_imports') &&
        sql.includes('where id = $1::uuid') &&
        sql.includes('and vendor_id = $2') &&
        !sql.includes('update invoice_imports')
      ) {
        return {
          rows: [
            {
              id: '55555555-5555-5555-5555-555555555555',
              vendor_id: 'opentext-appriver',
              file_name: 'AccountHistory.csv',
              invoice_number: '4032091',
              imported_at: '2026-07-01T12:00:00Z',
              invoice_date: '2026-06-21',
              billing_period_start: '2026-05-22',
              billing_period_end: '2026-07-17',
              row_count: 2,
              matched_rows: 0,
              exception_rows: 2,
              status: 'review',
            },
          ] as T[],
        };
      }

      if (sql.includes('update invoice_line_items') && sql.includes('vendor_account_mappings')) {
        return { rows: [{ updated_count: 1 }] as T[] };
      }

      if (sql.includes('update invoice_line_items') && sql.includes('approved_product_mappings')) {
        return { rows: [{ updated_count: 1 }] as T[] };
      }

      if (sql.includes('update invoice_imports') && sql.includes('returning invoice_imports.id')) {
        return {
          rows: [
            {
              id: '55555555-5555-5555-5555-555555555555',
              vendor_id: 'opentext-appriver',
              file_name: 'AccountHistory.csv',
              invoice_number: '4032091',
              imported_at: '2026-07-01T12:00:00Z',
              invoice_date: '2026-06-21',
              billing_period_start: '2026-05-22',
              billing_period_end: '2026-07-17',
              row_count: 2,
              matched_rows: 2,
              exception_rows: 0,
              status: 'ready',
            },
          ] as T[],
        };
      }

      if (sql.includes('insert into sync_runs') && sql.includes('returning id')) {
        return {
          rows: [
            {
              id: '66666666-6666-6666-6666-666666666666',
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  const refresh = await refreshInvoiceImportMappings(
    refreshDatabase,
    'opentext-appriver',
    '55555555-5555-5555-5555-555555555555',
  );
  assert.equal(refresh?.accountRowsUpdated, 1);
  assert.equal(refresh?.productRowsUpdated, 1);
  assert.equal(refresh?.import.status, 'ready');
  const refreshAccountQuery = refreshQueries.find((query) => query.sql.includes('approved_account_mapping_keys'));
  assert.equal(refreshAccountQuery?.sql.includes("dimensions->>'externalCustomerAccountNumber'"), true);
  assert.equal(refreshAccountQuery?.values?.[2], 'opentext-appriver');

  const totalInvoiceImports: Array<{ sql: string; values?: unknown[] }> = [];
  const totalInvoiceLines: Array<{ sql: string; values?: unknown[] }> = [];
  const totalInvoiceSyncQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const totalInvoiceDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('from vendor_account_mappings')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return {
          rows: [
            {
              vendor_product_key: 'HUNTRESS-MDR',
              target_index: 0,
              connectwise_product_code: 'CW-HUNTRESS-MDR',
              connectwise_product_name: 'Huntress MDR',
            },
          ] as T[],
        };
      }

      if (sql.includes('insert into invoice_imports')) {
        totalInvoiceImports.push({ sql, values });
        return { rows: [{ id: '88888888-8888-8888-8888-888888888888' }] as T[] };
      }

      if (sql.includes('insert into invoice_line_items')) {
        totalInvoiceLines.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into sync_runs') && sql.includes('returning id')) {
        return { rows: [{ id: '99999999-9999-9999-9999-999999999999' }] as T[] };
      }

      if (sql.includes('delete from vendor_usage_snapshots') || sql.includes('insert into vendor_usage_snapshots')) {
        totalInvoiceSyncQueries.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('update sync_runs')) {
        totalInvoiceSyncQueries.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('from invoice_imports') && sql.includes('where id = $1::uuid')) {
        const importValues = totalInvoiceImports[0]?.values ?? [];
        return {
          rows: [
            {
              id: '88888888-8888-8888-8888-888888888888',
              vendor_id: 'huntress',
              file_name: importValues[1],
              invoice_number: importValues[2],
              imported_at: '2026-07-02T12:00:00Z',
              invoice_date: importValues[3],
              billing_period_start: importValues[4],
              billing_period_end: importValues[5],
              row_count: importValues[6],
              matched_rows: importValues[7],
              exception_rows: importValues[8],
              status: importValues[9],
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const totalInvoice = await importMappedInvoiceTableCsv(totalInvoiceDatabase, {
    vendorId: 'huntress',
    fileName: 'Huntress Total Invoice.csv',
    content: [
      'SKU,Product,Qty,Invoice Number,Invoice Date,Amount',
      'HUNTRESS-MDR,Huntress MDR,42,H-1001,2026-07-01,1260',
    ].join('\n'),
    columnMap: {
      productCode: 'SKU',
      productName: 'Product',
      quantity: 'Qty',
      invoiceNumber: 'Invoice Number',
      invoiceDate: 'Invoice Date',
      billedAmount: 'Amount',
    },
    sourceType: 'reseller-product-total',
  });

  assert.equal(totalInvoice.vendorId, 'huntress');
  assert.equal(totalInvoice.status, 'ready');
  assert.equal(totalInvoice.matchedRows, 1);
  assert.equal(totalInvoice.exceptionRows, 0);
  assert.equal(totalInvoiceLines[0]?.values?.[2], null);
  assert.equal(totalInvoiceLines[0]?.values?.[3], null);
  assert.equal(totalInvoiceLines[0]?.values?.[10], 'CW-HUNTRESS-MDR');
  assert.equal(JSON.parse(String(totalInvoiceImports[0]?.values?.[10])).sourceType, 'reseller-product-total');
  assert.equal(
    totalInvoiceSyncQueries.some((query) =>
      query.sql.includes("raw_summary->>'sourceType'") && query.sql.includes("'reseller-product-total'"),
    ),
    true,
  );

  console.log('AppRiver invoice import tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
