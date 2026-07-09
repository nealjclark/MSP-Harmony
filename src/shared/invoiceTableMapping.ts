import type { IntegrationDataSourceType } from './integrationSettings';
import type { InvoiceTableColumnMap, VendorDatapointRecord } from './vendorDatapoints';

export type InvoiceTableFieldDefinition = {
  key: keyof InvoiceTableColumnMap;
  label: string;
  required?: boolean;
  aliases: string[];
};

export type InvoiceTableFieldGroup = {
  id: string;
  label: string;
  keys: Array<keyof InvoiceTableColumnMap>;
};

export const invoiceTableFieldDefinitions: InvoiceTableFieldDefinition[] = [
  {
    key: 'externalAccountId',
    label: 'Customer account',
    required: true,
    aliases: ['customer account number', 'account number', 'account id', 'customer id', 'client id', 'client', 'tenant id', 'external account', 'account'],
  },
  {
    key: 'externalAccountName',
    label: 'Customer name',
    aliases: ['company name', 'customer name', 'account name', 'tenant name', 'client name'],
  },
  {
    key: 'productCode',
    label: 'Product code',
    aliases: ['product code', 'sku', 'sku id', 'item code', 'part number', 'license id', 'license sku'],
  },
  {
    key: 'productName',
    label: 'Product name',
    required: true,
    aliases: ['product', 'product name', 'sku name', 'item name', 'description', 'license', 'license name', 'device category'],
  },
  {
    key: 'licenseId',
    label: 'License ID',
    aliases: ['license id', 'license sku', 'sku id', 'subscription id', 'plan id'],
  },
  {
    key: 'licenseName',
    label: 'License name',
    aliases: ['license', 'license name', 'sku name', 'plan name', 'subscription name'],
  },
  {
    key: 'userPrincipalName',
    label: 'User principal',
    aliases: ['user principal name', 'upn', 'username', 'user name', 'login', 'principal name'],
  },
  {
    key: 'email',
    label: 'Email',
    aliases: ['email', 'email address', 'mail', 'user email'],
  },
  {
    key: 'deviceId',
    label: 'Device ID',
    aliases: ['device id', 'asset id', 'computer id', 'endpoint id', 'machine id'],
  },
  {
    key: 'deviceName',
    label: 'Device name',
    aliases: ['device name', 'hostname', 'host name', 'computer name', 'machine name', 'endpoint name'],
  },
  {
    key: 'deviceType',
    label: 'DeviceType',
    aliases: ['device type', 'devicetype', 'type', 'system type', 'os type'],
  },
  {
    key: 'deviceClass',
    label: 'DeviceClass',
    aliases: ['device class', 'deviceclass', 'class', 'device category', 'physicality', 'asset class'],
  },
  {
    key: 'lastCheckIn',
    label: 'Last check-in',
    aliases: ['last check in', 'last checkin', 'lastcheckin', 'last seen', 'last online', 'last contact', 'last heartbeat'],
  },
  {
    key: 'quantity',
    label: 'Quantity',
    required: true,
    aliases: ['charge qty', 'quantity', 'qty', 'seats', 'licenses', 'usage quantity', 'usage qty'],
  },
  {
    key: 'invoiceNumber',
    label: 'Invoice number',
    aliases: ['invoice number', 'invoice #', 'invoice no', 'bill number'],
  },
  {
    key: 'invoiceDate',
    label: 'Invoice date',
    aliases: ['invoice date', 'bill date', 'date'],
  },
  {
    key: 'chargeType',
    label: 'Charge type',
    aliases: ['charge type', 'line type', 'transaction type', 'type'],
  },
  {
    key: 'billedAmount',
    label: 'Billed amount',
    aliases: ['billed amount', 'amount', 'total', 'line total', 'extended amount'],
  },
  {
    key: 'term',
    label: 'Term',
    aliases: ['term', 'subscription term', 'commitment term'],
  },
  {
    key: 'billingFrequency',
    label: 'Billing frequency',
    aliases: ['billing frequency', 'frequency', 'billing cycle'],
  },
  {
    key: 'billingPeriodStart',
    label: 'Billing period start',
    aliases: ['billing period start', 'period start', 'start date', 'start'],
  },
  {
    key: 'billingPeriodEnd',
    label: 'Billing period end',
    aliases: ['billing period end', 'period end', 'end date', 'end'],
  },
  {
    key: 'primaryDomain',
    label: 'Domain',
    aliases: ['primary domain', 'domain', 'tenant domain'],
  },
];

export const invoiceTableFieldGroups: InvoiceTableFieldGroup[] = [
  {
    id: 'account',
    label: 'Customer / account',
    keys: ['externalAccountId', 'externalAccountName', 'primaryDomain'],
  },
  {
    id: 'product',
    label: 'Product / license',
    keys: ['productCode', 'productName', 'licenseId', 'licenseName', 'quantity'],
  },
  {
    id: 'device',
    label: 'Device properties',
    keys: ['deviceId', 'deviceName', 'deviceType', 'deviceClass', 'lastCheckIn'],
  },
  {
    id: 'user',
    label: 'User detail',
    keys: ['userPrincipalName', 'email'],
  },
  {
    id: 'invoice',
    label: 'Invoice detail',
    keys: [
      'invoiceNumber',
      'invoiceDate',
      'chargeType',
      'billedAmount',
      'term',
      'billingFrequency',
      'billingPeriodStart',
      'billingPeriodEnd',
    ],
  },
];

const invoiceTableFieldDefinitionByKey = new Map(
  invoiceTableFieldDefinitions.map((field) => [field.key, field]),
);

export function invoiceTableFieldLabel(key: keyof InvoiceTableColumnMap) {
  return invoiceTableFieldDefinitionByKey.get(key)?.label ?? key;
}

/** Sentinel stored in columnMap.quantity for device lists: each CSV row counts as 1 device. */
export const CONSTANT_QUANTITY_ONE = '__one_per_row__';

export function isConstantQuantityOne(value: string | undefined) {
  return value === CONSTANT_QUANTITY_ONE;
}

export function quantityColumnSelectOptions(
  sourceType: IntegrationDataSourceType | string,
  headerOptions: string[],
) {
  if (sourceType === 'device-count') {
    return [
      { value: '', label: 'Ignore (defaults to 1 per row)' },
      { value: CONSTANT_QUANTITY_ONE, label: '1 (one per device row)' },
      ...headerOptions.map((header) => ({ value: header, label: header })),
    ];
  }

  return [
    { value: '', label: 'Ignore' },
    ...headerOptions.map((header) => ({ value: header, label: header })),
  ];
}

export function normalizeImportedCustomerLabel(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const stripped = trimmed.replace(/^[[("'"]+/, '').replace(/[\])"'"]+$/, '').trim();
  return stripped || undefined;
}

export function mappedColumnHeaders(columnMap: InvoiceTableColumnMap) {
  return Object.values(columnMap).filter(
    (header): header is string =>
      typeof header === 'string' && header.trim().length > 0 && !isConstantQuantityOne(header),
  );
}

export function columnMappingHeaderOptions(
  columnMap: InvoiceTableColumnMap,
  fileHeaders: string[] = [],
  knownHeaders: string[] = [],
) {
  return mergeKnownHeaders(knownHeaders, fileHeaders, mappedColumnHeaders(columnMap));
}

export function mergeKnownHeaders(...headerLists: Array<string[] | undefined>) {
  return [
    ...new Set(
      headerLists
        .flatMap((headers) => headers ?? [])
        .filter((header): header is string => typeof header === 'string')
        .map((header) => header.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function suggestInvoiceTableColumnMap(
  headers: string[],
  sourceType?: IntegrationDataSourceType | string,
): InvoiceTableColumnMap {
  return Object.fromEntries(
    invoiceTableFieldDefinitions.flatMap((field) => {
      if (field.key === 'quantity' && sourceType === 'device-count') {
        return [[field.key, CONSTANT_QUANTITY_ONE]];
      }
      if (field.key === 'chargeType' && sourceType === 'device-count') {
        return [];
      }
      const header = bestHeaderMatch(headers, field.aliases);
      return header ? [[field.key, header]] : [];
    }),
  ) as InvoiceTableColumnMap;
}

export function mergeInvoiceTableColumnMap(
  savedMap: InvoiceTableColumnMap,
  headers: string[],
  sourceType?: IntegrationDataSourceType | string,
): InvoiceTableColumnMap {
  const suggested = suggestInvoiceTableColumnMap(headers, sourceType);
  const merged: InvoiceTableColumnMap = { ...savedMap };

  for (const field of invoiceTableFieldDefinitions) {
    const savedHeader = savedMap[field.key];
    if (!savedHeader) {
      continue;
    }

    if (isConstantQuantityOne(savedHeader)) {
      merged[field.key] = CONSTANT_QUANTITY_ONE;
      continue;
    }

    const normalizedSaved = normalizeColumnLabel(savedHeader);
    const exact = headers.find((header) => normalizeColumnLabel(header) === normalizedSaved);
    if (exact) {
      merged[field.key] = exact;
      continue;
    }

    const partial = headers.find((header) => normalizeColumnLabel(header).includes(normalizedSaved));
    if (partial) {
      merged[field.key] = partial;
      continue;
    }

    if (suggested[field.key]) {
      merged[field.key] = suggested[field.key];
    }
  }

  for (const field of invoiceTableFieldDefinitions) {
    if (!merged[field.key] && suggested[field.key]) {
      merged[field.key] = suggested[field.key];
    }
  }

  if (sourceType === 'device-count' && !merged.quantity) {
    merged.quantity = CONSTANT_QUANTITY_ONE;
  }

  return merged;
}

export function countResolvedColumnMapFields(columnMap: InvoiceTableColumnMap, headers: string[]) {
  const headerSet = new Set(headers);
  return Object.values(columnMap).filter((header) => header && headerSet.has(header)).length;
}

export function importRequiresQuantityColumn(sourceType: IntegrationDataSourceType | string) {
  return sourceType !== 'device-count';
}

export function columnMapSatisfiesSourceType(
  sourceType: IntegrationDataSourceType | string,
  columnMap: InvoiceTableColumnMap,
  options: { requiresCustomerMapping?: boolean } = {},
) {
  const requiresCustomerMapping = options.requiresCustomerMapping ?? sourceType !== 'reseller-product-total';
  if (requiresCustomerMapping && !columnMap.externalAccountId) {
    return false;
  }

  if (importRequiresQuantityColumn(sourceType) && !columnMap.quantity) {
    return false;
  }

  const hasProductColumn = Boolean(columnMap.productName || columnMap.productCode);
  if (sourceType === 'device-count') {
    return hasProductColumn || Boolean(columnMap.deviceType || columnMap.deviceClass);
  }
  if (sourceType === 'license-count') {
    return hasProductColumn || Boolean(columnMap.licenseName || columnMap.licenseId);
  }

  return hasProductColumn;
}

export type VendorDatapointHeaderMatch = {
  datapoint: VendorDatapointRecord;
  columnMap: InvoiceTableColumnMap;
  matchedFields: number;
};

export function matchVendorDatapointByHeaders(
  datapoints: VendorDatapointRecord[],
  headers: string[],
): VendorDatapointHeaderMatch | undefined {
  let best: VendorDatapointHeaderMatch | undefined;

  for (const datapoint of datapoints) {
    if (Object.keys(datapoint.columnMap).length === 0) {
      continue;
    }

    const columnMap = mergeInvoiceTableColumnMap(datapoint.columnMap, headers, datapoint.sourceType);
    const matchedFields = countResolvedColumnMapFields(columnMap, headers);
    if (!columnMapSatisfiesSourceType(datapoint.sourceType, columnMap)) {
      continue;
    }

    if (!best || matchedFields > best.matchedFields) {
      best = { datapoint, columnMap, matchedFields };
    }
  }

  return best;
}

function bestHeaderMatch(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers
    .filter((header): header is string => typeof header === 'string')
    .map((header) => ({
      header,
      normalized: normalizeColumnLabel(header),
    }));

  for (const alias of aliases) {
    const normalizedAlias = normalizeColumnLabel(alias);
    const exact = normalizedHeaders.find((item) => item.normalized === normalizedAlias);
    if (exact) return exact.header;
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeColumnLabel(alias);
    const partial = normalizedHeaders.find((item) => item.normalized.includes(normalizedAlias));
    if (partial) return partial.header;
  }

  return undefined;
}

function normalizeColumnLabel(value: string | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
