import type { Queryable } from '../vendor/cove/operations';
import {
  integrationSupportsLaborMapping,
  normalizeIdList,
  type LaborMappingRecord,
  type UpsertLaborMappingInput,
} from '../../shared/laborMappings';
import type { VendorKey } from '../../shared/vendorDatapoints';

type LaborMappingRow = {
  id: string;
  vendor_id: string;
  label: string;
  board_id: number | null;
  board_name: string | null;
  type_id: number | null;
  type_name: string | null;
  subtype_id: number | null;
  subtype_name: string | null;
  type_ids: number[] | null;
  type_names: string[] | null;
  subtype_ids: number[] | null;
  subtype_names: string[] | null;
  priority: number | string;
  active: boolean;
  raw_payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function ensureLaborMappingStorage(database: Queryable) {
  await database.query(`
    create table if not exists vendor_labor_mappings (
      id uuid primary key default gen_random_uuid(),
      vendor_id text not null,
      label text not null,
      board_id integer,
      board_name text,
      type_id integer,
      type_name text,
      subtype_id integer,
      subtype_name text,
      type_ids integer[] not null default '{}'::integer[],
      type_names text[] not null default '{}'::text[],
      subtype_ids integer[] not null default '{}'::integer[],
      subtype_names text[] not null default '{}'::text[],
      priority integer not null default 100,
      active boolean not null default true,
      raw_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await database.query(`alter table vendor_labor_mappings add column if not exists type_ids integer[] not null default '{}'::integer[]`);
  await database.query(`alter table vendor_labor_mappings add column if not exists type_names text[] not null default '{}'::text[]`);
  await database.query(`alter table vendor_labor_mappings add column if not exists subtype_ids integer[] not null default '{}'::integer[]`);
  await database.query(`alter table vendor_labor_mappings add column if not exists subtype_names text[] not null default '{}'::text[]`);
  await database.query(`
    update vendor_labor_mappings
    set type_ids = array[type_id]
    where type_id is not null
      and coalesce(array_length(type_ids, 1), 0) = 0
  `);
  await database.query(`
    update vendor_labor_mappings
    set type_names = array[type_name]
    where type_name is not null
      and btrim(type_name) <> ''
      and coalesce(array_length(type_names, 1), 0) = 0
  `);
  await database.query(`
    update vendor_labor_mappings
    set subtype_ids = array[subtype_id]
    where subtype_id is not null
      and coalesce(array_length(subtype_ids, 1), 0) = 0
  `);
  await database.query(`
    update vendor_labor_mappings
    set subtype_names = array[subtype_name]
    where subtype_name is not null
      and btrim(subtype_name) <> ''
      and coalesce(array_length(subtype_names, 1), 0) = 0
  `);
  await database.query(`
    create index if not exists idx_vendor_labor_mappings_vendor_active
      on vendor_labor_mappings(vendor_id, active, priority)
  `);
  await database.query(`drop index if exists ux_vendor_labor_mappings_identity`);
  await database.query(`
    create unique index if not exists ux_vendor_labor_mappings_identity
      on vendor_labor_mappings(
        vendor_id,
        label,
        coalesce(board_id, 0),
        type_ids,
        subtype_ids
      )
  `);
}

export async function listLaborMappings(database: Queryable, vendorId: VendorKey) {
  assertLaborMappingVendor(vendorId);
  await ensureLaborMappingStorage(database);

  const result = await database.query<LaborMappingRow>(
    `select
       id,
       vendor_id,
       label,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       type_ids,
       type_names,
       subtype_ids,
       subtype_names,
       priority,
       active,
       raw_payload,
       created_at,
       updated_at
     from vendor_labor_mappings
     where vendor_id = $1
     order by priority asc, label asc, created_at asc`,
    [vendorId],
  );

  return result.rows.map(mapLaborMappingRow);
}

export async function listAllActiveLaborMappings(database: Queryable) {
  await ensureLaborMappingStorage(database);

  const result = await database.query<LaborMappingRow>(
    `select
       id,
       vendor_id,
       label,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       type_ids,
       type_names,
       subtype_ids,
       subtype_names,
       priority,
       active,
       raw_payload,
       created_at,
       updated_at
     from vendor_labor_mappings
     where active = true
     order by vendor_id asc, priority asc, label asc`,
  );

  return result.rows.map(mapLaborMappingRow);
}

export async function upsertLaborMapping(
  database: Queryable,
  vendorId: VendorKey,
  input: UpsertLaborMappingInput,
) {
  assertLaborMappingVendor(vendorId);
  await ensureLaborMappingStorage(database);

  const label = input.label?.trim();
  if (!label) {
    throw new Error('Labor mapping label is required for reports.');
  }

  const boardId = nullableId(input.boardId);
  const typeIds = normalizeIdList(input.typeIds);
  const subTypeIds = normalizeIdList(input.subTypeIds);
  if (subTypeIds.length > 0 && typeIds.length === 0) {
    throw new Error('Subtype filters require at least one ticket type (or leave subtypes as Any).');
  }
  if (typeIds.length > 0 && boardId == null) {
    throw new Error('Type filters require a board (or leave types as Any).');
  }

  const boardName = boardId == null ? null : nullableTrim(input.boardName);
  const typeNames = alignNames(typeIds, input.typeNames);
  const subTypeNames = alignNames(subTypeIds, input.subTypeNames);
  const legacyTypeId = typeIds.length === 1 ? typeIds[0] : null;
  const legacySubTypeId = subTypeIds.length === 1 ? subTypeIds[0] : null;
  const legacyTypeName = typeNames.length === 1 ? typeNames[0] : null;
  const legacySubTypeName = subTypeNames.length === 1 ? subTypeNames[0] : null;
  const priority = Number.isFinite(input.priority) ? Number(input.priority) : 100;
  const active = input.active ?? true;
  const rawPayload = JSON.stringify(input.rawPayload ?? {});

  if (input.id) {
    const result = await database.query<LaborMappingRow>(
      `update vendor_labor_mappings
       set label = $3,
           board_id = $4,
           board_name = $5,
           type_id = $6,
           type_name = $7,
           subtype_id = $8,
           subtype_name = $9,
           type_ids = $10::integer[],
           type_names = $11::text[],
           subtype_ids = $12::integer[],
           subtype_names = $13::text[],
           priority = $14,
           active = $15,
           raw_payload = $16::jsonb,
           updated_at = now()
       where id = $1
         and vendor_id = $2
       returning
         id,
         vendor_id,
         label,
         board_id,
         board_name,
         type_id,
         type_name,
         subtype_id,
         subtype_name,
         type_ids,
         type_names,
         subtype_ids,
         subtype_names,
         priority,
         active,
         raw_payload,
         created_at,
         updated_at`,
      [
        input.id,
        vendorId,
        label,
        boardId,
        boardName,
        legacyTypeId,
        legacyTypeName,
        legacySubTypeId,
        legacySubTypeName,
        typeIds,
        typeNames,
        subTypeIds,
        subTypeNames,
        priority,
        active,
        rawPayload,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Labor mapping was not found.');
    }
    return mapLaborMappingRow(row);
  }

  const result = await database.query<LaborMappingRow>(
    `insert into vendor_labor_mappings (
       vendor_id,
       label,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       type_ids,
       type_names,
       subtype_ids,
       subtype_names,
       priority,
       active,
       raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::integer[], $10::text[], $11::integer[], $12::text[], $13, $14, $15::jsonb)
     returning
       id,
       vendor_id,
       label,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       type_ids,
       type_names,
       subtype_ids,
       subtype_names,
       priority,
       active,
       raw_payload,
       created_at,
       updated_at`,
    [
      vendorId,
      label,
      boardId,
      boardName,
      legacyTypeId,
      legacyTypeName,
      legacySubTypeId,
      legacySubTypeName,
      typeIds,
      typeNames,
      subTypeIds,
      subTypeNames,
      priority,
      active,
      rawPayload,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to save labor mapping.');
  }
  return mapLaborMappingRow(row);
}

function assertLaborMappingVendor(vendorId: VendorKey) {
  if (!integrationSupportsLaborMapping(vendorId)) {
    throw new Error(`Labor mapping is not available for integration "${vendorId}".`);
  }
}

function mapLaborMappingRow(row: LaborMappingRow): LaborMappingRecord {
  const typeIds = normalizeIdList(
    row.type_ids?.length ? row.type_ids : row.type_id != null ? [row.type_id] : [],
  );
  const subTypeIds = normalizeIdList(
    row.subtype_ids?.length ? row.subtype_ids : row.subtype_id != null ? [row.subtype_id] : [],
  );
  const typeNames = stringList(row.type_names?.length ? row.type_names : row.type_name ? [row.type_name] : []);
  const subTypeNames = stringList(
    row.subtype_names?.length ? row.subtype_names : row.subtype_name ? [row.subtype_name] : [],
  );

  return {
    id: row.id,
    vendorId: row.vendor_id as VendorKey,
    label: row.label,
    boardId: row.board_id,
    boardName: row.board_name,
    typeIds,
    typeNames,
    subTypeIds,
    subTypeNames,
    priority: Number(row.priority),
    active: row.active,
    rawPayload: asObject(row.raw_payload),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function alignNames(ids: number[], names: string[] | null | undefined) {
  if (ids.length === 0) {
    return [] as string[];
  }
  const cleaned = stringList(names);
  if (cleaned.length === ids.length) {
    return cleaned;
  }
  return ids.map((id, index) => cleaned[index] || `Type ${id}`);
}

function stringList(values: string[] | null | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function nullableId(value: number | null | undefined) {
  if (value == null || value === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableTrim(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}
