import assert from 'node:assert/strict';
import { getAgreementReportDetails, listAgreementReportSyncRuns, mapAgreementReportDetailRow } from './agreementReports';

const rawPayload = {
  Company: 'Acme Co',
  Agreement: 'Acme Monthly Services',
  ProductName: 'Managed Endpoint Protection',
  id: 3401,
  product: {
    id: 1350,
    identifier: 'Managed Endpoint Protection',
    description: 'Managed Endpoint Protection',
  },
  quantity: 24,
  lessIncluded: 0,
  unitPrice: 14.95,
  unitCost: 4,
  billCustomer: 'Billable',
  effectiveDate: '2025-11-01T00:00:00Z',
  taxableFlag: true,
  invoiceDescription: 'Managed Endpoint Protection',
  purchaseItemFlag: false,
  specialOrderFlag: false,
  agreementId: 314,
  description: 'Managed Endpoint Protection',
  billedQuantity: 24,
  uom: 'Each',
  extPrice: 358.8,
  extCost: 96,
  sequenceNumber: 8,
  margin: 262.8,
  prorateCost: 0,
  proratePrice: 0,
  extendedProrateCost: 0,
  extendedProratePrice: 0,
  prorateCurrentPeriodFlag: false,
  agreementStatus: 'Active',
  additionStatus: 'Active',
  _info: {
    lastUpdated: '2026-06-08T10:00:00Z',
  },
};

async function run() {
  const mapped = mapAgreementReportDetailRow({
    company_name: 'Fallback Company',
    agreement_name: 'Fallback Agreement',
    connectwise_agreement_id: '314',
    connectwise_addition_id: '3401',
    product_code: 'Fallback Product',
    product_name: 'Fallback Product Name',
    observed_quantity: '24',
    unit_price: '14.95',
    raw_payload: rawPayload,
  });

  assert.equal(mapped.Company, 'Acme Co');
  assert.equal(mapped.Agreement, 'Acme Monthly Services');
  assert.equal(mapped.ProductName, 'Managed Endpoint Protection');
  assert.equal(mapped.quantity, 24);
  assert.equal(mapped.unitPrice, 14.95);
  assert.equal(mapped.additionStatus, 'Active');
  assert.equal(mapped._info, '2026-06-08T10:00:00Z');

  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('from sync_runs') && sql.includes('order by started_at')) {
        return {
          rows: [
            {
              id: 'sync-1',
              started_at: new Date('2026-06-15T12:00:00Z'),
              completed_at: new Date('2026-06-15T12:02:00Z'),
              status: 'complete',
              records_read: 1,
              records_written: 1,
              error_message: null,
              metadata: { entity: 'agreement-report', additionsWritten: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from sync_runs') && sql.includes('where id = $1')) {
        return {
          rows: [
            {
              id: 'sync-1',
              started_at: new Date('2026-06-15T12:00:00Z'),
              completed_at: new Date('2026-06-15T12:02:00Z'),
              status: 'complete',
              records_read: 1,
              records_written: 1,
              error_message: null,
              metadata: { entity: 'agreement-report', additionsWritten: 1 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from addition_history')) {
        return {
          rows: [
            {
              company_name: 'Acme Co',
              agreement_name: 'Acme Monthly Services',
              connectwise_agreement_id: '314',
              connectwise_addition_id: '3401',
              product_code: 'Managed Endpoint Protection',
              product_name: 'Managed Endpoint Protection',
              observed_quantity: '24',
              unit_price: '14.95',
              raw_payload: rawPayload,
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const runs = await listAgreementReportSyncRuns(database);
  assert.equal(runs[0]?.id, 'sync-1');
  assert.equal(runs[0]?.metadata.additionsWritten, 1);

  const details = await getAgreementReportDetails(database, 'sync-1');
  assert.equal(details?.summary.rowCount, 1);
  assert.equal(details?.summary.companyCount, 1);
  assert.equal(details?.rows[0]?.ProductName, 'Managed Endpoint Protection');
  assert.equal(queries[queries.length - 1]?.values?.[0], 'sync-1');

  console.log('agreement report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
