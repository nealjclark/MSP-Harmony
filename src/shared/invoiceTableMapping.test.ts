import assert from 'node:assert/strict';
import {
  CONSTANT_QUANTITY_ONE,
  columnMappingHeaderOptions,
  columnMapSatisfiesSourceType,
  importRequiresQuantityColumn,
  mappedColumnHeaders,
  matchVendorDatapointByHeaders,
  mergeKnownHeaders,
  mergeInvoiceTableColumnMap,
  normalizeImportedCustomerLabel,
  quantityColumnSelectOptions,
  suggestInvoiceTableColumnMap,
} from './invoiceTableMapping';
import { vendorDatapointVendorId, type VendorDatapointRecord } from './vendorDatapoints';

async function run() {
  assert.equal(normalizeImportedCustomerLabel('[Acme Corp]'), 'Acme Corp');
  assert.equal(normalizeImportedCustomerLabel('"[Beta LLC]"'), 'Beta LLC');
  assert.equal(normalizeImportedCustomerLabel('(Gamma Inc)'), 'Gamma Inc');
  assert.equal(normalizeImportedCustomerLabel('  [Delta]  '), 'Delta');

  const suggestedLicense = suggestInvoiceTableColumnMap(['Client', 'LastCheckIn', 'DeviceType', 'Count']);
  assert.equal(suggestedLicense.externalAccountId, 'Client');
  assert.equal(suggestedLicense.lastCheckIn, 'LastCheckIn');
  assert.equal(suggestedLicense.deviceType, 'DeviceType');
  assert.equal(suggestedLicense.quantity, undefined);

  const suggestedDevice = suggestInvoiceTableColumnMap(
    ['Account', 'Device Type', 'Core Count', 'CPU Type'],
    'device-count',
  );
  assert.equal(suggestedDevice.externalAccountId, 'Account');
  assert.equal(suggestedDevice.deviceType, 'Device Type');
  assert.equal(suggestedDevice.quantity, CONSTANT_QUANTITY_ONE);
  assert.equal(suggestedDevice.chargeType, undefined);

  const merged = mergeInvoiceTableColumnMap(
    {
      externalAccountId: 'Customer',
      lastCheckIn: 'Last Check In',
      quantity: 'Qty',
    },
    ['Client', 'LastCheckIn', 'Qty'],
  );
  assert.equal(merged.externalAccountId, 'Client');
  assert.equal(merged.lastCheckIn, 'LastCheckIn');
  assert.equal(merged.quantity, 'Qty');

  const mergedDevice = mergeInvoiceTableColumnMap(
    {
      externalAccountId: 'Account',
      deviceType: 'Device Type',
      quantity: 'Core Count',
    },
    ['Account', 'Device Type', 'Core Count'],
    'device-count',
  );
  assert.equal(mergedDevice.quantity, 'Core Count');

  const mergedDeviceDefault = mergeInvoiceTableColumnMap(
    {
      externalAccountId: 'Account',
      deviceType: 'Device Type',
    },
    ['Account', 'Device Type', 'Core Count'],
    'device-count',
  );
  assert.equal(mergedDeviceDefault.quantity, CONSTANT_QUANTITY_ONE);

  assert.equal(
    columnMapSatisfiesSourceType('device-count', {
      externalAccountId: 'Client',
      deviceType: 'DeviceType',
      quantity: CONSTANT_QUANTITY_ONE,
    }),
    true,
  );
  assert.equal(
    columnMapSatisfiesSourceType('device-count', {
      externalAccountId: 'Client',
      deviceType: 'DeviceType',
    }),
    true,
  );
  assert.equal(importRequiresQuantityColumn('device-count'), false);
  assert.equal(importRequiresQuantityColumn('license-count'), true);

  assert.deepEqual(
    quantityColumnSelectOptions('device-count', ['Core Count']).slice(0, 2),
    [
      { value: '', label: 'Ignore (defaults to 1 per row)' },
      { value: CONSTANT_QUANTITY_ONE, label: '1 (one per device row)' },
    ],
  );

  const datapoint: VendorDatapointRecord = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    vendorId: vendorDatapointVendorId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    displayName: 'Skout devices',
    sourceType: 'device-count',
    syncMode: 'info-only',
    columnMap: {
      externalAccountId: 'Client',
      deviceType: 'DeviceType',
      lastCheckIn: 'LastCheckIn',
      quantity: CONSTANT_QUANTITY_ONE,
    },
    knownHeaders: [],
    defaultImportMode: 'merge',
    active: true,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };

  const matched = matchVendorDatapointByHeaders([datapoint], ['Client', 'LastCheckIn', 'DeviceType', 'Count']);
  assert.equal(matched?.datapoint.id, datapoint.id);
  assert.equal(matched?.columnMap.lastCheckIn, 'LastCheckIn');
  assert.equal(matched?.columnMap.quantity, CONSTANT_QUANTITY_ONE);

  assert.deepEqual(columnMappingHeaderOptions({ externalAccountId: 'Client', lastCheckIn: 'LastCheckIn' }, ['Count'], ['Hostname']), [
    'Client',
    'Count',
    'Hostname',
    'LastCheckIn',
  ]);
  assert.deepEqual(
    mergeKnownHeaders(['Client'], mappedColumnHeaders({ externalAccountId: 'Client', quantity: undefined })),
    ['Client'],
  );
  assert.deepEqual(
    mappedColumnHeaders({ externalAccountId: 'Client', quantity: CONSTANT_QUANTITY_ONE }),
    ['Client'],
  );
  assert.deepEqual(
    columnMappingHeaderOptions({ externalAccountId: 'Client', quantity: undefined }, ['Hostname'], ['LastCheckIn']),
    ['Client', 'Hostname', 'LastCheckIn'],
  );

  console.log('invoice table mapping tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
