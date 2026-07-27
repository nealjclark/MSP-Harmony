import assert from 'node:assert/strict';
import * as XLSX from '@e965/xlsx';
import {
  isIngramCustomerExcluded,
  normalizeIngramRow,
  parseIngramExcludedCustomerNames,
  parseIngramWorkbook,
} from './operations';

const row = {
  CUSTOMER_NAME: 'Example Client',
  SUBSCRIPTION_ID: 'subscription-1',
  CUSTOMER_DETAIL_DESCRIPTION: 'Microsoft Azure',
  QTY: 1,
  RESELLER_DETAIL_UNIT_PRICE: 125.1234,
  TOTAL: 125.1234,
};
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row, row]), 'Invoice');
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
const parsed = parseIngramWorkbook(bytes);

assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.SUBSCRIPTION_ID, 'subscription-1');
assert.equal(Number(parsed[0]?.TOTAL), 125.1234);

const excludedCustomerNames = parseIngramExcludedCustomerNames('BMB Solutions, Internal Test\nSample Tenant');
assert.deepEqual(excludedCustomerNames, ['BMB Solutions', 'Internal Test', 'Sample Tenant']);
assert.equal(isIngramCustomerExcluded('BMB Solutions', excludedCustomerNames), true);
assert.equal(isIngramCustomerExcluded(' bmb-solutions ', excludedCustomerNames), true);
assert.equal(isIngramCustomerExcluded('Example Client', excludedCustomerNames), false);

console.log('Ingram invoice operations tests passed');

const normalized = normalizeIngramRow({
  CUSTOMER_NAME: 'Example Client',
  SUBSCRIPTION_ID: '1470360',
  RESELLER_RESOURCE_MPN: 'MS-AZR-0017G-RI',
  CUSTOMER_DETAIL_DESCRIPTION: 'Azure Reserved Instance',
  RESELLER_DETAIL_TYPE: 'Resource Overusage',
  RESELLER_DETAIL_QTY: '1',
  RESELLER_DETAIL_UNIT_PRICE: '59.00',
  RESELLER_DETAIL_TOTAL: '59.00',
  RESELLER_INVOICE_DATE: '2026-07-21',
  RESELLER_ACTUAL_DETAIL_START_DATE: '2026-06-10',
  RESELLER_ACTUAL_DETAIL_END_DATE: '2026-06-30',
});
assert.deepEqual(normalized, {
  subscriptionId: '1470360',
  customerAccountId: '1470360',
  customerName: 'Example Client',
  vendorProductKey: 'ingram:MS-AZR-0017G-RI',
  productCode: 'MS-AZR-0017G-RI',
  productName: 'Azure Reserved Instance',
  chargeType: 'Resource Overusage',
  chargeName: 'Azure Reserved Instance',
  quantity: 1,
  unitCost: 59,
  extendedCost: 59,
  invoiceDate: '2026-07-21',
  billingPeriodStart: '2026-06-10',
  billingPeriodEnd: '2026-06-30',
});
