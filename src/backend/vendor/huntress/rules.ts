import type { MoneyAmount, VendorRuleSet } from '../../shared/types';

export const huntressIntegrationId = 'huntress' as const;

export const huntressProductClasses = [
  'edr',
  'itdr',
  'sat',
  'siem',
  'ispm',
  'siem_extended_retention',
] as const;

export type HuntressProductClass = (typeof huntressProductClasses)[number];
export type HuntressProductMappingKey = string;

export type HuntressProductMapping = {
  vendorProductKey: HuntressProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const defaultHuntressProductMappings: Record<HuntressProductClass, HuntressProductMapping> = {
  edr: {
    vendorProductKey: huntressVendorProductKey('edr'),
    productCode: 'HUNTRESS-EDR',
    productName: 'Huntress Managed EDR',
  },
  itdr: {
    vendorProductKey: huntressVendorProductKey('itdr'),
    productCode: 'HUNTRESS-ITDR',
    productName: 'Huntress Managed ITDR',
  },
  sat: {
    vendorProductKey: huntressVendorProductKey('sat'),
    productCode: 'HUNTRESS-SAT',
    productName: 'Huntress Security Awareness Training',
  },
  siem: {
    vendorProductKey: huntressVendorProductKey('siem'),
    productCode: 'HUNTRESS-SIEM',
    productName: 'Huntress SIEM',
  },
  ispm: {
    vendorProductKey: huntressVendorProductKey('ispm'),
    productCode: 'HUNTRESS-ISPM',
    productName: 'Huntress ISPM',
  },
  siem_extended_retention: {
    vendorProductKey: huntressVendorProductKey('siem_extended_retention'),
    productCode: 'HUNTRESS-SIEM-EXTENDED-RETENTION',
    productName: 'Huntress SIEM Extended Retention',
  },
};

export function buildHuntressRuleSet(
  mappings: Partial<Record<HuntressProductMappingKey, HuntressProductMapping>> = {},
): VendorRuleSet {
  const resolvedMappings: Record<string, HuntressProductMapping> = {
    ...Object.fromEntries(
      Object.values(defaultHuntressProductMappings).map((mapping) => [mapping.vendorProductKey, mapping]),
    ),
    ...Object.fromEntries(
      Object.entries(mappings).filter((entry): entry is [string, HuntressProductMapping] =>
        Boolean(entry[1]?.vendorProductKey && entry[1]?.productCode && entry[1]?.productName),
      ),
    ),
  };

  return {
    vendorId: huntressIntegrationId,
    vendorName: 'Huntress',
    rules: Object.values(resolvedMappings).map((mapping) => {
      const productClass = huntressProductClassForKey(mapping.vendorProductKey);
      return {
        id: `${mapping.vendorProductKey}-count`,
        vendorId: huntressIntegrationId,
        vendorProductKey: mapping.vendorProductKey,
        productCode: mapping.productCode,
        targetProductCodes: targetProductCodes(mapping),
        productName: mapping.productName,
        sourceMetric: 'snapshot-count',
        billableUnit: productClass === 'edr' ? 'device' : 'license',
        dimensions: productClass ? { huntressProductClass: productClass } : undefined,
        unitPrice: mapping.unitPrice,
        notes: productClass
          ? `${mapping.productName} is counted from Huntress ${productClassLabel(productClass)} organization usage.`
          : `${mapping.productName} is counted from Huntress synced or imported usage.`,
      };
    }),
  };
}

export const huntressRuleSet = buildHuntressRuleSet();

export function huntressVendorProductKey(productClass: HuntressProductClass | string) {
  return `huntress-${productClass.trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-')}`;
}

export function huntressProductClassForKey(vendorProductKey: string): HuntressProductClass | undefined {
  const normalized = vendorProductKey.trim().toLowerCase().replace(/^huntress-/, '').replace(/-/g, '_');
  return isHuntressProductClass(normalized) ? normalized : undefined;
}

export function isHuntressProductClass(value: string): value is HuntressProductClass {
  return huntressProductClasses.includes(value as HuntressProductClass);
}

export function productClassLabel(productClass: HuntressProductClass) {
  if (productClass === 'edr') return 'EDR';
  if (productClass === 'itdr') return 'ITDR';
  if (productClass === 'sat') return 'SAT';
  if (productClass === 'siem') return 'SIEM';
  if (productClass === 'ispm') return 'ISPM';
  return 'SIEM Extended Retention';
}

function targetProductCodes(mapping: HuntressProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}
