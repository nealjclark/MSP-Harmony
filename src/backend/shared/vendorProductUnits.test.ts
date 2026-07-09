import assert from 'node:assert/strict';
import { billableUnitForVendorProductKey } from './vendorProductUnits';

async function run() {
  assert.equal(billableUnitForVendorProductKey('device:virtual-server'), 'server');
  assert.equal(billableUnitForVendorProductKey('device:workstation'), 'workstation');
  assert.equal(billableUnitForVendorProductKey('device:other-device'), 'device');
  assert.equal(billableUnitForVendorProductKey('ncentral-workstation'), 'workstation');
  assert.equal(billableUnitForVendorProductKey('M365-E3'), 'license');

  console.log('vendor product unit tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
