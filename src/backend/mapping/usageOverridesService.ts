import type { DimensionMap } from '../shared/types';
import type { Queryable } from '../vendor/cove/operations';

export type UsageOverrideRow = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  source_vendor_product_key: string;
  target_vendor_product_key: string;
  dimension_filters: unknown;
  target_dimensions: unknown;
  reason: string | null;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type UsageOverride = {
  id: string;
  vendorId: string;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  sourceVendorProductKey: string;
  targetVendorProductKey: string;
  dimensionFilters: DimensionMap;
  targetDimensions: DimensionMap;
  reason?: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateUsageOverrideInput = {
  customerId?: string;
  agreementId?: string;
  sourceVendorProductKey: string;
  targetVendorProductKey: string;
  dimensionFilters?: DimensionMap;
  targetDimensions?: DimensionMap;
  reason?: string;
  reviewedBy?: string;
};

export async function listUsageOverrides(database: Queryable, vendorId: string) {
  const result = await database.query<UsageOverrideRow>(
    `select
       vendor_usage_overrides.id,
       vendor_usage_overrides.vendor_id,
       vendor_usage_overrides.customer_id,
       customers.name as customer_name,
       vendor_usage_overrides.agreement_id,
       agreements.name as agreement_name,
       vendor_usage_overrides.source_vendor_product_key,
       vendor_usage_overrides.target_vendor_product_key,
       vendor_usage_overrides.dimension_filters,
       vendor_usage_overrides.target_dimensions,
       vendor_usage_overrides.reason,
       vendor_usage_overrides.active,
       vendor_usage_overrides.reviewed_by,
       vendor_usage_overrides.reviewed_at,
       vendor_usage_overrides.created_at,
       vendor_usage_overrides.updated_at
     from vendor_usage_overrides
     left join customers on customers.id = vendor_usage_overrides.customer_id
     left join agreements on agreements.id = vendor_usage_overrides.agreement_id
     where vendor_usage_overrides.vendor_id = $1
       and vendor_usage_overrides.active = true
     order by customers.name nulls last, agreements.name nulls last, vendor_usage_overrides.created_at desc`,
    [vendorId],
  );

  return result.rows.map(mapOverrideRow);
}

export async function createUsageOverride(database: Queryable, vendorId: string, input: CreateUsageOverrideInput) {
  validateUsageOverrideInput(input);

  const result = await database.query<UsageOverrideRow>(
    `insert into vendor_usage_overrides (
       vendor_id,
       customer_id,
       agreement_id,
       source_vendor_product_key,
       target_vendor_product_key,
       dimension_filters,
       target_dimensions,
       reason,
       reviewed_by,
       reviewed_at
     )
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
     returning
       id,
       vendor_id,
       customer_id,
       null::text as customer_name,
       agreement_id,
       null::text as agreement_name,
       source_vendor_product_key,
       target_vendor_product_key,
       dimension_filters,
       target_dimensions,
       reason,
       active,
       reviewed_by,
       reviewed_at,
       created_at,
       updated_at`,
    [
      vendorId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.sourceVendorProductKey,
      input.targetVendorProductKey,
      JSON.stringify(input.dimensionFilters ?? {}),
      JSON.stringify(input.targetDimensions ?? {}),
      input.reason?.trim() || null,
      input.reviewedBy?.trim() || null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to create usage override.');
  }

  return mapOverrideRow(row);
}

export async function deactivateUsageOverride(
  database: Queryable,
  vendorId: string,
  overrideId: string,
  input: { reviewedBy?: string } = {},
) {
  const result = await database.query<{ id: string }>(
    `update vendor_usage_overrides
     set active = false,
         reviewed_by = coalesce($3, reviewed_by),
         reviewed_at = now(),
         updated_at = now()
     where vendor_id = $1
       and id = $2
       and active = true
     returning id`,
    [vendorId, overrideId, input.reviewedBy?.trim() || null],
  );

  if (!result.rows[0]) {
    throw new Error('Usage override was not found or is already inactive.');
  }

  return {
    vendorId,
    overrideId,
    active: false,
  };
}

function validateUsageOverrideInput(input: CreateUsageOverrideInput) {
  if (!input.sourceVendorProductKey?.trim()) {
    throw new Error('Source product is required.');
  }

  if (!input.targetVendorProductKey?.trim()) {
    throw new Error('Target product is required.');
  }

  if (input.sourceVendorProductKey === input.targetVendorProductKey) {
    throw new Error('Source and target products must be different.');
  }
}

function mapOverrideRow(row: UsageOverrideRow): UsageOverride {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    customerId: row.customer_id ?? undefined,
    customerName: row.customer_name ?? undefined,
    agreementId: row.agreement_id ?? undefined,
    agreementName: row.agreement_name ?? undefined,
    sourceVendorProductKey: row.source_vendor_product_key,
    targetVendorProductKey: row.target_vendor_product_key,
    dimensionFilters: recordFromJson(row.dimension_filters),
    targetDimensions: recordFromJson(row.target_dimensions),
    reason: row.reason ?? undefined,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
    createdAt: isoDate(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function recordFromJson(value: unknown): DimensionMap {
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

  return value as DimensionMap;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
