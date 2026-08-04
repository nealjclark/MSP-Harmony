import assert from 'node:assert/strict';
import { defaultSalesSettings, type QuoteLineSnapshot } from '../../shared/sales';
import { evaluateQuotePolicy } from './policy';

const governedLines: QuoteLineSnapshot[] = [
  {
    lineId: 'managed-seat',
    source: 'template',
    sku: 'MSP-SEAT',
    description: 'Managed user',
    quantity: 17,
    unitCost: 51.23,
    unitPrice: 75.49,
    listPrice: 79.99,
    included: true,
  },
  {
    lineId: 'optional-backup',
    source: 'template',
    description: 'Optional backup',
    quantity: 1,
    unitCost: 10,
    unitPrice: 20,
    included: false,
  },
];

const result = evaluateQuotePolicy(governedLines, defaultSalesSettings);
assert.equal(result.passed, true);
assert.deepEqual(result.totals, {
  cost: 870.91,
  price: 1283.33,
  marginAmount: 412.42,
  marginPercent: 32.1,
});
assert.equal(result.warnings.length, 0);

const unsafe = evaluateQuotePolicy(
  [
    {
      lineId: 'hardware',
      source: 'dell-equote',
      description: 'Dell workstation',
      quantity: 2,
      unitCost: 1200,
      unitPrice: 1100,
      listPrice: 1500,
      included: true,
    },
    {
      lineId: 'unpriced',
      source: 'template',
      description: 'Unpriced service',
      quantity: 1,
      included: true,
    },
  ],
  defaultSalesSettings,
);
assert.equal(unsafe.passed, false);
assert.equal(unsafe.blockers.some((item) => item.code === 'negative-margin'), true);
assert.equal(unsafe.blockers.some((item) => item.code === 'missing-financials'), true);
assert.equal(unsafe.warnings.some((item) => item.code === 'discount-threshold'), true);

console.log('sales policy tests passed');
