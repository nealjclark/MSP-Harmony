import assert from 'node:assert/strict';
import { reconcileVendor } from '../api/reconciliation';
import { coveDemoAgreementAdditions, coveDemoSnapshots } from '../vendor/cove/demoData';

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

console.log('backend reconciliation tests passed');
