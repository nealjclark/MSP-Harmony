import assert from 'node:assert/strict';
import { buildSentinelOneRuleSet } from './rules';

const deviceRules = buildSentinelOneRuleSet({
  'device:workstation': {
    vendorProductKey: 'device:workstation',
    productCode: 'Managed Workstation',
    productName: 'Managed Workstation',
  },
}).rules;

assert.equal(deviceRules.length, 3);
const deviceRule = deviceRules.find((rule) => rule.vendorProductKey === 'device:workstation');
assert.equal(deviceRule?.billableUnit, 'workstation');
assert.equal(deviceRule?.dimensions, undefined);
assert.equal(deviceRule?.requiresExistingAgreementProduct, false);

console.log('sentinelone rules tests passed');
