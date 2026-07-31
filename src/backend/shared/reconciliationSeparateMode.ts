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
import { billableUnitForVendorProductKey } from './vendorProductUnits';

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

  for (const currentAgreementKey of agreementKeys) {
    lines.push(
      ...reconcileAgreement({
        request,
        contexts,
        agreementKey: currentAgreementKey,
        pins: request.additionPins ?? [],
        pinAssignments,
      }),
    );
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

function reconcileAgreement(input: {
  request: ReconcileVendorUsageRequest;
  contexts: RuleContext[];
  agreementKey: string;
  pins: VendorProductAdditionPin[];
  pinAssignments: VendorProductAdditionPinAssignment[];
}) {
  const [clientId, agreementId] = input.agreementKey.split('|');
  const activeContexts = input.contexts.filter((context) => context.snapshotsByAgreement.has(input.agreementKey));
  const activeRules = activeContexts.map((context) => context.rule);
  if (activeRules.length === 0) {
    return [];
  }

  const agreementAdditions = additionsForAgreement(input.request.agreementAdditions, input.agreementKey);
  const snapshotsByRule = new Map(
    activeContexts.map((context) => [context.rule.id, context.snapshotsByAgreement.get(input.agreementKey) ?? []] as const),
  );

  // Keep unrelated mapped products apart (e.g. N-central servers vs workstations) even when
  // they share an agreement. Only rules with overlapping target codes form a merge family.
  return partitionRulesBySharedTargets(activeRules).flatMap((familyRules) =>
    reconcileRuleFamily({
      request: input.request,
      agreementKey: input.agreementKey,
      clientId,
      agreementId,
      familyRules,
      agreementAdditions,
      snapshotsByRule,
      pins: input.pins,
      pinAssignments: input.pinAssignments,
    }),
  );
}

function reconcileRuleFamily(input: {
  request: ReconcileVendorUsageRequest;
  agreementKey: string;
  clientId: string;
  agreementId: string;
  familyRules: QuantityRule[];
  agreementAdditions: AgreementAddition[];
  snapshotsByRule: Map<string, UsageSnapshot[]>;
  pins: VendorProductAdditionPin[];
  pinAssignments: VendorProductAdditionPinAssignment[];
}) {
  const matchedAdditions = uniqueAdditions(
    input.familyRules.flatMap((rule) =>
      findAdditions(input.agreementAdditions, input.clientId, input.agreementId, targetProductCodes(rule)),
    ),
  );
  const sourceGroups = buildRuleSourceGroups(input.familyRules, input.snapshotsByRule);
  const sourceAccountIds = new Set(
    sourceGroups
      .map((group) => group.sourceAccountId)
      .filter((value): value is string => Boolean(value)),
  );
  const hasAccountSplit = sourceAccountIds.size > 1;

  // Single CW addition for this catalog family: merge related vendor counts into one line.
  if (matchedAdditions.length <= 1 && !hasAccountSplit) {
    const mergedSnapshots = input.familyRules.flatMap((rule) => input.snapshotsByRule.get(rule.id) ?? []);
    const primaryRule = pickPrimaryMergedRule(input.familyRules, input.snapshotsByRule);
    if (primaryRule.requiresExistingAgreementProduct && matchedAdditions.length === 0) {
      return [];
    }

    return [
      buildLine({
        request: input.request,
        rule: primaryRule,
        agreementKey: input.agreementKey,
        clientId: input.clientId,
        agreementId: input.agreementId,
        snapshots: mergedSnapshots,
        matchedAdditions,
        assignedAddition: matchedAdditions[0],
        sourceVendorProductKey: sourceGroups.length === 1 ? sourceGroups[0].vendorProductKey : undefined,
        sourceAccountId: sourceAccountIds.size === 1 ? sourceAccountIds.values().next().value : undefined,
        sourceAccountName: sourceGroups.find((group) => group.sourceAccountId)?.sourceAccountName,
        merged: input.familyRules.length > 1,
      }),
    ].filter((line): line is ReconciliationLine => Boolean(line));
  }

  // Multiple same-catalog (or overlapping-target) additions: assign each vendor product key
  // to one addition, then surface any leftover additions as zero-source review rows.
  const claimedAdditionIds = new Set<string>();
  const assignments = assignRulesToAdditions({
    request: input.request,
    sourceGroups,
    additions: matchedAdditions,
    pins: input.pins,
    clientId: input.clientId,
    agreementId: input.agreementId,
    pinAssignments: input.pinAssignments,
    claimedAdditionIds,
  });

  const assignedLines = assignments
    .map((assignment) =>
      buildLine({
        request: input.request,
        rule: assignment.rule,
        agreementKey: input.agreementKey,
        clientId: input.clientId,
        agreementId: input.agreementId,
        snapshots: assignment.snapshots,
        matchedAdditions: assignment.addition ? [assignment.addition] : [],
        assignedAddition: assignment.addition,
        sourceVendorProductKey: assignment.vendorProductKey,
        sourceAccountId: assignment.sourceAccountId,
        sourceAccountName: assignment.sourceAccountName,
        merged: false,
        ambiguous: assignment.ambiguous,
      }),
    )
    .filter((line): line is ReconciliationLine => Boolean(line));

  const leftoverAdditions = matchedAdditions.filter((addition) => !claimedAdditionIds.has(additionIdentity(addition)));
  const leftoverLines = leftoverAdditions
    .map((addition) =>
      buildLeftoverAdditionLine({
        request: input.request,
        agreementKey: input.agreementKey,
        clientId: input.clientId,
        agreementId: input.agreementId,
        addition,
        fallbackRule: pickRuleForLeftoverAddition(input.familyRules, addition) ?? input.familyRules[0],
      }),
    )
    .filter((line): line is ReconciliationLine => Boolean(line));

  return [...assignedLines, ...leftoverLines];
}

function partitionRulesBySharedTargets(rules: QuantityRule[]): QuantityRule[][] {
  if (rules.length <= 1) {
    return rules.map((rule) => [rule]);
  }

  const parent = new Map<string, string>();
  for (const rule of rules) {
    parent.set(rule.id, rule.id);
  }

  const find = (ruleId: string): string => {
    const current = parent.get(ruleId) ?? ruleId;
    if (current === ruleId) {
      return ruleId;
    }
    const root = find(current);
    parent.set(ruleId, root);
    return root;
  };

  const unite = (leftId: string, rightId: string) => {
    const leftRoot = find(leftId);
    const rightRoot = find(rightId);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  };

  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const leftCodes = new Set(targetProductCodes(rules[leftIndex]).map(normalizeProductCode));
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const overlaps = targetProductCodes(rules[rightIndex]).some((code) => leftCodes.has(normalizeProductCode(code)));
      if (overlaps) {
        unite(rules[leftIndex].id, rules[rightIndex].id);
      }
    }
  }

  const families = new Map<string, QuantityRule[]>();
  for (const rule of rules) {
    const root = find(rule.id);
    const family = families.get(root) ?? [];
    family.push(rule);
    families.set(root, family);
  }

  return [...families.values()];
}

function uniqueAdditions(additions: AgreementAddition[]) {
  const seen = new Set<string>();
  return additions.filter((addition) => {
    const id = additionIdentity(addition);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function pickPrimaryMergedRule(rules: QuantityRule[], snapshotsByRule: Map<string, UsageSnapshot[]>) {
  return [...rules].sort((left, right) => {
    const leftQuantity = (snapshotsByRule.get(left.id) ?? []).reduce((total, snapshot) => total + snapshot.quantity, 0);
    const rightQuantity = (snapshotsByRule.get(right.id) ?? []).reduce(
      (total, snapshot) => total + snapshot.quantity,
      0,
    );
    return rightQuantity - leftQuantity;
  })[0];
}

function pickRuleForLeftoverAddition(rules: QuantityRule[], addition: AgreementAddition) {
  return rules.find((rule) => ruleTargetsProductCode(rule, addition.productCode));
}

type RuleAssignment = {
  rule: QuantityRule;
  snapshots: UsageSnapshot[];
  vendorProductKey?: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
  addition?: AgreementAddition;
  ambiguous: boolean;
};

function buildRuleSourceGroups(
  rules: QuantityRule[],
  snapshotsByRule: Map<string, UsageSnapshot[]>,
): RuleAssignment[] {
  return rules.flatMap((rule) => {
    const snapshots = snapshotsByRule.get(rule.id) ?? [];
    const explicitAccountIds = new Set(
      snapshots
        .map(snapshotSourceAccountId)
        .filter((value): value is string => Boolean(value)),
    );

    if (explicitAccountIds.size <= 1) {
      return [{
        rule,
        snapshots,
        vendorProductKey: sourceGroupVendorProductKey(rule, snapshots),
        sourceAccountId: explicitAccountIds.values().next().value,
        sourceAccountName: snapshotSourceAccountName(snapshots[0]),
        ambiguous: false,
      }];
    }

    const groups = new Map<string, UsageSnapshot[]>();
    for (const snapshot of snapshots) {
      const sourceAccountId = snapshotSourceAccountId(snapshot) ?? snapshot.clientId;
      groups.set(sourceAccountId, [...(groups.get(sourceAccountId) ?? []), snapshot]);
    }

    return [...groups.entries()].map(([sourceAccountId, accountSnapshots]) => ({
      rule,
      snapshots: accountSnapshots,
      vendorProductKey: sourceGroupVendorProductKey(rule, accountSnapshots),
      sourceAccountId,
      sourceAccountName: snapshotSourceAccountName(accountSnapshots[0]),
      ambiguous: false,
    }));
  });
}

function assignRulesToAdditions(input: {
  request: ReconcileVendorUsageRequest;
  sourceGroups: RuleAssignment[];
  additions: AgreementAddition[];
  pins: VendorProductAdditionPin[];
  clientId: string;
  agreementId: string;
  pinAssignments: VendorProductAdditionPinAssignment[];
  claimedAdditionIds: Set<string>;
}) {
  const assignments: RuleAssignment[] = [];
  const pendingGroups: RuleAssignment[] = [];
  const hasMultipleSourceAccounts =
    new Set(
      input.sourceGroups
        .map((group) => group.sourceAccountId)
        .filter((value): value is string => Boolean(value)),
    ).size > 1;

  for (const group of input.sourceGroups) {
    const { rule, snapshots, sourceAccountId } = group;
    const proposedQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    if (rule.requiresExistingAgreementProduct && input.additions.length === 0) {
      continue;
    }
    if (proposedQuantity === 0 && !input.additions.some((addition) => addition.quantity > 0)) {
      continue;
    }

    const vendorProductKey = group.vendorProductKey;
    const pin = input.pins.find(
      (candidate) =>
        candidate.agreementId === input.agreementId &&
        candidate.vendorProductKey === vendorProductKey &&
        candidate.sourceAccountId === sourceAccountId,
    );
    const pinnedAddition = pin
      ? input.additions.find(
          (addition) =>
            addition.connectWiseAdditionId === pin.connectWiseAdditionId || addition.id === pin.connectWiseAdditionId,
        )
      : undefined;

    if (pinnedAddition && !input.claimedAdditionIds.has(additionIdentity(pinnedAddition))) {
      input.claimedAdditionIds.add(additionIdentity(pinnedAddition));
      assignments.push({ ...group, addition: pinnedAddition, ambiguous: false });
      continue;
    }

    pendingGroups.push(group);
  }

  const pendingByQuantity = [...pendingGroups].sort((left, right) => {
    const leftQuantity = left.snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const rightQuantity = right.snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    return rightQuantity - leftQuantity;
  });

  for (const group of pendingByQuantity) {
    const { rule, snapshots, sourceAccountId } = group;
    const proposedQuantity = snapshots.reduce((total, snapshot) => total + snapshot.quantity, 0);
    const availableAdditions = input.additions.filter(
      (addition) =>
        !input.claimedAdditionIds.has(additionIdentity(addition)) && ruleTargetsProductCode(rule, addition.productCode),
    );
    const closestAddition = pickClosestAddition(
      proposedQuantity,
      availableAdditions,
      rule,
      hasMultipleSourceAccounts,
    );

    if (!closestAddition) {
      assignments.push({
        ...group,
        ambiguous: availableAdditions.length > 0,
      });
      continue;
    }

    input.claimedAdditionIds.add(additionIdentity(closestAddition));
    assignments.push({ ...group, addition: closestAddition, ambiguous: false });
    const vendorProductKey = group.vendorProductKey;
    const existingPin = input.pins.find(
      (candidate) =>
        candidate.agreementId === input.agreementId &&
        candidate.vendorProductKey === vendorProductKey &&
        candidate.sourceAccountId === sourceAccountId,
    );
    if (vendorProductKey && existingPin?.mappingSource !== 'manual') {
      input.pinAssignments.push({
        vendorId: input.request.vendorId,
        customerId: input.clientId,
        agreementId: input.agreementId,
        vendorProductKey,
        sourceAccountId,
        connectWiseAdditionId: closestAddition.connectWiseAdditionId ?? closestAddition.id,
        connectwiseProductCode: closestAddition.productCode,
        connectwiseProductName: closestAddition.productName,
        mappingSource: 'auto-reconcile',
      });
    }
  }

  return assignments;
}

function pickClosestAddition(
  proposedQuantity: number,
  additions: AgreementAddition[],
  rule: QuantityRule,
  allowStableAccountTieBreak = false,
) {
  if (additions.length === 0) {
    return undefined;
  }

  const exactMatches = additions.filter((addition) => addition.quantity === proposedQuantity);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1 && allowStableAccountTieBreak) {
    return [...exactMatches].sort((left, right) =>
      additionIdentity(left).localeCompare(additionIdentity(right)),
    )[0];
  }

  const ranked = [...(exactMatches.length > 0 ? exactMatches : additions)].sort((left, right) => {
    const leftDistance = Math.abs(left.quantity - proposedQuantity);
    const rightDistance = Math.abs(right.quantity - proposedQuantity);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return priceHintScore(right, rule) - priceHintScore(left, rule);
  });

  if (
    ranked.length > 1 &&
    Math.abs(ranked[0].quantity - proposedQuantity) === Math.abs(ranked[1].quantity - proposedQuantity) &&
    priceHintScore(ranked[0], rule) === priceHintScore(ranked[1], rule)
  ) {
    return undefined;
  }

  return ranked[0];
}

function snapshotSourceAccountId(snapshot: UsageSnapshot) {
  const value =
    snapshot.dimensions.externalCustomerAccountNumber ??
    snapshot.dimensions.appRiverCustomerId ??
    snapshot.dimensions.externalAccountId ??
    snapshot.dimensions.accountId;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function snapshotSourceAccountName(snapshot: UsageSnapshot | undefined) {
  const value =
    snapshot?.dimensions.appRiverCustomerName ??
    snapshot?.dimensions.externalAccountName ??
    snapshot?.dimensions.customerName;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function snapshotSourceAccountAliases(snapshots: UsageSnapshot[]) {
  return [
    ...new Set(
      snapshots.flatMap((snapshot) =>
        [
          snapshot.dimensions.externalCustomerAccountNumber,
          snapshot.dimensions.appRiverCustomerId,
          snapshot.dimensions.externalAccountId,
          snapshot.dimensions.accountId,
          snapshot.dimensions.appRiverCustomerName,
          snapshot.dimensions.externalAccountName,
          snapshot.dimensions.customerName,
        ]
          .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
          .map(String),
      ),
    ),
  ];
}

function sourceGroupVendorProductKey(rule: QuantityRule, snapshots: UsageSnapshot[]) {
  const keys = [
    ...new Set(
      snapshots
        .map((snapshot) => snapshot.vendorProductKey)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  return keys.length === 1 ? keys[0] : ruleVendorProductKey(rule);
}

function priceHintScore(addition: AgreementAddition, rule: QuantityRule) {
  const unit = rule.billableUnit ?? billableUnitForVendorProductKey(ruleVendorProductKey(rule));
  const price = addition.unitPrice?.amount ?? 0;
  if (unit === 'server') {
    return price;
  }
  if (unit === 'workstation') {
    return -price;
  }
  return 0;
}

function buildLeftoverAdditionLine(input: {
  request: ReconcileVendorUsageRequest;
  agreementKey: string;
  clientId: string;
  agreementId: string;
  addition: AgreementAddition;
  fallbackRule: QuantityRule;
}): ReconciliationLine | undefined {
  return buildLine({
    request: input.request,
    rule: {
      ...input.fallbackRule,
      productCode: input.addition.productCode,
      productName: input.addition.productName,
      billableUnit: input.fallbackRule.billableUnit,
      notes: `${input.addition.productName} has no assigned vendor product count in separate mode.`,
    },
    agreementKey: input.agreementKey,
    clientId: input.clientId,
    agreementId: input.agreementId,
    snapshots: [],
    matchedAdditions: [input.addition],
    assignedAddition: input.addition,
    merged: false,
    ambiguous: true,
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
  sourceVendorProductKey?: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
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

  const liveVendorProductKeys = [
    ...new Set(
      input.snapshots
        .filter((snapshot) => snapshot.dimensions.linkedCountAnchor !== true)
        .map((snapshot) => snapshot.vendorProductKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  const vendorProductKey = input.merged
    ? liveVendorProductKeys.length === 1
      ? liveVendorProductKeys[0]
      : undefined
    : input.sourceVendorProductKey ?? ruleVendorProductKey(input.rule);
  const assignedAddition = input.assignedAddition ?? input.matchedAdditions[0];
  const connectWiseAdditionId = assignedAddition?.connectWiseAdditionId ?? assignedAddition?.id;
  const unitPrice =
    assignedAddition?.unitPrice ??
    unitPriceForImpact(input.matchedAdditions, input.rule.productCode, input.rule.unitPrice);
  const matchedAdditionCount = input.matchedAdditions.length;
  const writeAction: ReconciliationWriteAction | undefined = input.ambiguous
    ? 'review-required'
    : writeActionForDelta(delta, matchedAdditionCount);

  return {
    id: input.merged
      ? `${input.agreementKey}|${normalizeProductCode(assignedAddition?.productCode ?? input.rule.productCode)}|merged-base`
      : `${input.agreementKey}|${input.sourceAccountId ?? 'all-accounts'}|${vendorProductKey ?? input.rule.productCode}|${connectWiseAdditionId ?? 'unassigned'}|base`,
    vendorId: input.request.vendorId,
    clientId: input.clientId,
    agreementId: input.agreementId,
    productCode: assignedAddition?.productCode ?? input.rule.productCode,
    productName: assignedAddition?.productName ?? input.rule.productName,
    vendorProductKey,
    sourceAccountId: input.sourceAccountId,
    sourceAccountAliases: snapshotSourceAccountAliases(input.snapshots),
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
      ...(input.sourceAccountName
        ? [{ label: 'Source account', value: input.sourceAccountName }]
        : input.sourceAccountId
          ? [{ label: 'Source account', value: input.sourceAccountId }]
          : []),
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
