import assert from 'node:assert/strict';
import { reconcileVendor } from '../api/reconciliation';
import { coveDemoAgreementAdditions, coveDemoSnapshots } from '../vendor/cove/demoData';
import { buildNcentralRuleSet } from '../vendor/ncentral/rules';
import { reconcileVendorUsage } from './reconciliation';
import type { AgreementAddition, UsageSnapshot } from './types';

const result = reconcileVendor({
  vendorId: 'cove',
  snapshots: coveDemoSnapshots,
  agreementAdditions: coveDemoAgreementAdditions,
});

const serverBase = result.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
assert.equal(serverBase?.status, 'matched');
assert.equal(serverBase?.proposedQuantity, 2);

const serverStorageAddOn = result.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
assert.equal(serverStorageAddOn?.status, 'needs-review');
assert.equal(serverStorageAddOn?.sourceQuantity, 3200);
assert.equal(serverStorageAddOn?.proposedQuantity, 2);
assert.equal(serverStorageAddOn?.agreementQuantity, 1);
assert.equal(serverStorageAddOn?.delta, 1);
assert.equal(serverStorageAddOn?.financialImpact.amount, 75);

const workstationStorage = result.lines.find(
  (line) => line.productCode === 'COVE-WORKSTATION' && line.lineType === 'usage-add-on',
);
assert.equal(workstationStorage, undefined);

assert.equal(result.totals.matched, 2);
assert.equal(result.totals.needsReview, 1);
assert.equal(result.totals.notBillable, 0);
assert.equal(result.totals.financialImpact.amount, 75);

const ncentralRules = buildNcentralRuleSet({
  'ncentral-workstation': {
    vendorProductKey: 'ncentral-workstation',
    productCode: 'Managed Workstation',
    productName: 'Managed Workstation',
  },
}).rules;

const ncentralSourceOnly = reconcileVendorUsage({
  vendorId: 'ncentral',
  rules: ncentralRules,
  snapshots: [ncentralSnapshot('ncentral-workstation-1')],
  agreementAdditions: [],
});
assert.equal(ncentralSourceOnly.lines.length, 0);

const ncentralExistingProduct = reconcileVendorUsage({
  vendorId: 'ncentral',
  rules: ncentralRules,
  snapshots: [ncentralSnapshot('ncentral-workstation-1'), ncentralSnapshot('ncentral-workstation-2')],
  agreementAdditions: [ncentralAddition('Managed Workstation', 1)],
});
const ncentralWorkstationLine = ncentralExistingProduct.lines.find((line) => line.productCode === 'Managed Workstation');
assert.equal(ncentralWorkstationLine?.status, 'needs-review');
assert.equal(ncentralWorkstationLine?.writeAction, 'update-addition');
assert.equal(ncentralWorkstationLine?.sourceQuantity, 2);
assert.equal(ncentralWorkstationLine?.agreementQuantity, 1);

console.log('backend reconciliation tests passed');

function ncentralSnapshot(id: string): UsageSnapshot {
  return {
    id,
    vendorId: 'ncentral',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    vendorProductKey: 'ncentral-workstation',
    productCode: 'Managed Workstation',
    productName: 'Managed Workstation',
    quantity: 1,
    observedAt: '2026-06-17T12:00:00.000Z',
    dimensions: {
      ncentralProductType: 'workstation',
    },
  };
}

function ncentralAddition(productCode: string, quantity: number): AgreementAddition {
  return {
    id: `addition-${productCode}`,
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode,
    productName: productCode,
    quantity,
  };
}
