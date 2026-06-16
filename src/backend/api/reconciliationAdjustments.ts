import type { MoneyAmount, ReconciliationLine } from '../shared/types';
import type { Queryable } from '../vendor/cove/operations';

export type ReconciliationAdjustmentRow = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  agreement_id: string | null;
  product_code: string;
  product_name: string | null;
  line_type: string;
  adjustment_type: string;
  quantity: string | number;
  reason: string | null;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ReconciliationAdjustment = {
  id: string;
  vendorId: string;
  customerId?: string;
  agreementId?: string;
  productCode: string;
  productName?: string;
  lineType: string;
  adjustmentType: 'less-count';
  quantity: number;
  reason?: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateReconciliationAdjustmentInput = {
  customerId?: string;
  agreementId?: string;
  productCode: string;
  productName?: string;
  lineType?: string;
  adjustmentType: 'less-count';
  quantity: number;
  reason?: string;
  reviewedBy?: string;
};

export type ReconciliationLineWithAdjustments = ReconciliationLine & {
  adjustments?: ReconciliationAdjustment[];
};

export async function createReconciliationAdjustment(
  database: Queryable,
  vendorId: string,
  input: CreateReconciliationAdjustmentInput,
) {
  validateAdjustmentInput(input);

  const result = await database.query<ReconciliationAdjustmentRow>(
    `insert into vendor_reconciliation_adjustments (
       vendor_id,
       customer_id,
       agreement_id,
       product_code,
       product_name,
       line_type,
       adjustment_type,
       quantity,
       reason,
       reviewed_by,
       reviewed_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     returning
       id,
       vendor_id,
       customer_id,
       agreement_id,
       product_code,
       product_name,
       line_type,
       adjustment_type,
       quantity,
       reason,
       active,
       reviewed_by,
       reviewed_at,
       created_at,
       updated_at`,
    [
      vendorId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.productCode,
      input.productName ?? null,
      input.lineType ?? 'base-count',
      input.adjustmentType,
      input.quantity,
      input.reason?.trim() || null,
      input.reviewedBy?.trim() || null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to create reconciliation adjustment.');
  }

  return mapAdjustmentRow(row);
}

export async function deactivateReconciliationAdjustment(
  database: Queryable,
  vendorId: string,
  adjustmentId: string,
  input: { reviewedBy?: string } = {},
) {
  const result = await database.query<{ id: string }>(
    `update vendor_reconciliation_adjustments
     set active = false,
         reviewed_by = coalesce($3, reviewed_by),
         reviewed_at = now(),
         updated_at = now()
     where vendor_id = $1
       and id = $2
       and active = true
     returning id`,
    [vendorId, adjustmentId, input.reviewedBy?.trim() || null],
  );

  if (!result.rows[0]) {
    throw new Error('Reconciliation adjustment was not found or is already inactive.');
  }

  return {
    vendorId,
    adjustmentId,
    active: false,
  };
}

export async function loadReconciliationAdjustments(
  database: Queryable,
  vendorId: string,
  lines: ReconciliationLine[],
) {
  if (lines.length === 0) {
    return [];
  }

  const customerIds = [...new Set(lines.map((line) => line.clientId))];
  const agreementIds = [...new Set(lines.map((line) => line.agreementId))];
  const productCodes = [...new Set(lines.map((line) => line.productCode))];
  const result = await database.query<ReconciliationAdjustmentRow>(
    `select
       id,
       vendor_id,
       customer_id,
       agreement_id,
       product_code,
       product_name,
       line_type,
       adjustment_type,
       quantity,
       reason,
       active,
       reviewed_by,
       reviewed_at,
       created_at,
       updated_at
     from vendor_reconciliation_adjustments
     where vendor_id = $1
       and active = true
       and (customer_id is null or customer_id = any($2::uuid[]))
       and (agreement_id is null or agreement_id = any($3::uuid[]))
       and product_code = any($4::text[])
     order by customer_id nulls last, agreement_id nulls last, created_at, id`,
    [vendorId, customerIds, agreementIds, productCodes],
  );

  return result.rows.map(mapAdjustmentRow);
}

export function applyReconciliationAdjustments(
  lines: ReconciliationLine[],
  adjustments: ReconciliationAdjustment[],
): ReconciliationLineWithAdjustments[] {
  if (adjustments.length === 0) {
    return lines;
  }

  return lines.map((line) => {
    const matchingAdjustments = adjustments.filter((adjustment) => adjustmentMatchesLine(adjustment, line));
    const lessCount = matchingAdjustments
      .filter((adjustment) => adjustment.adjustmentType === 'less-count')
      .reduce((total, adjustment) => total + adjustment.quantity, 0);

    if (lessCount <= 0) {
      return {
        ...line,
        adjustments: matchingAdjustments,
      };
    }

    const proposedQuantity = Math.max(0, line.proposedQuantity - lessCount);
    const delta = proposedQuantity - line.agreementQuantity;

    return {
      ...line,
      proposedQuantity,
      delta,
      financialImpact: calculateImpact(delta, line.unitPrice),
      status: delta === 0 ? 'matched' : 'needs-review',
      writeAction: writeActionForDelta(delta, line.writeAction),
      reason:
        delta === 0
          ? `${line.productName} count matches after manual less-count adjustment.`
          : `${line.productName} count differs after manual less-count adjustment.`,
      evidence: [
        ...line.evidence,
        { label: 'Less Count', value: lessCount },
        ...matchingAdjustments
          .filter((adjustment) => adjustment.reason)
          .map((adjustment) => ({ label: 'Adjustment reason', value: adjustment.reason ?? '' })),
      ],
      adjustments: matchingAdjustments,
    };
  });
}

function validateAdjustmentInput(input: CreateReconciliationAdjustmentInput) {
  if (input.adjustmentType !== 'less-count') {
    throw new Error('Only less-count adjustments are supported.');
  }

  if (!input.productCode?.trim()) {
    throw new Error('Product code is required.');
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Less Count must be greater than zero.');
  }
}

function adjustmentMatchesLine(adjustment: ReconciliationAdjustment, line: ReconciliationLine) {
  if (adjustment.customerId && adjustment.customerId !== line.clientId) {
    return false;
  }

  if (adjustment.agreementId && adjustment.agreementId !== line.agreementId) {
    return false;
  }

  return adjustment.productCode === line.productCode && adjustment.lineType === line.lineType;
}

function calculateImpact(delta: number, unitPrice?: MoneyAmount): MoneyAmount {
  if (!unitPrice) {
    return { amount: 0, currency: 'USD' };
  }

  return {
    amount: delta * unitPrice.amount,
    currency: unitPrice.currency,
  };
}

function writeActionForDelta(delta: number, existingAction: ReconciliationLine['writeAction']) {
  if (delta === 0) return undefined;
  return existingAction ?? 'update-addition';
}

function mapAdjustmentRow(row: ReconciliationAdjustmentRow): ReconciliationAdjustment {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    customerId: row.customer_id ?? undefined,
    agreementId: row.agreement_id ?? undefined,
    productCode: row.product_code,
    productName: row.product_name ?? undefined,
    lineType: row.line_type,
    adjustmentType: 'less-count',
    quantity: numericValue(row.quantity),
    reason: row.reason ?? undefined,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
    createdAt: isoDate(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function numericValue(value: string | number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
