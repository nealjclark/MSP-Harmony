import type {
  AgreementAddition,
  MoneyAmount,
  QuantityRule,
  ReconcileVendorUsageRequest,
  ReconciliationLine,
  ReconciliationStatus,
  ReconciliationWriteAction,
  UsageSnapshot,
  VendorProductAdditionPin,
  VendorProductAdditionPinAssignment,
} from './types';
import {
  additionIdentity,
  additionsForAgreement,
  findAdditions,
  groupSnapshotsByAgreement,
  matchesDimensions,
  matchesRuleProduct,
  normalizeProductCode,
  ruleTargetsProductCode,
  ruleVendorProductKey,
  sumAdditions,
  targetProductCodes,
} from './reconciliationProductMatching';

const zeroUsd: MoneyAmount = { amount: 0, currency: 'USD' };

type RuleContext = {
  rule: QuantityRule;
  snapshotsByAgreement: Map<string, UsageSnapshot[]>;
};

export function reconcileSeparateVendorUsage(request: ReconcileVendorUsageRequest) {
  const pinAssignments: VendorProductAdditionPinAssignment[] = [];
  const contexts = buildRuleContexts(request);
  const agreementKeys = collectAgreementKeys(request, contexts);
  const lines: ReconciliationLine[] = [];
  const processedScopes = new Set<string>();

  for (const currentAgreementKey of agreementKeys) {
    for (const normalizedProductCode of productCodesOnAgreement(request, contexts, currentAgreementKey)) {
      const scopeKey = `${currentAgreementKey}|${normalizedProductCode}`;
      if (processedScopes.has(scopeKey)) {
        continue;
      }
      processedScopes.add(scopeKey);

      lines.push(
        ...reconcileAgreementProductScope({
          request,
          contexts,
          agreementKey: currentAgreementKey,
          normalizedProductCode,
          pins: request.additionPins ?? [],
          pinAssignments,
        }),
      );
    }
  }

  return { lines, pinAssignments };
}

function buildRuleContexts(request: ReconcileVendorUsageRequest): RuleContext[] {
  return request.rules.map((rule) => ({
    rule,
    snapshotsByAgreement: groupSnapshotsByAgreement(
      request.snapshots.filter(
        (snapshot) =>
          snapshot.vendorId === request.vendorId &&
          matchesRuleProduct(snapshot, rule) &&
          matchesDimensions(snapshot, rule.dimensions),
      ),
    ),
  }));
}

function collectAgreementKeys(request: ReconcileVendorUsageRequest, contexts: RuleContext[]) {
  const keys = new Set<string>();

  for (const context of contexts) {
    for (const key of context.snapshotsByAgreement.keys()) {
      keys.add(key);
    }
  }

  for (const addition of request.agreementAdditions) {
    keys.add(`${addition.clientId}|${addition.agreementId}`);
  }

  return keys;
}

function productCodesOnAgreement(
  request: ReconcileVendorUsageRequest,
  contexts: RuleContext[],
  agreementKey: string,
) {
  const normalizedCodes = new Set<string>();

  for (const addition of additionsForAgreement(request.agreementAdditions, agreementKey)) {
    if (request.rules.some((rule) => ruleTargetsProductCode(rule, addition.productCode))) {
      normalizedCodes.add(normalizeProductCode(addition.productCode));
    }
  }

  for (const context of contexts) {
    if (!context.snapshotsByAgreement.has(agreementKey)) {
      continue;
    }

    for (const code of targetProductCodes(context.rule)) {
      normalizedCodes.add(normalizeProductCode(code));
    }
  }

  return [...normalizedCodes];
}

function reconcileAgreementProductScope(input: {
  request: ReconcileVendorUsageRequest;
  contexts: RuleContext[];
  agreementKey: string;
  normalizedProductCode: string;
  pins: VendorProductAdditionPin[];
  pinAssignments: VendorProductAdditionPinAssignment[];
}) {
  const [clientId, agreementId] = input.agreementKey.split('|');
  const activeRules = input.request.rules.filter(
    (rule) =>
      ruleTargetsProductCode(rule, input.normalizedProductCode) &&
      input.contexts.some(
        (context) => context.rule.id === rule.id && context.snapshotsByAgreement.has(input.agreementKey),
      ),
  );
  const agreementAdditions = additionsForAgreement(input.request.agreementAdditions, input.agreementKey);
  const productCodes = [
    ...new Set([
      ...activeRules.flatMap((rule) => targetProductCodes(rule)),
      ...agreementAdditions
        .filter((addition) => normalizeProductCode(addition.productCode) === input.normalizedProductCode)
        .map((addition) => addition.productCode),
    ]),
  ];
  const matchedAdditions = findAdditions(agreementAdditions, clientId, agreementId, productCodes);
  const snapshotsByRule = new Map(
    activeRules.map((rule) => {
      const context = input.contexts.find((candidate) => candidate.rule.id === rule.id);
      return [rule.id, context?.snapshotsByAgreement.get(input.agreementKey) ?? []] as const;
    }),
  );

  if (activeRules.length === 0) {
    return [];
  }

  if (matchedAdditions.length <= 1) {
    const mergedSnapshots = activeRules.flatMap((rule) => snapshotsByRule.get(rule.id) ?? []);
    const primaryRule = activeRules[0];
    if (primaryRule.requiresExistingAgreementProduct && matchedAdditions.length === 0) {
      return [];
    }

    return [
      buildLine({
        request: input.request,
        rule: primaryRule,
        agreementKey: input.agreementKey,
        clientId,
        agreementId,
        snapshots: mergedSnapshots,
        matchedAdditions,
        assignedAddition: matchedAdditions[0],
        merged: true,
      }),
    ].filter((line): line is ReconciliationLine => Boolean(line));
  }

  return assignRulesToAdditions({
    request: input.request,
    rules: activeRules,
    snapshotsByRule,
    additions: matchedAdditions,
    pins: input.pins,
    clientId,
    agreementId,
    pinAssignments: input.pinAssignments,
  })
    .map((assignment) =>
      buildLine({
        request: input.request,
        rule: assignment.rule,
        agreementKey: input.agreementKey,
        clientId,
        agreementId,
        snapshots: assignment.snapshots,
        matchedAdditions: assignment.addition ? [assignment.addition] : matchedAdditions,
        assignedAddition: assignment.addition,
        merged: false,
        ambiguous: assignment.ambiguous,
      }),
    )
    .filter((line): line is ReconciliationLine => Boolean(line));
}

type RuleAssignment = {
  rule: QuantityRule;
  snapshots: UsageSnapshot[];
  addition?: AgreementAddition;
  ambiguous: boolean;
};

function assignRulesToAdditions(input: {
  request: ReconcileVendorUsageRequest;
  rules: QuantityRule[];
  snapshotsByRule: Map<string, UsageSnapshot[]>;
  additions: AgreementAddition[];
  pins: VendorProductAdditionPin[];
  clientId: string;
  agreementId: string;
  pinAssignments: VendorProductAdditionPinAssignment[];
}) {
  const claimedAdditionIds = new Set<string>();
  const assignments: RuleAssignment[] = [];
  const pendingRules: QuantityRule[] = [];

  for (const rule of input.rules) {
    const snapshots = input.snapshotsByRule.get(rule.id) ?? [];
    const proposedQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    if (rule.requiresExistingAgreementProduct && input.additions.length === 0) {
      continue;
    }
    if (proposedQuantity === 0 && !input.additions.some((addition) => addition.quantity > 0)) {
      continue;
    }

    const vendorProductKey = ruleVendorProductKey(rule);
    const pin = input.pins.find(
      (candidate) => candidate.agreementId === input.agreementId && candidate.vendorProductKey === vendorProductKey,
    );
    const pinnedAddition = pin
      ? input.additions.find(
          (addition) =>
            addition.connectWiseAdditionId === pin.connectWiseAdditionId || addition.id === pin.connectWiseAdditionId,
        )
      : undefined;

    if (pinnedAddition && !claimedAdditionIds.has(additionIdentity(pinnedAddition))) {
      claimedAdditionIds.add(additionIdentity(pinnedAddition));
      assignments.push({ rule, snapshots, addition: pinnedAddition, ambiguous: false });
      continue;
    }

    pendingRules.push(rule);
  }

  const pendingByQuantity = [...pendingRules].sort((left, right) => {
    const leftQuantity = (input.snapshotsByRule.get(left.id) ?? []).reduce((total, snapshot) => total + snapshot.quantity, 0);
    const rightQuantity = (input.snapshotsByRule.get(right.id) ?? []).reduce(
      (total, snapshot) => total + snapshot.quantity,
      0,
    );
    return rightQuantity - leftQuantity;
  });

  for (const rule of pendingByQuantity) {
    const snapshots = input.snapshotsByRule.get(rule.id) ?? [];
    const proposedQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const availableAdditions = input.additions.filter((addition) => !claimedAdditionIds.has(additionIdentity(addition)));
    const closestAddition = pickClosestAddition(proposedQuantity, availableAdditions);

    if (!closestAddition) {
      assignments.push({
        rule,
        snapshots,
        ambiguous: availableAdditions.length > 0,
      });
      continue;
    }

    claimedAdditionIds.add(additionIdentity(closestAddition));
    assignments.push({ rule, snapshots, addition: closestAddition, ambiguous: false });
    const vendorProductKey = ruleVendorProductKey(rule);
    if (vendorProductKey) {
      input.pinAssignments.push({
        vendorId: input.request.vendorId,
        customerId: input.clientId,
        agreementId: input.agreementId,
        vendorProductKey,
        connectWiseAdditionId: closestAddition.connectWiseAdditionId ?? closestAddition.id,
        connectwiseProductCode: closestAddition.productCode,
        connectwiseProductName: closestAddition.productName,
        mappingSource: 'auto-reconcile',
      });
    }
  }

  return assignments;
}

function pickClosestAddition(proposedQuantity: number, additions: AgreementAddition[]) {
  if (additions.length === 0) {
    return undefined;
  }

  return additions.reduce((closest, addition) => {
    if (!closest) {
      return addition;
    }

    const closestDistance = Math.abs(closest.quantity - proposedQuantity);
    const additionDistance = Math.abs(addition.quantity - proposedQuantity);
    return additionDistance < closestDistance ? addition : closest;
  });
}

function buildLine(input: {
  request: ReconcileVendorUsageRequest;
  rule: QuantityRule;
  agreementKey: string;
  clientId: string;
  agreementId: string;
  snapshots: UsageSnapshot[];
  matchedAdditions: AgreementAddition[];
  assignedAddition?: AgreementAddition;
  merged: boolean;
  ambiguous?: boolean;
}): ReconciliationLine | undefined {
  const proposedQuantity = input.snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
  const agreementQuantity = sumAdditions(input.matchedAdditions);
  const delta = proposedQuantity - agreementQuantity;

  if (
    !(input.snapshots.length > 0 || input.matchedAdditions.length > 0) ||
    (proposedQuantity === 0 && agreementQuantity === 0)
  ) {
    return undefined;
  }

  const vendorProductKey = input.merged ? undefined : ruleVendorProductKey(input.rule);
  const assignedAddition = input.assignedAddition ?? input.matchedAdditions[0];
  const connectWiseAdditionId = assignedAddition?.connectWiseAdditionId ?? assignedAddition?.id;
  const unitPrice = unitPriceForImpact(input.matchedAdditions, input.rule.productCode, input.rule.unitPrice);
  const matchedAdditionCount = input.matchedAdditions.length;
  const writeAction: ReconciliationWriteAction | undefined = input.ambiguous
    ? 'review-required'
    : writeActionForDelta(delta, matchedAdditionCount);

  return {
    id: input.merged
      ? `${input.agreementKey}|${input.rule.productCode}|merged-base`
      : `${input.agreementKey}|${vendorProductKey ?? input.rule.productCode}|${connectWiseAdditionId ?? 'unassigned'}|base`,
    vendorId: input.request.vendorId,
    clientId: input.clientId,
    agreementId: input.agreementId,
    productCode: input.rule.productCode,
    productName: input.rule.productName,
    vendorProductKey,
    connectWiseAdditionId,
    matchedAdditionIds: input.matchedAdditions.map((addition) => addition.connectWiseAdditionId ?? addition.id),
    lineType: 'base-count',
    ruleId: input.rule.id,
    sourceQuantity: proposedQuantity,
    agreementQuantity,
    proposedQuantity,
    delta,
    unit: input.rule.billableUnit,
    unitPrice,
    financialImpact: calculateImpact(delta, unitPrice),
    status: statusForDelta(delta),
    writeAction,
    reason: input.ambiguous
      ? `${input.rule.productName} could not be uniquely matched to a ConnectWise addition.`
      : proposedQuantity === agreementQuantity
        ? `${input.rule.productName} count matches the agreement addition.`
        : `${input.rule.productName} count differs from the agreement addition.`,
    evidence: [
      { label: 'Snapshot rows', value: input.snapshots.length },
      { label: 'Matched agreement additions', value: matchedAdditionCount },
      ...(input.merged ? [{ label: 'Reconcile mode', value: 'merged-single-addition' }] : []),
      ...(!input.merged && connectWiseAdditionId
        ? [{ label: 'Assigned ConnectWise addition', value: connectWiseAdditionId }]
        : []),
      ...(unitPrice ? [{ label: 'Unit price', value: unitPrice.amount }] : []),
      { label: 'Rule', value: input.rule.notes },
    ],
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

function calculateImpact(delta: number, unitPrice?: MoneyAmount): MoneyAmount {
  if (!unitPrice) {
    return { ...zeroUsd };
  }

  return {
    amount: delta * unitPrice.amount,
    currency: unitPrice.currency,
  };
}

function statusForDelta(delta: number): ReconciliationStatus {
  return delta === 0 ? 'matched' : 'needs-review';
}

function writeActionForDelta(delta: number, additionCount: number): ReconciliationWriteAction | undefined {
  if (delta === 0) {
    return undefined;
  }
  if (additionCount === 0) {
    return 'create-addition';
  }
  return additionCount === 1 ? 'update-addition' : 'review-required';
}
