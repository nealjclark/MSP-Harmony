import type {
  AgreementAddition,
  MoneyAmount,
  QuantityRule,
  ReconcileVendorUsageRequest,
  ReconciliationLine,
  ReconciliationResult,
  ReconciliationStatus,
  UsageSnapshot,
} from './types';
import {
  findAdditions,
  matchesDimensions,
  matchesRuleProduct,
  normalizeProductCode,
  ruleVendorProductKey,
  sumAdditions,
  targetProductCodes,
} from './reconciliationProductMatching';
import { reconcileSeparateVendorUsage } from './reconciliationSeparateMode';

const zeroUsd: MoneyAmount = { amount: 0, currency: 'USD' };

export function reconcileVendorUsage(request: ReconcileVendorUsageRequest): ReconciliationResult {
  const separateRules = request.rules.filter((rule) => !rule.allowance && !rule.addOn);
  const allowanceRules = request.rules.filter((rule) => rule.allowance || rule.addOn);
  const separateResult = reconcileSeparateVendorUsage({ ...request, rules: separateRules });
  const lines = [
    ...separateResult.lines,
    ...allowanceRules.flatMap((rule) => reconcileRule(request, rule)),
    ...reconcileUnmappedSnapshots(request),
  ];

  const totals = lines.reduce(
    (summary, line) => {
      if (line.status === 'matched') summary.matched += 1;
      if (line.status === 'needs-review') summary.needsReview += 1;
      if (line.status === 'not-billable') summary.notBillable += 1;
      if (line.status === 'unmapped') summary.unmapped += 1;
      summary.financialImpact.amount += line.financialImpact.amount;
      return summary;
    },
    {
      matched: 0,
      needsReview: 0,
      notBillable: 0,
      unmapped: 0,
      financialImpact: { ...zeroUsd },
    },
  );

  return {
    vendorId: request.vendorId,
    generatedAt: new Date().toISOString(),
    lines,
    pinAssignments: separateResult?.pinAssignments?.length ? separateResult.pinAssignments : undefined,
    totals,
  };
}

function reconcileUnmappedSnapshots(request: ReconcileVendorUsageRequest): ReconciliationLine[] {
  const mappedSnapshots = request.snapshots.filter((snapshot) =>
    request.rules.some((rule) =>
      snapshot.vendorId === request.vendorId &&
      matchesRuleProduct(snapshot, rule) &&
      matchesDimensions(snapshot, rule.dimensions),
    ),
  );
  const mappedSnapshotIds = new Set(mappedSnapshots.map((snapshot) => snapshot.id));
  const unmappedSnapshots = request.snapshots.filter(
    (snapshot) =>
      snapshot.vendorId === request.vendorId &&
      !mappedSnapshotIds.has(snapshot.id) &&
      !isSyntheticReconciliationSnapshot(snapshot),
  );
  const groupedSnapshots = groupUnmappedSnapshots(unmappedSnapshots);

  return [...groupedSnapshots.entries()].map(([groupKey, snapshots]) => {
    const firstSnapshot = snapshots[0];
    const [clientId, agreementId] = groupKey.split('\u0001');
    const sourceQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const vendorProductKey = firstSnapshot?.vendorProductKey;
    const productName = firstSnapshot?.productName ?? firstSnapshot?.productCode ?? 'Unmapped vendor product';
    const productCode = firstSnapshot?.productCode ?? vendorProductKey ?? productName;

    return {
      id: `${groupKey}|${productCode}|unmapped`,
      vendorId: request.vendorId,
      clientId,
      agreementId,
      productCode,
      productName,
      lineType: 'unmapped-vendor',
      ruleId: 'unmapped-vendor-product',
      sourceQuantity,
      agreementQuantity: 0,
      proposedQuantity: sourceQuantity,
      delta: sourceQuantity,
      unit: 'license',
      financialImpact: { ...zeroUsd },
      status: 'unmapped',
      reason: `${productName} is present in vendor usage but has no approved product mapping.`,
      evidence: [
        { label: 'Snapshot rows', value: snapshots.length },
        ...(vendorProductKey ? [{ label: 'Vendor product key', value: vendorProductKey }] : []),
        { label: 'Action', value: 'Map this vendor product before reconciling it to ConnectWise.' },
      ],
    };
  });
}

function isSyntheticReconciliationSnapshot(snapshot: UsageSnapshot) {
  return snapshot.dimensions.linkedCountAnchor === true;
}

function groupUnmappedSnapshots(snapshots: UsageSnapshot[]) {
  return snapshots.reduce((groups, snapshot) => {
    const key = [
      snapshot.clientId,
      snapshot.agreementId,
      snapshot.vendorProductKey ?? '',
      snapshot.productCode,
      snapshot.productName,
    ].join('\u0001');
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, snapshot]);
    return groups;
  }, new Map<string, UsageSnapshot[]>());
}

function reconcileRule(request: ReconcileVendorUsageRequest, rule: QuantityRule): ReconciliationLine[] {
  const scopedSnapshots = request.snapshots.filter(
    (snapshot) =>
      snapshot.vendorId === request.vendorId &&
      matchesRuleProduct(snapshot, rule) &&
      matchesDimensions(snapshot, rule.dimensions),
  );

  const groupedSnapshots = groupSnapshotsByAgreement(scopedSnapshots);
  const groupedRelevantAdditions = groupAdditionsForSnapshotAgreements(
    request.agreementAdditions.filter((addition) => {
      const productCodes = [
        ...targetProductCodes(rule),
        ...(rule.addOn ? targetProductCodes(rule.addOn) : []),
      ];
      return productCodes.some(
        (code) => normalizeProductCode(code) === normalizeProductCode(addition.productCode),
      );
    }),
    groupedSnapshots,
  );
  const agreementKeys = new Set([...groupedSnapshots.keys(), ...groupedRelevantAdditions.keys()]);
  const lines: ReconciliationLine[] = [];

  agreementKeys.forEach((agreementKey) => {
    const [clientId, agreementId] = agreementKey.split('|');
    const snapshots = groupedSnapshots.get(agreementKey) ?? [];
    const proposedBaseQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const relevantAdditions = groupedRelevantAdditions.get(agreementKey) ?? [];
    const matchingBaseAdditions = findAdditions(
      relevantAdditions,
      clientId,
      agreementId,
      targetProductCodes(rule),
    );
    const baseAdditions = selectSingleAddition(matchingBaseAdditions, proposedBaseQuantity, rule.productCode);
    if (rule.requiresExistingAgreementProduct && baseAdditions.length === 0) {
      return;
    }
    const baseAgreementQuantity = sumAdditions(baseAdditions);
    const baseDelta = proposedBaseQuantity - baseAgreementQuantity;

    if (snapshots.length > 0 || baseAdditions.length > 0) {
      const assignedAddition = baseAdditions[0];
      const productCode = assignedAddition?.productCode ?? rule.productCode;
      const productName = assignedAddition?.productName ?? rule.productName;
      const unitPrice = unitPriceForImpact(baseAdditions, productCode, rule.unitPrice);

      lines.push({
        id: `${agreementKey}|${productCode}|base`,
        vendorId: request.vendorId,
        clientId,
        agreementId,
        productCode,
        productName,
        vendorProductKey: ruleVendorProductKey(rule),
        connectWiseAdditionId: assignedAddition?.connectWiseAdditionId ?? assignedAddition?.id,
        matchedAdditionIds: baseAdditions.map((addition) => addition.connectWiseAdditionId ?? addition.id),
        lineType: 'base-count',
        ruleId: rule.id,
        sourceQuantity: proposedBaseQuantity,
        agreementQuantity: baseAgreementQuantity,
        proposedQuantity: proposedBaseQuantity,
        delta: baseDelta,
        unit: rule.billableUnit,
        unitPrice,
        financialImpact: calculateImpact(baseDelta, unitPrice),
        status: statusForDelta(baseDelta),
        writeAction: writeActionForDelta(baseDelta, baseAdditions.length),
        reason:
          proposedBaseQuantity === baseAgreementQuantity
            ? `${rule.productName} count matches the agreement addition.`
            : `${rule.productName} count differs from the agreement addition.`,
        evidence: [
          { label: 'Snapshot rows', value: snapshots.length },
          { label: 'Matched agreement additions', value: baseAdditions.length },
          ...(unitPrice ? [{ label: 'Unit price', value: unitPrice.amount }] : []),
          { label: 'Rule', value: rule.notes },
        ],
      });

      lines.push(
        ...matchingBaseAdditions
          .filter((addition) => addition !== assignedAddition)
          .map((addition) => unassignedAdditionLine(request, rule, clientId, agreementId, addition)),
      );
    }

    if (rule.allowance?.kind === 'included' && rule.addOn) {
      const measuredUsage = sumMetric(snapshots, rule.addOn.metric);
      const proposedAddOnQuantity = calculateAddOnQuantity(snapshots, rule.allowance.metric, rule.allowance.includedQuantity, rule.allowance.scope, rule.addOn.incrementQuantity, rule.addOn.roundOverage);
      const matchingAddOnAdditions = findAdditions(
        relevantAdditions,
        clientId,
        agreementId,
        targetProductCodes(rule.addOn),
      );
      const addOnAdditions = selectSingleAddition(
        matchingAddOnAdditions,
        proposedAddOnQuantity,
        rule.addOn.productCode,
      );
      const agreementQuantity = sumAdditions(addOnAdditions);
      const delta = proposedAddOnQuantity - agreementQuantity;
      const unitPrice = unitPriceForImpact(addOnAdditions, rule.addOn.productCode, rule.addOn.unitPrice);

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
        // API/source count is billable add-on units (+1 per incrementQuantity of measured usage over allowance),
        // not the raw measured metric (e.g. total GB for Cove 1 TB storage add-ons).
        sourceQuantity: proposedAddOnQuantity,
        agreementQuantity,
        proposedQuantity: proposedAddOnQuantity,
        delta,
        unit: rule.addOn.unit,
        unitPrice,
        financialImpact: calculateImpact(delta, unitPrice),
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
          { label: 'Measured usage', value: measuredUsage },
          ...(unitPrice ? [{ label: 'Unit price', value: unitPrice.amount }] : []),
        ],
      });

      lines.push(
        ...matchingAddOnAdditions
          .filter((addition) => addition !== addOnAdditions[0])
          .map((addition) => unassignedAdditionLine(request, rule, clientId, agreementId, addition)),
      );
    }
  });

  return lines;
}

function unassignedAdditionLine(
  request: ReconcileVendorUsageRequest,
  rule: QuantityRule,
  clientId: string,
  agreementId: string,
  addition: AgreementAddition,
): ReconciliationLine {
  const unitPrice = addition.unitPrice ?? rule.unitPrice;
  return {
    id: `${clientId}|${agreementId}|${addition.connectWiseAdditionId ?? addition.id}|unassigned-addition`,
    vendorId: request.vendorId,
    clientId,
    agreementId,
    productCode: addition.productCode,
    productName: addition.productName,
    vendorProductKey: ruleVendorProductKey(rule),
    connectWiseAdditionId: addition.connectWiseAdditionId ?? addition.id,
    matchedAdditionIds: [addition.connectWiseAdditionId ?? addition.id],
    lineType: 'base-count',
    ruleId: rule.id,
    sourceQuantity: 0,
    agreementQuantity: addition.quantity,
    proposedQuantity: 0,
    delta: -addition.quantity,
    unit: rule.billableUnit,
    unitPrice,
    financialImpact: calculateImpact(-addition.quantity, unitPrice),
    status: 'needs-review',
    writeAction: 'review-required',
    reason: `${addition.productName} is an additional ConnectWise agreement addition with no separately assigned vendor count.`,
    evidence: [
      { label: 'Matched agreement additions', value: 1 },
      { label: 'Assigned ConnectWise addition', value: addition.connectWiseAdditionId ?? addition.id },
      { label: 'Rule', value: rule.notes },
    ],
  };
}

function selectSingleAddition(
  additions: AgreementAddition[],
  proposedQuantity: number,
  preferredProductCode: string,
) {
  if (additions.length <= 1) {
    return additions;
  }

  const preferredCode = normalizeProductCode(preferredProductCode);
  const ranked = [...additions].sort((left, right) => {
    const leftExact = left.quantity === proposedQuantity ? 0 : 1;
    const rightExact = right.quantity === proposedQuantity ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;

    const leftDistance = Math.abs(left.quantity - proposedQuantity);
    const rightDistance = Math.abs(right.quantity - proposedQuantity);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;

    const leftPreferred = normalizeProductCode(left.productCode) === preferredCode ? 0 : 1;
    const rightPreferred = normalizeProductCode(right.productCode) === preferredCode ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;

    return (left.connectWiseAdditionId ?? left.id).localeCompare(right.connectWiseAdditionId ?? right.id);
  });

  return ranked.slice(0, 1);
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

function unitPriceForImpact(
  additions: AgreementAddition[],
  preferredProductCode: string,
  fallback?: MoneyAmount,
): MoneyAmount | undefined {
  return (
    additions.find(
      (addition) =>
        normalizeProductCode(addition.productCode) === normalizeProductCode(preferredProductCode) &&
        addition.unitPrice,
    )?.unitPrice ??
    additions.find((addition) => addition.unitPrice)?.unitPrice ??
    fallback
  );
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

function groupAdditionsForSnapshotAgreements(
  additions: AgreementAddition[],
  snapshotGroups: Map<string, UsageSnapshot[]>,
) {
  const snapshotKeysByClient = new Map<string, string[]>();
  for (const key of snapshotGroups.keys()) {
    const [clientId] = key.split('|');
    snapshotKeysByClient.set(clientId, [...(snapshotKeysByClient.get(clientId) ?? []), key]);
  }

  return additions.reduce((groups, addition) => {
    const actualKey = `${addition.clientId}|${addition.agreementId}`;
    const clientSnapshotKeys = snapshotKeysByClient.get(addition.clientId) ?? [];
    const targetKeys =
      clientSnapshotKeys.includes(actualKey) || clientSnapshotKeys.length !== 1 ? [actualKey] : clientSnapshotKeys;

    for (const targetKey of targetKeys) {
      const [, targetAgreementId] = targetKey.split('|');
      const projectedAddition =
        targetAgreementId === addition.agreementId
          ? addition
          : {
              ...addition,
              agreementId: targetAgreementId,
              sourceAgreementId: addition.sourceAgreementId ?? addition.agreementId,
            };
      const existing = groups.get(targetKey) ?? [];
      groups.set(targetKey, [...existing, projectedAddition]);
    }

    return groups;
  }, new Map<string, AgreementAddition[]>());
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
