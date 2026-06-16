import type { MoneyAmount, VendorRuleSet } from '../../shared/types';

export type CoveProductMappingKey = 'cove-workstation' | 'cove-server' | 'cove-server-storage-addon';

export type CoveProductMapping = {
  vendorProductKey: CoveProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const defaultCoveProductMappings: Record<CoveProductMappingKey, CoveProductMapping> = {
  'cove-workstation': {
    vendorProductKey: 'cove-workstation',
    productCode: 'COVE-WORKSTATION',
    productName: 'Cove Workstation Backup',
  },
  'cove-server': {
    vendorProductKey: 'cove-server',
    productCode: 'COVE-SERVER',
    productName: 'Cove Server Backup',
  },
  'cove-server-storage-addon': {
    vendorProductKey: 'cove-server-storage-addon',
    productCode: 'COVE-SERVER-STORAGE-ADDON',
    productName: 'Cove Server Selected Storage Overage',
    unitPrice: { amount: 75, currency: 'USD' },
  },
};

export function buildCoveRuleSet(
  mappings: Partial<Record<CoveProductMappingKey, CoveProductMapping>> = {},
): VendorRuleSet {
  const workstation = mappings['cove-workstation'] ?? defaultCoveProductMappings['cove-workstation'];
  const server = mappings['cove-server'] ?? defaultCoveProductMappings['cove-server'];
  const storageAddOn = mappings['cove-server-storage-addon'] ?? defaultCoveProductMappings['cove-server-storage-addon'];

  return {
    vendorId: 'cove',
    vendorName: 'Cove Data Protection',
    rules: [
      {
        id: 'cove-workstation-count',
        vendorId: 'cove',
        vendorProductKey: 'cove-workstation',
        productCode: workstation.productCode,
        targetProductCodes: targetProductCodes(workstation),
        productName: workstation.productName,
        sourceMetric: 'snapshot-count',
        billableUnit: 'workstation',
        dimensions: { protectedSystemType: 'workstation' },
        unitPrice: workstation.unitPrice,
        allowance: {
          kind: 'unlimited',
          metric: 'selectedStorageGb',
          unit: 'GB',
        },
        notes: 'Workstation backup bills by protected workstation and includes unlimited selected storage.',
      },
      {
        id: 'cove-server-selected-storage',
        vendorId: 'cove',
        vendorProductKey: 'cove-server',
        productCode: server.productCode,
        targetProductCodes: targetProductCodes(server),
        productName: server.productName,
        sourceMetric: 'snapshot-count',
        billableUnit: 'server',
        dimensions: { protectedSystemType: 'server' },
        unitPrice: server.unitPrice,
        allowance: {
          kind: 'included',
          metric: 'selectedStorageGb',
          includedQuantity: 1000,
          scope: 'per-snapshot-pooled',
          unit: 'GB',
        },
        addOn: {
          productCode: storageAddOn.productCode,
          targetProductCodes: targetProductCodes(storageAddOn),
          productName: storageAddOn.productName,
          metric: 'selectedStorageGb',
          incrementQuantity: 1000,
          roundOverage: 'ceil',
          unit: 'TB',
          unitPrice: storageAddOn.unitPrice ?? { amount: 75, currency: 'USD' },
        },
        notes:
          'Server backup includes 1000 GB of selected storage per protected server, pooled by mapped customer/agreement; add one 1 TB storage add-on for each started 1000 GB over the pooled allowance.',
      },
    ],
  };
}

export const coveRuleSet = buildCoveRuleSet();

function targetProductCodes(mapping: CoveProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}
