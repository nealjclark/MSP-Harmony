import { getIntegrationSettingsDefinition, integrationHasCapability, type IntegrationId } from './integrationSettings';
import { isVendorDatapointId, type VendorKey } from './vendorDatapoints';

/** Ticket fields used for labor filter matching (not time-entry fields). */
export type LaborTicketClassification = {
  ticketId: number | string;
  boardId?: number | null;
  typeId?: number | null;
  subTypeId?: number | null;
  actualHours?: number | null;
  closedAt?: string | null;
};

export type LaborMappingFilter = {
  boardId?: number | null;
  /** Empty = any type. */
  typeIds?: number[];
  /** Empty = any subtype. */
  subTypeIds?: number[];
};

export type LaborTypeOption = {
  id: number;
  name: string;
};

export type LaborMappingRecord = {
  id: string;
  vendorId: VendorKey;
  /** Report-facing labor type label (e.g. "Datto BCDR"). */
  label: string;
  boardId?: number | null;
  boardName?: string | null;
  typeIds: number[];
  typeNames: string[];
  subTypeIds: number[];
  subTypeNames: string[];
  priority: number;
  active: boolean;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpsertLaborMappingInput = {
  id?: string;
  label: string;
  boardId?: number | null;
  boardName?: string | null;
  typeIds?: number[];
  typeNames?: string[];
  subTypeIds?: number[];
  subTypeNames?: string[];
  priority?: number;
  active?: boolean;
  rawPayload?: Record<string, unknown>;
};

export type ConnectWiseBoardOption = {
  id: number;
  name: string;
};

export type ConnectWiseTypeOption = {
  id: number;
  name: string;
  boardId: number;
};

export type ConnectWiseSubTypeOption = {
  id: number;
  name: string;
  boardId: number;
};

export function integrationSupportsLaborMapping(vendorId: string): vendorId is VendorKey {
  if (isVendorDatapointId(vendorId)) {
    return true;
  }

  const definition = getIntegrationSettingsDefinition(vendorId as IntegrationId);
  if (!definition) {
    return false;
  }

  if (definition.integrationId === 'connectwise') {
    return true;
  }

  return integrationHasCapability(definition.integrationId, 'mapping');
}

export function normalizeIdList(values: Array<number | null | undefined> | null | undefined): number[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed === 0 || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    ids.push(parsed);
  }
  return ids.sort((left, right) => left - right);
}

export function laborFilterMatchesTicket(
  filter: LaborMappingFilter,
  ticket: Pick<LaborTicketClassification, 'boardId' | 'typeId' | 'subTypeId'>,
): boolean {
  if (filter.boardId != null && filter.boardId !== ticket.boardId) {
    return false;
  }

  const typeIds = normalizeIdList(filter.typeIds);
  if (typeIds.length > 0 && (ticket.typeId == null || !typeIds.includes(ticket.typeId))) {
    return false;
  }

  const subTypeIds = normalizeIdList(filter.subTypeIds);
  if (subTypeIds.length > 0 && (ticket.subTypeId == null || !subTypeIds.includes(ticket.subTypeId))) {
    return false;
  }

  return true;
}

/** Higher score = more specific filter (board +4, types +2, subtypes +1). */
export function laborFilterSpecificity(filter: LaborMappingFilter): number {
  return (
    (filter.boardId != null ? 4 : 0) +
    (normalizeIdList(filter.typeIds).length > 0 ? 2 : 0) +
    (normalizeIdList(filter.subTypeIds).length > 0 ? 1 : 0)
  );
}

/**
 * Pick a single labor mapping for a ticket.
 * Prefer higher specificity, then lower priority number.
 * Callers that aggregate hours across mappings must still dedupe by ticket id.
 */
export function selectLaborMappingForTicket<T extends LaborMappingFilter & { priority: number; active?: boolean }>(
  mappings: T[],
  ticket: Pick<LaborTicketClassification, 'boardId' | 'typeId' | 'subTypeId'>,
): T | undefined {
  const matches = mappings
    .filter((mapping) => mapping.active !== false)
    .filter((mapping) => laborFilterMatchesTicket(mapping, ticket))
    .sort((left, right) => {
      const specificityDelta = laborFilterSpecificity(right) - laborFilterSpecificity(left);
      if (specificityDelta !== 0) {
        return specificityDelta;
      }
      return left.priority - right.priority;
    });

  return matches[0];
}

/**
 * When joining tickets from multiple labor filters, never double-count the same ticket id.
 * Hours are summed once per ticket regardless of how many filters matched.
 */
export function sumDistinctTicketHours(
  tickets: Array<Pick<LaborTicketClassification, 'ticketId' | 'actualHours'>>,
): number {
  const seen = new Set<string>();
  let total = 0;

  for (const ticket of tickets) {
    const key = String(ticket.ticketId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const hours = Number(ticket.actualHours ?? 0);
    if (Number.isFinite(hours)) {
      total += hours;
    }
  }

  return total;
}

export function formatLaborFilterSummary(mapping: {
  boardId?: number | null;
  boardName?: string | null;
  typeIds?: number[];
  typeNames?: string[];
  subTypeIds?: number[];
  subTypeNames?: string[];
  /** Legacy single-value fields still accepted for display. */
  typeId?: number | null;
  typeName?: string | null;
  subTypeId?: number | null;
  subTypeName?: string | null;
}): string {
  const board = mapping.boardId != null ? mapping.boardName || `Board ${mapping.boardId}` : 'Any board';
  const typeIds = normalizeIdList(mapping.typeIds?.length ? mapping.typeIds : mapping.typeId != null ? [mapping.typeId] : []);
  const subTypeIds = normalizeIdList(
    mapping.subTypeIds?.length ? mapping.subTypeIds : mapping.subTypeId != null ? [mapping.subTypeId] : [],
  );
  const typeNames = mapping.typeNames?.filter(Boolean) ?? [];
  const subTypeNames = mapping.subTypeNames?.filter(Boolean) ?? [];
  const type =
    typeIds.length === 0
      ? 'Any type'
      : typeNames.length > 0
        ? typeNames.join(', ')
        : typeIds.map((id) => `Type ${id}`).join(', ');
  const subType =
    subTypeIds.length === 0
      ? 'Any subtype'
      : subTypeNames.length > 0
        ? subTypeNames.join(', ')
        : subTypeIds.map((id) => `Subtype ${id}`).join(', ');
  return `${board} / ${type} / ${subType}`;
}
