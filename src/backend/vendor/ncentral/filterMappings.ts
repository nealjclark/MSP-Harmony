import type { Queryable } from '../cove/operations';
import {
  defaultNcentralProductMappings,
  isNcentralProductMappingKey,
  type NcentralProductMappingKey,
} from './rules';

export type NcentralFilterMappingType = 'product' | 'overlay';
export type NcentralFilterMappingStatus = 'candidate' | 'approved' | 'needs-review' | 'rejected';

export type NcentralFilterMapping = {
  id: string;
  filterId?: string;
  filterName: string;
  mappingType: NcentralFilterMappingType;
  vendorProductKey?: NcentralProductMappingKey | string;
  displayName: string;
  tagKey?: string;
  priority: number;
  status: NcentralFilterMappingStatus;
  active: boolean;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpsertNcentralFilterMappingInput = {
  id?: string;
  filterId?: string;
  filterName: string;
  mappingType: NcentralFilterMappingType;
  vendorProductKey?: string;
  displayName: string;
  tagKey?: string;
  priority?: number;
  status?: NcentralFilterMappingStatus;
  active?: boolean;
  rawPayload?: Record<string, unknown>;
};

type NcentralFilterMappingRow = {
  id: string;
  filter_id: string | null;
  filter_name: string;
  mapping_type: NcentralFilterMappingType;
  vendor_product_key: string | null;
  display_name: string;
  tag_key: string | null;
  priority: number | string;
  mapping_status: NcentralFilterMappingStatus;
  active: boolean;
  raw_payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

const defaultFilterMappings: Array<Omit<UpsertNcentralFilterMappingInput, 'id'>> = [
  {
    filterName: 'Billing - Servers - Physical',
    mappingType: 'product',
    vendorProductKey: 'ncentral-physical-server',
    displayName: defaultNcentralProductMappings['ncentral-physical-server'].productName,
    priority: 10,
    status: 'approved',
    active: true,
  },
  {
    filterName: 'Billing - Servers - Virtual Machines',
    mappingType: 'product',
    vendorProductKey: 'ncentral-virtual-server',
    displayName: defaultNcentralProductMappings['ncentral-virtual-server'].productName,
    priority: 20,
    status: 'approved',
    active: true,
  },
  {
    filterName: 'Billing - Workstations and Laptops',
    mappingType: 'product',
    vendorProductKey: 'ncentral-workstation',
    displayName: defaultNcentralProductMappings['ncentral-workstation'].productName,
    priority: 30,
    status: 'approved',
    active: true,
  },
  {
    filterName: 'Agent Check-In greater than 30 days',
    mappingType: 'overlay',
    displayName: 'Stale 30+ days offline',
    tagKey: 'stale-30-days',
    priority: 100,
    status: 'approved',
    active: true,
  },
  {
    filterName: 'Billing - DoNotBill Devices',
    mappingType: 'overlay',
    displayName: 'Do not bill',
    tagKey: 'do-not-bill',
    priority: 110,
    status: 'approved',
    active: true,
  },
];

export async function ensureDefaultNcentralFilterMappings(database: Queryable) {
  for (const mapping of defaultFilterMappings) {
    await database.query(
      `insert into ncentral_filter_mappings (
         filter_id,
         filter_name,
         mapping_type,
         vendor_product_key,
         display_name,
         tag_key,
         priority,
         mapping_status,
         active,
         raw_payload
       )
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
       where not exists (
         select 1
         from ncentral_filter_mappings
         where mapping_type = $3
           and filter_name = $2
           and coalesce(filter_id, '') = coalesce($1, '')
           and coalesce(vendor_product_key, '') = coalesce($4, '')
           and coalesce(tag_key, '') = coalesce($6, '')
       )`,
      [
        mapping.filterId ?? null,
        mapping.filterName,
        mapping.mappingType,
        mapping.vendorProductKey ?? null,
        mapping.displayName,
        mapping.tagKey ?? null,
        mapping.priority ?? 100,
        mapping.status ?? 'approved',
        mapping.active ?? true,
        JSON.stringify(mapping.rawPayload ?? { seeded: true }),
      ],
    );
  }
}

export async function listNcentralFilterMappings(database: Queryable): Promise<NcentralFilterMapping[]> {
  await ensureDefaultNcentralFilterMappings(database);
  const result = await database.query<NcentralFilterMappingRow>(
    `select
       id,
       filter_id,
       filter_name,
       mapping_type,
       vendor_product_key,
       display_name,
       tag_key,
       priority,
       mapping_status,
       active,
       raw_payload,
       created_at,
       updated_at
     from ncentral_filter_mappings
     order by active desc, mapping_type, priority, filter_name`,
  );

  return result.rows.map(mapFilterMappingRow);
}

export async function upsertNcentralFilterMapping(
  database: Queryable,
  input: UpsertNcentralFilterMappingInput,
): Promise<NcentralFilterMapping> {
  validateFilterMapping(input);

  if (input.id) {
    const result = await database.query<NcentralFilterMappingRow>(
      `update ncentral_filter_mappings
       set filter_id = $2,
           filter_name = $3,
           mapping_type = $4,
           vendor_product_key = $5,
           display_name = $6,
           tag_key = $7,
           priority = $8,
           mapping_status = $9,
           active = $10,
           raw_payload = $11::jsonb,
           updated_at = now()
       where id = $1
       returning
         id,
         filter_id,
         filter_name,
         mapping_type,
         vendor_product_key,
         display_name,
         tag_key,
         priority,
         mapping_status,
         active,
         raw_payload,
         created_at,
         updated_at`,
      [
        input.id,
        nullableTrim(input.filterId),
        input.filterName.trim(),
        input.mappingType,
        nullableTrim(input.vendorProductKey),
        input.displayName.trim(),
        nullableTrim(input.tagKey),
        input.priority ?? 100,
        input.status ?? 'approved',
        input.active ?? true,
        JSON.stringify(input.rawPayload ?? {}),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('N-central filter mapping was not found.');
    }

    return mapFilterMappingRow(row);
  }

  const result = await database.query<NcentralFilterMappingRow>(
    `insert into ncentral_filter_mappings (
       filter_id,
       filter_name,
       mapping_type,
       vendor_product_key,
       display_name,
       tag_key,
       priority,
       mapping_status,
       active,
       raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     returning
       id,
       filter_id,
       filter_name,
       mapping_type,
       vendor_product_key,
       display_name,
       tag_key,
       priority,
       mapping_status,
       active,
       raw_payload,
       created_at,
       updated_at`,
    [
      nullableTrim(input.filterId),
      input.filterName.trim(),
      input.mappingType,
      nullableTrim(input.vendorProductKey),
      input.displayName.trim(),
      nullableTrim(input.tagKey),
      input.priority ?? 100,
      input.status ?? 'approved',
      input.active ?? true,
      JSON.stringify(input.rawPayload ?? {}),
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to save N-central filter mapping.');
  }

  return mapFilterMappingRow(row);
}

export async function updateNcentralMappingResolvedFilterId(
  database: Queryable,
  mappingId: string,
  filterId: string,
  rawPayload: unknown,
) {
  await database.query(
    `update ncentral_filter_mappings
     set filter_id = $2,
         raw_payload = $3::jsonb,
         updated_at = now()
     where id = $1
       and (filter_id is null or filter_id <> $2)`,
    [mappingId, filterId, JSON.stringify(rawPayload ?? {})],
  );
}

function validateFilterMapping(input: UpsertNcentralFilterMappingInput) {
  if (!input.filterId?.trim() && !input.filterName?.trim()) {
    throw new Error('N-central filter mapping requires a filter ID or exact filter name.');
  }

  if (!input.displayName?.trim()) {
    throw new Error('N-central filter mapping requires a display name.');
  }

  if (input.mappingType === 'product') {
    if (!input.vendorProductKey?.trim()) {
      throw new Error('Product filter mapping requires a vendor product key.');
    }

    return;
  }

  if (!input.tagKey?.trim()) {
    throw new Error('Overlay filter mapping requires a tag key.');
  }
}

function mapFilterMappingRow(row: NcentralFilterMappingRow): NcentralFilterMapping {
  return {
    id: row.id,
    filterId: row.filter_id ?? undefined,
    filterName: row.filter_name,
    mappingType: row.mapping_type,
    vendorProductKey:
      row.vendor_product_key && isNcentralProductMappingKey(row.vendor_product_key)
        ? row.vendor_product_key
        : row.vendor_product_key ?? undefined,
    displayName: row.display_name,
    tagKey: row.tag_key ?? undefined,
    priority: integerValue(row.priority),
    status: row.mapping_status,
    active: row.active,
    rawPayload: recordFromJson(row.raw_payload),
    createdAt: isoDate(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function nullableTrim(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return recordFromJson(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function integerValue(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
