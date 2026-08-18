import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import type { AuthPrincipal } from '../functions/auth';
import {
  dismissBackgroundJob,
  dismissCompletedBackgroundJobs,
  listBackgroundJobs,
} from './backgroundJobs';

const requestedAt = '2026-08-17T12:00:00.000Z';

const integrationRepository = {
  async listRecentSyncJobs() {
    return [{
      id: 'integration-job',
      integrationId: 'ncentral',
      integrationName: 'N-central',
      operationKey: 'devices',
      operationLabel: 'Devices',
      status: 'complete',
      requestedBy: 'analyst@example.com',
      requestedAt,
      completedAt: '2026-08-17T12:05:00.000Z',
      warnings: ['Branch office: API access denied.'],
      progress: { completed: 9, total: 10, failed: 1, unitLabel: 'devices' },
    }];
  },
} as unknown as PostgresIntegrationSettingsRepository;

const dismissals = new Map<string, Array<{ source: string; job_id: string }>>();

const database = {
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes('from background_job_dismissals')) {
      return { rows: dismissals.get(String(params[0])) ?? [] };
    }
    if (sql.includes('insert into background_job_dismissals')) {
      const key = String(params[0]);
      const sources = params[1] as string[];
      const ids = params[2] as string[];
      const existing = dismissals.get(key) ?? [];
      sources.forEach((source, index) => {
        if (!existing.some((item) => item.source === source && item.job_id === ids[index])) {
          existing.push({ source, job_id: ids[index] ?? '' });
        }
      });
      dismissals.set(key, existing);
      return { rows: [] };
    }
    if (sql.includes('ncentral_software_inventory_reports')) {
      return { rows: [{
        id: 'software-job', customer_name: 'Acme', site_name: null, status: 'partial',
        requested_by: 'analyst@example.com', requested_at: requestedAt,
        started_at: requestedAt, completed_at: '2026-08-17T12:06:00.000Z',
        total_devices: 10, completed_devices: 8, failed_devices: 2,
        error_message: null, current_item: null,
      }] };
    }
    if (sql.includes('appriver_license_cleanup_batches')) {
      return { rows: [{
        id: 'cleanup-job', requested_by: 'admin@example.com', status: 'skipped',
        requested_at: requestedAt, completed_at: '2026-08-17T12:01:00.000Z',
        total_count: 3, completed_count: 3, failed_count: 0, current_item: null,
      }] };
    }
    if (sql.includes('sales_quote_requests')) {
      const canReadAll = params[0] === true;
      const email = String(params[1] ?? '').toLowerCase();
      const rows = [
        {
          id: 'sales-own', subject: 'Own quote', status: 'drafting', requester_email: 'sales@example.com',
          received_at: requestedAt, processing_started_at: requestedAt, completed_at: null,
          updated_at: requestedAt, error_message: null,
        },
        {
          id: 'sales-other', subject: 'Other quote', status: 'changes-requested', requester_email: 'other@example.com',
          received_at: requestedAt, processing_started_at: requestedAt, completed_at: null,
          updated_at: requestedAt, error_message: null,
        },
      ];
      return { rows: canReadAll ? rows : rows.filter((row) => row.requester_email.toLowerCase() === email) };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  },
} as unknown as Pool;

function principal(name: string, roles: AuthPrincipal['roles']): AuthPrincipal {
  return { name, email: name, roles };
}

async function run() {
  const analystJobs = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('analyst@example.com', ['Analyst']),
  });
  assert.deepEqual(analystJobs.map((job) => job.source).sort(), ['integration-sync', 'software-inventory']);
  assert.equal(analystJobs.find((job) => job.id === 'integration-job')?.status, 'complete-with-warnings');
  assert.match(analystJobs.find((job) => job.id === 'integration-job')?.warning ?? '', /access denied/i);
  assert.equal(analystJobs.find((job) => job.id === 'software-job')?.status, 'complete-with-warnings');
  assert.equal(
    analystJobs.find((job) => job.id === 'software-job')?.destination?.path,
    '/reports/software-inventory?reportId=software-job',
  );

  const licenseJobs = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('license@example.com', ['LicenseAdmin']),
  });
  assert.ok(licenseJobs.some((job) => job.source === 'appriver-license-cleanup'));
  assert.equal(licenseJobs.find((job) => job.id === 'cleanup-job')?.status, 'complete');
  assert.equal(licenseJobs.some((job) => job.source === 'sales-quote'), false);

  const salesJobs = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('sales@example.com', ['SalesRequester']),
  });
  assert.deepEqual(salesJobs.map((job) => job.id), ['sales-own']);
  assert.equal(salesJobs[0]?.status, 'running');

  const adminJobs = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('admin@example.com', ['Admin']),
  });
  assert.ok(adminJobs.some((job) => job.id === 'sales-other' && job.status === 'complete-with-warnings'));
  assert.deepEqual(new Set(adminJobs.map((job) => job.source)), new Set([
    'integration-sync', 'software-inventory', 'appriver-license-cleanup', 'sales-quote',
  ]));

  const dismissedOne = await dismissBackgroundJob({
    database,
    integrationRepository,
    principal: principal('analyst@example.com', ['Analyst']),
    source: 'software-inventory',
    jobId: 'software-job',
  });
  assert.equal(dismissedOne.dismissed, true);
  const afterSingleDismiss = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('analyst@example.com', ['Analyst']),
  });
  assert.equal(afterSingleDismiss.some((job) => job.id === 'software-job'), false);
  assert.equal(afterSingleDismiss.some((job) => job.id === 'integration-job'), true);

  const activeDismiss = await dismissBackgroundJob({
    database,
    integrationRepository,
    principal: principal('sales@example.com', ['SalesRequester']),
    source: 'sales-quote',
    jobId: 'sales-own',
  });
  assert.equal(activeDismiss.dismissed, false);
  assert.match(activeDismiss.reason ?? '', /remain visible/i);

  const dismissedAll = await dismissCompletedBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('admin@example.com', ['Admin']),
  });
  assert.ok(dismissedAll.dismissedCount >= 1);
  const afterDismissAll = await listBackgroundJobs({
    database,
    integrationRepository,
    principal: principal('admin@example.com', ['Admin']),
  });
  assert.deepEqual(afterDismissAll.map((job) => job.id), ['sales-own']);

  console.log('background jobs tests passed');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
