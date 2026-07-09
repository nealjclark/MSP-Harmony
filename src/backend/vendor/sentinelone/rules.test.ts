import assert from 'node:assert/strict';
import { buildSentinelOneRuleSet } from './rules';

const deviceRules = buildSentinelOneRuleSet({
  'device:workstation': {
    vendorProductKey: 'device:workstation',
    productCode: 'Managed Workstation',
    productName: 'Managed Workstation',
  },
}).rules;

assert.equal(deviceRules.length, 1);
const deviceRule = deviceRules.find((rule) => rule.vendorProductKey === 'device:workstation');
assert.equal(deviceRule?.billableUnit, 'workstation');
assert.equal(deviceRule?.dimensions, undefined);
assert.equal(deviceRule?.requiresExistingAgreementProduct, false);
assert.equal(
  deviceRules.some((rule) => rule.vendorProductKey === 'sentinelone-server'),
  false,
);

const apiOnlyRules = buildSentinelOneRuleSet().rules;
assert.equal(apiOnlyRules.length, 2);
assert.equal(
  apiOnlyRules.every((rule) => rule.vendorProductKey?.startsWith('sentinelone-')),
  true,
);

console.log('sentinelone rules tests passed');
