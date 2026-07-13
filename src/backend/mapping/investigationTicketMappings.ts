import type { Queryable } from '../vendor/cove/operations';
import {
  integrationSupportsInvestigationTicketMapping,
  isDefaultInvestigationTicketStatus,
  type InvestigationTicketMappingRecord,
  type UpsertInvestigationTicketMappingInput,
} from '../../shared/investigationTicketMappings';
import type { VendorKey } from '../../shared/vendorDatapoints';

type InvestigationTicketMappingRow = {
  id: string;
  vendor_id: string;
  board_id: number;
  board_name: string | null;
  type_id: number;
  type_name: string | null;
  subtype_id: number | null;
  subtype_name: string | null;
  status_id: number | null;
  status_name: string | null;
  company_override_id: number | null;
  company_override_name: string | null;
  raw_payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function ensureInvestigationTicketMappingStorage(database: Queryable) {
  await database.query(`
    create table if not exists vendor_investigation_ticket_mappings (
      id uuid primary key default gen_random_uuid(),
      vendor_id text not null unique,
      board_id integer not null,
      board_name text,
      type_id integer not null,
      type_name text,
      subtype_id integer,
      subtype_name text,
      status_id integer,
      status_name text,
      company_override_id integer,
      company_override_name text,
      raw_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await database.query(
    `alter table vendor_investigation_ticket_mappings add column if not exists company_override_id integer`,
  );
  await database.query(
    `alter table vendor_investigation_ticket_mappings add column if not exists company_override_name text`,
  );
  await database.query(`
    create index if not exists idx_vendor_investigation_ticket_mappings_vendor
      on vendor_investigation_ticket_mappings(vendor_id)
  `);
}

export async function getInvestigationTicketMapping(database: Queryable, vendorId: VendorKey) {
  assertInvestigationTicketMappingVendor(vendorId);
  await ensureInvestigationTicketMappingStorage(database);

  const result = await database.query<InvestigationTicketMappingRow>(
    `select
       id,
       vendor_id,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       status_id,
       status_name,
       company_override_id,
       company_override_name,
       raw_payload,
       created_at,
       updated_at
     from vendor_investigation_ticket_mappings
     where vendor_id = $1
     limit 1`,
    [vendorId],
  );

  return result.rows[0] ? mapInvestigationTicketMappingRow(result.rows[0]) : null;
}

export async function upsertInvestigationTicketMapping(
  database: Queryable,
  vendorId: VendorKey,
  input: UpsertInvestigationTicketMappingInput,
) {
  assertInvestigationTicketMappingVendor(vendorId);
  await ensureInvestigationTicketMappingStorage(database);

  const boardId = requiredId(input.boardId, 'board');
  const typeId = requiredId(input.typeId, 'type');
  const subTypeId = nullableId(input.subTypeId);
  const useDefaultStatus = isDefaultInvestigationTicketStatus(input.statusId);
  const statusId = useDefaultStatus ? null : requiredId(input.statusId as number, 'status');
  const companyOverrideId = nullableId(input.companyOverrideId);
  const boardName = nullableTrim(input.boardName);
  const typeName = nullableTrim(input.typeName);
  const subTypeName = subTypeId == null ? null : nullableTrim(input.subTypeName);
  const statusName = useDefaultStatus ? 'default' : nullableTrim(input.statusName);
  const companyOverrideName =
    companyOverrideId == null ? null : nullableTrim(input.companyOverrideName) ?? `Company ${companyOverrideId}`;
  const rawPayload = JSON.stringify(input.rawPayload ?? {});

  const result = await database.query<InvestigationTicketMappingRow>(
    `insert into vendor_investigation_ticket_mappings (
       vendor_id,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       status_id,
       status_name,
       company_override_id,
       company_override_name,
       raw_payload,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
     on conflict (vendor_id) do update set
       board_id = excluded.board_id,
       board_name = excluded.board_name,
       type_id = excluded.type_id,
       type_name = excluded.type_name,
       subtype_id = excluded.subtype_id,
       subtype_name = excluded.subtype_name,
       status_id = excluded.status_id,
       status_name = excluded.status_name,
       company_override_id = excluded.company_override_id,
       company_override_name = excluded.company_override_name,
       raw_payload = excluded.raw_payload,
       updated_at = now()
     returning
       id,
       vendor_id,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       status_id,
       status_name,
       company_override_id,
       company_override_name,
       raw_payload,
       created_at,
       updated_at`,
    [
      vendorId,
      boardId,
      boardName,
      typeId,
      typeName,
      subTypeId,
      subTypeName,
      statusId,
      statusName,
      companyOverrideId,
      companyOverrideName,
      rawPayload,
    ],
  );

  return mapInvestigationTicketMappingRow(result.rows[0]);
}

function assertInvestigationTicketMappingVendor(vendorId: string): asserts vendorId is VendorKey {
  if (!integrationSupportsInvestigationTicketMapping(vendorId)) {
    throw new Error(`Investigation ticket mapping is not available for integration "${vendorId}".`);
  }
}

function mapInvestigationTicketMappingRow(row: InvestigationTicketMappingRow): InvestigationTicketMappingRecord {
  return {
    id: row.id,
    vendorId: row.vendor_id as VendorKey,
    boardId: Number(row.board_id),
    boardName: row.board_name,
    typeId: Number(row.type_id),
    typeName: row.type_name,
    subTypeId: row.subtype_id == null ? null : Number(row.subtype_id),
    subTypeName: row.subtype_name,
    statusId: row.status_id == null ? null : Number(row.status_id),
    statusName: row.status_name,
    companyOverrideId: row.company_override_id == null ? null : Number(row.company_override_id),
    companyOverrideName: row.company_override_name,
    rawPayload: asObject(row.raw_payload),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function requiredId(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) {
    throw new Error(`Investigation ticket mapping requires a valid ${label}.`);
  }
  return parsed;
}

function nullableId(value: unknown) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return null;
  }
  return parsed;
}

function nullableTrim(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
