import type { Queryable } from '../vendor/cove/operations';

type NcentralSiteMappingRow = {
  id: string;
  ncentral_customer_id: string;
  ncentral_customer_name: string;
  ncentral_site_id: string;
  ncentral_site_name: string;
  customer_id: string;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: string | Date | null;
  last_seen_at: string | Date | null;
};

type NcentralSiteOptionRow = {
  ncentral_customer_id: string;
  ncentral_customer_name: string;
  ncentral_site_id: string;
  ncentral_site_name: string;
  device_count: string | number;
};

export type NcentralSiteOption = {
  siteId: string;
  siteName: string;
  deviceCount: number;
};

export type NcentralSiteCustomerOption = {
  customerId: string;
  customerName: string;
  sites: NcentralSiteOption[];
};

export type NcentralSiteMapping = {
  id: string;
  ncentralCustomerId: string;
  ncentralCustomerName: string;
  ncentralSiteId: string;
  ncentralSiteName: string;
  customerId: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  lastSeenAt?: string;
};

export type UpsertNcentralSiteMappingInput = {
  ncentralCustomerId: string;
  ncentralCustomerName: string;
  ncentralSiteId: string;
  ncentralSiteName: string;
  customerId: string;
  agreementId?: string;
  reviewedBy: string;
};

export async function listNcentralSiteOptions(
  database: Queryable,
): Promise<NcentralSiteCustomerOption[]> {
  const result = await database.query<NcentralSiteOptionRow>(
    `with latest_sync as (
       select id
         from sync_runs
        where integration_id = 'ncentral'
          and status = 'complete'
          and coalesce(metadata->>'entity', 'usage-snapshots') = 'usage-snapshots'
        order by completed_at desc nulls last, started_at desc
        limit 1
     )
     select coalesce(nullif(dimensions->>'customerId', ''), external_account_id) as ncentral_customer_id,
            coalesce(
              nullif(dimensions->>'customerName', ''),
              nullif(dimensions->>'ncentralCustomerName', ''),
              external_account_id
            ) as ncentral_customer_name,
            dimensions->>'siteId' as ncentral_site_id,
            coalesce(nullif(dimensions->>'siteName', ''), dimensions->>'siteId') as ncentral_site_name,
            count(*)::int as device_count
       from vendor_usage_snapshots
      where vendor_id = 'ncentral'
        and sync_run_id = (select id from latest_sync)
        and nullif(dimensions->>'siteId', '') is not null
        and coalesce(nullif(dimensions->>'customerId', ''), external_account_id) is not null
      group by coalesce(nullif(dimensions->>'customerId', ''), external_account_id),
               coalesce(
                 nullif(dimensions->>'customerName', ''),
                 nullif(dimensions->>'ncentralCustomerName', ''),
                 external_account_id
               ),
               dimensions->>'siteId',
               coalesce(nullif(dimensions->>'siteName', ''), dimensions->>'siteId')
      order by ncentral_customer_name, ncentral_site_name`,
  );

  const customers = new Map<string, NcentralSiteCustomerOption>();
  for (const row of result.rows) {
    const customer = customers.get(row.ncentral_customer_id) ?? {
      customerId: row.ncentral_customer_id,
      customerName: row.ncentral_customer_name,
      sites: [],
    };
    customer.sites.push({
      siteId: row.ncentral_site_id,
      siteName: row.ncentral_site_name,
      deviceCount: numberValue(row.device_count),
    });
    customers.set(row.ncentral_customer_id, customer);
  }
  return [...customers.values()];
}

export async function listNcentralSiteMappings(
  database: Queryable,
  options: { includeInactive?: boolean } = {},
): Promise<NcentralSiteMapping[]> {
  const result = await database.query<NcentralSiteMappingRow>(
    `select site_mappings.id,
            site_mappings.ncentral_customer_id,
            site_mappings.ncentral_customer_name,
            site_mappings.ncentral_site_id,
            site_mappings.ncentral_site_name,
            site_mappings.customer_id,
            customers.name as customer_name,
            site_mappings.agreement_id,
            agreements.name as agreement_name,
            site_mappings.active,
            site_mappings.reviewed_by,
            site_mappings.reviewed_at,
            site_mappings.last_seen_at
       from ncentral_site_mappings site_mappings
       left join customers on customers.id = site_mappings.customer_id
       left join agreements on agreements.id = site_mappings.agreement_id
      where ($1::boolean = true or site_mappings.active = true)
      order by site_mappings.active desc,
               site_mappings.ncentral_customer_name,
               site_mappings.ncentral_site_name`,
    [options.includeInactive ?? false],
  );
  return result.rows.map(mapRow);
}

export async function loadActiveNcentralSiteMappingTargets(database: Queryable) {
  const mappings = await listNcentralSiteMappings(database);
  return new Map(
    mappings.map((mapping) => [
      siteMappingKey(mapping.ncentralCustomerId, mapping.ncentralSiteId),
      {
        customerId: mapping.customerId,
        agreementId: mapping.agreementId,
      },
    ]),
  );
}

export async function upsertNcentralSiteMapping(
  database: Queryable,
  input: UpsertNcentralSiteMappingInput,
): Promise<NcentralSiteMapping> {
  const ncentralCustomerId = required(input.ncentralCustomerId, 'Choose an N-Able customer.');
  const ncentralCustomerName = required(input.ncentralCustomerName, 'Choose an N-Able customer.');
  const ncentralSiteId = required(input.ncentralSiteId, 'Choose an N-Able site.');
  const ncentralSiteName = required(input.ncentralSiteName, 'Choose an N-Able site.');
  const customerId = required(input.customerId, 'Choose a ConnectWise customer.');

  const result = await database.query<NcentralSiteMappingRow>(
    `insert into ncentral_site_mappings (
       ncentral_customer_id,
       ncentral_customer_name,
       ncentral_site_id,
       ncentral_site_name,
       customer_id,
       agreement_id,
       active,
       reviewed_by,
       reviewed_at,
       last_seen_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5::uuid, $6::uuid, true, $7, now(), now(), now())
     on conflict (ncentral_customer_id, ncentral_site_id)
     do update set
       ncentral_customer_name = excluded.ncentral_customer_name,
       ncentral_site_name = excluded.ncentral_site_name,
       customer_id = excluded.customer_id,
       agreement_id = excluded.agreement_id,
       active = true,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = now(),
       last_seen_at = now(),
       updated_at = now()
     returning id,
               ncentral_customer_id,
               ncentral_customer_name,
               ncentral_site_id,
               ncentral_site_name,
               customer_id,
               null::text as customer_name,
               agreement_id,
               null::text as agreement_name,
               active,
               reviewed_by,
               reviewed_at,
               last_seen_at`,
    [
      ncentralCustomerId,
      ncentralCustomerName,
      ncentralSiteId,
      ncentralSiteName,
      customerId,
      input.agreementId?.trim() || null,
      input.reviewedBy,
    ],
  );
  await applyNcentralSiteMappingsToSnapshots(database, ncentralCustomerId);
  const row = result.rows[0];
  if (!row) throw new Error('Unable to save the N-Able site mapping.');
  return mapRow(row);
}

export async function deactivateNcentralSiteMapping(
  database: Queryable,
  mappingId: string,
  reviewedBy: string,
) {
  const result = await database.query<{
    ncentral_customer_id: string;
    ncentral_site_id: string;
  }>(
    `update ncentral_site_mappings
        set active = false,
            reviewed_by = $2,
            reviewed_at = now(),
            updated_at = now()
      where id = $1::uuid
        and active = true
      returning ncentral_customer_id, ncentral_site_id`,
    [mappingId, reviewedBy],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The N-Able site mapping was not found or is already inactive.');
  await restoreNcentralSiteSnapshotsToParent(
    database,
    row.ncentral_customer_id,
    row.ncentral_site_id,
  );
}

export async function applyNcentralSiteMappingsToSnapshots(
  database: Queryable,
  ncentralCustomerId?: string,
) {
  await database.query(
    `update vendor_usage_snapshots snapshots
        set customer_id = site_mappings.customer_id,
            agreement_id = site_mappings.agreement_id
       from ncentral_site_mappings site_mappings
      where snapshots.vendor_id = 'ncentral'
        and site_mappings.active = true
        and snapshots.external_account_id = site_mappings.ncentral_customer_id
        and snapshots.dimensions->>'siteId' = site_mappings.ncentral_site_id
        and ($1::text is null or snapshots.external_account_id = $1)
        and (
          snapshots.customer_id is distinct from site_mappings.customer_id
          or snapshots.agreement_id is distinct from site_mappings.agreement_id
        )`,
    [ncentralCustomerId ?? null],
  );
}

export function siteMappingKey(ncentralCustomerId: string, ncentralSiteId: string) {
  return `${ncentralCustomerId.trim()}:${ncentralSiteId.trim()}`;
}

async function restoreNcentralSiteSnapshotsToParent(
  database: Queryable,
  ncentralCustomerId: string,
  ncentralSiteId: string,
) {
  await database.query(
    `update vendor_usage_snapshots snapshots
        set customer_id = (
              select account_mappings.customer_id
                from vendor_account_mappings account_mappings
               where account_mappings.vendor_id = 'ncentral'
                 and account_mappings.external_account_id = $1
                 and account_mappings.active = true
                 and account_mappings.mapping_status = 'approved'
               limit 1
            ),
            agreement_id = (
              select account_mappings.agreement_id
                from vendor_account_mappings account_mappings
               where account_mappings.vendor_id = 'ncentral'
                 and account_mappings.external_account_id = $1
                 and account_mappings.active = true
                 and account_mappings.mapping_status = 'approved'
               limit 1
            )
      where snapshots.vendor_id = 'ncentral'
        and snapshots.external_account_id = $1
        and snapshots.dimensions->>'siteId' = $2`,
    [ncentralCustomerId, ncentralSiteId],
  );
}

function mapRow(row: NcentralSiteMappingRow): NcentralSiteMapping {
  return {
    id: row.id,
    ncentralCustomerId: row.ncentral_customer_id,
    ncentralCustomerName: row.ncentral_customer_name,
    ncentralSiteId: row.ncentral_site_id,
    ncentralSiteName: row.ncentral_site_name,
    customerId: row.customer_id,
    customerName: row.customer_name ?? undefined,
    agreementId: row.agreement_id ?? undefined,
    agreementName: row.agreement_name ?? undefined,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
    lastSeenAt: isoDate(row.last_seen_at),
  };
}

function required(value: string | undefined, message: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function numberValue(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: string | Date | null) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
