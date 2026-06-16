import assert from 'node:assert/strict';
import {
  applyReconciliationAdjustments,
  createReconciliationAdjustment,
  loadReconciliationAdjustments,
} from './reconciliationAdjustments';
import type { Queryable } from '../vendor/cove/operations';
import type { ReconciliationLine } from '../shared/types';

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into vendor_reconciliation_adjustments')) {
      return {
        rows: [
          {
            id: 'adjustment-1',
            vendor_id: values?.[0],
            customer_id: values?.[1],
            agreement_id: values?.[2],
            product_code: values?.[3],
            product_name: values?.[4],
            line_type: values?.[5],
            adjustment_type: values?.[6],
            quantity: values?.[7],
            reason: values?.[8],
            active: true,
            reviewed_by: values?.[9],
            reviewed_at: new Date('2026-06-16T12:00:00Z'),
            created_at: new Date('2026-06-16T12:00:00Z'),
            updated_at: new Date('2026-06-16T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_reconciliation_adjustments')) {
      return {
        rows: [
          {
            id: 'adjustment-1',
            vendor_id: 'cove',
            customer_id: 'customer-1',
            agreement_id: 'agreement-1',
            product_code: 'COVE-WORKSTATION',
            product_name: 'Cove Workstation Backup',
            line_type: 'base-count',
            adjustment_type: 'less-count',
            quantity: '2',
            reason: 'Included at no charge.',
            active: true,
            reviewed_by: 'frontend',
            reviewed_at: new Date('2026-06-16T12:00:00Z'),
            created_at: new Date('2026-06-16T12:00:00Z'),
            updated_at: new Date('2026-06-16T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

const line: ReconciliationLine = {
  id: 'customer-1|agreement-1|COVE-WORKSTATION|base',
  vendorId: 'cove',
  clientId: 'customer-1',
  agreementId: 'agreement-1',
  productCode: 'COVE-WORKSTATION',
  productName: 'Cove Workstation Backup',
  lineType: 'base-count',
  ruleId: 'cove-workstation-count',
  sourceQuantity: 10,
  agreementQuantity: 10,
  proposedQuantity: 10,
  delta: 0,
  unit: 'workstation',
  unitPrice: { amount: 15, currency: 'USD' },
  financialImpact: { amount: 0, currency: 'USD' },
  status: 'matched',
  reason: 'Counts match.',
  evidence: [],
};

async function run() {
  const created = await createReconciliationAdjustment(database, 'cove', {
    customerId: 'customer-1',
    agreementId: 'agreement-1',
    productCode: 'COVE-WORKSTATION',
    productName: 'Cove Workstation Backup',
    lineType: 'base-count',
    adjustmentType: 'less-count',
    quantity: 2,
    reason: 'Included at no charge.',
    reviewedBy: 'frontend',
  });
  assert.equal(created.quantity, 2);

  const adjustments = await loadReconciliationAdjustments(database, 'cove', [line]);
  assert.equal(adjustments.length, 1);

  const adjusted = applyReconciliationAdjustments([line], adjustments)[0];
  assert.equal(adjusted?.sourceQuantity, 10);
  assert.equal(adjusted?.proposedQuantity, 8);
  assert.equal(adjusted?.delta, -2);
  assert.equal(adjusted?.financialImpact.amount, -30);
  assert.equal(adjusted?.status, 'needs-review');

  await assert.rejects(
    () =>
      createReconciliationAdjustment(database, 'cove', {
        productCode: 'COVE-WORKSTATION',
        adjustmentType: 'less-count',
        quantity: 0,
      }),
    /greater than zero/,
  );

  console.log('reconciliation adjustment tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
