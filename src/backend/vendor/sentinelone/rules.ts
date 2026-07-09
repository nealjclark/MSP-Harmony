import type { MoneyAmount, VendorRuleSet } from '../../shared/types';
import { billableUnitForVendorProductKey } from '../../shared/vendorProductUnits';

export type SentinelOneProductMappingKey = string;

export type SentinelOneProductMapping = {
  vendorProductKey: SentinelOneProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const sentinelOneProductKeys = ['sentinelone-server', 'sentinelone-workstation'] as const;

export const defaultSentinelOneProductMappings: Record<string, SentinelOneProductMapping> = {
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

function isManualDeviceProductKey(vendorProductKey: string) {
  return vendorProductKey.startsWith('device:');
}

export function buildSentinelOneRuleSet(
  mappings: Partial<Record<string, SentinelOneProductMapping>> = {},
): VendorRuleSet {
  const resolvedMappings = {
    ...defaultSentinelOneProductMappings,
    ...mappings,
  };

  return {
    vendorId: 'sentinelone',
    vendorName: 'SentinelOne',
    rules: Object.values(resolvedMappings)
      .filter((mapping): mapping is SentinelOneProductMapping => Boolean(mapping?.vendorProductKey && mapping.productCode))
      .map((mapping) => {
        const manualDeviceKey = isManualDeviceProductKey(mapping.vendorProductKey);
        return {
          id: `${mapping.vendorProductKey}-count`,
          vendorId: 'sentinelone',
          vendorProductKey: mapping.vendorProductKey,
          productCode: mapping.productCode,
          targetProductCodes: targetProductCodes(mapping),
          productName: mapping.productName,
          sourceMetric: 'snapshot-count' as const,
          billableUnit: manualDeviceKey
            ? billableUnitForVendorProductKey(mapping.vendorProductKey)
            : mapping.vendorProductKey === 'sentinelone-workstation'
              ? 'workstation'
              : 'server',
          dimensions: manualDeviceKey
            ? undefined
            : { sentinelOneMachineType: mapping.vendorProductKey.replace('sentinelone-', '') },
          unitPrice: mapping.unitPrice,
          requiresExistingAgreementProduct: !manualDeviceKey,
          notes: manualDeviceKey
            ? `${mapping.productName} is counted from imported device rows with approved product mappings.`
            : `${mapping.productName} is counted from synced SentinelOne agents when the agreement already has this product.`,
        };
      }),
  };
}

export const sentinelOneRuleSet = buildSentinelOneRuleSet();

export function isSentinelOneProductMappingKey(value: string): value is (typeof sentinelOneProductKeys)[number] {
  return sentinelOneProductKeys.includes(value as (typeof sentinelOneProductKeys)[number]);
}

function targetProductCodes(mapping: SentinelOneProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}
