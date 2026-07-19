import type { MoneyAmount, VendorRuleSet } from '../../shared/types';
import { appRiverIntegrationId, appRiverSubscriptionSource } from './client';

export type AppRiverProductMappingKey = string;

export type AppRiverProductMapping = {
  vendorProductKey: AppRiverProductMappingKey;
  vendorProductKeys?: AppRiverProductMappingKey[];
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export type AppRiverProductBundleMapping = {
  bundleKey: string;
  bundleName: string;
  componentProductKeys: string[];
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export function buildAppRiverRuleSet(
  mappings: Partial<Record<string, AppRiverProductMapping>> = {},
  bundles: AppRiverProductBundleMapping[] = [],
): VendorRuleSet {
  const productRuleMappings = groupProductMappings(Object.values(mappings).filter(isProductMapping));

  return {
    vendorId: appRiverIntegrationId,
    vendorName: 'AppRiver - OpenText',
    rules: [
      ...productRuleMappings.map((mapping) => ({
        id: `${mapping.vendorProductKey}-license-count`,
        vendorId: appRiverIntegrationId,
        vendorProductKey: mapping.vendorProductKey,
        vendorProductKeys: mapping.vendorProductKeys,
        productCode: mapping.productCode,
        targetProductCodes: targetProductCodes(mapping),
        productName: mapping.productName,
        sourceMetric: 'snapshot-count' as const,
        billableUnit: 'license' as const,
        dimensions: { subscriptionSource: appRiverSubscriptionSource },
        unitPrice: mapping.unitPrice,
        notes: `${mapping.productName} is counted from AppRiver SecureCloud subscription quantity for approved product mappings.`,
      })),
      ...bundles.filter(isBundleMapping).map((bundle) => ({
        id: `${bundle.bundleKey}-bundle-count`,
        vendorId: appRiverIntegrationId,
        vendorProductKey: bundle.bundleKey,
        productCode: bundle.productCode,
        targetProductCodes: targetProductCodes(bundle),
        productName: bundle.productName,
        sourceMetric: 'snapshot-count' as const,
        billableUnit: 'license' as const,
        dimensions: {
          subscriptionSource: appRiverSubscriptionSource,
          appRiverBundle: true,
          appRiverBundleKey: bundle.bundleKey,
        },
        unitPrice: bundle.unitPrice,
        notes: `${bundle.bundleName} uses the largest license count across its AppRiver component products.`,
      })),
    ],
  };
}

export const appRiverRuleSet = buildAppRiverRuleSet();

function targetProductCodes(mapping: { productCode: string; targetProductCodes?: string[] }) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}

function isProductMapping(value: AppRiverProductMapping | undefined): value is AppRiverProductMapping {
  return Boolean(value?.vendorProductKey && value.productCode && value.productName);
}

function isBundleMapping(value: AppRiverProductBundleMapping | undefined): value is AppRiverProductBundleMapping {
  return Boolean(value?.bundleKey && value.bundleName && value.productCode && value.productName && value.componentProductKeys.length > 0);
}

function groupProductMappings(mappings: AppRiverProductMapping[]): AppRiverProductMapping[] {
  const grouped = new Map<string, AppRiverProductMapping>();

  for (const mapping of mappings) {
    const groupKey = [
      mapping.productCode,
      mapping.productName,
      targetProductCodes(mapping).sort().join('\u0001'),
      mapping.unitPrice ? `${mapping.unitPrice.amount}:${mapping.unitPrice.currency}` : '',
    ].join('\u0002');
    const existing = grouped.get(groupKey);
    const vendorProductKeys = [
      ...new Set([
        ...(existing?.vendorProductKeys ?? [existing?.vendorProductKey].filter((key): key is string => Boolean(key))),
        mapping.vendorProductKey,
        ...(mapping.vendorProductKeys ?? []),
      ]),
    ].sort();

    grouped.set(groupKey, {
      ...mapping,
      vendorProductKey: existing?.vendorProductKey ?? mapping.vendorProductKey,
      vendorProductKeys,
      targetProductCodes: [
        ...new Set([...(existing?.targetProductCodes ?? []), ...targetProductCodes(mapping)]),
      ],
    });
  }

  return [...grouped.values()].sort((left, right) => left.vendorProductKey.localeCompare(right.vendorProductKey));
}
