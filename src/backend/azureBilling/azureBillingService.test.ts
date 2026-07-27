import assert from 'node:assert/strict';
import {
  applyExternalPreTaxTotal,
  buildAzureBillingIngramReadiness,
  calculateAzureBillingResult,
  classifyAzureBillingIngramProduct,
  compareAzureBillingIngramLines,
  sumNerdioClientInvoiceLines,
} from './azureBillingService';

function run() {
  const combined = calculateAzureBillingResult({
    policyType: 'combined-avd-markup',
    ingramCost: 1000.1234,
    nerdioCost: 200.4321,
    invoiceNerdioCount: 20,
    liveNerdioCount: 22,
    markupRate: 0.6,
    currentQuantity: 1,
    currentUnitPrice: 1800,
    currentUnitCost: 1100,
  });
  assert.equal(combined.combinedCost, 1200.5555);
  assert.equal(combined.proposedQuantity, 1);
  assert.equal(combined.proposedUnitCost, 1200.56);
  assert.equal(combined.proposedUnitPrice, 1920.89);
  assert.equal(combined.projectedMargin, 720.33);

  const externalOverride = applyExternalPreTaxTotal(combined.combinedCost, 1, 1800);
  assert.equal(externalOverride.proposedUnitPrice, 1800);
  assert.equal(externalOverride.proposedUnitCost, 1200.56);
  assert.equal(externalOverride.projectedRevenue, 1800);
  assert.equal(externalOverride.projectedMargin, 599.44);
  assert.equal(externalOverride.effectiveMarkupRate, 0.499306);

  const ingram = calculateAzureBillingResult({
    policyType: 'ingram-subscription-markup',
    ingramCost: 100,
    nerdioCost: 999,
    invoiceNerdioCount: 0,
    liveNerdioCount: 0,
    markupRate: 0.15,
    currentQuantity: 1,
  });
  assert.equal(ingram.proposedUnitCost, 100);
  assert.equal(ingram.proposedUnitPrice, 115);

  const fixed = calculateAzureBillingResult({
    policyType: 'fixed-avd-per-user',
    ingramCost: 2288.72,
    nerdioCost: 339.9667,
    invoiceNerdioCount: 27,
    liveNerdioCount: 29,
    currentQuantity: 27,
    currentUnitPrice: 500,
    currentUnitCost: 90,
  });
  assert.equal(fixed.selectedNerdioCountSource, 'live');
  assert.equal(fixed.selectedNerdioCount, 29);
  assert.equal(fixed.proposedQuantity, 29);
  assert.equal(fixed.proposedUnitPrice, 500);
  assert.equal(fixed.proposedUnitCost, 90.64);

  const invoiceSelected = calculateAzureBillingResult({
    policyType: 'fixed-avd-per-user',
    ingramCost: 100,
    nerdioCost: 20,
    invoiceNerdioCount: 12,
    liveNerdioCount: 15,
    selectedNerdioCountSource: 'invoice',
    currentQuantity: 15,
    currentUnitPrice: 200,
  });
  assert.equal(invoiceSelected.selectedNerdioCount, 12);
  assert.equal(invoiceSelected.proposedUnitCost, 10);

  const previousApproved = calculateAzureBillingResult({
    policyType: 'combined-avd-markup',
    ingramCost: 120,
    nerdioCost: 30,
    invoiceNerdioCount: 12,
    liveNerdioCount: 13,
    markupRate: 0.15,
    currentQuantity: 1,
    decisionType: 'previous-approved',
    previousApprovedQuantity: 1,
    previousApprovedUnitPrice: 160,
    previousApprovedUnitCost: 140,
  });
  assert.equal(previousApproved.proposedQuantity, 1);
  assert.equal(previousApproved.proposedUnitPrice, 160);
  assert.equal(previousApproved.proposedUnitCost, 140);

  const withInvoiceCredit = calculateAzureBillingResult({
    policyType: 'combined-avd-markup',
    ingramCost: 100,
    nerdioCost: -10.125,
    invoiceNerdioCount: 4,
    liveNerdioCount: 4,
    markupRate: 0.15,
    currentQuantity: 1,
  });
  assert.equal(withInvoiceCredit.combinedCost, 89.875);
  assert.equal(withInvoiceCredit.proposedUnitCost, 89.88);
  assert.equal(withInvoiceCredit.proposedUnitPrice, 103.36);
  assert.ok(withInvoiceCredit.varianceFlags.includes('source-credit-exceeds-charges'));

  const rounded = calculateAzureBillingResult({
    policyType: 'ingram-subscription-markup',
    ingramCost: 1.005,
    nerdioCost: 0,
    invoiceNerdioCount: 0,
    liveNerdioCount: 0,
    markupRate: 0.15,
    currentQuantity: 1,
  });
  assert.equal(rounded.combinedCost, 1.005);
  assert.equal(rounded.proposedUnitCost, 1.01);
  assert.equal(rounded.proposedUnitPrice, 1.16);

  const zero = calculateAzureBillingResult({
    policyType: 'fixed-avd-per-user',
    ingramCost: 100,
    nerdioCost: 20,
    invoiceNerdioCount: 0,
    liveNerdioCount: 0,
    currentQuantity: 0,
    currentUnitPrice: 200,
  });
  assert.equal(zero.proposedUnitCost, undefined);
  assert.ok(zero.varianceFlags.includes('zero-selected-count'));

  assert.throws(
    () =>
      calculateAzureBillingResult({
        policyType: 'combined-avd-markup',
        ingramCost: 10,
        nerdioCost: 1,
        invoiceNerdioCount: 1,
        liveNerdioCount: 1,
        markupRate: 0.2,
        currentQuantity: 1,
        decisionType: 'manual',
        manualQuantity: 1,
        manualUnitCost: 11,
      }),
    /Manual unit price is required/,
  );

  assert.equal(
    classifyAzureBillingIngramProduct(
      'CFQ7TTC0HHS9:000W',
      'Windows 365 Enterprise 4 vCPU, 16 GB, 512 GB',
    ),
    'windows-365',
  );
  assert.equal(
    classifyAzureBillingIngramProduct('CFQ-NEW-CLOUD-PC', 'Windows 365 Enterprise future configuration'),
    'windows-365',
  );
  assert.equal(
    classifyAzureBillingIngramProduct('MS-AZR-0017G-RI', 'Reserved VM Instance'),
    'azure-consumption',
  );
  assert.equal(
    classifyAzureBillingIngramProduct('MODERN-WORK-SKU', 'Microsoft 365 Business Premium'),
    undefined,
  );

  assert.equal(
    sumNerdioClientInvoiceLines(
      [
        { accountId: 'client-1', value: 100.1234 },
        { accountId: 'client-1', value: 25.4321 },
        { accountId: 'client-2', value: 90 },
        { accountId: null, value: -50, description: 'Portfolio discount' },
      ],
      ['client-1'],
    ),
    125.5555,
  );

  assert.deepEqual(
    compareAzureBillingIngramLines(
      [
        { subscriptionId: 'sub-1', productCode: 'AZURE', productName: 'Azure plan', quantity: 3, unitCost: 10, extendedCost: 30 },
        { subscriptionId: 'sub-3', productCode: 'W365', productName: 'Cloud PC', quantity: 1, unitCost: 40, extendedCost: 40 },
        { subscriptionId: 'sub-4', productCode: 'KEEP', productName: 'Unchanged plan', quantity: 2, unitCost: 5, extendedCost: 10 },
      ],
      [
        { subscriptionId: 'sub-1', productCode: 'AZURE', productName: 'Azure plan', quantity: 2, unitCost: 10, extendedCost: 20 },
        { subscriptionId: 'sub-2', productCode: 'OLD', productName: 'Removed plan', quantity: 1, unitCost: 15, extendedCost: 15 },
        { subscriptionId: 'sub-4', productCode: 'KEEP', productName: 'Unchanged plan', quantity: 2, unitCost: 5, extendedCost: 10 },
      ],
    ),
    [
      {
        status: 'new',
        productCode: 'W365',
        productName: 'Cloud PC',
        subscriptionId: 'sub-3',
        unitCost: 40,
        previousQuantity: 0,
        currentQuantity: 1,
        quantityChange: 1,
        previousCost: 0,
        currentCost: 40,
        costChange: 40,
      },
      {
        status: 'changed',
        productCode: 'AZURE',
        productName: 'Azure plan',
        subscriptionId: 'sub-1',
        unitCost: 10,
        previousQuantity: 2,
        currentQuantity: 3,
        quantityChange: 1,
        previousCost: 20,
        currentCost: 30,
        costChange: 10,
      },
      {
        status: 'removed',
        productCode: 'OLD',
        productName: 'Removed plan',
        subscriptionId: 'sub-2',
        unitCost: 15,
        previousQuantity: 1,
        currentQuantity: 0,
        quantityChange: -1,
        previousCost: 15,
        currentCost: 0,
        costChange: -15,
      },
      {
        status: 'same',
        productCode: 'KEEP',
        productName: 'Unchanged plan',
        subscriptionId: 'sub-4',
        unitCost: 5,
        previousQuantity: 2,
        currentQuantity: 2,
        quantityChange: 0,
        previousCost: 10,
        currentCost: 10,
        costChange: 0,
      },
    ],
  );

  const beforeRelease = buildAzureBillingIngramReadiness(
    '2026-07',
    undefined,
    new Date('2026-07-20T16:00:00.000Z'),
  );
  assert.equal(beforeRelease.status, 'before-release');
  assert.equal(beforeRelease.ready, false);
  assert.match(beforeRelease.message, /Wait until the 21st/);

  const due = buildAzureBillingIngramReadiness(
    '2026-07',
    undefined,
    new Date('2026-07-21T16:00:00.000Z'),
  );
  assert.equal(due.status, 'due');
  assert.match(due.message, /try again tomorrow/i);

  const missingHistory = buildAzureBillingIngramReadiness(
    '2026-06',
    undefined,
    new Date('2026-07-21T16:00:00.000Z'),
  );
  assert.equal(missingHistory.status, 'missing-history');

  const ready = buildAzureBillingIngramReadiness(
    '2026-07',
    {
      invoiceImportId: 'invoice-1',
      invoiceDate: '2026-07-22',
      lineCount: 42,
      invoiceCost: 1234.56,
    },
    new Date('2026-07-22T16:00:00.000Z'),
  );
  assert.equal(ready.status, 'ready');
  assert.equal(ready.lineCount, 42);
  assert.equal(ready.invoiceCost, 1234.56);
}

run();
console.log('azureBillingService tests passed');
