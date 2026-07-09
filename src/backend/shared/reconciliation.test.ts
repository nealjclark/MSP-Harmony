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
assert.equal(result.totals.unmapped, 0);
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
assert.equal(ncentralSourceOnly.lines.length, 1);
const ncentralOnlyLine = ncentralSourceOnly.lines[0];
assert.equal(ncentralOnlyLine?.status, 'needs-review');
assert.equal(ncentralOnlyLine?.writeAction, 'create-addition');
assert.equal(ncentralOnlyLine?.sourceQuantity, 1);
assert.equal(ncentralOnlyLine?.agreementQuantity, 0);

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

const unmappedAppRiverResult = reconcileVendorUsage({
  vendorId: 'opentext-appriver',
  rules: [],
  snapshots: [
    {
      id: 'appriver-e5-no-teams',
      vendorId: 'opentext-appriver',
      clientId: 'building-trades',
      agreementId: 'monthly-services',
      vendorProductKey: 'Microsoft 365 E5 (no Teams)|Monthly|Monthly',
      productCode: 'MICROSOFT-365-E5-NO-TEAMS-MONTHLY-MONTHLY',
      productName: 'Microsoft 365 E5 (no Teams)',
      quantity: 1,
      observedAt: '2026-07-01T14:43:10.943Z',
      dimensions: {
        subscriptionSource: 'appriver-securecloud-subscription',
      },
    },
  ],
  agreementAdditions: [],
});
const unmappedE5Line = unmappedAppRiverResult.lines.find((line) => line.status === 'unmapped');
assert.equal(unmappedE5Line?.lineType, 'unmapped-vendor');
assert.equal(unmappedE5Line?.sourceQuantity, 1);
assert.equal(unmappedE5Line?.agreementQuantity, 0);
assert.equal(unmappedE5Line?.writeAction, undefined);
assert.equal(unmappedAppRiverResult.totals.unmapped, 1);

const linkedAnchorResult = reconcileVendorUsage({
  vendorId: 'opentext-appriver',
  rules: [
    {
      id: 'advanced-email-threat-protection-license-count',
      vendorId: 'opentext-appriver',
      vendorProductKey: 'Advanced Email Threat Protection|Monthly|Monthly',
      productCode: 'Email Threat Protection',
      productName: 'Email Threat Protection',
      sourceMetric: 'snapshot-count',
      billableUnit: 'license',
      dimensions: {
        subscriptionSource: 'appriver-securecloud-subscription',
      },
      notes: 'Advanced Email Threat Protection count comes from AppRiver subscription quantity.',
    },
  ],
  snapshots: [
    {
      id: 'appriver-aetp-live',
      vendorId: 'opentext-appriver',
      clientId: 'all-american-metal',
      agreementId: 'monthly-services',
      vendorProductKey: 'Advanced Email Threat Protection|Monthly|Monthly',
      productCode: 'Email Threat Protection',
      productName: 'Email Threat Protection',
      quantity: 11,
      observedAt: '2026-07-04T03:10:52.662Z',
      dimensions: {
        subscriptionSource: 'appriver-securecloud-subscription',
      },
    },
    {
      id: 'linked-aetp-anchor',
      vendorId: 'opentext-appriver',
      clientId: 'all-american-metal',
      agreementId: 'monthly-services',
      vendorProductKey: 'Advanced Email Threat Protection|Monthly|Monthly',
      productCode: 'Email Threat Protection',
      productName: 'Email Threat Protection',
      quantity: 0,
      observedAt: '2026-07-04T03:10:52.662Z',
      dimensions: {
        linkedCountAnchor: true,
        linkedCountRuleName: 'AETP - M365 Licensed Users',
      },
    },
  ],
  agreementAdditions: [
    {
      id: 'addition-aetp',
      clientId: 'all-american-metal',
      agreementId: 'monthly-services',
      productCode: 'Email Threat Protection',
      productName: 'Email Threat Protection',
      quantity: 12,
    },
  ],
});
const linkedAnchorLine = linkedAnchorResult.lines.find((line) => line.productCode === 'Email Threat Protection');
assert.equal(linkedAnchorLine?.lineType, 'base-count');
assert.equal(linkedAnchorLine?.sourceQuantity, 11);
assert.equal(linkedAnchorLine?.delta, -1);
assert.equal(linkedAnchorResult.lines.some((line) => line.lineType === 'unmapped-vendor'), false);
assert.equal(linkedAnchorResult.totals.unmapped, 0);

const sentinelRules = [
  {
    id: 'sentinelone-server-count',
    vendorId: 'sentinelone',
    vendorProductKey: 'sentinelone-server',
    productCode: 'S1-ENDPOINT',
    productName: 'SentinelOne Endpoint',
    sourceMetric: 'snapshot-count' as const,
    billableUnit: 'server' as const,
    requiresExistingAgreementProduct: true,
    notes: 'Server agents',
  },
  {
    id: 'sentinelone-workstation-count',
    vendorId: 'sentinelone',
    vendorProductKey: 'sentinelone-workstation',
    productCode: 'S1-ENDPOINT',
    productName: 'SentinelOne Endpoint',
    sourceMetric: 'snapshot-count' as const,
    billableUnit: 'workstation' as const,
    requiresExistingAgreementProduct: true,
    notes: 'Workstation agents',
  },
];

const separateModeResult = reconcileVendorUsage({
  vendorId: 'sentinelone',
  reconcileMode: 'separate-multiple-products',
  rules: sentinelRules,
  snapshots: [
    {
      id: 'server-1',
      vendorId: 'sentinelone',
      clientId: 'client-advanced',
      agreementId: 'agreement-advanced',
      vendorProductKey: 'sentinelone-server',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 1,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
    {
      id: 'workstation-1',
      vendorId: 'sentinelone',
      clientId: 'client-advanced',
      agreementId: 'agreement-advanced',
      vendorProductKey: 'sentinelone-workstation',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 5,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
  ],
  agreementAdditions: [
    {
      id: 'addition-workstation-bulk',
      connectWiseAdditionId: '701',
      clientId: 'client-advanced',
      agreementId: 'agreement-advanced',
      productCode: 's1-endpoint',
      productName: 'SentinelOne Endpoint',
      quantity: 7,
    },
    {
      id: 'addition-server-single',
      connectWiseAdditionId: '702',
      clientId: 'client-advanced',
      agreementId: 'agreement-advanced',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 1,
    },
  ],
});

const serverLine = separateModeResult.lines.find((line) => line.vendorProductKey === 'sentinelone-server');
const workstationLine = separateModeResult.lines.find((line) => line.vendorProductKey === 'sentinelone-workstation');
assert.equal(separateModeResult.lines.filter((line) => line.lineType === 'base-count').length, 2);
assert.equal(serverLine?.connectWiseAdditionId, '702');
assert.equal(serverLine?.agreementQuantity, 1);
assert.equal(workstationLine?.connectWiseAdditionId, '701');
assert.equal(workstationLine?.agreementQuantity, 7);
assert.equal(workstationLine?.delta, -2);

const singleAdditionSeparateResult = reconcileVendorUsage({
  vendorId: 'sentinelone',
  reconcileMode: 'separate-multiple-products',
  rules: sentinelRules,
  snapshots: [
    {
      id: 'server-only',
      vendorId: 'sentinelone',
      clientId: 'client-1',
      agreementId: 'agreement-1',
      vendorProductKey: 'sentinelone-server',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 3,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
    {
      id: 'workstation-only',
      vendorId: 'sentinelone',
      clientId: 'client-1',
      agreementId: 'agreement-1',
      vendorProductKey: 'sentinelone-workstation',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 48,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
  ],
  agreementAdditions: [
    {
      id: 'addition-combined',
      connectWiseAdditionId: '201',
      clientId: 'client-1',
      agreementId: 'agreement-1',
      productCode: 'S1-ENDPOINT',
      productName: 'SentinelOne Endpoint',
      quantity: 51,
    },
  ],
});
assert.equal(singleAdditionSeparateResult.lines.filter((line) => line.lineType === 'base-count').length, 1);
assert.equal(singleAdditionSeparateResult.lines[0]?.sourceQuantity, 51);
assert.equal(singleAdditionSeparateResult.lines[0]?.agreementQuantity, 51);

const overlappingTargetRules = [
  {
    id: 'device:workstation-count',
    vendorId: 'sentinelone',
    vendorProductKey: 'device:workstation',
    productCode: 'Managed Endpoint Protection',
    targetProductCodes: ['Managed Endpoint Protection', 'Managed Threat Response PC'],
    productName: 'Managed Endpoint Protection',
    sourceMetric: 'snapshot-count' as const,
    billableUnit: 'workstation' as const,
    notes: 'Workstation devices',
  },
  {
    id: 'device:server-count',
    vendorId: 'sentinelone',
    vendorProductKey: 'device:server',
    productCode: 'Managed Threat Response Server',
    targetProductCodes: ['Managed Threat Response Server', 'Managed Endpoint Protection'],
    productName: 'Managed Threat Response Server',
    sourceMetric: 'snapshot-count' as const,
    billableUnit: 'server' as const,
    notes: 'Server devices',
  },
];

const overlappingTargetResult = reconcileVendorUsage({
  vendorId: 'sentinelone',
  reconcileMode: 'separate-multiple-products',
  rules: overlappingTargetRules,
  snapshots: [
    {
      id: 'ao-server',
      vendorId: 'sentinelone',
      clientId: 'client-ao',
      agreementId: 'agreement-ao',
      vendorProductKey: 'device:server',
      productCode: 'Managed Threat Response Server',
      productName: 'Managed Threat Response Server',
      quantity: 1,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
    {
      id: 'ao-workstation',
      vendorId: 'sentinelone',
      clientId: 'client-ao',
      agreementId: 'agreement-ao',
      vendorProductKey: 'device:workstation',
      productCode: 'Managed Endpoint Protection',
      productName: 'Managed Endpoint Protection',
      quantity: 5,
      observedAt: '2026-07-08T00:00:00.000Z',
      dimensions: {},
    },
  ],
  agreementAdditions: [
    {
      id: 'ao-2594',
      connectWiseAdditionId: '2594',
      clientId: 'client-ao',
      agreementId: 'agreement-ao',
      productCode: 'Managed Endpoint Protection',
      productName: 'Managed Endpoint Protection',
      quantity: 7,
      unitPrice: { amount: 14.95, currency: 'USD' },
    },
    {
      id: 'ao-2595',
      connectWiseAdditionId: '2595',
      clientId: 'client-ao',
      agreementId: 'agreement-ao',
      productCode: 'Managed Endpoint Protection',
      productName: 'Managed Endpoint Protection',
      quantity: 1,
      unitPrice: { amount: 19.95, currency: 'USD' },
    },
  ],
});

const overlappingWorkstation = overlappingTargetResult.lines.find((line) => line.vendorProductKey === 'device:workstation');
const overlappingServer = overlappingTargetResult.lines.find((line) => line.vendorProductKey === 'device:server');
assert.equal(overlappingTargetResult.lines.filter((line) => line.lineType === 'base-count').length, 2);
assert.equal(overlappingWorkstation?.connectWiseAdditionId, '2594');
assert.equal(overlappingWorkstation?.sourceQuantity, 5);
assert.equal(overlappingWorkstation?.agreementQuantity, 7);
assert.equal(overlappingWorkstation?.unitPrice?.amount, 14.95);
assert.equal(overlappingServer?.connectWiseAdditionId, '2595');
assert.equal(overlappingServer?.sourceQuantity, 1);
assert.equal(overlappingServer?.agreementQuantity, 1);
assert.equal(overlappingServer?.unitPrice?.amount, 19.95);
assert.equal(
  overlappingTargetResult.lines.filter((line) => line.id.includes('merged-base')).length,
  0,
);

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
