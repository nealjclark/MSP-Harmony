import type { MoneyAmount, VendorRuleSet } from '../../shared/types';
import { appRiverIntegrationId, appRiverSubscriptionSource } from './client';

export type AppRiverProductMappingKey = string;

export type AppRiverProductMapping = {
  vendorProductKey: AppRiverProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export function buildAppRiverRuleSet(
  mappings: Partial<Record<string, AppRiverProductMapping>> = {},
): VendorRuleSet {
  return {
    vendorId: appRiverIntegrationId,
    vendorName: 'AppRiver - OpenText',
    rules: Object.values(mappings).filter(isProductMapping).map((mapping) => ({
      id: `${mapping.vendorProductKey}-license-count`,
      vendorId: appRiverIntegrationId,
      vendorProductKey: mapping.vendorProductKey,
      productCode: mapping.productCode,
      targetProductCodes: targetProductCodes(mapping),
      productName: mapping.productName,
      sourceMetric: 'snapshot-count',
      billableUnit: 'license',
      dimensions: { subscriptionSource: appRiverSubscriptionSource },
      unitPrice: mapping.unitPrice,
      notes: `${mapping.productName} is counted from AppRiver SecureCloud subscription quantity for approved product mappings.`,
    })),
  };
}

export const appRiverRuleSet = buildAppRiverRuleSet();

function targetProductCodes(mapping: AppRiverProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}

function isProductMapping(value: AppRiverProductMapping | undefined): value is AppRiverProductMapping {
  return Boolean(value?.vendorProductKey && value.productCode && value.productName);
}
