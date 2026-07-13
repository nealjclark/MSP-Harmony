import { getIntegrationSettingsDefinition, integrationHasCapability, type IntegrationId } from './integrationSettings';
import { isVendorDatapointId, type VendorKey } from './vendorDatapoints';

/** Sentinel value: omit status on create so the board assigns its default. */
export const INVESTIGATION_TICKET_STATUS_DEFAULT = 'default' as const;

export type InvestigationTicketStatusMode = typeof INVESTIGATION_TICKET_STATUS_DEFAULT | number;

export type InvestigationTicketMappingRecord = {
  id: string;
  vendorId: VendorKey;
  boardId: number;
  boardName: string | null;
  typeId: number;
  typeName: string | null;
  subTypeId: number | null;
  subTypeName: string | null;
  /** null means board default (do not send status on create). */
  statusId: number | null;
  statusName: string | null;
  /** When set, tickets open under this company instead of the license company. */
  companyOverrideId: number | null;
  companyOverrideName: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpsertInvestigationTicketMappingInput = {
  boardId: number;
  boardName?: string | null;
  typeId: number;
  typeName?: string | null;
  subTypeId?: number | null;
  subTypeName?: string | null;
  /** Omit, null, or "default" to leave status unset on ticket create. */
  statusId?: number | null | typeof INVESTIGATION_TICKET_STATUS_DEFAULT;
  statusName?: string | null;
  companyOverrideId?: number | null;
  companyOverrideName?: string | null;
  rawPayload?: Record<string, unknown>;
};

export type InvestigationTicketProductSnapshot = {
  sourceLineId: string;
  productCode: string;
  productName: string;
  vendorProductKey?: string;
  apiCount?: number | null;
  linkedCount?: number | null;
  invoiceCount?: number | null;
  connectWiseCount?: number | null;
  proposedCount?: number | null;
  selectedCountSource?: string | null;
  delta?: number | null;
  financialImpact?: number | null;
  unit?: string | null;
  discrepancySnapshot?: Record<string, unknown>;
};

export type InvestigationTicketRecord = {
  id: string;
  connectWiseTicketId: number;
  connectWiseTicketNumber: string;
  vendorId: VendorKey;
  vendorName: string | null;
  customerId: string | null;
  customerName: string | null;
  agreementId: string | null;
  agreementName: string | null;
  companyId: number | null;
  summary: string;
  notes: string | null;
  boardId: number | null;
  typeId: number | null;
  subTypeId: number | null;
  statusId: number | null;
  reconciliationMonth: string;
  createdBy: string | null;
  createdAt: string;
  products: InvestigationTicketProductSnapshot[];
};

export type InvestigationTicketTimeEntry = {
  id: number;
  memberName?: string | null;
  notes?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
  actualHours?: number | null;
  billableOption?: string | null;
  workType?: string | null;
  workRole?: string | null;
  enteredDate?: string | null;
};

export function integrationSupportsInvestigationTicketMapping(vendorId: string): vendorId is VendorKey {
  if (vendorId === 'connectwise') {
    return false;
  }

  if (isVendorDatapointId(vendorId)) {
    return true;
  }

  const definition = getIntegrationSettingsDefinition(vendorId as IntegrationId);
  if (!definition) {
    return false;
  }

  return integrationHasCapability(definition.integrationId, 'mapping');
}

export function isDefaultInvestigationTicketStatus(
  statusId: number | null | undefined | typeof INVESTIGATION_TICKET_STATUS_DEFAULT,
): boolean {
  return statusId == null || statusId === INVESTIGATION_TICKET_STATUS_DEFAULT;
}

export function formatInvestigationTicketStatusLabel(mapping: {
  statusId?: number | null;
  statusName?: string | null;
}): string {
  if (mapping.statusId == null) {
    return 'Board default';
  }
  return mapping.statusName?.trim() || `Status ${mapping.statusId}`;
}
