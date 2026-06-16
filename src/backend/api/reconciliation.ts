import { reconcileVendorUsage } from '../shared/reconciliation';
import type { ReconcileVendorUsageRequest, ReconciliationResult, VendorRuleSet } from '../shared/types';
import { coveRuleSet } from '../vendor/cove/rules';

const vendorRuleSets: Record<string, VendorRuleSet> = {
  [coveRuleSet.vendorId]: coveRuleSet,
};

export function listVendorRuleSets() {
  return Object.values(vendorRuleSets);
}

export function getVendorRuleSet(vendorId: string) {
  return vendorRuleSets[vendorId];
}

export function reconcileVendor(request: Omit<ReconcileVendorUsageRequest, 'rules'>): ReconciliationResult {
  const ruleSet = getVendorRuleSet(request.vendorId);

  if (!ruleSet) {
    throw new Error(`No reconciliation rule set is configured for vendor "${request.vendorId}".`);
  }

  return reconcileVendorUsage({
    ...request,
    rules: ruleSet.rules,
  });
}
