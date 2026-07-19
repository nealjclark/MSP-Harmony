import assert from 'node:assert/strict';
import { reconcileVendor } from '../api/reconciliation';
import { coveDemoAgreementAdditions, coveDemoSnapshots } from '../vendor/cove/demoData';
import { buildCoveRuleSet } from '../vendor/cove/rules';
import { reconcileVendorUsage } from './reconciliation';
import type { AgreementAddition } from './types';

const matchedResult = reconcileVendor({
  vendorId: 'cove',
  snapshots: coveDemoSnapshots,
  agreementAdditions: coveDemoAgreementAdditions,
});

const matchedServer = matchedResult.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
assert.equal(matchedServer?.status, 'matched');
assert.equal(matchedServer?.delta, 0);

const overCountResult = reconcileVendor({
  vendorId: 'cove',
  snapshots: coveDemoSnapshots,
  agreementAdditions: withAdditionQuantity(coveDemoAgreementAdditions, 'COVE-SERVER', 1),
});

const overCountServer = overCountResult.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
assert.equal(overCountServer?.status, 'needs-review');
assert.equal(overCountServer?.delta, 1);
assert.equal(overCountServer?.proposedQuantity, 2);

const actualAgreementPriceResult = reconcileVendorUsage({
  vendorId: 'cove',
  rules: buildCoveRuleSet({
    'cove-server': {
      vendorProductKey: 'cove-server',
      productCode: 'COVE-SERVER',
      productName: 'Cove Server Backup',
      unitPrice: { amount: 999, currency: 'USD' },
    },
  }).rules,
  snapshots: [serverSnapshot('actual-price-1', 100), serverSnapshot('actual-price-2', 100)],
  agreementAdditions: [addition('COVE-SERVER', 1, 42)],
});
const actualAgreementPriceLine = actualAgreementPriceResult.lines.find(
  (line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count',
);
assert.equal(actualAgreementPriceLine?.delta, 1);
assert.equal(actualAgreementPriceLine?.unitPrice?.amount, 42);
assert.equal(actualAgreementPriceLine?.financialImpact.amount, 42);

const underCountResult = reconcileVendor({
  vendorId: 'cove',
  snapshots: coveDemoSnapshots,
  agreementAdditions: withAdditionQuantity(coveDemoAgreementAdditions, 'COVE-SERVER', 3),
});

const underCountServer = underCountResult.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
assert.equal(underCountServer?.status, 'needs-review');
assert.equal(underCountServer?.delta, -1);
assert.equal(underCountServer?.proposedQuantity, 2);

const alternateProductResult = reconcileVendorUsage({
  vendorId: 'cove',
  rules: buildCoveRuleSet({
    'cove-server': {
      vendorProductKey: 'cove-server',
      productCode: 'COVE-SERVER',
      productName: 'Cove Server Backup',
      targetProductCodes: ['COVE-SERVER', 'ALT-COVE-SERVER'],
    },
  }).rules,
  snapshots: coveDemoSnapshots.map((snapshot) =>
    snapshot.productCode === 'COVE-SERVER'
      ? {
          ...snapshot,
          vendorProductKey: 'cove-server',
        }
      : snapshot,
  ),
  agreementAdditions: coveDemoAgreementAdditions.map((addition) =>
    addition.productCode === 'COVE-SERVER'
      ? {
          ...addition,
          productCode: 'ALT-COVE-SERVER',
        }
      : addition,
  ),
});
const alternateProductServer = alternateProductResult.lines.find((line) => line.productCode === 'ALT-COVE-SERVER' && line.lineType === 'base-count');
assert.equal(alternateProductServer?.status, 'matched');
assert.equal(alternateProductServer?.agreementQuantity, 2);

const storageAddOn = matchedResult.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
assert.equal(storageAddOn?.status, 'needs-review');
assert.equal(storageAddOn?.sourceQuantity, 2);
assert.equal(storageAddOn?.proposedQuantity, 2);
assert.equal(storageAddOn?.delta, 1);
assert.equal(storageAddOn?.financialImpact.amount, 75);
assert.equal(storageAddOn?.evidence.find((item) => item.label === 'Measured usage')?.value, 3200);

const pooledNoOverage = reconcileVendor({
  vendorId: 'cove',
  snapshots: [
    serverSnapshot('pooled-1', 171),
    serverSnapshot('pooled-2', 452),
    serverSnapshot('pooled-3', 1073),
  ],
  agreementAdditions: [
    addition('COVE-SERVER', 3),
    addition('COVE-SERVER-STORAGE-ADDON', 0),
  ],
});
const pooledNoOverageAddOn = pooledNoOverage.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
assert.equal(pooledNoOverageAddOn, undefined);

const singleServerOverage = reconcileVendor({
  vendorId: 'cove',
  snapshots: [serverSnapshot('single-over', 1135)],
  agreementAdditions: [
    addition('COVE-SERVER', 1),
    addition('COVE-SERVER-STORAGE-ADDON', 0),
  ],
});
const singleServerAddOn = singleServerOverage.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
assert.equal(singleServerAddOn?.status, 'needs-review');
assert.equal(singleServerAddOn?.proposedQuantity, 1);
assert.equal(singleServerAddOn?.writeAction, 'update-addition');

const missingAddOn = reconcileVendor({
  vendorId: 'cove',
  snapshots: [serverSnapshot('missing-addon', 1135)],
  agreementAdditions: [addition('COVE-SERVER', 1)],
});
const missingAddOnLine = missingAddOn.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
assert.equal(missingAddOnLine?.status, 'needs-review');
assert.equal(missingAddOnLine?.writeAction, 'create-addition');

const missingCurrentServer = reconcileVendor({
  vendorId: 'cove',
  snapshots: [workstationSnapshot('current-workstation')],
  agreementAdditions: [
    addition('COVE-WORKSTATION', 1),
    addition('COVE-SERVER', 1),
  ],
});
const missingCurrentServerLine = missingCurrentServer.lines.find(
  (line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count',
);
assert.equal(missingCurrentServerLine?.status, 'needs-review');
assert.equal(missingCurrentServerLine?.sourceQuantity, 0);
assert.equal(missingCurrentServerLine?.agreementQuantity, 1);
assert.equal(missingCurrentServerLine?.delta, -1);

const workstationStorage = matchedResult.lines.find(
  (line) => line.productCode === 'COVE-WORKSTATION' && line.lineType === 'usage-add-on',
);
assert.equal(workstationStorage, undefined);

function withAdditionQuantity(
  additions: AgreementAddition[],
  productCode: string,
  quantity: number,
): AgreementAddition[] {
  return additions.map((addition) =>
    addition.productCode === productCode
      ? {
          ...addition,
          quantity,
        }
      : addition,
  );
}

function serverSnapshot(id: string, selectedStorageGb: number) {
  return {
    id,
    vendorId: 'cove',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-SERVER',
    productName: 'Cove Server Backup',
    quantity: 1,
    observedAt: '2026-06-03T12:00:00.000Z',
    dimensions: {
      protectedSystemType: 'server',
      selectedStorageGb,
    },
  };
}

function workstationSnapshot(id: string) {
  return {
    id,
    vendorId: 'cove',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    vendorProductKey: 'cove-workstation',
    productCode: 'COVE-WORKSTATION',
    productName: 'Cove Workstation Backup',
    quantity: 1,
    observedAt: '2026-06-03T12:00:00.000Z',
    dimensions: {
      protectedSystemType: 'workstation',
      selectedStorageGb: 250,
    },
  };
}

function addition(productCode: string, quantity: number, unitPrice = 75): AgreementAddition {
  return {
    id: `addition-${productCode}`,
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode,
    productName: productCode,
    quantity,
    unitPrice: { amount: unitPrice, currency: 'USD' },
  };
}

console.log('cove reconciliation scenario tests passed');
