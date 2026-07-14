import { getIntegrationSettingsDefinition, integrationHasCapability, type IntegrationId } from './integrationSettings';

export type VendorDatapointId = `datapoint:${string}`;
export const crossVendorBundlesVendorId = 'cross-vendor-bundles' as const;
export type CrossVendorBundlesVendorId = typeof crossVendorBundlesVendorId;
export type VendorKey = IntegrationId | VendorDatapointId | CrossVendorBundlesVendorId;

export type ManualImportSyncMode = 'info-only' | 'full-vendor-sync';
export type VendorDatapointImportMode = 'merge' | 'overwrite';

export type InvoiceTableColumnMap = {
  externalAccountId?: string;
  externalAccountName?: string;
  productCode?: string;
  productName?: string;
  licenseId?: string;
  licenseName?: string;
  userPrincipalName?: string;
  email?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  deviceClass?: string;
  lastCheckIn?: string;
  quantity?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  chargeType?: string;
  billedAmount?: string;
  term?: string;
  billingFrequency?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  primaryDomain?: string;
};

export type VendorDatapointRecord = {
  id: string;
  vendorId: VendorDatapointId;
  displayName: string;
  description?: string;
  linkedIntegrationId?: IntegrationId;
  sourceType: string;
  syncMode: ManualImportSyncMode;
  columnMap: InvoiceTableColumnMap;
  knownHeaders: string[];
  defaultImportMode: VendorDatapointImportMode;
  active: boolean;
  lastImportedAt?: string;
  lastImportFileName?: string;
  lastImportRowCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateVendorDatapointInput = {
  displayName: string;
  description?: string;
  linkedIntegrationId?: IntegrationId;
  sourceType: string;
  syncMode?: ManualImportSyncMode;
  columnMap?: InvoiceTableColumnMap;
  knownHeaders?: string[];
  defaultImportMode?: VendorDatapointImportMode;
};

export type UpdateVendorDatapointInput = {
  displayName?: string;
  description?: string;
  linkedIntegrationId?: IntegrationId | null;
  sourceType?: string;
  syncMode?: ManualImportSyncMode;
  columnMap?: InvoiceTableColumnMap;
  knownHeaders?: string[];
  defaultImportMode?: VendorDatapointImportMode;
  active?: boolean;
};

const datapointPrefix = 'datapoint:';

export function vendorDatapointVendorId(id: string): VendorDatapointId {
  return `${datapointPrefix}${id}`;
}

export function isVendorDatapointId(value: string): value is VendorDatapointId {
  return value.startsWith(datapointPrefix) && value.length > datapointPrefix.length;
}

export function vendorDatapointUuidFromVendorId(vendorId: string): string | undefined {
  if (!isVendorDatapointId(vendorId)) {
    return undefined;
  }

  return vendorId.slice(datapointPrefix.length);
}

export function isVendorKey(value: string): value is VendorKey {
  return value === crossVendorBundlesVendorId || Boolean(getIntegrationSettingsDefinition(value as IntegrationId)) || isVendorDatapointId(value);
}

export function vendorSupportsMapping(vendorId: string) {
  if (vendorId === crossVendorBundlesVendorId) {
    return false;
  }

  if (isVendorDatapointId(vendorId)) {
    return true;
  }

  return integrationHasCapability(vendorId as IntegrationId, 'mapping');
}

export function vendorSupportsInvoiceImport(vendorId: string) {
  if (vendorId === crossVendorBundlesVendorId) {
    return false;
  }

  if (isVendorDatapointId(vendorId)) {
    return true;
  }

  return integrationHasCapability(vendorId as IntegrationId, 'invoice-import');
}

export function mappingVendorIdForDatapoint(
  datapointVendorId: VendorDatapointId,
  linkedIntegrationId?: IntegrationId,
): VendorKey {
  if (linkedIntegrationId && getIntegrationSettingsDefinition(linkedIntegrationId)) {
    return linkedIntegrationId;
  }

  return datapointVendorId;
}
