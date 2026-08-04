import assert from 'node:assert/strict';
import { buildMonthlyReviewFindings, restartMonthlyReviewRun } from './monthlyReview';
import type { DatabaseReconciliationLine } from './reconciliationRuns';
import type { MonthlyReviewAdditionSnapshot, MonthlyReviewReadinessSource } from '../../shared/monthlyReview';

const addition = {
  id: 'addition-row-1',
  connectWiseAdditionId: 'cw-addition-1',
  connectWiseAgreementId: 'cw-agreement-1',
  productCode: 'MANAGED-ENDPOINT',
  productName: 'Managed Endpoint',
  quantity: 10,
  unitPrice: 20,
  additionStatus: 'Active',
  customerId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Example Client',
  agreementId: '22222222-2222-4222-8222-222222222222',
  agreementName: 'Managed Services',
} satisfies MonthlyReviewAdditionSnapshot & {
  customerId: string;
  customerName: string;
  agreementId: string;
  agreementName: string;
};

const extraAddition = {
  ...addition,
  id: 'addition-row-2',
  connectWiseAdditionId: 'cw-addition-2',
  productCode: 'BACKUP',
  productName: 'Backup',
  quantity: 3,
};

function source(vendorId: 'cove' | 'ncentral', label: string): MonthlyReviewReadinessSource {
  return {
    id: vendorId,
    vendorId,
    integrationId: vendorId,
    label,
    sourceKind: 'live-sync',
    state: 'ready',
    message: 'Ready',
    syncRunId: `${vendorId}-sync`,
    completedAt: '2026-08-01T12:00:00.000Z',
    canSync: true,
  };
}

function line(vendorId: 'cove' | 'ncentral', proposedQuantity: number): DatabaseReconciliationLine {
  return {
    id: `${vendorId}-line`,
    vendorId,
    clientId: addition.customerId,
    agreementId: addition.agreementId,
    customerName: addition.customerName,
    agreementName: addition.agreementName,
    productCode: addition.productCode,
    productName: addition.productName,
    vendorProductKey: `${vendorId}-endpoint`,
    lineType: 'base-count',
    ruleId: `${vendorId}-rule`,
    sourceQuantity: proposedQuantity,
    agreementQuantity: addition.quantity,
    proposedQuantity,
    delta: proposedQuantity - addition.quantity,
    unit: 'device',
    financialImpact: { amount: (proposedQuantity - addition.quantity) * 20, currency: 'USD' },
    status: proposedQuantity === addition.quantity ? 'matched' : 'needs-review',
    reason: 'Test comparison',
    evidence: [{ label: 'Count', value: proposedQuantity }],
    matchedAgreementAdditions: [{
      id: addition.id,
      agreementId: addition.agreementId,
      agreementName: addition.agreementName,
      connectWiseAgreementId: addition.connectWiseAgreementId,
      connectWiseAdditionId: addition.connectWiseAdditionId,
      productCode: addition.productCode,
      productName: addition.productName,
      quantity: addition.quantity,
      unitPrice: { amount: 20, currency: 'USD' },
      additionStatus: 'Active',
    }],
    devices: [],
  };
}

const agreed = buildMonthlyReviewFindings(
  [
    { source: source('cove', 'Cove'), lines: [line('cove', 12)] },
    { source: source('ncentral', 'N-Able'), lines: [line('ncentral', 12)] },
  ],
  [addition, extraAddition],
);
assert.equal(agreed.length, 2);
const correlated = agreed.find((finding) => finding.rowType === 'agreement-addition');
assert.equal(correlated?.vendors.length, 2);
assert.equal(correlated?.selectedQuantity, 12);
assert.equal(correlated?.disposition, 'needs-action');
const cwOnly = agreed.find((finding) => finding.rowType === 'cw-only');
assert.equal(cwOnly?.additions[0]?.connectWiseAdditionId, 'cw-addition-2');
assert.equal(cwOnly?.disposition, 'needs-action');

const disagreement = buildMonthlyReviewFindings(
  [
    { source: source('cove', 'Cove'), lines: [line('cove', 12)] },
    { source: source('ncentral', 'N-Able'), lines: [line('ncentral', 13)] },
  ],
  [addition],
)[0];
assert.equal(disagreement?.vendors.length, 2);
assert.equal(disagreement?.disposition, 'needs-source');
assert.equal(disagreement?.selectedQuantity, undefined);

const matched = buildMonthlyReviewFindings(
  [{ source: source('cove', 'Cove'), lines: [line('cove', 10)] }],
  [addition],
)[0];
assert.equal(matched?.disposition, 'auto-passed');

const cwOnlyException = buildMonthlyReviewFindings(
  [{ source: source('cove', 'Cove'), lines: [line('cove', 12)] }],
  [addition, extraAddition],
  { cwOnlyExcludedProductCodes: ['backup'] },
);
assert.equal(cwOnlyException.length, 1);
assert.equal(cwOnlyException[0]?.rowType, 'agreement-addition');
assert.equal(cwOnlyException[0]?.additions[0]?.connectWiseAdditionId, addition.connectWiseAdditionId);

const matchedExceptionStillShows = buildMonthlyReviewFindings(
  [{ source: source('cove', 'Cove'), lines: [line('cove', 12)] }],
  [addition],
  { cwOnlyExcludedProductCodes: [addition.productCode] },
);
assert.equal(matchedExceptionStillShows.length, 1);
assert.equal(matchedExceptionStillShows[0]?.rowType, 'agreement-addition');

async function testRestartGuards() {
  await assert.rejects(
    () => restartMonthlyReviewRun(
      {
        async query() {
          throw new Error('Blank reasons should fail before querying.');
        },
      },
      '11111111-1111-4111-8111-111111111111',
      { actor: 'admin@example.com', reason: '   ' },
    ),
    /requires a reason/,
  );

  await assert.rejects(
    () => restartMonthlyReviewRun(
      {
        async query<T>() {
          return {
            rows: [{
              billing_month: '2026-07',
              status: 'completed',
              locked_at: '2026-08-01T12:00:00.000Z',
            }] as T[],
          };
        },
      },
      '11111111-1111-4111-8111-111111111111',
      { actor: 'admin@example.com', reason: 'Recalculate corrected mappings.' },
    ),
    /Only an open Monthly Review/,
  );
}

void testRestartGuards().then(() => {
  console.log('monthlyReview tests passed');
});
