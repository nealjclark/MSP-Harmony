import assert from 'node:assert/strict';
import {
  getDiscrepancyAuditState,
  getLatestDiscrepancyAuditReport,
  getLiveDiscrepancyReport,
  runAndSaveDiscrepancyAudit,
} from './discrepancyAudits';
import type { DiscrepancyReport, Queryable } from './discrepancyReports';

const customerId = '11111111-1111-4111-8111-111111111111';
const now = '2026-07-15T12:00:00.000Z';

type QueryCall = {
  sql: string;
  values?: unknown[];
};

type AuditRow = {
  id: string;
  comparison_id: string;
  comparison_label: string;
  source_key: string;
  source_snapshot: unknown;
  report_json: unknown;
  generated_at: string;
  created_at: string;
  created_by: string | null;
  row_count: number;
  open_discrepancy_count: number;
};

class AuditDatabase implements Queryable {
  calls: QueryCall[] = [];
  audits: AuditRow[] = [];
  syncRuns: Record<string, { id: string; completedAt: string }> = {
    ncentral: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', completedAt: '2026-07-15T11:00:00.000Z' },
    sentinelone: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', completedAt: '2026-07-15T11:05:00.000Z' },
    'opentext-appriver': { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', completedAt: '2026-07-15T11:10:00.000Z' },
  };
  cleanupMergeRows?: unknown[];

  async query<T = unknown>(sql: string, values?: unknown[]) {
    this.calls.push({ sql, values });

    if (sql.includes('from sync_runs')) {
      const vendorId = String(values?.[0] ?? '');
      const syncRun = this.syncRuns[vendorId];
      return {
        rows: syncRun
          ? [
              {
                id: syncRun.id,
                started_at: '2026-07-15T10:55:00.000Z',
                completed_at: syncRun.completedAt,
                metadata: {},
              },
            ]
          : [],
      } as { rows: T[] };
    }

    if (sql.includes('from vendor_usage_snapshots')) {
      const vendorId = String(values?.[0] ?? '');
      return {
        rows:
          vendorId === 'ncentral'
            ? ([deviceSnapshot('ncentral-1', 'ncentral', 'DESKTOP-01'), deviceSnapshot('ncentral-2', 'ncentral', 'LAPTOP-02')] as T[])
            : vendorId === 'sentinelone'
              ? ([deviceSnapshot('sentinel-1', 'sentinelone', 'desktop-01'), deviceSnapshot('sentinel-2', 'sentinelone', 'SERVER-03')] as T[])
              : [],
      };
    }

    if (sql.includes('insert into discrepancy_audits')) {
      const comparisonId = String(values?.[0]);
      const sourceKey = String(values?.[2]);
      const existing = this.audits.find((audit) => audit.comparison_id === comparisonId && audit.source_key === sourceKey);
      const audit: AuditRow = {
        id: existing?.id ?? `dddddddd-dddd-4ddd-8ddd-${String(this.audits.length + 1).padStart(12, '0')}`,
        comparison_id: comparisonId,
        comparison_label: String(values?.[1]),
        source_key: sourceKey,
        source_snapshot: JSON.parse(String(values?.[3])),
        report_json: JSON.parse(String(values?.[5])),
        generated_at: String(values?.[9]),
        created_at: now,
        created_by: values?.[10] ? String(values[10]) : null,
        row_count: Number(values?.[7]),
        open_discrepancy_count: Number(values?.[8]),
      };
      if (existing) {
        Object.assign(existing, audit);
      } else {
        this.audits.push(audit);
      }
      return { rows: [audit] as T[] };
    }

    if (sql.includes('from discrepancy_audits')) {
      const comparisonId = String(values?.[0] ?? '');
      const matchingAudits = this.audits.filter((row) => row.comparison_id === comparisonId);
      const audit = matchingAudits[matchingAudits.length - 1];
      return { rows: audit ? ([audit] as T[]) : [] };
    }

    if (sql.includes('jsonb_to_recordset')) {
      return {
        rows: (this.cleanupMergeRows ?? [
          {
            row_id: 'appriver-license-cleanup:cust-1:sub-1',
            pending_action_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            pending_action_status: 'queued',
            pending_requested_quantity: 8,
            pending_requested_reduction: 2,
            pending_created_at: '2026-07-15T12:05:00.000Z',
            latest_action_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            latest_action_status: 'queued',
            latest_requested_quantity: 8,
            latest_requested_reduction: 2,
            latest_final_quantity: null,
            latest_error_message: null,
            latest_created_at: '2026-07-15T12:05:00.000Z',
            latest_completed_at: null,
            latest_updated_at: '2026-07-15T12:05:00.000Z',
          },
        ]) as T[],
      };
    }

    return { rows: [] as T[] };
  }
}

async function run() {
  await testRunAndDetectNewerSnapshot();
  await testAppRiverUsesLiveMode();
  await testSavedAuditMergesCleanupActions();
  await testSavedAuditHidesPersistedMatchedRefresh();
  await testSavedAuditHidesHistoricalVerifiedAction();

  console.log('discrepancy audit tests passed');
}

async function testAppRiverUsesLiveMode() {
  const database = new AuditDatabase();
  const state = await getDiscrepancyAuditState(database, 'appriver-license-cleanup');
  assert.equal(state.liveMode, true);
  assert.equal(state.canRun, false);
  assert.equal(state.hasNewerSnapshot, false);

  const live = await getLiveDiscrepancyReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: true,
    now,
  });
  assert.equal(live.auditMode, 'live');
  assert.equal(live.auditState.liveMode, true);
  assert.equal(live.auditState.canRun, false);
}

async function testSavedAuditHidesPersistedMatchedRefresh() {
  const database = new AuditDatabase();
  database.audits.push({
    id: 'dddddddd-dddd-4ddd-8ddd-000000000002',
    comparison_id: 'appriver-license-cleanup',
    comparison_label: 'AppRiver license cleanup',
    source_key: 'source:opentext-appriver:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_snapshot: {
      comparisonId: 'appriver-license-cleanup',
      sources: [{ vendorId: 'opentext-appriver', syncRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }],
    },
    report_json: appRiverCleanupReport(),
    generated_at: now,
    created_at: now,
    created_by: 'analyst@example.com',
    row_count: 1,
    open_discrepancy_count: 1,
  });
  const original = appRiverCleanupReport().rows[0]?.cleanup;
  assert.ok(original);
  database.cleanupMergeRows = [{
    row_id: original.id,
    pending_action_id: null,
    latest_action_id: null,
    refresh_candidate: {
      ...original,
      totalLicenses: 8,
      assignedLicenses: 8,
      unassignedLicenses: 0,
      proposedReduction: 0,
      proposedQuantity: 8,
      refresh: {
        syncRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        initialTotalLicenses: 10,
        initialAssignedLicenses: 8,
        initialUnassignedLicenses: 2,
        refreshedAt: '2026-07-15T12:10:00.000Z',
      },
    },
    preview_payload: null,
  }];

  const hidden = await getLatestDiscrepancyAuditReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: false,
  });
  assert.equal(hidden?.rows.length, 0);

  const visible = await getLatestDiscrepancyAuditReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: true,
  });
  assert.equal(visible?.rows[0]?.status, 'matched');
  assert.equal(visible?.rows[0]?.cleanup?.totalLicenses, 8);
  assert.equal(visible?.rows[0]?.cleanup?.refresh?.initialTotalLicenses, 10);
}

async function testSavedAuditHidesHistoricalVerifiedAction() {
  const database = new AuditDatabase();
  database.audits.push({
    id: 'dddddddd-dddd-4ddd-8ddd-000000000003',
    comparison_id: 'appriver-license-cleanup',
    comparison_label: 'AppRiver license cleanup',
    source_key: 'source:opentext-appriver:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_snapshot: {
      comparisonId: 'appriver-license-cleanup',
      sources: [{ vendorId: 'opentext-appriver', syncRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }],
    },
    report_json: appRiverCleanupReport(),
    generated_at: now,
    created_at: now,
    created_by: 'analyst@example.com',
    row_count: 1,
    open_discrepancy_count: 1,
  });
  const original = appRiverCleanupReport().rows[0]?.cleanup;
  assert.ok(original);
  database.cleanupMergeRows = [{
    row_id: original.id,
    pending_action_id: null,
    latest_action_id: 'eeeeeeee-eeee-4eee-8eee-000000000003',
    latest_action_status: 'verified',
    latest_requested_quantity: 8,
    latest_requested_reduction: 2,
    latest_final_quantity: 8,
    latest_error_message: null,
    latest_created_at: '2026-07-15T12:05:00.000Z',
    latest_completed_at: '2026-07-15T12:10:00.000Z',
    latest_updated_at: '2026-07-15T12:10:00.000Z',
    refresh_candidate: null,
    preview_payload: null,
  }];

  const hidden = await getLatestDiscrepancyAuditReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: false,
  });
  assert.equal(hidden?.rows.length, 0);

  const visible = await getLatestDiscrepancyAuditReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: true,
  });
  assert.equal(visible?.rows[0]?.status, 'matched');
  assert.equal(visible?.rows[0]?.cleanup?.totalLicenses, 8);
  assert.equal(visible?.rows[0]?.cleanup?.unassignedLicenses, 0);
  assert.equal(visible?.rows[0]?.cleanup?.latestAction?.status, 'verified');
}

async function testRunAndDetectNewerSnapshot() {
  const database = new AuditDatabase();
  const report = await runAndSaveDiscrepancyAudit(database, {
    comparisonId: 'ncentral-sentinelone-devices',
    includeMatched: false,
    now,
    createdBy: 'analyst@example.com',
  });

  assert.equal(report.auditMode, 'new');
  assert.equal(report.audit.comparisonId, 'ncentral-sentinelone-devices');
  assert.equal(report.audit.rowCount, 1);
  assert.match(report.audit.sourceKey, /ncentral:aaaaaaaa/);
  assert.match(report.audit.sourceKey, /sentinelone:bbbbbbbb/);
  assert.equal(report.rows[0]?.status, 'warning');
  assert.ok(database.calls.some((call) => call.sql.includes('insert into audit_events')));

  database.syncRuns.sentinelone = {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    completedAt: '2026-07-15T12:30:00.000Z',
  };
  const state = await getDiscrepancyAuditState(database, 'ncentral-sentinelone-devices');
  assert.equal(state.hasNewerSnapshot, true);
  assert.equal(state.canRun, true);
  assert.equal(state.liveMode, false);
}

async function testSavedAuditMergesCleanupActions() {
  const database = new AuditDatabase();
  database.audits.push({
    id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    comparison_id: 'appriver-license-cleanup',
    comparison_label: 'AppRiver license cleanup',
    source_key: 'source:opentext-appriver:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_snapshot: {
      comparisonId: 'appriver-license-cleanup',
      sourceKey: 'source:opentext-appriver:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sources: [
        {
          side: 'source',
          vendorId: 'opentext-appriver',
          vendorName: 'AppRiver - OpenText',
          syncRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          completedAt: '2026-07-15T11:10:00.000Z',
        },
      ],
      latestCompletedAt: '2026-07-15T11:10:00.000Z',
      missingSourceCount: 0,
    },
    report_json: appRiverCleanupReport(),
    generated_at: now,
    created_at: now,
    created_by: 'analyst@example.com',
    row_count: 1,
    open_discrepancy_count: 1,
  });

  const report = await getLatestDiscrepancyAuditReport(database, {
    comparisonId: 'appriver-license-cleanup',
    includeMatched: true,
  });

  assert.ok(report);
  assert.equal(report.auditMode, 'saved');
  assert.equal(report.rows[0]?.cleanup?.pendingAction?.status, 'queued');
  assert.equal(report.rows[0]?.cleanup?.latestAction?.requestedQuantity, 8);
}

function deviceSnapshot(id: string, vendorId: 'ncentral' | 'sentinelone', hostname: string) {
  return {
    id,
    vendor_id: vendorId,
    customer_id: customerId,
    connectwise_company_id: 'cw-101',
    customer_name: 'Mapped Client',
    external_account_id: `${vendorId}-${customerId}`,
    vendor_product_key: `${vendorId}-workstation`,
    product_code: `${vendorId.toUpperCase()}-WORKSTATION`,
    product_name: `${vendorId} Workstation`,
    quantity: 1,
    observed_at: '2026-07-15T11:30:00.000Z',
    dimensions: {
      hostname,
      deviceName: hostname,
      lastCheckIn: '2026-07-15T11:45:00.000Z',
    },
  };
}

function appRiverCleanupReport(): DiscrepancyReport {
  return {
    reportType: 'discrepancies',
    generatedAt: now,
    filters: {
      includeMatched: true,
    },
    summary: {
      comparisonCount: 1,
      rowCount: 1,
      openDiscrepancyCount: 1,
      warningCount: 1,
      criticalCount: 0,
      unavailableCount: 0,
      matchedCount: 0,
      deviceGapCount: 0,
      userGapCount: 1,
      staleSourceCount: 0,
      customerCount: 1,
    },
    comparisonPairs: [
      {
        id: 'appriver-license-cleanup',
        label: 'AppRiver license cleanup',
        basis: 'user',
        leftVendorId: 'opentext-appriver',
        leftVendorName: 'AppRiver - OpenText',
        rightVendorId: 'opentext-appriver',
        rightVendorName: 'AppRiver - OpenText',
        matchingStrategy: 'license-cleanup',
        productFamily: 'Unassigned licenses',
        aggregateOnly: false,
        comparisonType: 'license-cleanup',
      },
    ],
    customers: [
      {
        customerId,
        connectWiseCompanyId: 'cw-101',
        customerName: 'Mapped Client',
      },
    ],
    rows: [
      {
        id: 'appriver-license-cleanup:cust-1:sub-1',
        customer: {
          customerId,
          connectWiseCompanyId: 'cw-101',
          customerName: 'Mapped Client',
        },
        comparisonPair: {
          id: 'appriver-license-cleanup',
          label: 'AppRiver license cleanup',
          basis: 'user',
          leftVendorId: 'opentext-appriver',
          leftVendorName: 'AppRiver - OpenText',
          rightVendorId: 'opentext-appriver',
          rightVendorName: 'AppRiver - OpenText',
          matchingStrategy: 'license-cleanup',
          productFamily: 'Unassigned licenses',
          aggregateOnly: false,
          comparisonType: 'license-cleanup',
        },
        basis: 'user',
        productFamily: 'Hosted Exchange',
        leftCount: 10,
        rightCount: 8,
        delta: 2,
        status: 'warning',
        stale: false,
        aggregateOnly: false,
        missingFromLeft: [],
        missingFromRight: [],
        referenceItems: [],
        cleanup: {
          id: 'appriver-license-cleanup:cust-1:sub-1',
          customerId,
          connectWiseCompanyId: 'cw-101',
          customerName: 'Mapped Client',
          externalCustomerId: 'cust-1',
          productCode: 'HEX',
          productName: 'Hosted Exchange',
          subscriptionKey: 'sub-1',
          totalLicenses: 10,
          assignedLicenses: 8,
          unassignedLicenses: 2,
          proposedReduction: 2,
          proposedQuantity: 8,
          eligibilityReason: 'Renewal',
          renewalWindow: 'Upcoming',
          observedAt: now,
          syncTimestamp: '2026-07-15T11:10:00.000Z',
        },
        syncTimestamps: {
          left: '2026-07-15T11:10:00.000Z',
        },
      },
    ],
  };
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
