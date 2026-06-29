import type { DimensionFilter, MoneyAmount, VendorRuleSet } from '../../shared/types';

export type DattoProductMappingKey =
  | 'datto-bcdr-agent'
  | 'datto-saas-office365-icr'
  | 'datto-saas-office365-tbr'
  | 'datto-saas-googleapps-icr'
  | 'datto-saas-googleapps-tbr'
  | string;

export type DattoProductMapping = {
  vendorProductKey: DattoProductMappingKey;
  productCode: string;
  productName: string;
  targetProductCodes?: string[];
  unitPrice?: MoneyAmount;
};

export const dattoProductKeys = [
  'datto-bcdr-agent',
  'datto-saas-office365-icr',
  'datto-saas-office365-tbr',
  'datto-saas-googleapps-icr',
  'datto-saas-googleapps-tbr',
] as const;

export const defaultDattoProductMappings: Record<DattoProductMappingKey, DattoProductMapping> = {
  'datto-bcdr-agent': {
    vendorProductKey: 'datto-bcdr-agent',
    productCode: 'DATTO-BCDR-AGENT',
    productName: 'Datto BCDR Protected Agent',
  },
  'datto-saas-office365-icr': {
    vendorProductKey: 'datto-saas-office365-icr',
    productCode: 'DATTO-SAAS-OFFICE365-ICR',
    productName: 'Datto SaaS Protection Office 365 Infinite Cloud Retention',
  },
  'datto-saas-office365-tbr': {
    vendorProductKey: 'datto-saas-office365-tbr',
    productCode: 'DATTO-SAAS-OFFICE365-TBR',
    productName: 'Datto SaaS Protection Office 365 Time Based Retention',
  },
  'datto-saas-googleapps-icr': {
    vendorProductKey: 'datto-saas-googleapps-icr',
    productCode: 'DATTO-SAAS-GOOGLEAPPS-ICR',
    productName: 'Datto SaaS Protection Google Workspace Infinite Cloud Retention',
  },
  'datto-saas-googleapps-tbr': {
    vendorProductKey: 'datto-saas-googleapps-tbr',
    productCode: 'DATTO-SAAS-GOOGLEAPPS-TBR',
    productName: 'Datto SaaS Protection Google Workspace Time Based Retention',
  },
};

export function buildDattoRuleSet(
  mappings: Partial<Record<DattoProductMappingKey, DattoProductMapping>> = {},
): VendorRuleSet {
  const cleanMappings = Object.fromEntries(
    Object.entries(mappings).filter((entry): entry is [string, DattoProductMapping] => Boolean(entry[1])),
  );
  const resolvedMappings: Record<string, DattoProductMapping> = {
    ...defaultDattoProductMappings,
    ...cleanMappings,
  };

  return {
    vendorId: 'datto',
    vendorName: 'Datto Backup',
    rules: Object.values(resolvedMappings).map((mapping) => {
      const key = mapping.vendorProductKey;
      const isBcdr = key === 'datto-bcdr-agent';
      const dimensions: DimensionFilter = isBcdr
        ? { dattoProductFamily: 'bcdr' }
        : { dattoProductFamily: 'saas', dattoSaasProductKey: key };

      return {
        id: `${key}-count`,
        vendorId: 'datto',
        vendorProductKey: key,
        productCode: mapping.productCode,
        targetProductCodes: targetProductCodes(mapping),
        productName: mapping.productName,
        sourceMetric: 'snapshot-count',
        billableUnit: isBcdr ? 'device' : 'license',
        dimensions,
        unitPrice: mapping.unitPrice,
        notes: isBcdr
          ? 'Datto BCDR is counted by protected agents from the Datto REST /v1/bcdr/agent endpoint.'
          : `${mapping.productName} is counted from SaaS Protection REST domain product-line seatsUsed data.`,
      };
    }),
  };
}

export const dattoRuleSet = buildDattoRuleSet();

export function isDattoProductMappingKey(value: string): value is DattoProductMappingKey {
  return value.trim().length > 0;
}

export function dattoProductKeyForSaasProductLine(
  productType: string | undefined,
  retentionType: string | undefined,
): DattoProductMappingKey {
  const product = productTypeKeyPart(productType) ?? 'unknown';
  const retention = productTypeKeyPart(retentionType) ?? 'standard';

  return `datto-saas-${product}-${retention}`;
}

export function dattoProductNameForSaasProductLine(
  productType: string | undefined,
  retentionType: string | undefined,
) {
  const productName =
    /^office365$/i.test(productType ?? '') || /^microsoft\s*365$/i.test(productType ?? '')
      ? 'Office 365'
      : /^googleapps$/i.test(productType ?? '') || /^google\s*workspace$/i.test(productType ?? '')
        ? 'Google Workspace'
        : productType?.trim() || 'Unknown SaaS';
  const retentionName =
    /^icr$/i.test(retentionType ?? '')
      ? 'Infinite Cloud Retention'
      : /^tbr$/i.test(retentionType ?? '')
        ? 'Time Based Retention'
        : retentionType?.trim() || 'Standard Retention';

  return `Datto SaaS Protection ${productName} ${retentionName}`;
}

function targetProductCodes(mapping: DattoProductMapping) {
  return [...new Set([mapping.productCode, ...(mapping.targetProductCodes ?? [])])];
}

function productTypeKeyPart(value: string | undefined) {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'microsoft365') return 'office365';
  if (normalized === 'googleworkspace') return 'googleapps';
  return normalized;
}
