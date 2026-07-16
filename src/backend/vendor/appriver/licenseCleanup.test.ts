import assert from 'node:assert/strict';
import {
  cancelAppRiverLicenseCleanupAction,
  dismissAppRiverLicenseCleanupAction,
  listAppRiverLicenseCleanupActions,
  listAppRiverLicenseCleanupCandidates,
  processNextAppRiverLicenseCleanupAction,
  queueAppRiverLicenseCleanupPreview,
  queueAppRiverLicenseCleanupActions,
  refreshAppRiverLicenseCleanupCandidate,
  type AppRiverLicenseCleanupClient,
  type Queryable,
} from './licenseCleanup';
import type { AppRiverChargeEvent, AppRiverSubscriptionDetail } from './client';

const now = '2026-07-15T12:00:00.000Z';
const syncRunId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerId = '11111111-1111-4111-8111-111111111111';

type QueryCall = {
  sql: string;
  values?: unknown[];
};

type SnapshotRow = {
  id: string;
  customer_id: string | null;
  connectwise_company_id: string | null;
  customer_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: number;
  observed_at: string;
  dimensions: Record<string, unknown>;
  pending_action_id: string | null;
  pending_action_status: string | null;
  pending_requested_quantity: number | null;
  pending_requested_reduction: number | null;
  pending_created_at: string | null;
  latest_action_id?: string | null;
  latest_action_status?: string | null;
  latest_requested_quantity?: number | null;
  latest_requested_reduction?: number | null;
  latest_final_quantity?: number | null;
  latest_error_message?: string | null;
  latest_created_at?: string | null;
  latest_completed_at?: string | null;
  latest_updated_at?: string | null;
};

type CleanupAction = {
  id: string;
  batch_id: string;
  customer_id: string | null;
  customer_name: string | null;
  external_customer_id: string;
  vendor_product_key: string | null;
  product_code: string | null;
  product_name: string;
  subscription_key: string;
  domain: string | null;
  status: string;
  current_total_licenses: number;
  current_assigned_licenses: number | null;
  current_unassigned_licenses: number;
  requested_reduction: number;
  requested_quantity: number;
  attempts: number;
  verification_attempts: number;
  expires_at: string;
  next_check_at: string;
  created_at: string;
  updated_at: string;
  request_payload: Record<string, unknown>;
  live_total_licenses?: number | null;
  live_assigned_licenses?: number | null;
  live_unassigned_licenses?: number | null;
  previous_status?: string;
  error_message?: string;
  dismissed_at?: string;
  dismissed_by?: string;
};

class CleanupDatabase implements Queryable {
  calls: QueryCall[] = [];
  snapshotRows: SnapshotRow[] = [];
  actions: CleanupAction[] = [];
  batchIds: string[] = [];
  previews: Array<{ id: string; actor: string; rowId: string; occurredAt: string; payload: unknown }> = [];
  savedCandidates = new Map<string, unknown>();
  subscriptionRefreshes = new Map<string, unknown>();

  constructor(snapshotRows: SnapshotRow[] = []) {
    this.snapshotRows = snapshotRows;
  }

  async query<T = unknown>(sql: string, values?: unknown[]) {
    this.calls.push({ sql, values });

    if (sql.includes('from sync_runs')) {
      return {
        rows: [
          {
            id: syncRunId,
            started_at: '2026-07-15T11:55:00.000Z',
            completed_at: '2026-07-15T12:00:00.000Z',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: this.snapshotRows.map((row) => ({
          ...row,
          refresh_candidate: this.subscriptionRefreshes.get(
            `${values?.[1]}:${row.external_account_id}:${String(row.dimensions.subscriptionKey ?? '')}`,
          ),
        })) as T[],
      };
    }

    if (sql.includes('jsonb_array_elements') && sql.includes('discrepancy_audits')) {
      const cleanup = this.savedCandidates.get(String(values?.[0] ?? ''));
      return { rows: cleanup ? ([{ cleanup, sync_run_id: syncRunId }] as T[]) : ([] as T[]) };
    }

    if (sql.includes('insert into appriver_subscription_refreshes')) {
      this.subscriptionRefreshes.set(
        `${values?.[0]}:${values?.[2]}:${values?.[3]}`,
        JSON.parse(String(values?.[10] ?? '{}')),
      );
      return { rows: [] as T[] };
    }

    if (sql.includes('delete from appriver_subscription_refreshes')) {
      this.subscriptionRefreshes.delete(`${values?.[0]}:${values?.[1]}:${values?.[2]}`);
      return { rows: [] as T[] };
    }

    if (sql.includes("insert into audit_events") && sql.includes("preview.refreshed")) {
      const id = `dddddddd-dddd-4ddd-8ddd-${String(this.previews.length + 1).padStart(12, '0')}`;
      this.previews.push({
        id,
        actor: String(values?.[0]),
        rowId: String(values?.[1]),
        occurredAt: String(values?.[2]),
        payload: JSON.parse(String(values?.[3] ?? '{}')),
      });
      return { rows: [{ id }] as T[] };
    }

    if (sql.includes('from audit_events') && sql.includes("preview.refreshed")) {
      const preview = this.previews.find(
        (item) => item.id === values?.[0] && item.actor === values?.[1] && Date.parse(item.occurredAt) >= Date.parse(String(values?.[2])) - 15 * 60 * 1000,
      );
      return {
        rows: preview ? ([{ id: preview.id, entity_id: preview.rowId, payload: preview.payload }] as T[]) : ([] as T[]),
      };
    }

    if (sql.includes('from appriver_license_cleanup_actions') && sql.includes('join appriver_license_cleanup_batches')) {
      const actionId = sql.includes('where appriver_license_cleanup_actions.id = $1::uuid')
        ? String(values?.[0] ?? '')
        : undefined;
      return {
        rows: this.actions
          .filter((action) => (!actionId || action.id === actionId) && (actionId || !action.dismissed_at))
          .map((action) => ({
            id: action.id,
            batch_id: action.batch_id,
            batch_status: 'queued',
            requested_by: 'license@example.com',
            customer_id: action.customer_id,
            customer_name: action.customer_name,
            external_customer_id: action.external_customer_id,
            vendor_product_key: action.vendor_product_key,
            product_code: action.product_code,
            product_name: action.product_name,
            subscription_key: action.subscription_key,
            domain: action.domain,
            status: action.status,
            current_total_licenses: action.current_total_licenses,
            current_assigned_licenses: action.current_assigned_licenses,
            current_unassigned_licenses: action.current_unassigned_licenses,
            requested_reduction: action.requested_reduction,
            requested_quantity: action.requested_quantity,
            live_total_licenses: action.live_total_licenses ?? null,
            live_assigned_licenses: action.live_assigned_licenses ?? null,
            live_unassigned_licenses: action.live_unassigned_licenses ?? null,
            final_quantity: null,
            eligibility_reason: 'Renewal',
            renewal_window: 'Upcoming',
            effective_date: null,
            commitment_end_date: '2026-07-20',
            previous_commitment_end_date: null,
            attempts: action.attempts,
            verification_attempts: action.verification_attempts,
            next_check_at: action.next_check_at,
            accepted_at: null,
            verified_at: null,
            started_at: action.status === 'queued' ? null : action.created_at,
            completed_at: ['verified', 'needs_review', 'failed', 'timed_out', 'skipped', 'cancelled'].includes(action.status)
              ? now
              : null,
            expires_at: action.expires_at,
            error_message: action.error_message ?? null,
            dismissed_at: action.dismissed_at ?? null,
            dismissed_by: action.dismissed_by ?? null,
            created_at: action.created_at,
            updated_at: action.updated_at,
          })) as T[],
      };
    }

    if (sql.includes('insert into appriver_license_cleanup_batches')) {
      const batchId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(this.batchIds.length + 1).padStart(12, '0')}`;
      this.batchIds.push(batchId);
      return { rows: [{ id: batchId }] as T[] };
    }

    if (sql.includes('select count(*) as due_count')) {
      const anchor = Date.parse(String(values?.[0] ?? ''));
      const updatePending = this.actions.some((action) => ['queued', 'running', 'reviewing', 'updating'].includes(action.status));
      const dueCount = this.actions.filter(
        (action) =>
          ((action.status === 'queued' && Date.parse(action.next_check_at) <= anchor) ||
            (action.status === 'confirm' && !updatePending && Date.parse(action.next_check_at) <= anchor)),
      ).length;
      return { rows: [{ due_count: dueCount }] as T[] };
    }

    if (sql.includes('count(*) filter')) {
      const batchId = String(values?.[0] ?? '');
      const actions = this.actions.filter((action) => action.batch_id === batchId);
      const count = (status: string) => actions.filter((action) => action.status === status).length;
      return {
        rows: [
          {
            total_count: actions.length,
            queued_count: count('queued'),
            running_count: count('running'),
            reviewing_count: count('reviewing'),
            updating_count: count('updating'),
            confirm_count: count('confirm'),
            skipped_count: count('skipped'),
            verified_count: count('verified'),
            needs_review_count: count('needs_review'),
            failed_count: count('failed'),
            timed_out_count: count('timed_out'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from appriver_license_cleanup_actions') && sql.includes('external_customer_id = $1')) {
      const externalCustomerId = String(values?.[0] ?? '');
      const subscriptionKey = String(values?.[1] ?? '');
      return {
        rows: this.actions
          .filter(
            (action) =>
              action.external_customer_id === externalCustomerId &&
              action.subscription_key === subscriptionKey &&
              ['queued', 'running', 'reviewing', 'updating', 'confirm'].includes(action.status),
          )
          .slice(0, 1) as T[],
      };
    }

    if (sql.includes('insert into appriver_license_cleanup_actions')) {
      const action: CleanupAction = {
        id: `cccccccc-cccc-4ccc-8ccc-${String(this.actions.length + 1).padStart(12, '0')}`,
        batch_id: String(values?.[0]),
        customer_id: values?.[1] ? String(values[1]) : null,
        customer_name: values?.[2] ? String(values[2]) : null,
        external_customer_id: String(values?.[3]),
        vendor_product_key: values?.[4] ? String(values[4]) : null,
        product_code: values?.[5] ? String(values[5]) : null,
        product_name: String(values?.[6]),
        subscription_key: String(values?.[7]),
        domain: values?.[8] ? String(values[8]) : null,
        status: 'queued',
        current_total_licenses: Number(values?.[9]),
        current_assigned_licenses: values?.[10] === null ? null : Number(values?.[10]),
        current_unassigned_licenses: Number(values?.[11]),
        requested_reduction: Number(values?.[12]),
        requested_quantity: Number(values?.[13]),
        attempts: 0,
        verification_attempts: 0,
        next_check_at: String(values?.[19]),
        expires_at: new Date(Date.parse(String(values?.[19])) + 24 * 60 * 60 * 1000).toISOString(),
        created_at: String(values?.[19]),
        updated_at: String(values?.[19]),
        request_payload: JSON.parse(String(values?.[20] ?? '{}')) as Record<string, unknown>,
      };
      this.actions.push(action);
      return { rows: [] as T[] };
    }

    if (sql.includes('with candidate as')) {
      const anchor = Date.parse(String(values?.[0]));
      const updatePending = this.actions.some((candidate) => ['queued', 'running', 'reviewing', 'updating'].includes(candidate.status));
      const action = this.actions
        .filter(
          (candidate) =>
            (candidate.status === 'queued' && Date.parse(candidate.next_check_at) <= anchor) ||
            (candidate.status === 'confirm' && !updatePending && Date.parse(candidate.next_check_at) <= anchor),
        )
        .sort((left, right) => {
          const leftPriority = left.status === 'queued' ? 0 : 3;
          const rightPriority = right.status === 'queued' ? 0 : 3;
          return leftPriority - rightPriority || Date.parse(left.created_at) - Date.parse(right.created_at);
        })[0];
      if (!action) {
        return { rows: [] as T[] };
      }

      const previousStatus = action.status;
      action.status = previousStatus === 'queued' ? 'running' : previousStatus;
      action.attempts += 1;
      action.updated_at = String(values?.[0]);
      return {
        rows: [
          {
            ...action,
            previous_status: previousStatus,
          },
        ] as T[],
      };
    }

    if (sql.includes("set status = 'verified'")) {
      this.updateAction(String(values?.[0]), { status: 'verified', updated_at: String(values?.[1]) });
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'cancelled'")) {
      const action = this.actions.find(
        (current) => current.id === values?.[0] && current.status === 'queued',
      );
      if (!action) {
        return { rows: [] as T[] };
      }
      action.status = 'cancelled';
      action.error_message = String(values?.[2]);
      return { rows: [{ id: action.id, batch_id: action.batch_id }] as T[] };
    }

    if (sql.includes('set dismissed_at = $2::timestamptz')) {
      const action = this.actions.find(
        (current) => current.id === values?.[0] && current.status === 'cancelled' && !current.dismissed_at,
      );
      if (!action) {
        return { rows: [] as T[] };
      }
      action.dismissed_at = String(values?.[1]);
      action.dismissed_by = String(values?.[2]);
      action.updated_at = String(values?.[1]);
      return { rows: [{ id: action.id }] as T[] };
    }

    if (sql.includes("set status = 'reviewing'")) {
      this.updateAction(String(values?.[0]), { status: 'reviewing', updated_at: String(values?.[1]) });
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'updating'")) {
      this.updateAction(String(values?.[0]), {
        status: 'updating',
        updated_at: String(values?.[1]),
        live_total_licenses: Number(values?.[2]),
        live_assigned_licenses: values?.[3] === null ? null : Number(values?.[3]),
        live_unassigned_licenses: Number(values?.[4]),
      });
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'confirm'")) {
      this.updateAction(String(values?.[0]), {
        status: 'confirm',
        updated_at: String(values?.[1]),
        next_check_at: String(values?.[3]),
      });
      const action = this.actions.find((current) => current.id === values?.[0]);
      if (action && values?.[2] === true) {
        action.verification_attempts += 1;
      }
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'needs_review'")) {
      this.updateAction(String(values?.[0]), {
        status: 'needs_review',
        updated_at: String(values?.[1]),
        live_total_licenses: Number(values?.[2]),
        live_assigned_licenses: values?.[3] === null ? null : Number(values?.[3]),
        live_unassigned_licenses: Number(values?.[4]),
        error_message: String(values?.[5]),
      });
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'failed'")) {
      this.updateAction(String(values?.[0]), { status: 'failed', error_message: String(values?.[2]) });
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'timed_out'")) {
      this.updateAction(String(values?.[0]), { status: 'timed_out', error_message: String(values?.[2]) });
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  }

  private updateAction(actionId: string, patch: Partial<CleanupAction>) {
    const action = this.actions.find((current) => current.id === actionId);
    if (action) {
      Object.assign(action, patch);
    }
  }
}

async function run() {
  await testReportEligibility();
  await testScheduledCancellationIsNotQueued();
  await testQueueDuplicatePrevention();
  await testQueueRefreshesLiveSubscriptionDetails();
  await testPreviewQueuesManualRemoval();
  await testPreviewMarksLiveMatch();
  await testAggregateProductCountsNeverReplaceSubscriptionQuantity();
  await testPreviewUsesCandidateFromSavedAudit();
  await testListAndCancelQueuedAction();
  await testDismissCanceledAction();
  await testLiveRevalidationAndVerification();
  await testQueuedUpdatesFinishBeforeConfirmation();
  await testAmbiguousUpdateTimeoutMovesToConfirm();
  await testChangedCountsNeedReview();
  await testVerificationTimeout();

  console.log('appriver license cleanup tests passed');
}

async function testPreviewUsesCandidateFromSavedAudit() {
  const sourceDatabase = new CleanupDatabase([
    snapshot('saved-only', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 5, assignedLicenses: 3, unassignedLicenses: 2 }),
  ]);
  const rowId = 'appriver-license-cleanup:cust-1:saved-only';
  const savedCandidate = (await listAppRiverLicenseCleanupCandidates(sourceDatabase, { now })).rows.find(
    (candidate) => candidate.id === rowId,
  );
  assert.ok(savedCandidate);

  const database = new CleanupDatabase([]);
  database.savedCandidates.set(rowId, savedCandidate);
  const preview = await refreshAppRiverLicenseCleanupCandidate(database, {
    actor: 'license@example.com',
    rowId,
    now,
    liveClient: {
      async getCustomerSubscriptionDetails(customerId, subscriptionKey) {
        assert.equal(customerId, 'cust-1');
        assert.equal(subscriptionKey, 'saved-only');
        return detail({
          subscriptionKey,
          totalLicenses: 5,
          subscriptionQuantity: 5,
          assignedLicenses: 3,
          unassignedLicenses: 2,
          commitmentEndDate: '2026-07-14T00:00:00Z',
        });
      },
    },
  });

  assert.equal(preview?.status, 'eligible');
  assert.equal(preview?.candidate.externalCustomerId, 'cust-1');
  assert.equal(preview?.candidate.subscriptionKey, 'saved-only');
}

async function testPreviewQueuesManualRemoval() {
  const database = new CleanupDatabase([
    snapshot('manual-decrease', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
  ]);
  const rowId = 'appriver-license-cleanup:cust-1:manual-decrease';
  const preview = await refreshAppRiverLicenseCleanupCandidate(database, {
    actor: 'license@example.com',
    rowId,
    now,
    liveClient: {
      async getCustomerSubscriptionDetails(_customerId, subscriptionKey) {
        return detail({
          subscriptionKey,
          totalLicenses: 9,
          subscriptionQuantity: 9,
          assignedLicenses: 7,
          unassignedLicenses: 2,
          commitmentEndDate: '2026-07-14T00:00:00Z',
        });
      },
    },
  });

  assert.equal(preview?.status, 'eligible');
  assert.equal(preview?.changed, true);
  assert.equal(preview?.candidate.totalLicenses, 9);
  assert.equal(preview?.candidate.proposedReduction, 2);
  assert.equal(preview?.candidate.refresh?.initialTotalLicenses, 10);
  assert.equal(database.subscriptionRefreshes.size, 1);
  const refreshedReport = await listAppRiverLicenseCleanupCandidates(database, { now });
  assert.equal(refreshedReport.rows.find((candidate) => candidate.id === rowId)?.totalLicenses, 9);
  await assert.rejects(
    queueAppRiverLicenseCleanupPreview(database, {
      actor: 'license@example.com',
      previewId: preview?.previewId ?? '',
      rowId,
      requestedQuantity: 6,
      now,
    }),
    /at or above assigned usage/,
  );
  const result = await queueAppRiverLicenseCleanupPreview(database, {
    actor: 'license@example.com',
    previewId: preview?.previewId ?? '',
    rowId,
    requestedQuantity: 8,
    now,
  });
  assert.equal(result.queued, 1);
  assert.equal(database.actions[0]?.current_total_licenses, 9);
  assert.equal(database.actions[0]?.requested_reduction, 1);
  assert.equal(database.actions[0]?.requested_quantity, 8);
}

async function testPreviewMarksLiveMatch() {
  const database = new CleanupDatabase([
    snapshot('now-matched', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
  ]);
  const preview = await refreshAppRiverLicenseCleanupCandidate(database, {
    actor: 'license@example.com',
    rowId: 'appriver-license-cleanup:cust-1:now-matched',
    now,
    liveClient: {
      async getCustomerSubscriptionDetails(_customerId, subscriptionKey) {
        return detail({
          subscriptionKey,
          totalLicenses: 7,
          subscriptionQuantity: 7,
          assignedLicenses: 7,
          unassignedLicenses: 0,
          commitmentEndDate: '2026-07-14T00:00:00Z',
        });
      },
    },
  });

  assert.equal(preview?.status, 'matched');
  assert.equal(preview?.candidate.totalLicenses, 7);
  assert.equal(preview?.candidate.proposedReduction, 0);
  const refreshedReport = await listAppRiverLicenseCleanupCandidates(database, { now });
  const refreshedCandidate = refreshedReport.rows.find(
    (candidate) => candidate.id === 'appriver-license-cleanup:cust-1:now-matched',
  );
  assert.equal(refreshedCandidate?.unassignedLicenses, 0);
  assert.equal(refreshedCandidate?.refresh?.initialTotalLicenses, 10);
}

async function testAggregateProductCountsNeverReplaceSubscriptionQuantity() {
  const database = new CleanupDatabase([
    snapshot('monthly-business-premium', {
      commitmentEndDate: '2026-07-14T00:00:00Z',
      totalLicenses: 156,
      subscriptionQuantity: 21,
      assignedLicenses: 154,
      unassignedLicenses: 2,
    }),
  ]);
  const rowId = 'appriver-license-cleanup:cust-1:monthly-business-premium';
  const initialCandidate = (await listAppRiverLicenseCleanupCandidates(database, { now })).rows.find(
    (candidate) => candidate.id === rowId,
  );
  assert.equal(initialCandidate?.totalLicenses, 21);
  assert.equal(initialCandidate?.assignedLicenses, 19);
  assert.equal(initialCandidate?.proposedQuantity, 19);

  database.subscriptionRefreshes.set(`${syncRunId}:cust-1:monthly-business-premium`, {
    ...initialCandidate,
    totalLicenses: 154,
    assignedLicenses: 154,
    unassignedLicenses: 0,
    proposedReduction: 0,
    proposedQuantity: 154,
    refresh: {
      syncRunId,
      initialTotalLicenses: 21,
      initialAssignedLicenses: 19,
      initialUnassignedLicenses: 2,
      refreshedAt: now,
    },
  });
  const correctedLegacyCandidate = (await listAppRiverLicenseCleanupCandidates(database, { now })).rows.find(
    (candidate) => candidate.id === rowId,
  );
  assert.equal(correctedLegacyCandidate?.totalLicenses, 19);
  assert.equal(correctedLegacyCandidate?.assignedLicenses, 19);
  assert.equal(correctedLegacyCandidate?.proposedQuantity, 19);

  await assert.rejects(
    refreshAppRiverLicenseCleanupCandidate(database, {
      actor: 'license@example.com',
      rowId,
      now,
      liveClient: {
        async getCustomerSubscriptionDetails(_customerId, subscriptionKey) {
          return detail({
            subscriptionKey,
            totalLicenses: 154,
            assignedLicenses: 154,
            unassignedLicenses: 0,
          });
        },
      },
    }),
    /No license decrease will be attempted/,
  );

  const preview = await refreshAppRiverLicenseCleanupCandidate(database, {
    actor: 'license@example.com',
    rowId,
    now,
    liveClient: {
      async getCustomerSubscriptionDetails(_customerId, subscriptionKey) {
        return detail({
          subscriptionKey,
          totalLicenses: 154,
          subscriptionQuantity: 19,
          assignedLicenses: 154,
          unassignedLicenses: 0,
        });
      },
    },
  });

  assert.equal(preview?.status, 'matched');
  assert.equal(preview?.candidate.totalLicenses, 19);
  assert.equal(preview?.candidate.assignedLicenses, 19);
  assert.equal(preview?.candidate.proposedQuantity, 19);
  assert.equal(preview?.candidate.refresh?.initialTotalLicenses, 21);
  assert.equal(preview?.candidate.refresh?.quantitySource, 'subscription');
}

async function testScheduledCancellationIsNotQueued() {
  const database = new CleanupDatabase([
    snapshot('canceling', {
      commitmentEndDate: '2026-07-20T00:00:00Z',
      totalLicenses: 4,
      assignedLicenses: 2,
      unassignedLicenses: 2,
      expirationBehavior: 'None',
    }),
  ]);

  const result = await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:canceling'],
    now,
  });

  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(database.actions.length, 0);
}

async function testReportEligibility() {
  const database = new CleanupDatabase([
    snapshot('upcoming', { commitmentEndDate: '2026-07-20T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
    snapshot('canceling', { commitmentEndDate: '2026-07-20T00:00:00Z', totalLicenses: 4, assignedLicenses: 2, unassignedLicenses: 2, expirationBehavior: 'None' }),
    snapshot('recent-current', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 8, assignedLicenses: 6, unassignedLicenses: 2 }),
    snapshot('recent-annual', { commitmentEndDate: '2027-07-14T00:00:00Z', totalLicenses: 12, assignedLicenses: 10, unassignedLicenses: 2, subscriptionTerm: 'Annual' }),
    snapshot('recent-order', { commitmentEndDate: '2026-12-31T00:00:00Z', totalLicenses: 10, assignedLicenses: 5, unassignedLicenses: 5 }),
    snapshot('no-unassigned', { commitmentEndDate: '2026-07-20T00:00:00Z', totalLicenses: 5, assignedLicenses: 5, unassignedLicenses: 0 }),
    snapshot('floor', { commitmentEndDate: '2026-07-20T00:00:00Z', totalLicenses: 2, assignedLicenses: 0, unassignedLicenses: 5 }),
    {
      ...snapshot('verified-result', { commitmentEndDate: '2026-07-20T00:00:00Z', totalLicenses: 9, assignedLicenses: 7, unassignedLicenses: 2 }),
      latest_action_id: 'cccccccc-cccc-4ccc-8ccc-999999999999',
      latest_action_status: 'verified',
      latest_requested_quantity: 7,
      latest_requested_reduction: 2,
      latest_final_quantity: 7,
      latest_created_at: '2026-07-15T12:05:00.000Z',
      latest_completed_at: '2026-07-15T12:06:00.000Z',
      latest_updated_at: '2026-07-15T12:06:00.000Z',
    },
  ]);

  const report = await listAppRiverLicenseCleanupCandidates(database, {
    chargeEvents: [
      chargeEvent({
        customerName: 'Mapped Client',
        productName: 'Recent Order Product',
        quantity: 10,
        previousQuantity: 8,
        effectiveDate: '2026-07-13T00:00:00Z',
      }),
    ],
    now,
  });

  const bySubscription = new Map(report.rows.map((row) => [row.subscriptionKey, row]));
  assert.equal(report.rows.length, 5);
  assert.equal(bySubscription.get('upcoming'), undefined);
  assert.equal(bySubscription.get('canceling')?.skipReason, 'ScheduledCancellation');
  assert.equal(bySubscription.get('canceling')?.proposedReduction, 0);
  assert.equal(bySubscription.get('recent-current')?.renewalWindow, 'Recent');
  assert.equal(bySubscription.get('recent-annual')?.previousCommitmentEndDate, '2026-07-14');
  assert.equal(bySubscription.get('recent-annual')?.renewalWindow, 'Recent');
  assert.equal(bySubscription.get('recent-order')?.eligibilityReason, 'RecentOrder');
  assert.equal(bySubscription.get('recent-order')?.proposedReduction, 2);
  assert.equal(bySubscription.get('no-unassigned'), undefined);
  assert.equal(bySubscription.get('floor'), undefined);
  assert.equal(bySubscription.get('verified-result')?.latestAction?.status, 'verified');
  assert.equal(bySubscription.get('verified-result')?.totalLicenses, 7);
  assert.equal(bySubscription.get('verified-result')?.unassignedLicenses, 0);
  assert.equal(bySubscription.get('verified-result')?.proposedReduction, 0);
}

async function testQueueDuplicatePrevention() {
  const database = new CleanupDatabase([
    snapshot('decrease-now', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
  ]);
  const rowId = 'appriver-license-cleanup:cust-1:decrease-now';

  const first = await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: [rowId],
    now,
  });
  assert.equal(first.queued, 1);
  assert.equal(database.actions.length, 1);

  const duplicate = await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: [rowId],
    now,
  });
  assert.equal(duplicate.queued, 0);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(database.actions.length, 1);
}

async function testQueueRefreshesLiveSubscriptionDetails() {
  const database = new CleanupDatabase([
    snapshot('decrease-now', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
  ]);
  const liveCalls: Array<{ customerId: string; subscriptionKey: string }> = [];

  const result = await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:decrease-now'],
    now,
    liveClient: {
      async getCustomerSubscriptionDetails(customerId, subscriptionKey) {
        liveCalls.push({ customerId, subscriptionKey });
        return detail({
          subscriptionKey,
          totalLicenses: 12,
          subscriptionQuantity: 12,
          assignedLicenses: 8,
          unassignedLicenses: 4,
          commitmentEndDate: '2026-07-14T00:00:00Z',
        });
      },
    },
  });

  assert.equal(result.queued, 1);
  assert.deepEqual(liveCalls, [{ customerId: 'cust-1', subscriptionKey: 'decrease-now' }]);
  assert.equal(database.actions[0]?.current_total_licenses, 12);
  assert.equal(database.actions[0]?.current_unassigned_licenses, 4);
  assert.equal(database.actions[0]?.requested_reduction, 4);
  assert.equal(database.actions[0]?.requested_quantity, 8);
}

async function testListAndCancelQueuedAction() {
  const database = new CleanupDatabase([
    snapshot('decrease-now', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:decrease-now'],
    now,
  });

  const before = await listAppRiverLicenseCleanupActions(database);
  assert.equal(before.actions.length, 1);
  assert.equal(before.actions[0]?.status, 'queued');
  assert.equal(before.actions[0]?.canCancel, true);

  const result = await cancelAppRiverLicenseCleanupAction(database, {
    actionId: before.actions[0]?.id ?? '',
    actor: 'license@example.com',
    now,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.action?.status, 'cancelled');
  assert.equal(result.action?.canCancel, false);

  const after = await listAppRiverLicenseCleanupActions(database);
  assert.equal(after.actions[0]?.status, 'cancelled');
}

async function testDismissCanceledAction() {
  const database = new CleanupDatabase([
    snapshot('decrease-now', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 7, unassignedLicenses: 3 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:decrease-now'],
    now,
  });

  const actionId = (await listAppRiverLicenseCleanupActions(database)).actions[0]?.id ?? '';
  await cancelAppRiverLicenseCleanupAction(database, {
    actionId,
    actor: 'license@example.com',
    now,
  });

  const result = await dismissAppRiverLicenseCleanupAction(database, {
    actionId,
    actor: 'license@example.com',
    now: '2026-07-15T12:01:00.000Z',
  });
  assert.equal(result.dismissed, true);
  assert.equal(result.action?.status, 'cancelled');
  assert.equal(result.action?.canDismiss, false);
  assert.equal(result.action?.dismissedBy, 'license@example.com');

  const after = await listAppRiverLicenseCleanupActions(database);
  assert.equal(after.actions.length, 0);
}

async function testLiveRevalidationAndVerification() {
  const database = new CleanupDatabase([
    snapshot('decrease-now', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:decrease-now'],
    now,
  });

  const requestedCounts: number[] = [];
  const liveDetails = [
    detail({ subscriptionKey: 'decrease-now', totalLicenses: 10, subscriptionQuantity: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
    detail({ subscriptionKey: 'decrease-now', totalLicenses: 8, subscriptionQuantity: 8, assignedLicenses: 8, unassignedLicenses: 0 }),
  ];
  const client: AppRiverLicenseCleanupClient = {
    async getCustomerSubscriptionDetails() {
      const next = liveDetails.shift();
      assert.ok(next, 'Expected live AppRiver detail call');
      return next;
    },
    async listChargeEvents() {
      return [];
    },
    async setCustomerSubscriptionLicenseCount(_customerId, _subscriptionKey, licenseCount) {
      requestedCounts.push(licenseCount);
      return { accepted: true, endpoint: 'https://example.test/subscription' };
    },
  };

  const result = await processNextAppRiverLicenseCleanupAction({
    database,
    client,
    batchId: database.batchIds[0],
    now,
  });
  assert.equal(result.status, 'processed');
  assert.deepEqual(requestedCounts, [8]);
  assert.equal(database.actions[0]?.status, 'confirm');

  const confirmation = await processNextAppRiverLicenseCleanupAction({
    database,
    client,
    batchId: database.batchIds[0],
    now: '2026-07-15T12:01:01.000Z',
  });
  assert.equal(confirmation.status, 'processed');
  assert.equal(database.actions[0]?.status, 'verified');
}

async function testChangedCountsNeedReview() {
  const database = new CleanupDatabase([
    snapshot('changed-counts', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:changed-counts'],
    now,
  });

  let updateCalls = 0;
  const client: AppRiverLicenseCleanupClient = {
    async getCustomerSubscriptionDetails() {
      return detail({ subscriptionKey: 'changed-counts', totalLicenses: 11, subscriptionQuantity: 11, assignedLicenses: 8, unassignedLicenses: 3 });
    },
    async listChargeEvents() {
      return [];
    },
    async setCustomerSubscriptionLicenseCount() {
      updateCalls += 1;
      return { accepted: true, endpoint: 'https://example.test/subscription' };
    },
  };

  await processNextAppRiverLicenseCleanupAction({ database, client, now });
  assert.equal(updateCalls, 0);
  assert.equal(database.actions[0]?.status, 'needs_review');
  assert.equal(database.actions[0]?.live_total_licenses, 11);
  assert.match(database.actions[0]?.error_message ?? '', /Total licenses changed from 10 to 11/);
  assert.ok(database.calls.some((call) => call.sql.includes('insert into audit_events')));
}

async function testAmbiguousUpdateTimeoutMovesToConfirm() {
  const database = new CleanupDatabase([
    snapshot('ambiguous-timeout', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: ['appriver-license-cleanup:cust-1:ambiguous-timeout'],
    now,
  });

  const client: AppRiverLicenseCleanupClient = {
    async getCustomerSubscriptionDetails() {
      return detail({ subscriptionKey: 'ambiguous-timeout', totalLicenses: 10, subscriptionQuantity: 10, assignedLicenses: 8, unassignedLicenses: 2 });
    },
    async listChargeEvents() {
      return [];
    },
    async setCustomerSubscriptionLicenseCount() {
      throw new Error('The AppRiver request timed out; check back to see if it completes.');
    },
  };

  const result = await processNextAppRiverLicenseCleanupAction({ database, client, now });
  assert.equal(result.status, 'processed');
  assert.equal(database.actions[0]?.status, 'confirm');
}

async function testQueuedUpdatesFinishBeforeConfirmation() {
  const database = new CleanupDatabase([
    snapshot('first-update', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 10, assignedLicenses: 8, unassignedLicenses: 2 }),
    snapshot('second-update', { commitmentEndDate: '2026-07-14T00:00:00Z', totalLicenses: 6, assignedLicenses: 5, unassignedLicenses: 1 }),
  ]);
  await queueAppRiverLicenseCleanupActions(database, {
    actor: 'license@example.com',
    rowIds: [
      'appriver-license-cleanup:cust-1:first-update',
      'appriver-license-cleanup:cust-1:second-update',
    ],
    now,
  });

  const quantities = new Map([
    ['first-update', 10],
    ['second-update', 6],
  ]);
  const updateOrder: string[] = [];
  const client: AppRiverLicenseCleanupClient = {
    async getCustomerSubscriptionDetails(_customerId, subscriptionKey) {
      const total = quantities.get(subscriptionKey) ?? 0;
      const assigned = subscriptionKey === 'first-update' ? 8 : 5;
      return detail({
        subscriptionKey,
        totalLicenses: total,
        subscriptionQuantity: total,
        assignedLicenses: assigned,
        unassignedLicenses: Math.max(total - assigned, 0),
      });
    },
    async listChargeEvents() {
      return [];
    },
    async setCustomerSubscriptionLicenseCount(_customerId, subscriptionKey, licenseCount) {
      updateOrder.push(subscriptionKey);
      quantities.set(subscriptionKey, licenseCount);
      return { accepted: true, endpoint: 'https://example.test/subscription' };
    },
  };

  await processNextAppRiverLicenseCleanupAction({ database, client, now });
  assert.deepEqual(database.actions.map((action) => action.status), ['confirm', 'queued']);

  await processNextAppRiverLicenseCleanupAction({ database, client, now });
  assert.deepEqual(database.actions.map((action) => action.status), ['confirm', 'confirm']);
  assert.deepEqual(updateOrder, ['first-update', 'second-update']);

  await processNextAppRiverLicenseCleanupAction({ database, client, now: '2026-07-15T12:01:01.000Z' });
  assert.deepEqual(database.actions.map((action) => action.status), ['verified', 'confirm']);
}

async function testVerificationTimeout() {
  const database = new CleanupDatabase();
  database.batchIds.push('bbbbbbbb-bbbb-4bbb-8bbb-000000000001');
  database.actions.push({
    id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    batch_id: database.batchIds[0],
    customer_id: customerId,
    customer_name: 'Mapped Client',
    external_customer_id: 'cust-1',
    vendor_product_key: 'timeout-product',
    product_code: 'TIMEOUT',
    product_name: 'Timeout Product',
    subscription_key: 'timeout',
    domain: null,
    status: 'confirm',
    current_total_licenses: 10,
    current_assigned_licenses: 8,
    current_unassigned_licenses: 2,
    requested_reduction: 2,
    requested_quantity: 8,
    attempts: 0,
    verification_attempts: 1,
    next_check_at: '2026-07-15T12:31:00.000Z',
    expires_at: '2026-07-15T12:30:00.000Z',
    created_at: now,
    updated_at: now,
    request_payload: {},
  });

  const client: AppRiverLicenseCleanupClient = {
    async getCustomerSubscriptionDetails() {
      return detail({ subscriptionKey: 'timeout', totalLicenses: 10, subscriptionQuantity: 10, assignedLicenses: 8, unassignedLicenses: 2 });
    },
    async listChargeEvents() {
      return [];
    },
    async setCustomerSubscriptionLicenseCount() {
      throw new Error('No patch expected while timing out verification.');
    },
  };

  const result = await processNextAppRiverLicenseCleanupAction({
    database,
    client,
    batchId: database.batchIds[0],
    now: '2026-07-15T12:31:00.000Z',
  });
  assert.equal(result.status, 'processed');
  assert.equal(database.actions[0]?.status, 'failed');
  assert.match(database.actions[0]?.error_message ?? '', /did not report 8/);
}

function snapshot(
  subscriptionKey: string,
  input: {
    commitmentEndDate: string;
    totalLicenses: number;
    subscriptionQuantity?: number;
    assignedLicenses: number;
    unassignedLicenses: number;
    subscriptionTerm?: string;
    expirationBehavior?: string;
  },
): SnapshotRow {
  const productName = subscriptionKey === 'recent-order' ? 'Recent Order Product' : `${subscriptionKey} Product`;
  return {
    id: `snapshot-${subscriptionKey}`,
    customer_id: customerId,
    connectwise_company_id: 'cw-101',
    customer_name: 'Mapped Client',
    external_account_id: 'cust-1',
    vendor_product_key: `${subscriptionKey}-key`,
    product_code: subscriptionKey.toUpperCase(),
    product_name: productName,
    quantity: input.subscriptionQuantity ?? input.totalLicenses,
    observed_at: '2026-07-15T11:45:00.000Z',
    dimensions: {
      subscriptionKey,
      productName,
      totalLicenses: input.totalLicenses,
      subscriptionQuantity: input.subscriptionQuantity ?? input.totalLicenses,
      assignedLicenses: input.assignedLicenses,
      unassignedLicenses: input.unassignedLicenses,
      commitmentEndDate: input.commitmentEndDate,
      subscriptionTerm: input.subscriptionTerm ?? 'Annual',
      billingFrequency: 'Monthly',
      expirationBehavior: input.expirationBehavior ?? 'AutoRenew',
      domain: `${subscriptionKey}.example`,
    },
    pending_action_id: null,
    pending_action_status: null,
    pending_requested_quantity: null,
    pending_requested_reduction: null,
    pending_created_at: null,
    latest_action_id: null,
    latest_action_status: null,
    latest_requested_quantity: null,
    latest_requested_reduction: null,
    latest_final_quantity: null,
    latest_error_message: null,
    latest_created_at: null,
    latest_completed_at: null,
    latest_updated_at: null,
  };
}

function chargeEvent(input: Omit<AppRiverChargeEvent, 'raw' | 'eventType'>): AppRiverChargeEvent {
  return {
    ...input,
    eventType: 'Adjustment',
    raw: {},
  };
}

function detail(input: Partial<AppRiverSubscriptionDetail> & { subscriptionKey: string }): AppRiverSubscriptionDetail {
  return {
    subscriptionKey: input.subscriptionKey,
    productName: input.productName ?? `${input.subscriptionKey} Product`,
    productCode: input.productCode ?? input.subscriptionKey.toUpperCase(),
    totalLicenses: input.totalLicenses,
    assignedLicenses: input.assignedLicenses,
    unassignedLicenses: input.unassignedLicenses,
    subscriptionQuantity: input.subscriptionQuantity,
    commitmentEndDate: input.commitmentEndDate ?? '2026-07-14T00:00:00Z',
    subscriptionTerm: input.subscriptionTerm ?? 'Annual',
    billingFrequency: input.billingFrequency ?? 'Monthly',
    domain: input.domain ?? `${input.subscriptionKey}.example`,
    raw: {},
  };
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
