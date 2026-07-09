import type { BillingUnit } from './types';

export function billableUnitForVendorProductKey(vendorProductKey: string | undefined): BillingUnit {
  const normalized = (vendorProductKey ?? '').toLowerCase();
  if (!normalized) {
    return 'license';
  }

  if (normalized.startsWith('device:')) {
    if (/workstation|desktop|laptop|mobile/.test(normalized)) {
      return 'workstation';
    }
    if (/server|virtual|physical/.test(normalized)) {
      return 'server';
    }
    return 'device';
  }

  if (/workstation|desktop|laptop/.test(normalized)) {
    return 'workstation';
  }
  if (/server|virtual|physical/.test(normalized)) {
    return 'server';
  }
  if (normalized.startsWith('ncentral-')) {
    return /workstation/.test(normalized) ? 'workstation' : 'server';
  }

  return 'license';
}
