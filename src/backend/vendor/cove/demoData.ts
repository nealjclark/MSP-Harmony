import type { AgreementAddition, UsageSnapshot } from '../../shared/types';

export const coveDemoSnapshots: UsageSnapshot[] = [
  {
    id: 'cove-snap-northstar-srv-01',
    vendorId: 'cove',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-SERVER',
    productName: 'Cove Server Backup',
    quantity: 1,
    observedAt: '2026-06-03T12:00:00.000Z',
    dimensions: {
      protectedSystemType: 'server',
      selectedStorageGb: 1000,
      hostname: 'ns-file-01',
    },
  },
  {
    id: 'cove-snap-northstar-srv-02',
    vendorId: 'cove',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-SERVER',
    productName: 'Cove Server Backup',
    quantity: 1,
    observedAt: '2026-06-03T12:00:00.000Z',
    dimensions: {
      protectedSystemType: 'server',
      selectedStorageGb: 2200,
      hostname: 'ns-sql-01',
    },
  },
  {
    id: 'cove-snap-northstar-wks',
    vendorId: 'cove',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-WORKSTATION',
    productName: 'Cove Workstation Backup',
    quantity: 153,
    observedAt: '2026-06-03T12:00:00.000Z',
    dimensions: {
      protectedSystemType: 'workstation',
      selectedStorageGb: 2410,
    },
  },
];

export const coveDemoAgreementAdditions: AgreementAddition[] = [
  {
    id: 'cw-add-cove-server',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-SERVER',
    productName: 'Cove Server Backup',
    quantity: 2,
    unitPrice: { amount: 120, currency: 'USD' },
    updatedAt: '2026-06-01T14:30:00.000Z',
  },
  {
    id: 'cw-add-cove-server-storage',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-SERVER-STORAGE-ADDON',
    productName: 'Cove Server Selected Storage Overage',
    quantity: 1,
    unitPrice: { amount: 75, currency: 'USD' },
    updatedAt: '2026-06-01T14:30:00.000Z',
  },
  {
    id: 'cw-add-cove-workstation',
    clientId: 'northstar-dental',
    agreementId: 'managed-services-premium',
    productCode: 'COVE-WORKSTATION',
    productName: 'Cove Workstation Backup',
    quantity: 153,
    unitPrice: { amount: 15, currency: 'USD' },
    updatedAt: '2026-06-01T14:30:00.000Z',
  },
];
