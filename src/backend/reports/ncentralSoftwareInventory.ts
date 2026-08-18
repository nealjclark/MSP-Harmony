import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { listNcentralSiteOptions } from '../mapping/ncentralSiteMappings';
import {
  NcentralApiError,
  type NcentralClient,
  type NcentralDeviceAssets,
  type NcentralDeviceSummary,
} from '../vendor/ncentral/client';

export type SoftwareInventoryScopeType = 'customer' | 'site';
export type SoftwareInventoryReportStatus = 'queued' | 'running' | 'complete' | 'partial' | 'failed';

export type SoftwareInventorySiteScope = {
  siteId: string;
  siteName: string;
};

export type SoftwareInventoryCustomerScope = {
  customerId: string;
  customerName: string;
  sites: SoftwareInventorySiteScope[];
};

export type SoftwareInventoryScopes = {
  source: 'live' | 'latest-sync';
  customers: SoftwareInventoryCustomerScope[];
};

export type SoftwareInventoryReport = {
  id: string;
  scopeType: SoftwareInventoryScopeType;
  customerId: string;
  customerName: string;
  siteId?: string;
  siteName?: string;
  status: SoftwareInventoryReportStatus;
  requestedBy: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  totalDevices: number;
  completedDevices: number;
  failedDevices: number;
  applicationCount: number;
  error?: string;
};

export type SoftwareInventoryCountRow = {
  applicationName: string;
  deviceCount: number;
  installationCount: number;
  publishers: string[];
  versions: string[];
};

export type SoftwareInventoryDetailRow = {
  customerName: string;
  siteName?: string;
  deviceId: string;
  deviceName: string;
  deviceClass?: string;
  lastUser?: string;
  applicationName?: string;
  publisher?: string;
  version?: string;
  installDate?: string;
  installLocation?: string;
  collectionStatus: 'Complete' | 'Failed';
  collectionError?: string;
};

export type SoftwareInventoryApplicationDeviceRow = {
  customerName: string;
  siteName?: string;
  deviceId: string;
  deviceName: string;
  deviceClass?: string;
  lastUser?: string;
  publishers: string[];
  versions: string[];
};

export type PagedResult<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
};

type ReportRow = {
  id: string;
  scope_type: SoftwareInventoryScopeType;
  customer_id: string;
  customer_name: string;
  site_id: string | null;
  site_name: string | null;
  status: SoftwareInventoryReportStatus;
  requested_by: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  expires_at: Date | string;
  total_devices: number | string;
  completed_devices: number | string;
  failed_devices: number | string;
  application_count: number | string;
  error_message: string | null;
};

type DeviceWorkRow = {
  report_id: string;
  device_id: string;
  customer_id: string;
  customer_name: string;
  site_id: string | null;
  site_name: string | null;
  device_name: string;
  device_class: string | null;
  last_user: string | null;
};

type ApplicationRecord = {
  applicationKey: string;
  applicationName: string;
  normalizedName: string;
  publisher?: string;
  version?: string;
  installDate?: string;
  installLocation?: string;
  raw: Record<string, unknown>;
};

export async function listSoftwareInventoryScopes(
  database: Pool,
  client: NcentralClient,
): Promise<SoftwareInventoryScopes> {
  try {
    const [customers, sites] = await Promise.all([
      client.listCustomers({ pageSize: 1000, maxPages: 100 }),
      client.listSites({ pageSize: 1000, maxPages: 100 }),
    ]);
    const sitesByCustomer = new Map<string, SoftwareInventorySiteScope[]>();
    for (const site of sites) {
      if (!site.customerId) continue;
      const grouped = sitesByCustomer.get(site.customerId) ?? [];
      grouped.push({ siteId: site.siteId, siteName: site.siteName });
      sitesByCustomer.set(site.customerId, grouped);
    }
    return {
      source: 'live',
      customers: customers
        .map((customer) => ({
          customerId: customer.customerId,
          customerName: customer.customerName,
          sites: (sitesByCustomer.get(customer.customerId) ?? []).sort(compareSiteScopes),
        }))
        .sort(compareCustomerScopes),
    };
  } catch (error) {
    const fallback = await listNcentralSiteOptions(database);
    if (fallback.length === 0) throw error;
    return {
      source: 'latest-sync',
      customers: fallback.map((customer) => ({
        customerId: customer.customerId,
        customerName: customer.customerName,
        sites: customer.sites.map((site) => ({ siteId: site.siteId, siteName: site.siteName })),
      })),
    };
  }
}

export async function createSoftwareInventoryReport(
  database: Pool,
  input: {
    scopeType: SoftwareInventoryScopeType;
    customerId: string;
    customerName: string;
    siteId?: string;
    siteName?: string;
    requestedBy: string;
  },
): Promise<{ report: SoftwareInventoryReport; created: boolean }> {
  try {
    const result = await database.query<ReportRow>(
      `insert into ncentral_software_inventory_reports (
         scope_type, customer_id, customer_name, site_id, site_name, requested_by
       ) values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [input.scopeType, input.customerId, input.customerName, input.siteId ?? null, input.siteName ?? null, input.requestedBy],
    );
    return { report: mapReport(requiredRow(result.rows[0], 'Unable to create software inventory report.')), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await database.query<ReportRow>(
      `select *
         from ncentral_software_inventory_reports
        where scope_type = $1
          and customer_id = $2
          and coalesce(site_id, '') = coalesce($3, '')
          and status in ('queued', 'running')
        order by requested_at desc
        limit 1`,
      [input.scopeType, input.customerId, input.siteId ?? null],
    );
    return { report: mapReport(requiredRow(existing.rows[0], 'The active software inventory report could not be loaded.')), created: false };
  }
}

export async function listSoftwareInventoryReports(database: Pool, limit = 50) {
  const result = await database.query<ReportRow>(
    `select *
       from ncentral_software_inventory_reports
      where expires_at > now()
      order by requested_at desc
      limit $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows.map(mapReport);
}

export async function getSoftwareInventoryReport(database: Pool, reportId: string) {
  const result = await database.query<ReportRow>(
    `select * from ncentral_software_inventory_reports where id = $1::uuid and expires_at > now()`,
    [reportId],
  );
  return result.rows[0] ? mapReport(result.rows[0]) : undefined;
}

export async function discoverSoftwareInventoryDevices(
  database: Pool,
  reportId: string,
  client: NcentralClient,
) {
  const report = await getSoftwareInventoryReport(database, reportId);
  if (!report || !['queued', 'running'].includes(report.status)) return report;

  await database.query(
    `update ncentral_software_inventory_reports
        set started_at = coalesce(started_at, now()), error_message = null, updated_at = now()
      where id = $1::uuid`,
    [reportId],
  );

  const scopeId = report.scopeType === 'site' ? report.siteId : report.customerId;
  if (!scopeId) throw new Error('The software inventory report scope is incomplete.');
  let devices: NcentralDeviceSummary[];
  try {
    devices = await client.listDevicesByOrgUnit(scopeId, { pageSize: 1000, maxPages: 100 });
  } catch (error) {
    if (error instanceof NcentralApiError && error.status && ![400, 404, 405, 501].includes(error.status)) throw error;
    const allDevices = await client.listDevices({ pageSize: 1000, maxPages: 100 });
    devices = allDevices.filter((device) => report.scopeType === 'site'
      ? String(device.siteId ?? device.orgUnitId ?? '') === report.siteId
      : String(device.customerId ?? '') === report.customerId);
  }
  const eligibleDevices = uniqueDevices(devices.filter(isSoftwareInventoryDevice));

  const connection = await database.connect();
  try {
    await connection.query('begin');
    for (const device of eligibleDevices) {
      await connection.query(
        `insert into ncentral_software_inventory_devices (
           report_id, device_id, customer_id, customer_name, site_id, site_name,
           device_name, device_class, last_user, raw_device
         ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (report_id, device_id) do update set
           customer_id = excluded.customer_id,
           customer_name = excluded.customer_name,
           site_id = excluded.site_id,
           site_name = excluded.site_name,
           device_name = excluded.device_name,
           device_class = excluded.device_class,
           last_user = excluded.last_user,
           raw_device = excluded.raw_device,
           updated_at = now()`,
        [
          reportId,
          String(device.deviceId),
          String(device.customerId ?? report.customerId),
          device.customerName ?? report.customerName,
          device.siteId == null ? null : String(device.siteId),
          device.siteName ?? null,
          device.longName ?? device.uri ?? String(device.deviceId),
          device.deviceClass ?? null,
          device.lastLoggedInUser ?? null,
          JSON.stringify(device.raw ?? {}),
        ],
      );
    }
    await connection.query(
      `update ncentral_software_inventory_reports
          set status = 'running', total_devices = $2, updated_at = now()
        where id = $1::uuid`,
      [reportId, eligibleDevices.length],
    );
    await connection.query('commit');
  } catch (error) {
    await connection.query('rollback');
    throw error;
  } finally {
    connection.release();
  }

  if (eligibleDevices.length === 0) await refreshSoftwareInventoryProgress(database, reportId);
  return getSoftwareInventoryReport(database, reportId);
}

export async function collectSoftwareInventoryBatch(
  database: Pool,
  reportId: string,
  client: NcentralClient,
  options: { batchSize?: number; concurrency?: number } = {},
) {
  const batch = await claimDeviceBatch(database, reportId, options.batchSize ?? 10);
  let fatalError: Error | undefined;
  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      const item = batch[nextIndex];
      nextIndex += 1;
      if (!item) return;
      try {
        const assets = await client.getDeviceAssets(Number(item.device_id));
        const applications = parseSoftwareApplications(assets);
        if (applications.length === 0 && hasSoftwareApplicationPayloadRows(assets)) {
          throw new Error('N-central returned application assets, but none contained a recognized software name.');
        }
        await saveDeviceApplications(database, item, applications);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to collect N-central device assets.';
        await markDeviceFailed(database, item.report_id, item.device_id, message);
        if (error instanceof NcentralApiError && (error.status === 401 || error.status === 403)) {
          fatalError = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 5), batch.length) }, () => worker()));
  if (fatalError) {
    await failSoftwareInventoryReport(database, reportId, fatalError.message);
    return { report: await getSoftwareInventoryReport(database, reportId), hasRemaining: false };
  }
  const report = await refreshSoftwareInventoryProgress(database, reportId);
  return { report, hasRemaining: report?.status === 'running' };
}

export async function failSoftwareInventoryReport(database: Pool, reportId: string, error: string) {
  await database.query(
    `update ncentral_software_inventory_devices
        set status = case when status in ('pending', 'running') then 'failed' else status end,
            error_message = case when status in ('pending', 'running') then $2 else error_message end,
            completed_at = case when status in ('pending', 'running') then now() else completed_at end,
            lease_expires_at = null,
            updated_at = now()
      where report_id = $1::uuid`,
    [reportId, error.slice(0, 2000)],
  );
  await database.query(
    `update ncentral_software_inventory_reports
        set status = 'failed', error_message = $2, completed_at = now(),
            failed_devices = total_devices, updated_at = now()
      where id = $1::uuid`,
    [reportId, error.slice(0, 2000)],
  );
}

export async function refreshSoftwareInventoryProgress(database: Pool, reportId: string) {
  const result = await database.query<ReportRow>(
    `with counts as (
       select count(*)::int as total,
              count(*) filter (where status = 'complete')::int as completed,
              count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status in ('pending', 'running'))::int as active
         from ncentral_software_inventory_devices
        where report_id = $1::uuid
     ), applications as (
       select count(*)::int as total
         from ncentral_software_inventory_applications
        where report_id = $1::uuid
     )
     update ncentral_software_inventory_reports reports
        set total_devices = counts.total,
            completed_devices = counts.completed,
            failed_devices = counts.failed,
            application_count = applications.total,
            status = case
              when counts.active > 0 then 'running'
              when counts.total = 0 then 'complete'
              when counts.completed = 0 and counts.failed > 0 then 'failed'
              when counts.failed > 0 then 'partial'
              else 'complete'
            end,
            completed_at = case when counts.active = 0 then now() else null end,
            error_message = case
              when counts.completed = 0 and counts.failed > 0 then 'Software inventory failed for every scoped device.'
              else null
            end,
            updated_at = now()
       from counts, applications
      where reports.id = $1::uuid
      returning reports.*`,
    [reportId],
  );
  return result.rows[0] ? mapReport(result.rows[0]) : undefined;
}

export async function getSoftwareInventoryCounts(
  database: Pool,
  reportId: string,
  options: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortDirection?: string } = {},
): Promise<PagedResult<SoftwareInventoryCountRow>> {
  const page = boundedInteger(options.page, 1, 1, 1000000);
  const pageSize = boundedInteger(options.pageSize, 100, 1, 1048575);
  const sortColumns: Record<string, string> = {
    applicationName: 'application_name',
    deviceCount: 'device_count',
    installationCount: 'installation_count',
  };
  const sortColumn = sortColumns[options.sortBy ?? 'applicationName'] ?? 'application_name';
  const direction = options.sortDirection === 'desc' ? 'desc' : 'asc';
  const search = cleanSearch(options.search);
  const result = await database.query<{
    application_name: string;
    device_count: number | string;
    installation_count: number | string;
    publishers: string[] | null;
    versions: string[] | null;
    total_rows: number | string;
  }>(
    `with grouped as (
       select min(application_name) as application_name,
              count(distinct device_id)::int as device_count,
              count(*)::int as installation_count,
              array_remove(array_agg(distinct publisher order by publisher), null) as publishers,
              array_remove(array_agg(distinct version order by version), null) as versions
         from ncentral_software_inventory_applications
        where report_id = $1::uuid
          and ($2 = '' or normalized_name like '%' || lower($2) || '%'
               or coalesce(publisher, '') ilike '%' || $2 || '%'
               or coalesce(version, '') ilike '%' || $2 || '%')
        group by normalized_name
     )
     select grouped.*, count(*) over()::int as total_rows
       from grouped
      order by ${sortColumn} ${direction}, application_name asc
      limit $3 offset $4`,
    [reportId, search, pageSize, (page - 1) * pageSize],
  );
  return {
    rows: result.rows.map((row) => ({
      applicationName: row.application_name,
      deviceCount: integerValue(row.device_count),
      installationCount: integerValue(row.installation_count),
      publishers: row.publishers ?? [],
      versions: row.versions ?? [],
    })),
    page,
    pageSize,
    total: integerValue(result.rows[0]?.total_rows),
  };
}

export async function getSoftwareInventoryApplicationDevices(
  database: Pool,
  reportId: string,
  applicationName: string,
): Promise<SoftwareInventoryApplicationDeviceRow[]> {
  const normalizedName = normalizeApplicationName(applicationName);
  if (!normalizedName) return [];
  const result = await database.query<{
    customer_name: string;
    site_name: string | null;
    device_id: string;
    device_name: string;
    device_class: string | null;
    last_user: string | null;
    publishers: string[] | null;
    versions: string[] | null;
  }>(
    `select devices.customer_name, devices.site_name, devices.device_id, devices.device_name,
            devices.device_class, devices.last_user,
            array_remove(array_agg(distinct applications.publisher order by applications.publisher), null) as publishers,
            array_remove(array_agg(distinct applications.version order by applications.version), null) as versions
       from ncentral_software_inventory_applications applications
       join ncentral_software_inventory_devices devices
         on devices.report_id = applications.report_id and devices.device_id = applications.device_id
      where applications.report_id = $1::uuid and applications.normalized_name = $2
      group by devices.customer_name, devices.site_name, devices.device_id, devices.device_name,
               devices.device_class, devices.last_user
      order by lower(devices.device_name), devices.device_id`,
    [reportId, normalizedName],
  );
  return result.rows.map((row) => ({
    customerName: row.customer_name,
    siteName: row.site_name ?? undefined,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceClass: row.device_class ?? undefined,
    lastUser: row.last_user ?? undefined,
    publishers: row.publishers ?? [],
    versions: row.versions ?? [],
  }));
}

export async function getSoftwareInventoryDetails(
  database: Pool,
  reportId: string,
  options: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortDirection?: string } = {},
): Promise<PagedResult<SoftwareInventoryDetailRow>> {
  const page = boundedInteger(options.page, 1, 1, 1000000);
  const pageSize = boundedInteger(options.pageSize, 100, 1, 1048575);
  const sortColumns: Record<string, string> = {
    customerName: 'customer_name',
    siteName: 'site_name',
    deviceName: 'device_name',
    applicationName: 'application_name',
    publisher: 'publisher',
    version: 'version',
    collectionStatus: 'collection_status',
  };
  const sortColumn = sortColumns[options.sortBy ?? 'applicationName'] ?? 'application_name';
  const direction = options.sortDirection === 'desc' ? 'desc' : 'asc';
  const search = cleanSearch(options.search);
  const result = await database.query<{
    customer_name: string;
    site_name: string | null;
    device_id: string;
    device_name: string;
    device_class: string | null;
    last_user: string | null;
    application_name: string | null;
    publisher: string | null;
    version: string | null;
    install_date: string | null;
    install_location: string | null;
    collection_status: 'Complete' | 'Failed';
    collection_error: string | null;
    total_rows: number | string;
  }>(
    `with detail_rows as (
       select devices.customer_name, devices.site_name, devices.device_id, devices.device_name,
              devices.device_class, devices.last_user, applications.application_name,
              applications.publisher, applications.version, applications.install_date,
              applications.install_location, 'Complete'::text as collection_status,
              null::text as collection_error
         from ncentral_software_inventory_applications applications
         join ncentral_software_inventory_devices devices
           on devices.report_id = applications.report_id and devices.device_id = applications.device_id
        where applications.report_id = $1::uuid
       union all
       select devices.customer_name, devices.site_name, devices.device_id, devices.device_name,
              devices.device_class, devices.last_user, null, null, null, null, null,
              'Failed'::text, devices.error_message
         from ncentral_software_inventory_devices devices
        where devices.report_id = $1::uuid and devices.status = 'failed'
     ), filtered as (
       select * from detail_rows
        where $2 = ''
           or concat_ws(' ', customer_name, site_name, device_name, device_class, last_user,
                        application_name, publisher, version, collection_error) ilike '%' || $2 || '%'
     )
     select filtered.*, count(*) over()::int as total_rows
       from filtered
      order by ${sortColumn} ${direction} nulls last, device_name asc
      limit $3 offset $4`,
    [reportId, search, pageSize, (page - 1) * pageSize],
  );
  return {
    rows: result.rows.map((row) => ({
      customerName: row.customer_name,
      siteName: row.site_name ?? undefined,
      deviceId: row.device_id,
      deviceName: row.device_name,
      deviceClass: row.device_class ?? undefined,
      lastUser: row.last_user ?? undefined,
      applicationName: row.application_name ?? undefined,
      publisher: row.publisher ?? undefined,
      version: row.version ?? undefined,
      installDate: row.install_date ?? undefined,
      installLocation: row.install_location ?? undefined,
      collectionStatus: row.collection_status,
      collectionError: row.collection_error ?? undefined,
    })),
    page,
    pageSize,
    total: integerValue(result.rows[0]?.total_rows),
  };
}

export async function cleanupExpiredSoftwareInventoryReports(database: Pool) {
  const result = await database.query<{ id: string }>(
    `delete from ncentral_software_inventory_reports where expires_at <= now() returning id`,
  );
  return result.rows.length;
}

export function parseSoftwareApplications(assets: NcentralDeviceAssets): ApplicationRecord[] {
  const records = applicationRecordsFromAssets(assets);
  const seen = new Set<string>();
  const applications: ApplicationRecord[] = [];
  for (const raw of records) {
    const applicationName = textValue(caseInsensitiveValue(raw, ['displayName', 'displayname', 'name', 'productName']));
    if (!applicationName) continue;
    const publisher = textValue(caseInsensitiveValue(raw, ['publisher', 'vendor', 'manufacturer']));
    const version = textValue(caseInsensitiveValue(raw, ['version', 'displayVersion']));
    const installDate = textValue(caseInsensitiveValue(raw, [
      'installDate',
      'installdate',
      'installedDate',
      'installationDate',
      'installationdate',
    ]));
    const installLocation = textValue(caseInsensitiveValue(raw, ['installLocation', 'installlocation', 'location']));
    const normalizedName = normalizeApplicationName(applicationName);
    const applicationKey = createHash('sha256')
      .update([normalizedName, publisher?.toLowerCase() ?? '', version?.toLowerCase() ?? '', installDate ?? '', installLocation?.toLowerCase() ?? ''].join('\u0000'))
      .digest('hex');
    if (seen.has(applicationKey)) continue;
    seen.add(applicationKey);
    applications.push({ applicationKey, applicationName, normalizedName, publisher, version, installDate, installLocation, raw });
  }
  return applications;
}

export function hasSoftwareApplicationPayloadRows(assets: NcentralDeviceAssets) {
  return applicationRecordsFromAssets(assets).length > 0;
}

function applicationRecordsFromAssets(assets: NcentralDeviceAssets) {
  const extra = caseInsensitiveValue(assets, ['_extra', 'extra']);
  if (isRecord(extra)) {
    const enrichedRecords = recordsFromApplicationValue(caseInsensitiveValue(extra, ['application', 'applications']));
    if (enrichedRecords.length > 0) return enrichedRecords;
  }
  return recordsFromApplicationValue(caseInsensitiveValue(assets, ['application', 'applications']));
}

export function normalizeApplicationName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isSoftwareInventoryDevice(device: Pick<NcentralDeviceSummary, 'deviceClass' | 'supportedOs' | 'osId'>) {
  const descriptor = `${device.deviceClass ?? ''} ${device.supportedOs ?? ''} ${device.osId ?? ''}`.toLowerCase();
  return descriptor.includes('windows') || descriptor.includes('winnt') || /(^|\W)mac(os|intosh)?(\W|$)/.test(descriptor);
}

async function claimDeviceBatch(database: Pool, reportId: string, batchSize: number) {
  const result = await database.query<DeviceWorkRow>(
    `with candidates as (
       select report_id, device_id
         from ncentral_software_inventory_devices
        where report_id = $1::uuid
          and (status = 'pending' or (status = 'running' and lease_expires_at < now()))
        order by device_name, device_id
        for update skip locked
        limit $2
     )
     update ncentral_software_inventory_devices devices
        set status = 'running', attempts = attempts + 1,
            started_at = coalesce(started_at, now()), lease_expires_at = now() + interval '10 minutes',
            error_message = null, updated_at = now()
       from candidates
      where devices.report_id = candidates.report_id and devices.device_id = candidates.device_id
      returning devices.report_id, devices.device_id, devices.customer_id, devices.customer_name,
                devices.site_id, devices.site_name, devices.device_name, devices.device_class, devices.last_user`,
    [reportId, Math.max(1, Math.min(batchSize, 50))],
  );
  return result.rows;
}

async function saveDeviceApplications(database: Pool, device: DeviceWorkRow, applications: ApplicationRecord[]) {
  const connection = await database.connect();
  try {
    await connection.query('begin');
    await connection.query(
      `delete from ncentral_software_inventory_applications where report_id = $1::uuid and device_id = $2`,
      [device.report_id, device.device_id],
    );
    for (const application of applications) {
      await connection.query(
        `insert into ncentral_software_inventory_applications (
           report_id, device_id, application_key, application_name, normalized_name,
           publisher, version, install_date, install_location, raw_application
         ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (report_id, device_id, application_key) do nothing`,
        [
          device.report_id,
          device.device_id,
          application.applicationKey,
          application.applicationName,
          application.normalizedName,
          application.publisher ?? null,
          application.version ?? null,
          application.installDate ?? null,
          application.installLocation ?? null,
          JSON.stringify(application.raw),
        ],
      );
    }
    await connection.query(
      `update ncentral_software_inventory_devices
          set status = 'complete', completed_at = now(), lease_expires_at = null,
              error_message = null, updated_at = now()
        where report_id = $1::uuid and device_id = $2`,
      [device.report_id, device.device_id],
    );
    await connection.query('commit');
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    connection.release();
  }
}

async function markDeviceFailed(database: Pool, reportId: string, deviceId: string, error: string) {
  await database.query(
    `update ncentral_software_inventory_devices
        set status = 'failed', completed_at = now(), lease_expires_at = null,
            error_message = $3, updated_at = now()
      where report_id = $1::uuid and device_id = $2`,
    [reportId, deviceId, error.slice(0, 2000)],
  );
}

function recordsFromApplicationValue(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  const nested = caseInsensitiveValue(value, ['list', 'items', 'data', 'applications']);
  if (Array.isArray(nested)) return nested.filter(isRecord);
  const objectValues = Object.values(value);
  if (objectValues.length > 0 && objectValues.every(isRecord)) return objectValues as Record<string, unknown>[];
  const arrayEntries = Object.entries(value).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
  if (arrayEntries.length > 0) {
    const size = Math.max(...arrayEntries.map(([, items]) => items.length));
    return Array.from({ length: size }, (_, index) => Object.fromEntries(arrayEntries.map(([key, items]) => [key, items[index]])));
  }
  return [value];
}

function caseInsensitiveValue(record: Record<string, unknown>, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(record).find(([key]) => wanted.has(key.toLowerCase()))?.[1];
}

function textValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueDevices(devices: NcentralDeviceSummary[]) {
  return [...new Map(devices.map((device) => [device.deviceId, device])).values()];
}

function mapReport(row: ReportRow): SoftwareInventoryReport {
  return {
    id: row.id,
    scopeType: row.scope_type,
    customerId: row.customer_id,
    customerName: row.customer_name,
    siteId: row.site_id ?? undefined,
    siteName: row.site_name ?? undefined,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: isoDate(row.requested_at),
    startedAt: row.started_at ? isoDate(row.started_at) : undefined,
    completedAt: row.completed_at ? isoDate(row.completed_at) : undefined,
    expiresAt: isoDate(row.expires_at),
    totalDevices: integerValue(row.total_devices),
    completedDevices: integerValue(row.completed_devices),
    failedDevices: integerValue(row.failed_devices),
    applicationCount: integerValue(row.application_count),
    error: row.error_message ?? undefined,
  };
}

function compareCustomerScopes(left: SoftwareInventoryCustomerScope, right: SoftwareInventoryCustomerScope) {
  return left.customerName.localeCompare(right.customerName);
}

function compareSiteScopes(left: SoftwareInventorySiteScope, right: SoftwareInventorySiteScope) {
  return left.siteName.localeCompare(right.siteName);
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integerValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value as number), max));
}

function cleanSearch(value: string | undefined) {
  return value?.trim().slice(0, 200) ?? '';
}

function requiredRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

function isUniqueViolation(error: unknown) {
  return isRecord(error) && error.code === '23505';
}

async function rollback(connection: PoolClient) {
  try {
    await connection.query('rollback');
  } catch {
    // Preserve the original failure.
  }
}
