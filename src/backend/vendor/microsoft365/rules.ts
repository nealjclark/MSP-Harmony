import type { MoneyAmount, VendorRuleSet } from '../../shared/types';

export type Microsoft365ProductMappingKey = string;

export type Microsoft365ProductMapping = {
  vendorProductKey: Microsoft365ProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export function buildMicrosoft365RuleSet(
  mappings: Partial<Record<string, Microsoft365ProductMapping>> = {},
): VendorRuleSet {
  return {
    vendorId: 'microsoft-365',
    vendorName: 'Microsoft 365',
    rules: Object.values(mappings).filter(isProductMapping).map((mapping) => ({
      id: `${mapping.vendorProductKey}-license-count`,
      vendorId: 'microsoft-365',
      vendorProductKey: mapping.vendorProductKey,
      productCode: mapping.productCode,
      targetProductCodes: targetProductCodes(mapping),
      productName: mapping.productName,
      sourceMetric: 'snapshot-count',
      billableUnit: 'license',
      dimensions: { licenseSource: 'assigned-user-license' },
      unitPrice: mapping.unitPrice,
      notes: `${mapping.productName} is counted from assigned Microsoft 365 user licenses for approved SKU mappings.`,
    })),
  };
}

export const microsoft365RuleSet = buildMicrosoft365RuleSet();

function targetProductCodes(mapping: Microsoft365ProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}

function isProductMapping(value: Microsoft365ProductMapping | undefined): value is Microsoft365ProductMapping {
  return Boolean(value?.vendorProductKey && value.productCode && value.productName);
}
