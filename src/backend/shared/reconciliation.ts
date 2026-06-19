import type {
  AgreementAddition,
  BillingUnit,
  DimensionFilter,
  MoneyAmount,
  QuantityRule,
  ReconcileVendorUsageRequest,
  ReconciliationLine,
  ReconciliationResult,
  ReconciliationStatus,
  UsageSnapshot,
} from './types';

const zeroUsd: MoneyAmount = { amount: 0, currency: 'USD' };

export function reconcileVendorUsage(request: ReconcileVendorUsageRequest): ReconciliationResult {
  const lines = request.rules.flatMap((rule) => reconcileRule(request, rule));
  const totals = lines.reduce(
    (summary, line) => {
      if (line.status === 'matched') summary.matched += 1;
      if (line.status === 'needs-review') summary.needsReview += 1;
      if (line.status === 'not-billable') summary.notBillable += 1;
      summary.financialImpact.amount += line.financialImpact.amount;
      return summary;
    },
    {
      matched: 0,
      needsReview: 0,
      notBillable: 0,
      financialImpact: { ...zeroUsd },
    },
  );

  return {
    vendorId: request.vendorId,
    generatedAt: new Date().toISOString(),
    lines,
    totals,
  };
}

function reconcileRule(request: ReconcileVendorUsageRequest, rule: QuantityRule): ReconciliationLine[] {
  const scopedSnapshots = request.snapshots.filter(
    (snapshot) =>
      snapshot.vendorId === request.vendorId &&
      matchesRuleProduct(snapshot, rule) &&
      matchesDimensions(snapshot, rule.dimensions),
  );

  const groupedSnapshots = groupSnapshotsByAgreement(scopedSnapshots);
  const groupedRelevantAdditions = groupAdditionsByAgreement(
    request.agreementAdditions.filter((addition) =>
      [...targetProductCodes(rule), ...(rule.addOn ? targetProductCodes(rule.addOn) : [])].includes(addition.productCode),
    ),
  );
  const agreementKeys = new Set([...groupedSnapshots.keys(), ...groupedRelevantAdditions.keys()]);
  const lines: ReconciliationLine[] = [];

  agreementKeys.forEach((agreementKey) => {
    const [clientId, agreementId] = agreementKey.split('|');
    const snapshots = groupedSnapshots.get(agreementKey) ?? [];
    const proposedBaseQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const baseAdditions = findAdditions(request.agreementAdditions, clientId, agreementId, targetProductCodes(rule));
    if (rule.requiresExistingAgreementProduct && baseAdditions.length === 0) {
      return;
    }
    const baseAgreementQuantity = sumAdditions(baseAdditions);
    const baseDelta = proposedBaseQuantity - baseAgreementQuantity;

    if (snapshots.length > 0 || baseAdditions.length > 0) {
      lines.push({
        id: `${agreementKey}|${rule.productCode}|base`,
        vendorId: request.vendorId,
        clientId,
        agreementId,
        productCode: rule.productCode,
        productName: rule.productName,
        lineType: 'base-count',
        ruleId: rule.id,
        sourceQuantity: proposedBaseQuantity,
        agreementQuantity: baseAgreementQuantity,
      proposedQuantity: proposedBaseQuantity,
      delta: baseDelta,
      unit: rule.billableUnit,
      unitPrice: rule.unitPrice ?? baseAdditions[0]?.unitPrice,
      financialImpact: calculateImpact(baseDelta, rule.unitPrice ?? baseAdditions[0]?.unitPrice),
        status: statusForDelta(baseDelta),
        writeAction: writeActionForDelta(baseDelta, baseAdditions.length),
        reason:
          proposedBaseQuantity === baseAgreementQuantity
            ? `${rule.productName} count matches the agreement addition.`
            : `${rule.productName} count differs from the agreement addition.`,
        evidence: [
          { label: 'Snapshot rows', value: snapshots.length },
          { label: 'Matched agreement additions', value: baseAdditions.length },
          { label: 'Rule', value: rule.notes },
        ],
      });
    }

    if (rule.allowance?.kind === 'included' && rule.addOn) {
      const sourceQuantity = sumMetric(snapshots, rule.addOn.metric);
      const proposedAddOnQuantity = calculateAddOnQuantity(snapshots, rule.allowance.metric, rule.allowance.includedQuantity, rule.allowance.scope, rule.addOn.incrementQuantity, rule.addOn.roundOverage);
      const addOnAdditions = findAdditions(request.agreementAdditions, clientId, agreementId, targetProductCodes(rule.addOn));
      const agreementQuantity = sumAdditions(addOnAdditions);
      const delta = proposedAddOnQuantity - agreementQuantity;

      if ((snapshots.length === 0 && addOnAdditions.length === 0) || (proposedAddOnQuantity === 0 && agreementQuantity === 0)) {
        return;
      }

      lines.push({
        id: `${agreementKey}|${rule.addOn.productCode}|addon`,
        vendorId: request.vendorId,
        clientId,
        agreementId,
        productCode: rule.addOn.productCode,
        productName: rule.addOn.productName,
        lineType: 'usage-add-on',
        ruleId: rule.id,
        sourceQuantity,
        agreementQuantity,
        proposedQuantity: proposedAddOnQuantity,
        delta,
        unit: rule.addOn.unit,
        unitPrice: rule.addOn.unitPrice,
        financialImpact: calculateImpact(delta, rule.addOn.unitPrice),
        status: statusForDelta(delta),
        writeAction: writeActionForDelta(delta, addOnAdditions.length),
        reason:
          delta === 0
            ? `${rule.addOn.productName} matches the included-usage policy.`
            : `${rule.addOn.productName} needs ${formatSigned(delta)} ${rule.addOn.unit} adjustment.`,
        evidence: [
          { label: 'Included quantity', value: rule.allowance.includedQuantity },
          { label: 'Allowance scope', value: rule.allowance.scope },
          { label: 'Matched agreement additions', value: addOnAdditions.length },
          { label: 'Measured usage', value: sourceQuantity },
          { label: 'Unit price', value: rule.addOn.unitPrice.amount },
        ],
      });
    }
  });

  return lines;
}

function calculateAddOnQuantity(
  snapshots: UsageSnapshot[],
  metric: string,
  includedQuantity: number,
  scope: 'per-agreement' | 'per-snapshot' | 'per-snapshot-pooled',
  incrementQuantity: number,
  roundOverage: 'ceil' | 'floor' | 'round',
) {
  if (scope === 'per-agreement') {
    return roundQuantity(Math.max(0, sumMetric(snapshots, metric) - includedQuantity) / incrementQuantity, roundOverage);
  }

  if (scope === 'per-snapshot-pooled') {
    const includedTotal = includedQuantity * snapshots.length;
    return roundQuantity(Math.max(0, sumMetric(snapshots, metric) - includedTotal) / incrementQuantity, roundOverage);
  }

  return snapshots.reduce((total, snapshot) => {
    const overage = Math.max(0, numericDimension(snapshot, metric) - includedQuantity);
    return total + roundQuantity(overage / incrementQuantity, roundOverage);
  }, 0);
}

function roundQuantity(value: number, method: 'ceil' | 'floor' | 'round') {
  if (method === 'ceil') return Math.ceil(value);
  if (method === 'floor') return Math.floor(value);
  return Math.round(value);
}

function calculateImpact(delta: number, unitPrice?: MoneyAmount): MoneyAmount {
  if (!unitPrice) return { ...zeroUsd };
  return {
    amount: delta * unitPrice.amount,
    currency: unitPrice.currency,
  };
}

function statusForDelta(delta: number): ReconciliationStatus {
  return delta === 0 ? 'matched' : 'needs-review';
}

function writeActionForDelta(delta: number, additionCount: number) {
  if (delta === 0) return undefined;
  if (additionCount === 0) return 'create-addition';
  return additionCount === 1 ? 'update-addition' : 'review-required';
}

function groupSnapshotsByAgreement(snapshots: UsageSnapshot[]) {
  return snapshots.reduce((groups, snapshot) => {
    const key = `${snapshot.clientId}|${snapshot.agreementId}`;
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, snapshot]);
    return groups;
  }, new Map<string, UsageSnapshot[]>());
}

function groupAdditionsByAgreement(additions: AgreementAddition[]) {
  return additions.reduce((groups, addition) => {
    const key = `${addition.clientId}|${addition.agreementId}`;
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, addition]);
    return groups;
  }, new Map<string, AgreementAddition[]>());
}

function findAdditions(
  additions: AgreementAddition[],
  clientId: string,
  agreementId: string,
  productCodes: string[],
) {
  const targetCodes = new Set(productCodes);
  return additions.filter(
    (addition) =>
      addition.clientId === clientId &&
      addition.agreementId === agreementId &&
      targetCodes.has(addition.productCode),
  );
}

function sumAdditions(additions: AgreementAddition[]) {
  return additions.reduce((total, addition) => total + addition.quantity, 0);
}

function targetProductCodes(target: { productCode: string; targetProductCodes?: string[] }) {
  return [...new Set([target.productCode, ...(target.targetProductCodes ?? [])])];
}

function matchesRuleProduct(snapshot: UsageSnapshot, rule: QuantityRule) {
  if (rule.vendorProductKey && snapshot.vendorProductKey) {
    return snapshot.vendorProductKey === rule.vendorProductKey;
  }

  return targetProductCodes(rule).includes(snapshot.productCode);
}

function matchesDimensions(snapshot: UsageSnapshot, dimensions?: DimensionFilter) {
  if (!dimensions) return true;
  return Object.entries(dimensions).every(([key, expected]) => snapshot.dimensions[key] === expected);
}

function sumMetric(snapshots: UsageSnapshot[], metric: string) {
  return snapshots.reduce((total, snapshot) => total + numericDimension(snapshot, metric), 0);
}

function numericDimension(snapshot: UsageSnapshot, metric: string) {
  const value = snapshot.dimensions[metric];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Snapshot ${snapshot.id} is missing numeric dimension "${metric}".`);
  }
  return value;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
