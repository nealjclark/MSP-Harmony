import type { MoneyAmount, VendorRuleSet } from '../../shared/types';

export type NcentralProductMappingKey = string;

export type NcentralProductMapping = {
  vendorProductKey: NcentralProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const ncentralProductKeys = [
  'ncentral-physical-server',
  'ncentral-virtual-server',
  'ncentral-workstation',
] as const;

export const defaultNcentralProductMappings: Record<string, NcentralProductMapping> = {
  'ncentral-physical-server': {
    vendorProductKey: 'ncentral-physical-server',
    productCode: 'NCENTRAL-PHYSICAL-SERVER',
    productName: 'N-central Managed Physical Server',
  },
  'ncentral-virtual-server': {
    vendorProductKey: 'ncentral-virtual-server',
    productCode: 'NCENTRAL-VIRTUAL-SERVER',
    productName: 'N-central Managed Virtual Server',
  },
  'ncentral-workstation': {
    vendorProductKey: 'ncentral-workstation',
    productCode: 'NCENTRAL-WORKSTATION',
    productName: 'N-central Managed Workstation',
  },
};

export function buildNcentralRuleSet(
  mappings: Partial<Record<string, NcentralProductMapping>> = {},
): VendorRuleSet {
  const resolvedMappings = {
    ...defaultNcentralProductMappings,
    ...mappings,
  };

  return {
    vendorId: 'ncentral',
    vendorName: 'N-able N-central',
    rules: Object.values(resolvedMappings).filter(isProductMapping).map((mapping) => {
      const productType = productTypeForKey(mapping.vendorProductKey);
      return {
        id: `${mapping.vendorProductKey}-count`,
        vendorId: 'ncentral',
        vendorProductKey: mapping.vendorProductKey,
        productCode: mapping.productCode,
        targetProductCodes: targetProductCodes(mapping),
        productName: mapping.productName,
        sourceMetric: 'snapshot-count',
        billableUnit: productType === 'workstation' ? 'workstation' : 'server',
        dimensions: { ncentralProductType: productType },
        unitPrice: mapping.unitPrice,
        notes: `${mapping.productName} is counted from its configured N-central product filter.`,
      };
    }),
  };
}

export const ncentralRuleSet = buildNcentralRuleSet();

export function isNcentralProductMappingKey(value: string): value is NcentralProductMappingKey {
  return value.trim().length > 0;
}

function targetProductCodes(mapping: NcentralProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}

function isProductMapping(value: NcentralProductMapping | undefined): value is NcentralProductMapping {
  return Boolean(value?.vendorProductKey && value.productCode && value.productName);
}

export function productTypeForKey(value: string) {
  if (value === 'ncentral-workstation' || /workstation|laptop|desktop/i.test(value)) {
    return 'workstation';
  }

  if (value === 'ncentral-physical-server' || /physical/i.test(value)) {
    return 'physical-server';
  }

  if (value === 'ncentral-virtual-server' || /virtual|vm/i.test(value)) {
    return 'virtual-server';
  }

  return value.replace(/^ncentral-/, '') || 'device';
}
