import type { AgreementAddition, DimensionFilter, QuantityRule, UsageSnapshot } from './types';

export function normalizeProductCode(productCode: string) {
  return productCode.trim().toLowerCase();
}

export function targetProductCodes(target: { productCode: string; targetProductCodes?: string[] }) {
  return [...new Set([target.productCode, ...(target.targetProductCodes ?? [])])];
}

export function ruleTargetsProductCode(rule: QuantityRule, productCode: string) {
  return targetProductCodes(rule).some(
    (code) => normalizeProductCode(code) === normalizeProductCode(productCode),
  );
}

export function findAdditions(
  additions: AgreementAddition[],
  clientId: string,
  agreementId: string,
  productCodes: string[],
) {
  const targetCodes = new Set(productCodes.map(normalizeProductCode));
  return additions.filter(
    (addition) =>
      addition.clientId === clientId &&
      addition.agreementId === agreementId &&
      targetCodes.has(normalizeProductCode(addition.productCode)),
  );
}

export function sumAdditions(additions: AgreementAddition[]) {
  return additions.reduce((total, addition) => total + addition.quantity, 0);
}

export function ruleVendorProductKey(rule: QuantityRule) {
  return rule.vendorProductKey ?? rule.vendorProductKeys?.[0];
}

export function ruleVendorProductKeys(rule: QuantityRule) {
  return [
    ...new Set([rule.vendorProductKey, ...(rule.vendorProductKeys ?? [])].filter((key): key is string => Boolean(key))),
  ];
}

export function matchesRuleProduct(snapshot: UsageSnapshot, rule: QuantityRule) {
  const vendorProductKeys = ruleVendorProductKeys(rule);
  if (vendorProductKeys.length > 0 && snapshot.vendorProductKey) {
    return vendorProductKeys.includes(snapshot.vendorProductKey);
  }

  return targetProductCodes(rule).some(
    (code) => normalizeProductCode(code) === normalizeProductCode(snapshot.productCode),
  );
}

export function matchesDimensions(snapshot: UsageSnapshot, dimensions?: DimensionFilter) {
  if (!dimensions) {
    return true;
  }

  return Object.entries(dimensions).every(([key, expected]) => snapshot.dimensions[key] === expected);
}

export function agreementKey(clientId: string, agreementId: string) {
  return `${clientId}|${agreementId}`;
}

export function additionsForAgreement(additions: AgreementAddition[], agreementKey: string) {
  const [clientId, agreementId] = agreementKey.split('|');
  return additions.filter(
    (addition) => addition.clientId === clientId && addition.agreementId === agreementId,
  );
}

export function groupSnapshotsByAgreement(snapshots: UsageSnapshot[]) {
  return snapshots.reduce((groups, snapshot) => {
    const key = agreementKey(snapshot.clientId, snapshot.agreementId);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, snapshot]);
    return groups;
  }, new Map<string, UsageSnapshot[]>());
}

export function additionIdentity(addition: AgreementAddition) {
  return addition.connectWiseAdditionId ?? addition.id;
}
