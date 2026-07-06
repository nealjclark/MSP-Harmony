import assert from 'node:assert/strict';
import { listActiveAgreementAdditions, reconcileVendorFromDatabase } from './reconciliationRuns';
import type { Queryable } from '../vendor/cove/operations';

const syncRunId = '00000000-0000-0000-0000-000000000001';
const queries: Array<{ sql: string; values?: unknown[] }> = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-1',
            vendor_id: 'cove',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            vendor_product_key: 'cove-server',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            observed_at: new Date('2026-06-15T12:00:00Z'),
            dimensions: {
              protectedSystemType: 'server',
              selectedStorageGb: 1135,
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions') && sql.includes('connectwise_addition_id')) {
      return {
        rows: [
          {
            id: 'addition-server',
            connectwise_addition_id: 'cw-addition-1',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120.50',
            addition_status: 'Active',
            updated_at: new Date('2026-06-15T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-server',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120',
            updated_at: new Date('2026-06-15T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  const result = await reconcileVendorFromDatabase(database, 'cove', { syncRunId });
  const addOnLine = result.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
  assert.equal(result.syncRunId, syncRunId);
  assert.equal(addOnLine?.status, 'needs-review');
  assert.equal(addOnLine?.writeAction, 'create-addition');
  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_snapshots')), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_account_mappings')), true);
  assert.equal(queries.some((query) => query.sql.includes('approved_product_mappings')), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_overrides')), true);
  assert.equal(queries.some((query) => query.sql.includes('agreement_additions')), true);
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes("agreement_additions.raw_payload->>'additionStatus'") &&
        query.sql.includes("agreement_additions.raw_payload->>'agreementStatus'") &&
        query.sql.includes('inner join agreements'),
    ),
    true,
  );

  const activeAdditions = await listActiveAgreementAdditions(database, '22222222-2222-2222-2222-222222222222');
  assert.equal(activeAdditions[0]?.connectWiseAdditionId, 'cw-addition-1');
  assert.equal(activeAdditions[0]?.unitPrice?.amount, 120.5);
  assert.equal(activeAdditions[0]?.additionStatus, 'Active');
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes('connectwise_addition_id') &&
        query.sql.includes("agreement_additions.raw_payload->>'additionStatus'") &&
        query.sql.includes('where agreement_additions.agreement_id = $1::uuid'),
    ),
    true,
  );

  const overrideResult = await reconcileVendorFromDatabase(overrideDatabase, 'cove', { syncRunId });
  const serverLine = overrideResult.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
  assert.equal(serverLine?.status, 'matched');
  assert.equal(serverLine?.sourceQuantity, 1);
  assert.equal(serverLine?.agreementQuantity, 1);

  const annualAgreementResult = await reconcileVendorFromDatabase(crossAgreementDatabase, 'cove', { syncRunId });
  const annualAgreementLine = annualAgreementResult.lines.find((line) => line.productCode === 'COVE-SERVER');
  assert.equal(annualAgreementLine?.status, 'matched');
  assert.equal(annualAgreementLine?.sourceQuantity, 1);
  assert.equal(annualAgreementLine?.agreementQuantity, 1);
  assert.equal(annualAgreementLine?.agreementId, '22222222-2222-2222-2222-222222222222');
  assert.equal(annualAgreementLine?.matchedAgreementAdditions[0]?.agreementId, '33333333-3333-3333-3333-333333333333');
  assert.equal(annualAgreementLine?.matchedAgreementAdditions[0]?.agreementName, 'Botta Annual Agreement');
  assert.equal(
    crossAgreementQueries.some(
      (query) =>
        query.sql.includes('agreement_additions.customer_id = any($1::uuid[])') &&
        Array.isArray(query.values?.[0]) &&
        query.values[0].includes('11111111-1111-1111-1111-111111111111'),
    ),
    true,
  );

  const appRiverBundleResult = await reconcileVendorFromDatabase(appRiverBundleDatabase, 'opentext-appriver', { syncRunId });
  const bundleLine = appRiverBundleResult.lines.find((line) => line.productCode === 'CW-ZIX-ADVANCED');
  assert.equal(bundleLine?.sourceQuantity, 10);
  assert.equal(bundleLine?.agreementQuantity, 8);
  assert.equal(bundleLine?.proposedQuantity, 10);
  assert.equal(bundleLine?.delta, 2);
  assert.equal(bundleLine?.devices.length, 1);
  assert.equal(bundleLine?.devices[0]?.vendorProductKey, 'zix-advanced-email-suite');
  assert.equal(bundleLine?.devices[0]?.dimensions.appRiverBundle, true);
  assert.equal(appRiverBundleResult.snapshotCount, 1);

  const appRiverBundleWithoutAdditionResult = await reconcileVendorFromDatabase(appRiverBundleWithoutAdditionDatabase, 'opentext-appriver', { syncRunId });
  const bundleLineWithoutAddition = appRiverBundleWithoutAdditionResult.lines.find((line) => line.productCode === 'CW-ZIX-ADVANCED');
  assert.equal(bundleLineWithoutAddition, undefined);
  assert.equal(appRiverBundleWithoutAdditionResult.snapshotCount, 2);

  const appRiverAliasResult = await reconcileVendorFromDatabase(appRiverAliasDatabase, 'opentext-appriver', { syncRunId });
  const standardLine = appRiverAliasResult.lines.find((line) => line.productCode === 'Microsoft 365 Business Standard-M');
  assert.equal(standardLine?.sourceQuantity, 6);
  assert.equal(standardLine?.agreementQuantity, 6);
  assert.equal(standardLine?.status, 'matched');
  assert.equal(standardLine?.devices[0]?.vendorProductKey, 'Microsoft 365 Business Standard|Monthly|Monthly');

  const appRiverInvoiceResult = await reconcileVendorFromDatabase(appRiverInvoiceDatabase, 'opentext-appriver', { syncRunId });
  const invoicedLine = appRiverInvoiceResult.lines.find((line) => line.productCode === 'Microsoft 365 Business Standard-M');
  assert.equal(invoicedLine?.sourceQuantity, 6);
  assert.equal(invoicedLine?.agreementQuantity, 5);
  assert.equal(invoicedLine?.delta, 1);
  assert.equal(invoicedLine?.status, 'needs-review');
  assert.equal(invoicedLine?.invoiceQuantity, 4);
  assert.equal(invoicedLine?.invoiceLineCount, 2);
  assert.equal(invoicedLine?.invoiceNumber, '4032091');
  assert.equal(appRiverInvoiceResult.latestInvoice?.invoiceNumber, '4032091');

  const appRiverUnmappedResult = await reconcileVendorFromDatabase(appRiverUnmappedProductDatabase, 'opentext-appriver', { syncRunId });
  const unmappedE5Line = appRiverUnmappedResult.lines.find((line) => line.status === 'unmapped');
  assert.equal(unmappedE5Line?.productCode, 'MICROSOFT-365-E5-NO-TEAMS-MONTHLY-MONTHLY');
  assert.equal(unmappedE5Line?.productName, 'Microsoft 365 E5 (no Teams)');
  assert.equal(unmappedE5Line?.sourceQuantity, 1);
  assert.equal(unmappedE5Line?.agreementQuantity, 0);
  assert.equal(unmappedE5Line?.devices.length, 1);
  assert.equal(unmappedE5Line?.devices[0]?.vendorProductKey, 'Microsoft 365 E5 (no Teams)|Monthly|Monthly');
  assert.equal(appRiverUnmappedResult.totals.unmapped, 1);

  const appRiverLinkedResult = await reconcileVendorFromDatabase(appRiverLinkedMicrosoftDatabase, 'opentext-appriver', { syncRunId });
  const linkedStandardLine = appRiverLinkedResult.lines.find((line) => line.productCode === 'Microsoft 365 Business Standard-M');
  assert.equal(linkedStandardLine?.sourceQuantity, 0);
  assert.equal(linkedStandardLine?.linkedCount?.quantity, 12);
  assert.equal(linkedStandardLine?.proposedQuantity, 12);
  assert.equal(linkedStandardLine?.agreementQuantity, 10);
  assert.equal(linkedStandardLine?.delta, 2);
  assert.equal(linkedStandardLine?.status, 'needs-review');
  assert.equal(linkedStandardLine?.writeAction, 'update-addition');
  assert.equal(linkedStandardLine?.linkedCount?.sources.length, 2);
  assert.equal(linkedStandardLine?.devices[0]?.dimensions.linkedCountAnchor, true);
  assert.equal(appRiverLinkedResult.lines.some((line) => line.lineType === 'unmapped-vendor'), false);

  appRiverLinkedFilteredMicrosoftQueries.splice(0, appRiverLinkedFilteredMicrosoftQueries.length);
  const appRiverFilteredLinkedResult = await reconcileVendorFromDatabase(appRiverLinkedFilteredMicrosoftDatabase, 'opentext-appriver', { syncRunId });
  const linkedThreatLine = appRiverFilteredLinkedResult.lines.find((line) => line.productCode === 'EMAIL-THREAT-PROTECTION');
  assert.equal(linkedThreatLine?.sourceQuantity, 0);
  assert.equal(linkedThreatLine?.linkedCount?.quantity, 2);
  assert.equal(linkedThreatLine?.linkedCount?.sources[0]?.sourceType, 'filtered-dataset');
  assert.equal(linkedThreatLine?.linkedCount?.sources[0]?.rowCount, 2);
  assert.equal(
    appRiverLinkedFilteredMicrosoftQueries.some((query) =>
      query.sql.includes('deduped_rows') && query.sql.includes('dedupe_key'),
    ),
    true,
  );
  assert.equal(linkedThreatLine?.proposedQuantity, 2);
  assert.equal(linkedThreatLine?.agreementQuantity, 1);
  assert.equal(linkedThreatLine?.delta, 1);
  assert.equal(appRiverFilteredLinkedResult.lines.some((line) => line.lineType === 'unmapped-vendor'), false);

  const huntressLinkedResult = await reconcileVendorFromDatabase(huntressLinkedConnectWiseDatabase, 'huntress', { syncRunId });
  const huntressLine = huntressLinkedResult.lines.find((line) => line.productCode === 'HUNTRESS');
  assert.equal(huntressLine?.sourceQuantity, 0);
  assert.equal(huntressLine?.linkedCount?.quantity, 9);
  assert.equal(huntressLine?.proposedQuantity, 9);
  assert.equal(huntressLine?.agreementQuantity, 8);
  assert.equal(huntressLine?.delta, 1);
  assert.equal(huntressLine?.linkedCount?.sources[0]?.sourceType, 'connectwise-addition');

  console.log('database reconciliation tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

const overrideDatabase: Queryable = {
  async query<T = unknown>(sql: string) {
    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-override',
            vendor_id: 'cove',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            vendor_product_key: 'cove-workstation',
            product_code: 'COVE-WORKSTATION',
            product_name: 'Cove Workstation Backup',
            quantity: '1',
            observed_at: new Date('2026-06-15T12:00:00Z'),
            dimensions: {
              protectedSystemType: 'workstation',
              selectedStorageGb: 100,
              hostname: 'server-counted-as-pc',
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return {
        rows: [
          {
            id: 'override-1',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            source_vendor_product_key: 'cove-workstation',
            target_vendor_product_key: 'cove-server',
            target_product_code: null,
            target_product_name: null,
            dimension_filters: {},
            target_dimensions: {},
            reason: 'Count this protected system as a server for billing.',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-server',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120',
            updated_at: new Date('2026-06-15T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

const crossAgreementQueries: Array<{ sql: string; values?: unknown[] }> = [];
const crossAgreementDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    crossAgreementQueries.push({ sql, values });

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-cross-agreement',
            vendor_id: 'cove',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            vendor_product_key: 'cove-server',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            observed_at: new Date('2026-06-15T12:00:00Z'),
            dimensions: {
              protectedSystemType: 'server',
              selectedStorageGb: 300,
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-annual-server',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '33333333-3333-3333-3333-333333333333',
            source_agreement_name: 'Botta Annual Agreement',
            source_connectwise_agreement_id: '9900',
            connectwise_addition_id: 'cw-annual-server',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120',
            addition_status: 'Active',
            updated_at: new Date('2026-06-15T12:00:00Z'),
            raw_payload: {},
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreements')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            customer_name: 'Botta Sferrazza',
            connectwise_company_id: 'BOTTA',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            agreement_name: 'Botta Monthly Services',
            connectwise_agreement_id: '8800',
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

const appRiverBundleDatabase: Queryable = {
  async query<T = unknown>(sql: string) {
    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-archive',
            vendor_id: 'opentext-appriver',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            external_account_id: 'appriver-customer-1',
            vendor_product_key: 'Email Archiving|Monthly|Monthly',
            product_code: 'EMAIL-ARCHIVING-MONTHLY-MONTHLY',
            product_name: 'Email Archiving',
            quantity: '10',
            observed_at: new Date('2026-06-24T12:00:00Z'),
            dimensions: {
              subscriptionSource: 'appriver-securecloud-subscription',
              appRiverCustomerId: 'appriver-customer-1',
            },
          },
          {
            id: 'snapshot-threat',
            vendor_id: 'opentext-appriver',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            external_account_id: 'appriver-customer-1',
            vendor_product_key: 'Email Threat Protection|Monthly|Monthly',
            product_code: 'EMAIL-THREAT-PROTECTION-MONTHLY-MONTHLY',
            product_name: 'Email Threat Protection',
            quantity: '0',
            observed_at: new Date('2026-06-24T12:00:00Z'),
            dimensions: {
              subscriptionSource: 'appriver-securecloud-subscription',
              appRiverCustomerId: 'appriver-customer-1',
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_product_bundles')) {
      return {
        rows: [
          {
            id: 'bundle-1',
            vendor_id: 'opentext-appriver',
            bundle_key: 'zix-advanced-email-suite',
            bundle_name: 'Zix Advanced Email Suite',
            components: [
              {
                vendorProductKey: 'Email Archiving|Monthly|Monthly',
                vendorProductName: 'Email Archiving',
              },
              {
                vendorProductKey: 'Email Threat Protection|Monthly|Monthly',
                vendorProductName: 'Email Threat Protection',
              },
            ],
            connectwise_product_code: 'CW-ZIX-ADVANCED',
            connectwise_product_name: 'Zix Advanced Email Suite',
            unit_price: '7.5',
            quantity_strategy: 'max-component-quantity',
            mapping_status: 'approved',
            active: true,
            reviewed_by: 'reviewer@example.com',
            reviewed_at: '2026-06-24T12:00:00.000Z',
            created_at: '2026-06-24T12:00:00.000Z',
            updated_at: '2026-06-24T12:00:00.000Z',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from target_names')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-zix',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'CW-ZIX-ADVANCED',
            product_name: 'Zix Advanced Email Suite',
            quantity: '8',
            unit_price: '7.5',
            updated_at: new Date('2026-06-24T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

const appRiverBundleWithoutAdditionDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('from agreement_additions')) {
      return { rows: [] as T[] };
    }

    return appRiverBundleDatabase.query<T>(sql, values);
  },
};

const appRiverAliasDatabase: Queryable = {
  async query<T = unknown>(sql: string) {
    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-business-standard',
            vendor_id: 'opentext-appriver',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            external_account_id: 'appriver-customer-healthcare',
            vendor_product_key: 'Microsoft 365 Business Standard|Monthly|Monthly',
            product_code: 'MICROSOFT-365-BUSINESS-STANDARD-MONTHLY-MONTHLY',
            product_name: 'Microsoft 365 Business Standard',
            quantity: '6',
            observed_at: new Date('2026-06-24T12:00:00Z'),
            dimensions: {
              subscriptionSource: 'appriver-securecloud-subscription',
              appRiverCustomerId: 'appriver-customer-healthcare',
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return {
        rows: [
          {
            vendor_product_key: 'Microsoft 365 Business Standard (T)|Monthly|Monthly',
            target_index: 0,
            connectwise_product_code: 'Microsoft 365 Business Standard-M',
            connectwise_product_name: 'Microsoft 365 Business Standard-M',
            unit_price: '14',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_bundles')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-business-standard',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'Microsoft 365 Business Standard-M',
            product_name: 'Microsoft 365 Business Standard-M',
            quantity: '6',
            unit_price: '14',
            updated_at: new Date('2026-06-24T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

const appRiverInvoiceDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
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
            billing_period_start: '2026-06-01',
            billing_period_end: '2026-07-01',
            row_count: 12,
            matched_rows: 10,
            exception_rows: 2,
            status: 'review',
          },
        ] as T[],
      };
    }

    if (sql.includes('from invoice_line_items') && sql.includes("charge_type = 'Renewal'")) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            connectwise_product_code: 'Microsoft 365 Business Standard-M',
            invoice_quantity: '4',
            invoice_line_count: '2',
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-business-standard',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'Microsoft 365 Business Standard-M',
            product_name: 'Microsoft 365 Business Standard-M',
            quantity: '5',
            unit_price: '14',
            updated_at: new Date('2026-06-24T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return appRiverAliasDatabase.query<T>(sql);
  },
};

const appRiverUnmappedProductDatabase: Queryable = {
  async query<T = unknown>(sql: string) {
    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-e5-no-teams',
            vendor_id: 'opentext-appriver',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            external_account_id: 'appriver-building-trades',
            vendor_product_key: 'Microsoft 365 E5 (no Teams)|Monthly|Monthly',
            product_code: 'MICROSOFT-365-E5-NO-TEAMS-MONTHLY-MONTHLY',
            product_name: 'Microsoft 365 E5 (no Teams)',
            quantity: '1',
            observed_at: new Date('2026-07-01T14:43:10.943Z'),
            dimensions: {
              subscriptionSource: 'appriver-securecloud-subscription',
              appRiverCustomerId: 'appriver-building-trades',
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return {
        rows: [
          {
            vendor_product_key: 'Microsoft 365 E5|Monthly|Monthly',
            target_index: 0,
            connectwise_product_code: 'Microsoft 365 E5-M',
            connectwise_product_name: 'Microsoft 365 E5 - Monthly',
            unit_price: '73.08',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_bundles')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-e5',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'Microsoft 365 E5-M',
            product_name: 'Microsoft 365 E5 - Monthly',
            quantity: '1',
            unit_price: '73.08',
            updated_at: new Date('2026-07-01T05:53:26.629Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from invoice_imports')) {
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  },
};

const appRiverLinkedMicrosoftDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('from vendor_product_link_rules')) {
      return {
        rows: [
          {
            id: 'link-rule-appriver-m365',
            vendor_id: 'opentext-appriver',
            source_vendor_product_key: 'Microsoft 365 Business Standard|Monthly|Monthly',
            rule_name: 'Business Standard follows Exchange-capable Microsoft licenses',
            sources: [
              {
                sourceType: 'vendor-product',
                vendorId: 'microsoft-365',
                vendorProductKey: 'exchange-online-plan-1',
                vendorProductName: 'Exchange Online Plan 1',
              },
              {
                sourceType: 'vendor-product',
                vendorId: 'microsoft-365',
                vendorProductKey: 'microsoft-365-business-standard',
                vendorProductName: 'Microsoft 365 Business Standard',
              },
            ],
            mapping_status: 'approved',
            active: true,
            reviewed_by: 'reviewer@example.com',
            reviewed_at: '2026-07-01T12:00:00Z',
            created_at: '2026-07-01T12:00:00Z',
            updated_at: '2026-07-01T12:00:00Z',
          },
        ] as T[],
      };
    }

    if (sql.includes('from deduped_rows') && sql.includes('vendor_usage_snapshots.vendor_id = $1') && values?.[0] === 'microsoft-365') {
      const quantity = values?.[1] === 'exchange-online-plan-1' ? '7' : '5';
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            quantity,
            row_count: quantity,
            observed_at: new Date('2026-07-01T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_snapshots') && values?.[0] === 'opentext-appriver') {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_product_mappings') && values?.[0] === 'opentext-appriver') {
      return {
        rows: [
          {
            vendor_product_key: 'Microsoft 365 Business Standard|Monthly|Monthly',
            target_index: 0,
            connectwise_product_code: 'Microsoft 365 Business Standard-M',
            connectwise_product_name: 'Microsoft 365 Business Standard-M',
            unit_price: '14',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_bundles')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from target_names')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('select distinct') && sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-business-standard-linked',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            connectwise_addition_id: 'cw-business-standard-linked',
            product_code: 'Microsoft 365 Business Standard-M',
            product_name: 'Microsoft 365 Business Standard-M',
            quantity: '10',
            unit_price: '14',
            addition_status: 'Active',
            updated_at: new Date('2026-07-01T12:00:00Z'),
            raw_payload: {},
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreements') && sql.includes('inner join customers')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            customer_name: 'Linked Legal',
            connectwise_company_id: 'LINKED',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            agreement_name: 'Linked Legal Monthly Services',
            connectwise_agreement_id: '8800',
          },
        ] as T[],
      };
    }

    if (sql.includes('from invoice_imports') || sql.includes('from invoice_line_items')) {
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  },
};

const appRiverLinkedFilteredMicrosoftQueries: Array<{ sql: string; values?: unknown[] }> = [];
const appRiverLinkedFilteredMicrosoftDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    appRiverLinkedFilteredMicrosoftQueries.push({ sql, values });

    if (sql.includes('from vendor_product_link_rules')) {
      return {
        rows: [
          {
            id: 'link-rule-appriver-filtered-m365',
            vendor_id: 'opentext-appriver',
            source_vendor_product_key: 'Email Threat Protection|Monthly|Monthly',
            rule_name: 'Email Threat Protection follows Business license rows',
            sources: [
              {
                sourceType: 'filtered-dataset',
                vendorId: 'microsoft-365',
                dataset: 'licenses',
                label: 'Microsoft Business license rows',
                aggregation: { type: 'row-count' },
                filter: {
                  nodeType: 'group',
                  operator: 'or',
                  children: [
                    {
                      nodeType: 'condition',
                      field: 'LicenseName',
                      operator: 'contains',
                      value: 'Microsoft 365 Business',
                    },
                    {
                      nodeType: 'condition',
                      field: 'LicenseName',
                      operator: 'contains',
                      value: 'Office 365',
                    },
                  ],
                },
              },
            ],
            mapping_status: 'approved',
            active: true,
            reviewed_by: 'reviewer@example.com',
            reviewed_at: '2026-07-01T12:00:00Z',
            created_at: '2026-07-01T12:00:00Z',
            updated_at: '2026-07-01T12:00:00Z',
          },
        ] as T[],
      };
    }

    if (sql.includes('from microsoft365_subscription_snapshots')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            quantity: '2',
            row_count: '2',
            observed_at: new Date('2026-07-01T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_snapshots') && values?.[0] === 'opentext-appriver') {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_product_mappings') && values?.[0] === 'opentext-appriver') {
      return {
        rows: [
          {
            vendor_product_key: 'Email Threat Protection|Monthly|Monthly',
            target_index: 0,
            connectwise_product_code: 'EMAIL-THREAT-PROTECTION',
            connectwise_product_name: 'Email Threat Protection',
            unit_price: '5',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_bundles')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from target_names')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('select distinct') && sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-email-threat-protection',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            connectwise_addition_id: 'cw-email-threat-protection',
            product_code: 'EMAIL-THREAT-PROTECTION',
            product_name: 'Email Threat Protection',
            quantity: '1',
            unit_price: '5',
            addition_status: 'Active',
            updated_at: new Date('2026-07-01T12:00:00Z'),
            raw_payload: {},
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreements') && sql.includes('inner join customers')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            customer_name: 'Linked Legal',
            connectwise_company_id: 'LINKED',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            agreement_name: 'Linked Legal Monthly Services',
            connectwise_agreement_id: '8800',
          },
        ] as T[],
      };
    }

    if (sql.includes('from invoice_imports') || sql.includes('from invoice_line_items')) {
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  },
};

const huntressLinkedConnectWiseDatabase: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('from vendor_product_link_rules')) {
      return {
        rows: [
          {
            id: 'link-rule-huntress-sync',
            vendor_id: 'huntress',
            source_vendor_product_key: 'huntress-agent',
            rule_name: 'Huntress follows sync product',
            sources: [
              {
                sourceType: 'connectwise-addition',
                productCode: 'HUNTRESS-SYNC',
                productName: 'Huntress Sync',
              },
            ],
            mapping_status: 'approved',
            active: true,
            reviewed_by: 'reviewer@example.com',
            reviewed_at: '2026-07-01T12:00:00Z',
            created_at: '2026-07-01T12:00:00Z',
            updated_at: '2026-07-01T12:00:00Z',
          },
        ] as T[],
      };
    }

    if (sql.includes('sum(agreement_additions.quantity)') && values?.[0] === 'HUNTRESS-SYNC') {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            quantity: '9',
            row_count: '1',
            observed_at: new Date('2026-07-01T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_snapshots') && values?.[0] === 'huntress') {
      return { rows: [] as T[] };
    }

    if (sql.includes('from vendor_product_mappings') && values?.[0] === 'huntress') {
      return {
        rows: [
          {
            vendor_product_key: 'huntress-agent',
            target_index: 0,
            connectwise_product_code: 'HUNTRESS',
            connectwise_product_name: 'Huntress Managed EDR',
            unit_price: '5',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('select distinct') && sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-huntress',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            connectwise_addition_id: 'cw-huntress',
            product_code: 'HUNTRESS',
            product_name: 'Huntress Managed EDR',
            quantity: '8',
            unit_price: '5',
            addition_status: 'Active',
            updated_at: new Date('2026-07-01T12:00:00Z'),
            raw_payload: {},
          },
        ] as T[],
      };
    }

    if (sql.includes('from agreements') && sql.includes('inner join customers')) {
      return {
        rows: [
          {
            customer_id: '11111111-1111-1111-1111-111111111111',
            customer_name: 'Managed Security Co',
            connectwise_company_id: 'SECURITY',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            agreement_name: 'Managed Security Monthly Services',
            connectwise_agreement_id: '9900',
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};
