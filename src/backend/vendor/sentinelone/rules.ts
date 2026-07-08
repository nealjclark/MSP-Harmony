import type { MoneyAmount, VendorRuleSet } from '../../shared/types';

export type SentinelOneProductMappingKey = 'sentinelone-server' | 'sentinelone-workstation';

export type SentinelOneProductMapping = {
  vendorProductKey: SentinelOneProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const sentinelOneProductKeys = ['sentinelone-server', 'sentinelone-workstation'] as const;

export const defaultSentinelOneProductMappings: Record<SentinelOneProductMappingKey, SentinelOneProductMapping> = {
  'sentinelone-server': {
    vendorProductKey: 'sentinelone-server',
    productCode: 'SENTINELONE-SERVER',
    productName: 'SentinelOne Server Agent',
  },
  'sentinelone-workstation': {
    vendorProductKey: 'sentinelone-workstation',
    productCode: 'SENTINELONE-WORKSTATION',
    productName: 'SentinelOne Workstation Agent',
  },
};

export function buildSentinelOneRuleSet(
  mappings: Partial<Record<SentinelOneProductMappingKey, SentinelOneProductMapping>> = {},
): VendorRuleSet {
  const resolvedMappings = {
    ...defaultSentinelOneProductMappings,
    ...mappings,
  };

  return {
    vendorId: 'sentinelone',
    vendorName: 'SentinelOne',
    rules: Object.values(resolvedMappings).map((mapping) => ({
      id: `${mapping.vendorProductKey}-count`,
      vendorId: 'sentinelone',
      vendorProductKey: mapping.vendorProductKey,
      productCode: mapping.productCode,
      targetProductCodes: targetProductCodes(mapping),
      productName: mapping.productName,
      sourceMetric: 'snapshot-count',
      billableUnit: mapping.vendorProductKey === 'sentinelone-workstation' ? 'workstation' : 'server',
      dimensions: { sentinelOneMachineType: mapping.vendorProductKey.replace('sentinelone-', '') },
      unitPrice: mapping.unitPrice,
      requiresExistingAgreementProduct: true,
      notes: `${mapping.productName} is counted from synced SentinelOne agents when the agreement already has this product.`,
    })),
  };
}

export const sentinelOneRuleSet = buildSentinelOneRuleSet();

export function isSentinelOneProductMappingKey(value: string): value is SentinelOneProductMappingKey {
  return sentinelOneProductKeys.includes(value as SentinelOneProductMappingKey);
}

function targetProductCodes(mapping: SentinelOneProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}
