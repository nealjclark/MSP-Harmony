import type { Queryable } from '../vendor/cove/operations';

type MonthlyReviewProductExclusionRow = {
  id: string;
  connectwise_product_id: string | null;
  connectwise_product_code: string;
  connectwise_product_name: string;
  active: boolean;
  excluded_by: string;
  excluded_at: string | Date;
  restored_by: string | null;
  restored_at: string | Date | null;
};

export type MonthlyReviewProductExclusion = {
  id: string;
  connectWiseProductId?: string;
  connectWiseProductCode: string;
  connectWiseProductName: string;
  active: boolean;
  excludedBy: string;
  excludedAt: string;
  restoredBy?: string;
  restoredAt?: string;
};

export type CreateMonthlyReviewProductExclusionInput = {
  connectWiseProductId?: string;
  connectWiseProductCode: string;
  connectWiseProductName: string;
  excludedBy: string;
};

export async function listMonthlyReviewProductExclusions(
  database: Queryable,
  options: { includeInactive?: boolean } = {},
): Promise<MonthlyReviewProductExclusion[]> {
  const result = await database.query<MonthlyReviewProductExclusionRow>(
    `select id,
            connectwise_product_id,
            connectwise_product_code,
            connectwise_product_name,
            active,
            excluded_by,
            excluded_at,
            restored_by,
            restored_at
       from monthly_review_product_exclusions
      where ($1::boolean = true or active = true)
      order by active desc, connectwise_product_name, connectwise_product_code`,
    [options.includeInactive ?? false],
  );

  return result.rows.map(mapRow);
}

export async function createMonthlyReviewProductExclusion(
  database: Queryable,
  input: CreateMonthlyReviewProductExclusionInput,
): Promise<MonthlyReviewProductExclusion> {
  const productCode = input.connectWiseProductCode.trim();
  const productName = input.connectWiseProductName.trim();
  if (!productCode || !productName) {
    throw new Error('Choose a ConnectWise catalog product before excluding it.');
  }

  const result = await database.query<MonthlyReviewProductExclusionRow>(
    `insert into monthly_review_product_exclusions (
       connectwise_product_id,
       connectwise_product_code,
       connectwise_product_name,
       active,
       excluded_by,
       excluded_at,
       restored_by,
       restored_at,
       updated_at
     )
     values ($1, $2, $3, true, $4, now(), null, null, now())
     on conflict (connectwise_product_code)
     do update set
       connectwise_product_id = coalesce(excluded.connectwise_product_id, monthly_review_product_exclusions.connectwise_product_id),
       connectwise_product_name = excluded.connectwise_product_name,
       active = true,
       excluded_by = excluded.excluded_by,
       excluded_at = now(),
       restored_by = null,
       restored_at = null,
       updated_at = now()
     returning id,
               connectwise_product_id,
               connectwise_product_code,
               connectwise_product_name,
               active,
               excluded_by,
               excluded_at,
               restored_by,
               restored_at`,
    [
      input.connectWiseProductId?.trim() || null,
      productCode,
      productName,
      input.excludedBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Unable to save the Monthly Review product exclusion.');
  return mapRow(row);
}

export async function restoreMonthlyReviewProductExclusion(
  database: Queryable,
  exclusionId: string,
  restoredBy: string,
) {
  const result = await database.query<{ id: string }>(
    `update monthly_review_product_exclusions
        set active = false,
            restored_by = $2,
            restored_at = now(),
            updated_at = now()
      where id = $1::uuid
        and active = true
      returning id`,
    [exclusionId, restoredBy],
  );
  if (!result.rows[0]) {
    throw new Error('The Monthly Review product exclusion was not found or is already removed.');
  }
}

function mapRow(row: MonthlyReviewProductExclusionRow): MonthlyReviewProductExclusion {
  return {
    id: row.id,
    connectWiseProductId: row.connectwise_product_id ?? undefined,
    connectWiseProductCode: row.connectwise_product_code,
    connectWiseProductName: row.connectwise_product_name,
    active: row.active,
    excludedBy: row.excluded_by,
    excludedAt: isoDate(row.excluded_at),
    restoredBy: row.restored_by ?? undefined,
    restoredAt: row.restored_at ? isoDate(row.restored_at) : undefined,
  };
}

function isoDate(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
