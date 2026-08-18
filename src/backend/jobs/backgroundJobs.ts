import type { Pool } from 'pg';
import type { AuthPrincipal } from '../functions/auth';
import { hasCapability, hasLicenseActionRole, hasMinimumRole } from '../functions/auth';
import type { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';

export type BackgroundJobStatus = 'queued' | 'running' | 'complete' | 'complete-with-warnings' | 'failed';

export type BackgroundJob = {
  id: string;
  source: 'integration-sync' | 'software-inventory' | 'appriver-license-cleanup' | 'sales-quote';
  title: string;
  operation: string;
  status: BackgroundJobStatus;
  requestedBy: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: {
    completed: number;
    total: number;
    failed: number;
    currentItem?: string;
    unitLabel: string;
  };
  destination?: {
    label: string;
    path: string;
  };
};

type SoftwareJobRow = {
  id: string;
  customer_name: string;
  site_name: string | null;
  status: string;
  requested_by: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  total_devices: number | string;
  completed_devices: number | string;
  failed_devices: number | string;
  error_message: string | null;
  current_item: string | null;
};

type CleanupJobRow = {
  id: string;
  requested_by: string;
  status: string;
  requested_at: Date | string;
  completed_at: Date | string | null;
  total_count: number | string;
  completed_count: number | string;
  failed_count: number | string;
  current_item: string | null;
};

type SalesJobRow = {
  id: string;
  subject: string;
  status: string;
  requester_email: string;
  received_at: Date | string;
  processing_started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
  error_message: string | null;
};

export async function listBackgroundJobs(input: {
  database: Pool;
  integrationRepository: PostgresIntegrationSettingsRepository;
  principal: AuthPrincipal;
  recentLimit?: number;
}) {
  const sources: Array<Promise<BackgroundJob[]>> = [];
  if (hasMinimumRole(input.principal, 'Analyst')) {
    sources.push(listIntegrationJobs(input.integrationRepository));
    sources.push(listSoftwareJobs(input.database));
  }
  if (hasLicenseActionRole(input.principal)) {
    sources.push(listCleanupJobs(input.database));
  }
  if (hasCapability(input.principal, 'sales.requests.read-own')) {
    sources.push(listSalesJobs(input.database, input.principal));
  }

  const jobs = (await Promise.all(sources)).flat();
  const active = jobs
    .filter((job) => job.status === 'queued' || job.status === 'running')
    .sort(compareJobs);
  const recent = jobs
    .filter((job) => job.status !== 'queued' && job.status !== 'running')
    .sort(compareJobs)
    .slice(0, Math.max(1, Math.min(input.recentLimit ?? 10, 50)));
  return [...active, ...recent];
}

async function listIntegrationJobs(repository: PostgresIntegrationSettingsRepository): Promise<BackgroundJob[]> {
  const jobs = await repository.listRecentSyncJobs(100);
  return jobs.map((job) => ({
    id: job.id,
    source: 'integration-sync',
    title: job.integrationName,
    operation: job.operationLabel,
    status: job.status === 'complete' && (job.progress?.failed ?? 0) > 0
      ? 'complete-with-warnings'
      : job.status,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    progress: job.progress,
    destination: { label: 'View integration', path: '/integrations' },
  }));
}

async function listSoftwareJobs(database: Pool): Promise<BackgroundJob[]> {
  const result = await database.query<SoftwareJobRow>(
    `select reports.id, reports.customer_name, reports.site_name, reports.status, reports.requested_by,
            reports.requested_at, reports.started_at, reports.completed_at, reports.total_devices,
            reports.completed_devices, reports.failed_devices, reports.error_message,
            (select devices.device_name
               from ncentral_software_inventory_devices devices
              where devices.report_id = reports.id and devices.status = 'running'
              order by devices.updated_at desc limit 1) as current_item
       from ncentral_software_inventory_reports reports
      where reports.status in ('queued', 'running') or reports.requested_at >= now() - interval '24 hours'
      order by reports.requested_at desc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    source: 'software-inventory',
    title: 'N-able Software Inventory',
    operation: row.site_name ? `${row.customer_name} / ${row.site_name}` : `${row.customer_name} / All sites`,
    status: mapSoftwareStatus(row.status),
    requestedBy: row.requested_by,
    requestedAt: isoDate(row.requested_at),
    startedAt: optionalIsoDate(row.started_at),
    completedAt: optionalIsoDate(row.completed_at),
    error: row.error_message ?? undefined,
    progress: {
      completed: integerValue(row.completed_devices) + integerValue(row.failed_devices),
      total: integerValue(row.total_devices),
      failed: integerValue(row.failed_devices),
      currentItem: row.current_item ?? undefined,
      unitLabel: 'devices',
    },
    destination: { label: 'View report', path: `/reports/software-inventory?reportId=${encodeURIComponent(row.id)}` },
  }));
}

async function listCleanupJobs(database: Pool): Promise<BackgroundJob[]> {
  const result = await database.query<CleanupJobRow>(
    `select batches.id, batches.requested_by, batches.status, batches.created_at as requested_at,
            batches.completed_at,
            count(actions.id)::int as total_count,
            count(actions.id) filter (where actions.status in ('verified', 'skipped', 'cancelled', 'needs_review', 'failed', 'timed_out'))::int as completed_count,
            count(actions.id) filter (where actions.status in ('needs_review', 'failed', 'timed_out'))::int as failed_count,
            (array_agg(concat_ws(' / ', actions.customer_name, actions.product_name)
               order by actions.updated_at desc) filter
               (where actions.status in ('queued', 'running', 'reviewing', 'updating', 'confirm')))[1] as current_item
       from appriver_license_cleanup_batches batches
       left join appriver_license_cleanup_actions actions on actions.batch_id = batches.id
      where batches.status in ('queued', 'processing') or batches.created_at >= now() - interval '24 hours'
      group by batches.id
      order by batches.created_at desc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    source: 'appriver-license-cleanup',
    title: 'AppRiver License Cleanup',
    operation: 'Reduce unassigned subscriptions',
    status: mapCleanupStatus(row.status),
    requestedBy: row.requested_by,
    requestedAt: isoDate(row.requested_at),
    completedAt: optionalIsoDate(row.completed_at),
    progress: {
      completed: integerValue(row.completed_count),
      total: integerValue(row.total_count),
      failed: integerValue(row.failed_count),
      currentItem: row.current_item ?? undefined,
      unitLabel: 'actions',
    },
    destination: { label: 'View cleanup', path: '/discrepancies' },
  }));
}

async function listSalesJobs(database: Pool, principal: AuthPrincipal): Promise<BackgroundJob[]> {
  const canReadAll = hasCapability(principal, 'sales.requests.read-all');
  const result = await database.query<SalesJobRow>(
    `select id, subject, status, requester_email, received_at, processing_started_at,
            completed_at, updated_at, error_message
       from sales_quote_requests
      where ($1::boolean or lower(requester_email) = lower($2))
        and (status in ('received', 'ready-to-draft', 'drafting')
             or updated_at >= now() - interval '24 hours')
      order by updated_at desc`,
    [canReadAll, principal.email ?? principal.name],
  );
  return result.rows.map((row) => ({
    id: row.id,
    source: 'sales-quote',
    title: 'Sales Quote',
    operation: row.subject,
    status: mapSalesStatus(row.status),
    requestedBy: row.requester_email,
    requestedAt: isoDate(row.received_at),
    startedAt: optionalIsoDate(row.processing_started_at),
    completedAt: ['received', 'ready-to-draft', 'drafting'].includes(row.status)
      ? undefined
      : optionalIsoDate(row.completed_at ?? row.updated_at),
    error: row.error_message ?? undefined,
    destination: { label: 'View quote', path: `/sales/quotes/${encodeURIComponent(row.id)}` },
  }));
}

function mapSoftwareStatus(status: string): BackgroundJobStatus {
  if (status === 'partial') return 'complete-with-warnings';
  if (status === 'complete' || status === 'failed' || status === 'running' || status === 'queued') return status;
  return 'failed';
}

function mapCleanupStatus(status: string): BackgroundJobStatus {
  if (status === 'queued') return 'queued';
  if (status === 'processing') return 'running';
  if (status === 'partial') return 'complete-with-warnings';
  if (status === 'failed') return 'failed';
  return 'complete';
}

function mapSalesStatus(status: string): BackgroundJobStatus {
  if (status === 'drafting') return 'running';
  if (['received', 'ready-to-draft'].includes(status)) return 'queued';
  if (status === 'failed') return 'failed';
  if (status === 'awaiting-clarification' || status === 'changes-requested') return 'complete-with-warnings';
  return 'complete';
}

function compareJobs(left: BackgroundJob, right: BackgroundJob) {
  return Date.parse(right.requestedAt) - Date.parse(left.requestedAt);
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIsoDate(value: Date | string | null) {
  return value ? isoDate(value) : undefined;
}

function integerValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
