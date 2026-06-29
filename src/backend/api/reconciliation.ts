import { reconcileVendorUsage } from '../shared/reconciliation';
import type { ReconcileVendorUsageRequest, ReconciliationResult, VendorRuleSet } from '../shared/types';
import { coveRuleSet } from '../vendor/cove/rules';
import { dattoRuleSet } from '../vendor/datto/rules';
import { microsoft365RuleSet } from '../vendor/microsoft365/rules';
import { ncentralRuleSet } from '../vendor/ncentral/rules';
import { appRiverRuleSet } from '../vendor/appriver/rules';

const vendorRuleSets: Record<string, VendorRuleSet> = {
  [coveRuleSet.vendorId]: coveRuleSet,
  [dattoRuleSet.vendorId]: dattoRuleSet,
  [ncentralRuleSet.vendorId]: ncentralRuleSet,
  [microsoft365RuleSet.vendorId]: microsoft365RuleSet,
  [appRiverRuleSet.vendorId]: appRiverRuleSet,
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
