import {
  AppRiverApiError,
  appRiverIntegrationId,
  appRiverLicenseQuantity,
  appRiverProductKeyForSubscription,
  fallbackAppRiverProductCode,
  type AppRiverChargeEvent,
  type AppRiverSubscriptionDetail,
  type AppRiverSubscriptionQuantityUpdateResult,
} from './client';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

type LockableQueryClient = Queryable & {
  release?: () => void;
};

export type LockableQueryable = Queryable & {
  connect?: () => Promise<LockableQueryClient>;
};

export type AppRiverLicenseCleanupClient = {
  getCustomerSubscriptionDetails: (customerId: string, subscriptionKey: string) => Promise<AppRiverSubscriptionDetail>;
  listChargeEvents: (options?: { pageSize?: number; maxPages?: number }) => Promise<AppRiverChargeEvent[]>;
  setCustomerSubscriptionLicenseCount: (
    customerId: string,
    subscriptionKey: string,
    licenseCount: number,
  ) => Promise<AppRiverSubscriptionQuantityUpdateResult>;
};

export type AppRiverLicenseCleanupSyncRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
};

export type AppRiverLicenseCleanupCandidate = {
  id: string;
  customerId?: string;
  connectWiseCompanyId?: string;
  customerName: string;
  externalCustomerId: string;
  vendorProductKey?: string;
  productCode: string;
  productName: string;
  subscriptionKey: string;
  domain?: string;
  totalLicenses: number;
  assignedLicenses?: number;
  unassignedLicenses: number;
  proposedReduction: number;
  proposedQuantity: number;
  eligibilityReason: 'Renewal' | 'RecentOrder' | 'Both';
  renewalWindow?: 'Upcoming' | 'Recent';
  daysFromRenewal?: number;
  daysUntilCommitmentEnd?: number;
  commitmentEndDate?: string;
  previousCommitmentEndDate?: string;
  effectiveDate?: string;
  availableLicensesToReduce?: number;
  subscriptionTerm?: string;
  billingFrequency?: string;
  expirationBehavior?: string;
  skipReason?: 'ScheduledCancellation';
  isTrial?: boolean;
  notes?: string;
  observedAt: string;
  syncTimestamp?: string;
  pendingAction?: {
    id: string;
    status: string;
    requestedQuantity: number;
    requestedReduction: number;
    createdAt: string;
  };
  latestAction?: {
    id: string;
    status: string;
    requestedQuantity: number;
    requestedReduction: number;
    finalQuantity?: number;
    errorMessage?: string;
    createdAt: string;
    completedAt?: string;
    updatedAt?: string;
  };
};

export type AppRiverLicenseCleanupReport = {
  syncRun?: AppRiverLicenseCleanupSyncRun;
  rows: AppRiverLicenseCleanupCandidate[];
};

export type QueueAppRiverLicenseCleanupResult = {
  batchId: string;
  status: string;
  requested: number;
  queued: number;
  skipped: number;
  missing: number;
  duplicates: number;
};

export type AppRiverLicenseCleanupPreviewStatus =
  | 'eligible'
  | 'matched'
  | 'scheduled-cancellation'
  | 'unavailable';

export type AppRiverLicenseCleanupPreview = {
  previewId: string;
  rowId: string;
  status: AppRiverLicenseCleanupPreviewStatus;
  changed: boolean;
  reason?: string;
  candidate: AppRiverLicenseCleanupCandidate;
};

export type AppRiverLicenseCleanupProcessResult = {
  status: 'idle' | 'processed' | 'waiting' | 'failed';
  shouldContinue: boolean;
  batchId?: string;
  actionId?: string;
  message?: string;
};

export type AppRiverLicenseCleanupActionSummary = {
  id: string;
  batchId: string;
  batchStatus: string;
  requestedBy: string;
  customerId?: string;
  customerName?: string;
  externalCustomerId: string;
  vendorProductKey?: string;
  productCode?: string;
  productName: string;
  subscriptionKey: string;
  domain?: string;
  status: string;
  currentTotalLicenses: number;
  currentAssignedLicenses?: number;
  currentUnassignedLicenses: number;
  requestedReduction: number;
  requestedQuantity: number;
  liveTotalLicenses?: number;
  liveAssignedLicenses?: number;
  liveUnassignedLicenses?: number;
  finalQuantity?: number;
  eligibilityReason?: string;
  renewalWindow?: string;
  effectiveDate?: string;
  commitmentEndDate?: string;
  previousCommitmentEndDate?: string;
  attempts: number;
  verificationAttempts: number;
  nextCheckAt: string;
  acceptedAt?: string;
  verifiedAt?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  errorMessage?: string;
  dismissedAt?: string;
  dismissedBy?: string;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  canDismiss: boolean;
};

export type AppRiverLicenseCleanupActionsReport = {
  actions: AppRiverLicenseCleanupActionSummary[];
};

export type CancelAppRiverLicenseCleanupActionResult = {
  cancelled: boolean;
  reason?: string;
  action?: AppRiverLicenseCleanupActionSummary;
};

export type DismissAppRiverLicenseCleanupActionResult = {
  dismissed: boolean;
  reason?: string;
  action?: AppRiverLicenseCleanupActionSummary;
};

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
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
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  pending_action_id: string | null;
  pending_action_status: string | null;
  pending_requested_quantity: string | number | null;
  pending_requested_reduction: string | number | null;
  pending_created_at: Date | string | null;
  latest_action_id: string | null;
  latest_action_status: string | null;
  latest_requested_quantity: string | number | null;
  latest_requested_reduction: string | number | null;
  latest_final_quantity: string | number | null;
  latest_error_message: string | null;
  latest_created_at: Date | string | null;
  latest_completed_at: Date | string | null;
  latest_updated_at: Date | string | null;
};

type BatchRow = {
  id: string;
};

type ExistingActionRow = {
  id: string;
  status: string;
};

type CleanupPreviewRow = {
  id: string;
  entity_id: string;
  payload: unknown;
};

type SavedCleanupCandidateRow = {
  cleanup: unknown;
};

type CleanupActionRow = {
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
  current_total_licenses: string | number;
  current_assigned_licenses: string | number | null;
  current_unassigned_licenses: string | number;
  requested_reduction: string | number;
  requested_quantity: string | number;
  attempts: string | number;
  verification_attempts: string | number;
  expires_at: Date | string;
  request_payload: unknown;
  previous_status: string;
};

type CleanupActionSummaryRow = {
  id: string;
  batch_id: string;
  batch_status: string;
  requested_by: string;
  customer_id: string | null;
  customer_name: string | null;
  external_customer_id: string;
  vendor_product_key: string | null;
  product_code: string | null;
  product_name: string;
  subscription_key: string;
  domain: string | null;
  status: string;
  current_total_licenses: string | number;
  current_assigned_licenses: string | number | null;
  current_unassigned_licenses: string | number;
  requested_reduction: string | number;
  requested_quantity: string | number;
  live_total_licenses: string | number | null;
  live_assigned_licenses: string | number | null;
  live_unassigned_licenses: string | number | null;
  final_quantity: string | number | null;
  eligibility_reason: string | null;
  renewal_window: string | null;
  effective_date: Date | string | null;
  commitment_end_date: Date | string | null;
  previous_commitment_end_date: Date | string | null;
  attempts: string | number;
  verification_attempts: string | number;
  next_check_at: Date | string;
  accepted_at: Date | string | null;
  verified_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  expires_at: Date | string;
  error_message: string | null;
  dismissed_at: Date | string | null;
  dismissed_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type CancelledActionRow = {
  id: string;
  batch_id: string;
};

type DismissedActionRow = {
  id: string;
};

type BatchCountRow = {
  total_count: string | number;
  queued_count: string | number;
  running_count: string | number;
  reviewing_count: string | number;
  updating_count: string | number;
  confirm_count: string | number;
  skipped_count: string | number;
  verified_count: string | number;
  needs_review_count: string | number;
  failed_count: string | number;
  timed_out_count: string | number;
};

type DueCountRow = {
  due_count: string | number;
};

type ChargeIncrease = {
  effectiveDate: Date;
  previousQuantity: number;
  addedLicenses: number;
};

type ChargeIncreaseIndex = Map<string, ChargeIncrease>;

type CandidateSource = {
  id: string;
  customerId?: string;
  connectWiseCompanyId?: string;
  customerName: string;
  externalCustomerId: string;
  vendorProductKey?: string;
  productCode?: string;
  productName?: string;
  subscriptionKey: string;
  domain?: string;
  totalLicenses: number;
  assignedLicenses?: number;
  unassignedLicenses: number;
  commitmentEndDate?: string;
  subscriptionTerm?: string;
  billingFrequency?: string;
  expirationBehavior?: string;
  subscriptionStatus?: string;
  cancellationDate?: string;
  scheduledUninstallDate?: string;
  isTrial?: boolean;
  notes?: string;
  observedAt: string;
  syncTimestamp?: string;
  pendingAction?: AppRiverLicenseCleanupCandidate['pendingAction'];
  latestAction?: AppRiverLicenseCleanupCandidate['latestAction'];
};

const activeActionStatuses = ['queued', 'running', 'reviewing', 'updating', 'confirm'];
const defaultWindowDays = 7;
const verificationDelayMs = 60_000;
const appRiverWorkerLockKey = 'msp-harmony:opentext-appriver:sync-worker';

export async function listAppRiverLicenseCleanupCandidates(
  database: Queryable,
  input: {
    chargeEvents?: AppRiverChargeEvent[];
    now?: string;
    windowDays?: number;
  } = {},
): Promise<AppRiverLicenseCleanupReport> {
  const syncRun = await loadLatestAppRiverSyncRun(database);
  if (!syncRun) {
    return {
      rows: [],
    };
  }

  const snapshotRows = await loadLatestAppRiverSnapshotRows(database, syncRun.id);
  const now = input.now ?? new Date().toISOString();
  const chargeIndex = buildChargeIncreaseIndex(input.chargeEvents ?? [], now, input.windowDays ?? defaultWindowDays);
  const rows = snapshotRows
    .map((row) => candidateFromSource(sourceFromSnapshotRow(row, syncRun), chargeIndex, now, input.windowDays ?? defaultWindowDays))
    .filter((row): row is AppRiverLicenseCleanupCandidate => Boolean(row))
    .sort(compareCleanupCandidates);

  return {
    syncRun,
    rows,
  };
}

export async function queueAppRiverLicenseCleanupActions(
  database: Queryable,
  input: {
    actor: string;
    rowIds: string[];
    requestedQuantities?: Record<string, number>;
    chargeEvents?: AppRiverChargeEvent[];
    liveClient?: Pick<AppRiverLicenseCleanupClient, 'getCustomerSubscriptionDetails'>;
    now?: string;
  },
): Promise<QueueAppRiverLicenseCleanupResult> {
  const now = input.now ?? new Date().toISOString();
  const uniqueRowIds = [...new Set(input.rowIds.map((id) => id.trim()).filter(Boolean))];
  const report = await listAppRiverLicenseCleanupCandidates(database, {
    chargeEvents: input.chargeEvents,
    now,
  });
  const candidatesById = new Map(report.rows.map((row) => [row.id, row]));
  const chargeIndex = buildChargeIncreaseIndex(input.chargeEvents ?? [], now, defaultWindowDays);
  const batchId = await createCleanupBatch(database, {
    actor: input.actor,
    requestedCount: uniqueRowIds.length,
    now,
  });

  let queued = 0;
  let skipped = 0;
  let missing = 0;
  let duplicates = 0;

  for (const rowId of uniqueRowIds) {
    const candidate = candidatesById.get(rowId);
    if (!candidate) {
      missing += 1;
      continue;
    }

    const existing = await findActiveCleanupAction(database, candidate.externalCustomerId, candidate.subscriptionKey);
    if (existing) {
      duplicates += 1;
      continue;
    }

    const liveCandidate = input.liveClient
      ? await liveCandidateForQueue(input.liveClient, candidate, chargeIndex, now)
      : candidate;
    if (!liveCandidate) {
      skipped += 1;
      continue;
    }

    if (liveCandidate.skipReason || liveCandidate.proposedReduction <= 0) {
      skipped += 1;
      continue;
    }

    const requestedQuantity = input.requestedQuantities?.[rowId];
    const queuedCandidate =
      typeof requestedQuantity === 'number'
        ? candidateWithRequestedQuantity(liveCandidate, requestedQuantity)
        : liveCandidate;
    if (!queuedCandidate) {
      skipped += 1;
      continue;
    }

    try {
      await insertCleanupAction(database, batchId, queuedCandidate, now);
      queued += 1;
    } catch (error) {
      if (isUniqueViolation(error)) {
        duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  skipped += missing + duplicates;
  await updateCleanupBatchAfterQueue(database, batchId, {
    status: queued > 0 ? 'queued' : 'skipped',
    queued,
    skipped,
    now,
  });

  await insertAuditEvent(database, {
    actor: input.actor,
    eventType: 'appriver.license-cleanup.batch.queued',
    entityType: 'appriver_license_cleanup_batch',
    entityId: batchId,
    payload: {
      requested: uniqueRowIds.length,
      queued,
      missing,
      duplicates,
    },
  });

  return {
    batchId,
    status: queued > 0 ? 'queued' : 'skipped',
    requested: uniqueRowIds.length,
    queued,
    skipped,
    missing,
    duplicates,
  };
}

export async function refreshAppRiverLicenseCleanupCandidate(
  database: Queryable,
  input: {
    actor: string;
    rowId: string;
    chargeEvents?: AppRiverChargeEvent[];
    liveClient: Pick<AppRiverLicenseCleanupClient, 'getCustomerSubscriptionDetails'>;
    now?: string;
  },
): Promise<AppRiverLicenseCleanupPreview | undefined> {
  const now = input.now ?? new Date().toISOString();
  const report = await listAppRiverLicenseCleanupCandidates(database, {
    chargeEvents: input.chargeEvents,
    now,
  });
  const snapshotCandidate =
    report.rows.find((row) => row.id === input.rowId) ??
    (await loadSavedAuditCleanupCandidate(database, input.rowId));
  if (!snapshotCandidate) {
    return undefined;
  }

  const chargeIndex = buildChargeIncreaseIndex(input.chargeEvents ?? [], now, defaultWindowDays);
  const detail = await input.liveClient.getCustomerSubscriptionDetails(
    snapshotCandidate.externalCustomerId,
    snapshotCandidate.subscriptionKey,
  );
  const liveSource = liveSourceForCandidate(snapshotCandidate, detail, now);
  const evaluatedCandidate = candidateFromSource(liveSource, chargeIndex, now, defaultWindowDays);
  const candidate = evaluatedCandidate ?? candidateFromIneligibleLiveSource(snapshotCandidate, liveSource);
  const status: AppRiverLicenseCleanupPreviewStatus =
    candidate.unassignedLicenses <= 0
      ? 'matched'
      : candidate.skipReason === 'ScheduledCancellation'
        ? 'scheduled-cancellation'
        : evaluatedCandidate && evaluatedCandidate.proposedReduction > 0
          ? 'eligible'
          : 'unavailable';
  const reason =
    status === 'matched'
      ? 'The refreshed AppRiver count already matches assigned usage.'
      : status === 'scheduled-cancellation'
        ? 'This subscription is scheduled to cancel, so no decrease will be queued.'
        : status === 'unavailable'
          ? 'This subscription is no longer eligible for a decrease.'
          : undefined;
  const changed =
    candidate.totalLicenses !== snapshotCandidate.totalLicenses ||
    candidate.assignedLicenses !== snapshotCandidate.assignedLicenses ||
    candidate.unassignedLicenses !== snapshotCandidate.unassignedLicenses;
  const previewId = await saveCleanupPreview(database, {
    actor: input.actor,
    rowId: input.rowId,
    now,
    payload: { status, reason, candidate },
  });

  return {
    previewId,
    rowId: input.rowId,
    status,
    changed,
    reason,
    candidate,
  };
}

export async function queueAppRiverLicenseCleanupPreview(
  database: Queryable,
  input: {
    actor: string;
    previewId: string;
    rowId: string;
    requestedQuantity: number;
    now?: string;
  },
): Promise<QueueAppRiverLicenseCleanupResult> {
  const now = input.now ?? new Date().toISOString();
  const preview = await loadCleanupPreview(database, input.previewId, input.actor, now);
  if (!preview || preview.rowId !== input.rowId || preview.status !== 'eligible') {
    throw new Error('The refreshed AppRiver preview is missing, expired, or no longer eligible. Refresh the count and try again.');
  }

  const queuedCandidate = candidateWithRequestedQuantity(preview.candidate, input.requestedQuantity);
  if (!queuedCandidate) {
    throw new Error('The requested decrease must leave a count below the refreshed total and at or above assigned usage.');
  }

  const existing = await findActiveCleanupAction(
    database,
    queuedCandidate.externalCustomerId,
    queuedCandidate.subscriptionKey,
  );
  const batchId = await createCleanupBatch(database, {
    actor: input.actor,
    requestedCount: 1,
    now,
  });
  let queued = 0;
  let duplicates = 0;
  if (existing) {
    duplicates = 1;
  } else {
    try {
      await insertCleanupAction(database, batchId, queuedCandidate, now);
      queued = 1;
    } catch (error) {
      if (isUniqueViolation(error)) {
        duplicates = 1;
      } else {
        throw error;
      }
    }
  }
  const skipped = duplicates;
  await updateCleanupBatchAfterQueue(database, batchId, {
    status: queued ? 'queued' : 'skipped',
    queued,
    skipped,
    now,
  });
  await insertAuditEvent(database, {
    actor: input.actor,
    eventType: 'appriver.license-cleanup.batch.queued',
    entityType: 'appriver_license_cleanup_batch',
    entityId: batchId,
    payload: { requested: 1, queued, missing: 0, duplicates, previewId: input.previewId },
  });

  return {
    batchId,
    status: queued ? 'queued' : 'skipped',
    requested: 1,
    queued,
    skipped,
    missing: 0,
    duplicates,
  };
}

export async function listAppRiverLicenseCleanupActions(
  database: Queryable,
  input: {
    limit?: number;
  } = {},
): Promise<AppRiverLicenseCleanupActionsReport> {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 200), 500));
  const result = await database.query<CleanupActionSummaryRow>(
    `${cleanupActionSummarySelectSql()}
     where appriver_license_cleanup_actions.dismissed_at is null
     order by
       case appriver_license_cleanup_actions.status
         when 'queued' then 0
         when 'running' then 1
         when 'reviewing' then 2
         when 'updating' then 3
         when 'confirm' then 4
         when 'needs_review' then 5
         else 6
       end,
       appriver_license_cleanup_actions.created_at desc
     limit $1`,
    [limit],
  );

  return {
    actions: result.rows.map(mapCleanupActionSummaryRow),
  };
}

export async function dismissAppRiverLicenseCleanupAction(
  database: Queryable,
  input: {
    actionId: string;
    actor: string;
    now?: string;
  },
): Promise<DismissAppRiverLicenseCleanupActionResult> {
  const now = input.now ?? new Date().toISOString();
  const existing = await loadCleanupActionSummary(database, input.actionId);
  if (!existing) {
    return {
      dismissed: false,
      reason: 'Action was not found.',
    };
  }

  if (!existing.canDismiss) {
    return {
      dismissed: false,
      reason: existing.dismissedAt
        ? 'This canceled action has already been dismissed.'
        : `Only canceled actions can be dismissed. Current status is ${existing.status}.`,
      action: existing,
    };
  }

  const result = await database.query<DismissedActionRow>(
    `update appriver_license_cleanup_actions
     set dismissed_at = $2::timestamptz,
         dismissed_by = $3,
         updated_at = $2::timestamptz
     where id = $1::uuid
       and status = 'cancelled'
       and dismissed_at is null
     returning id`,
    [input.actionId, now, input.actor],
  );
  if (!result.rows[0]) {
    const current = await loadCleanupActionSummary(database, input.actionId);
    return {
      dismissed: false,
      reason: current?.dismissedAt
        ? 'This canceled action has already been dismissed.'
        : current
          ? `Action changed before dismissal could be saved. Current status is ${current.status}.`
          : 'Action was not found.',
      action: current,
    };
  }

  await insertAuditEvent(database, {
    actor: input.actor,
    eventType: 'appriver.license-cleanup.action.dismissed',
    entityType: 'appriver_license_cleanup_action',
    entityId: input.actionId,
    payload: {
      dismissedAt: now,
    },
  });

  return {
    dismissed: true,
    action: await loadCleanupActionSummary(database, input.actionId),
  };
}

export async function cancelAppRiverLicenseCleanupAction(
  database: Queryable,
  input: {
    actionId: string;
    actor: string;
    now?: string;
  },
): Promise<CancelAppRiverLicenseCleanupActionResult> {
  const now = input.now ?? new Date().toISOString();
  const existing = await loadCleanupActionSummary(database, input.actionId);
  if (!existing) {
    return {
      cancelled: false,
      reason: 'Action was not found.',
    };
  }

  if (!existing.canCancel) {
    return {
      cancelled: false,
      reason: `Only queued actions that have not started can be canceled. Current status is ${existing.status}.`,
      action: existing,
    };
  }

  const result = await database.query<CancelledActionRow>(
    `update appriver_license_cleanup_actions
     set status = 'cancelled',
         completed_at = $2::timestamptz,
         error_message = coalesce(error_message, $3),
         response_payload = response_payload || $4::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid
       and status = 'queued'
       and started_at is null
     returning id, batch_id`,
    [
      input.actionId,
      now,
      `Canceled by ${input.actor}.`,
      JSON.stringify({
        cancelledBy: input.actor,
        cancelledAt: now,
      }),
    ],
  );
  const cancelled = result.rows[0];
  if (!cancelled) {
    const current = await loadCleanupActionSummary(database, input.actionId);
    return {
      cancelled: false,
      reason: current
        ? `Action changed before cancellation could be saved. Current status is ${current.status}.`
        : 'Action was not found.',
      action: current,
    };
  }

  await refreshCleanupBatch(database, cancelled.batch_id, now);
  await insertAuditEvent(database, {
    actor: input.actor,
    eventType: 'appriver.license-cleanup.action.cancelled',
    entityType: 'appriver_license_cleanup_action',
    entityId: input.actionId,
    payload: {
      batchId: cancelled.batch_id,
    },
  });

  return {
    cancelled: true,
    action: await loadCleanupActionSummary(database, input.actionId),
  };
}

export async function processNextAppRiverLicenseCleanupAction(input: {
  database: LockableQueryable;
  client: AppRiverLicenseCleanupClient;
  batchId?: string;
  now?: string;
}): Promise<AppRiverLicenseCleanupProcessResult> {
  const now = input.now ?? new Date().toISOString();
  return withAppRiverCleanupWorkerLock<AppRiverLicenseCleanupProcessResult>(
    input.database,
    () => ({ status: 'waiting', shouldContinue: false, batchId: input.batchId }),
    (database) => processNextAppRiverLicenseCleanupActionLocked(database, input.client, now, input.batchId),
  );
}

async function processNextAppRiverLicenseCleanupActionLocked(
  database: Queryable,
  client: AppRiverLicenseCleanupClient,
  now: string,
  requestedBatchId?: string,
): Promise<AppRiverLicenseCleanupProcessResult> {
  const action = await claimNextCleanupAction(database, now);
  if (!action) {
    if (requestedBatchId) {
      await refreshCleanupBatch(database, requestedBatchId, now);
    }
    return {
      status: 'idle',
      shouldContinue: false,
      batchId: requestedBatchId,
    };
  }

  try {
    if (action.previous_status === 'confirm') {
      await verifyCleanupAction(database, client, action, now);
    } else if (action.previous_status === 'updating') {
      await markCleanupActionConfirm(database, action.id, now, {
        recovery: 'The prior worker stopped after entering Updating. The update will be confirmed without sending it again.',
      });
    } else {
      await applyCleanupAction(database, client, action, now);
    }
    await refreshCleanupBatch(database, action.batch_id, now);
    return processedResult(database, action, now);
  } catch (error) {
    const message = errorMessage(error);
    await markCleanupActionFailed(database, action.id, now, message);
    await refreshCleanupBatch(database, action.batch_id, now);
    return {
      status: 'failed',
      shouldContinue: await hasDueCleanupAction(database, now),
      batchId: action.batch_id,
      actionId: action.id,
      message,
    };
  }
}

async function withAppRiverCleanupWorkerLock<T>(
  database: LockableQueryable,
  onLocked: () => T | Promise<T>,
  action: (database: Queryable) => Promise<T>,
) {
  if (!database.connect) {
    return action(database);
  }

  const client = await database.connect();
  try {
    const lockResult = await client.query<{ acquired: boolean | string }>(
      `select pg_try_advisory_lock(hashtext($1)) as acquired`,
      [appRiverWorkerLockKey],
    );
    if (!booleanValue(lockResult.rows[0]?.acquired)) {
      return onLocked();
    }

    try {
      return await action(client);
    } finally {
      await client.query(`select pg_advisory_unlock(hashtext($1))`, [appRiverWorkerLockKey]);
    }
  } finally {
    client.release?.();
  }
}

async function applyCleanupAction(
  database: Queryable,
  client: AppRiverLicenseCleanupClient,
  action: CleanupActionRow,
  now: string,
) {
  await markCleanupActionReviewing(database, action.id, now);
  const detail = await client.getCustomerSubscriptionDetails(action.external_customer_id, action.subscription_key);
  const liveSource = sourceFromLiveDetail(action, detail, now);
  const reviewChanges = cleanupReviewChanges(action, liveSource);
  if (reviewChanges.length > 0) {
    await markCleanupActionNeedsReview(database, action, now, liveSource, detail, reviewChanges);
    return;
  }

  if (isScheduledForCancellation(liveSource)) {
    await markCleanupActionNeedsReview(database, action, now, liveSource, detail, [
      'The live AppRiver subscription is now scheduled to cancel at the end of its term.',
    ]);
    return;
  }

  const requestedQuantity = integerValue(action.requested_quantity);
  if (liveSource.totalLicenses === requestedQuantity) {
    await markCleanupActionVerified(database, action.id, now, {
      liveCandidate: liveSource,
      message: 'The subscription already has the requested quantity.',
    });
    return;
  }

  if (requestedQuantity < 1 || requestedQuantity >= liveSource.totalLicenses) {
    await markCleanupActionNeedsReview(database, action, now, liveSource, detail, [
      `The requested quantity ${requestedQuantity} is no longer a valid decrease from ${liveSource.totalLicenses}.`,
    ]);
    return;
  }

  await markCleanupActionUpdating(database, action.id, now, liveSource, detail);
  try {
    const updateResult = await client.setCustomerSubscriptionLicenseCount(
      action.external_customer_id,
      action.subscription_key,
      requestedQuantity,
    );
    await markCleanupActionConfirm(database, action.id, now, {
      requestedQuantity,
      liveCandidate: liveSource,
      updateResult,
    });
  } catch (error) {
    if (isAmbiguousAppRiverUpdateError(error)) {
      await markCleanupActionConfirm(database, action.id, now, {
        requestedQuantity,
        liveCandidate: liveSource,
        updateResponse: 'AppRiver timed out or returned an ambiguous response. Confirmation will check whether it completed.',
        updateError: errorMessage(error),
      });
      return;
    }
    throw error;
  }
}

async function verifyCleanupAction(
  database: Queryable,
  client: AppRiverLicenseCleanupClient,
  action: CleanupActionRow,
  now: string,
) {
  const detail = await client.getCustomerSubscriptionDetails(action.external_customer_id, action.subscription_key);
  const observedQuantity = appRiverLicenseQuantity(detail);
  const requestedQuantity = integerValue(action.requested_quantity);
  if (observedQuantity === requestedQuantity) {
    await markCleanupActionVerified(database, action.id, now, {
      verifiedDetail: detail,
      liveCandidate: sourceFromLiveDetail(action, detail, now),
    });
    return;
  }

  if (Date.parse(isoDate(action.expires_at) ?? '') <= Date.parse(now)) {
    await markCleanupActionFailed(database, action.id, now, `AppRiver did not report ${requestedQuantity} within the confirmation window; last observed ${observedQuantity}.`);
    return;
  }

  await markCleanupActionConfirm(database, action.id, now, {
    requestedQuantity,
    verifiedDetail: detail,
    liveCandidate: sourceFromLiveDetail(action, detail, now),
  }, true);
}

function cleanupReviewChanges(action: CleanupActionRow, live: CandidateSource) {
  const changes: string[] = [];
  const storedTotal = integerValue(action.current_total_licenses);
  const storedAssigned = optionalInteger(action.current_assigned_licenses);
  const storedUnassigned = integerValue(action.current_unassigned_licenses);

  if (live.totalLicenses !== storedTotal) {
    changes.push(`Total licenses changed from ${storedTotal} to ${live.totalLicenses}.`);
  }
  if (storedAssigned !== undefined && live.assignedLicenses !== undefined && live.assignedLicenses !== storedAssigned) {
    changes.push(`Assigned licenses changed from ${storedAssigned} to ${live.assignedLicenses}.`);
  }
  if (live.unassignedLicenses !== storedUnassigned) {
    changes.push(`Unassigned licenses changed from ${storedUnassigned} to ${live.unassignedLicenses}.`);
  }

  const request = recordFromJson(action.request_payload);
  for (const [key, label, current] of [
    ['subscriptionTerm', 'Subscription term', live.subscriptionTerm],
    ['billingFrequency', 'Billing frequency', live.billingFrequency],
    ['expirationBehavior', 'Expiration behavior', live.expirationBehavior],
    ['commitmentEndDate', 'Commitment end date', live.commitmentEndDate],
  ] as const) {
    const expected = stringValue(request[key]);
    const expectedComparison = key === 'commitmentEndDate' ? dateString(expected) : expected;
    const currentComparison = key === 'commitmentEndDate' ? dateString(current) : current;
    if (
      expected &&
      current &&
      normalizeComparisonValue(expectedComparison ?? expected) !== normalizeComparisonValue(currentComparison ?? current)
    ) {
      changes.push(`${label} changed from ${expected} to ${current}.`);
    }
  }

  return changes;
}

function isAmbiguousAppRiverUpdateError(error: unknown) {
  if (error instanceof AppRiverApiError && (error.status === 408 || error.status === 504)) {
    return true;
  }
  return /timed?\s*out|timeout|check back|accepted for processing/i.test(errorMessage(error));
}

async function processedResult(database: Queryable, action: CleanupActionRow, now: string): Promise<AppRiverLicenseCleanupProcessResult> {
  return {
    status: 'processed',
    shouldContinue: await hasDueCleanupAction(database, now),
    batchId: action.batch_id,
    actionId: action.id,
  };
}

async function loadLatestAppRiverSyncRun(database: Queryable): Promise<AppRiverLicenseCleanupSyncRun | undefined> {
  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at
     from sync_runs
     where integration_id = $1
       and status = 'complete'
       and coalesce(metadata->>'entity', '') = 'subscription-snapshots'
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [appRiverIntegrationId],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
  };
}

async function loadLatestAppRiverSnapshotRows(database: Queryable, syncRunId: string) {
  const result = await database.query<SnapshotRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as customer_id,
         vendor_usage_snapshots.external_account_id,
         vendor_usage_snapshots.vendor_product_key,
         vendor_usage_snapshots.product_code,
         vendor_usage_snapshots.product_name,
         vendor_usage_snapshots.quantity,
         vendor_usage_snapshots.observed_at,
         vendor_usage_snapshots.dimensions
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_usage_snapshots.sync_run_id = $2::uuid
     )
     select
       mapped_snapshots.*,
       customers.connectwise_company_id,
       customers.name as customer_name,
       active_action.id as pending_action_id,
       active_action.status as pending_action_status,
       active_action.requested_quantity as pending_requested_quantity,
       active_action.requested_reduction as pending_requested_reduction,
       active_action.created_at as pending_created_at,
       latest_action.id as latest_action_id,
       latest_action.status as latest_action_status,
       latest_action.requested_quantity as latest_requested_quantity,
       latest_action.requested_reduction as latest_requested_reduction,
       latest_action.final_quantity as latest_final_quantity,
       latest_action.error_message as latest_error_message,
       latest_action.created_at as latest_created_at,
       latest_action.completed_at as latest_completed_at,
       latest_action.updated_at as latest_updated_at
     from mapped_snapshots
     left join customers
       on customers.id = mapped_snapshots.customer_id
     left join lateral (
       select id, status, requested_quantity, requested_reduction, created_at
       from appriver_license_cleanup_actions
       where appriver_license_cleanup_actions.external_customer_id = mapped_snapshots.external_account_id
         and appriver_license_cleanup_actions.subscription_key = mapped_snapshots.dimensions->>'subscriptionKey'
         and appriver_license_cleanup_actions.status = any($3::text[])
       order by created_at desc
       limit 1
     ) active_action on true
     left join lateral (
       select id, status, requested_quantity, requested_reduction, final_quantity, error_message, created_at, completed_at, updated_at
       from appriver_license_cleanup_actions
       where appriver_license_cleanup_actions.external_customer_id = mapped_snapshots.external_account_id
         and appriver_license_cleanup_actions.subscription_key = mapped_snapshots.dimensions->>'subscriptionKey'
       order by created_at desc
       limit 1
     ) latest_action on true
     where mapped_snapshots.customer_id is not null
       and mapped_snapshots.external_account_id is not null
       and nullif(mapped_snapshots.dimensions->>'subscriptionKey', '') is not null
     order by customers.name, mapped_snapshots.product_name, mapped_snapshots.dimensions->>'subscriptionKey'`,
    [appRiverIntegrationId, syncRunId, activeActionStatuses],
  );

  return result.rows;
}

function sourceFromSnapshotRow(row: SnapshotRow, syncRun: AppRiverLicenseCleanupSyncRun): CandidateSource {
  const dimensions = recordFromJson(row.dimensions);
  const totalLicenses =
    integerValue(dimensions.totalLicenses) ||
    integerValue(dimensions.subscriptionQuantity) ||
    integerValue(row.quantity);
  const subscriptionKey = stringValue(dimensions.subscriptionKey) ?? row.id;

  return {
    id: `appriver-license-cleanup:${row.external_account_id}:${subscriptionKey}`,
    customerId: row.customer_id ?? undefined,
    connectWiseCompanyId: row.connectwise_company_id ?? undefined,
    customerName:
      row.customer_name ??
      stringValue(dimensions.customerName) ??
      stringValue(dimensions.appRiverCustomerName) ??
      row.external_account_id ??
      'Unknown AppRiver customer',
    externalCustomerId: row.external_account_id ?? '',
    vendorProductKey: row.vendor_product_key ?? undefined,
    productCode: row.product_code,
    productName: stringValue(dimensions.productName) ?? row.product_name,
    subscriptionKey,
    domain: stringValue(dimensions.domain),
    totalLicenses,
    assignedLicenses: optionalInteger(dimensions.assignedLicenses),
    unassignedLicenses: integerValue(dimensions.unassignedLicenses),
    commitmentEndDate: stringValue(dimensions.commitmentEndDate),
    subscriptionTerm: stringValue(dimensions.subscriptionTerm),
    billingFrequency: stringValue(dimensions.billingFrequency),
    expirationBehavior: stringValue(dimensions.expirationBehavior),
    subscriptionStatus: stringValue(dimensions.subscriptionStatus),
    cancellationDate: stringValue(dimensions.cancellationDate),
    scheduledUninstallDate: stringValue(dimensions.scheduledUninstallDate),
    isTrial: typeof dimensions.isTrial === 'boolean' ? dimensions.isTrial : undefined,
    notes: stringValue(dimensions.notes),
    observedAt: isoDate(row.observed_at) ?? new Date(0).toISOString(),
    syncTimestamp: syncRun.completedAt ?? syncRun.startedAt,
    pendingAction: row.pending_action_id
      ? {
          id: row.pending_action_id,
          status: row.pending_action_status ?? 'queued',
          requestedQuantity: integerValue(row.pending_requested_quantity),
          requestedReduction: integerValue(row.pending_requested_reduction),
          createdAt: isoDate(row.pending_created_at) ?? new Date(0).toISOString(),
        }
      : undefined,
    latestAction: row.latest_action_id
      ? {
          id: row.latest_action_id,
          status: row.latest_action_status ?? 'queued',
          requestedQuantity: integerValue(row.latest_requested_quantity),
          requestedReduction: integerValue(row.latest_requested_reduction),
          finalQuantity: optionalInteger(row.latest_final_quantity),
          errorMessage: stringValue(row.latest_error_message),
          createdAt: isoDate(row.latest_created_at) ?? new Date(0).toISOString(),
          completedAt: isoDate(row.latest_completed_at),
          updatedAt: isoDate(row.latest_updated_at),
        }
      : undefined,
  };
}

function sourceFromLiveDetail(action: CleanupActionRow, detail: AppRiverSubscriptionDetail, now: string): CandidateSource {
  const vendorProductKey = appRiverProductKeyForSubscription(detail);
  const productCode = detail.productCode ?? fallbackAppRiverProductCode(vendorProductKey);
  const totalLicenses = appRiverLicenseQuantity(detail);
  const unassignedLicenses =
    detail.unassignedLicenses ??
    (typeof detail.assignedLicenses === 'number'
      ? Math.max(totalLicenses - detail.assignedLicenses, 0)
      : integerValue(action.current_unassigned_licenses));

  return {
    id: `appriver-license-cleanup:${action.external_customer_id}:${detail.subscriptionKey}`,
    customerId: action.customer_id ?? undefined,
    customerName: action.customer_name ?? action.external_customer_id,
    externalCustomerId: action.external_customer_id,
    vendorProductKey,
    productCode,
    productName: detail.productName ?? action.product_name,
    subscriptionKey: detail.subscriptionKey,
    domain: detail.domain ?? action.domain ?? undefined,
    totalLicenses,
    assignedLicenses: detail.assignedLicenses,
    unassignedLicenses,
    commitmentEndDate: detail.commitmentEndDate,
    subscriptionTerm: detail.subscriptionTerm,
    billingFrequency: detail.billingFrequency,
    expirationBehavior: detail.expirationBehavior,
    subscriptionStatus: detail.status,
    cancellationDate: detail.cancellationDate,
    scheduledUninstallDate: detail.scheduledUninstallDate,
    isTrial: detail.isTrial,
    notes: detail.notes,
    observedAt: now,
    syncTimestamp: now,
  };
}

async function liveCandidateForQueue(
  client: Pick<AppRiverLicenseCleanupClient, 'getCustomerSubscriptionDetails'>,
  snapshotCandidate: AppRiverLicenseCleanupCandidate,
  chargeIndex: ChargeIncreaseIndex,
  now: string,
) {
  const detail = await client.getCustomerSubscriptionDetails(
    snapshotCandidate.externalCustomerId,
    snapshotCandidate.subscriptionKey,
  );
  return candidateFromSource(liveSourceForCandidate(snapshotCandidate, detail, now), chargeIndex, now, defaultWindowDays);
}

async function loadSavedAuditCleanupCandidate(
  database: Queryable,
  rowId: string,
): Promise<AppRiverLicenseCleanupCandidate | undefined> {
  const result = await database.query<SavedCleanupCandidateRow>(
    `select audit_row->'cleanup' as cleanup
     from discrepancy_audits
     cross join lateral jsonb_array_elements(report_json->'rows') audit_row
     where comparison_id = 'appriver-license-cleanup'
       and audit_row->>'id' = $1
       and audit_row->'cleanup' is not null
     order by created_at desc
     limit 1`,
    [rowId],
  );
  return cleanupCandidateFromUnknown(result.rows[0]?.cleanup, rowId);
}

function cleanupCandidateFromUnknown(value: unknown, expectedRowId?: string): AppRiverLicenseCleanupCandidate | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== 'string' ||
    (expectedRowId && value.id !== expectedRowId) ||
    typeof value.customerName !== 'string' ||
    typeof value.externalCustomerId !== 'string' ||
    typeof value.productCode !== 'string' ||
    typeof value.productName !== 'string' ||
    typeof value.subscriptionKey !== 'string' ||
    typeof value.totalLicenses !== 'number' ||
    typeof value.unassignedLicenses !== 'number' ||
    typeof value.proposedReduction !== 'number' ||
    typeof value.proposedQuantity !== 'number' ||
    !['Renewal', 'RecentOrder', 'Both'].includes(String(value.eligibilityReason)) ||
    typeof value.observedAt !== 'string'
  ) {
    return undefined;
  }
  return value as AppRiverLicenseCleanupCandidate;
}

function liveSourceForCandidate(
  snapshotCandidate: AppRiverLicenseCleanupCandidate,
  detail: AppRiverSubscriptionDetail,
  now: string,
): CandidateSource {
  const vendorProductKey = appRiverProductKeyForSubscription(detail);
  const productCode = detail.productCode ?? snapshotCandidate.productCode ?? fallbackAppRiverProductCode(vendorProductKey);
  const liveQuantity = appRiverLicenseQuantity(detail);
  const assignedLicenses = detail.assignedLicenses ?? snapshotCandidate.assignedLicenses;
  const unassignedLicenses =
    detail.unassignedLicenses ??
    (typeof assignedLicenses === 'number'
      ? Math.max(liveQuantity - assignedLicenses, 0)
      : snapshotCandidate.unassignedLicenses);

  return {
    id: snapshotCandidate.id,
    customerId: snapshotCandidate.customerId,
    connectWiseCompanyId: snapshotCandidate.connectWiseCompanyId,
    customerName: snapshotCandidate.customerName,
    externalCustomerId: snapshotCandidate.externalCustomerId,
    vendorProductKey,
    productCode,
    productName: detail.productName ?? snapshotCandidate.productName,
    subscriptionKey: detail.subscriptionKey || snapshotCandidate.subscriptionKey,
    domain: detail.domain ?? snapshotCandidate.domain,
    totalLicenses: liveQuantity,
    assignedLicenses,
    unassignedLicenses,
    commitmentEndDate: detail.commitmentEndDate ?? snapshotCandidate.commitmentEndDate,
    subscriptionTerm: detail.subscriptionTerm ?? snapshotCandidate.subscriptionTerm,
    billingFrequency: detail.billingFrequency ?? snapshotCandidate.billingFrequency,
    expirationBehavior: detail.expirationBehavior ?? snapshotCandidate.expirationBehavior,
    subscriptionStatus: detail.status,
    cancellationDate: detail.cancellationDate,
    scheduledUninstallDate: detail.scheduledUninstallDate,
    isTrial: typeof detail.isTrial === 'boolean' ? detail.isTrial : snapshotCandidate.isTrial,
    notes: detail.notes ?? snapshotCandidate.notes,
    observedAt: now,
    syncTimestamp: now,
    pendingAction: snapshotCandidate.pendingAction,
    latestAction: snapshotCandidate.latestAction,
  };
}

function candidateFromIneligibleLiveSource(
  snapshotCandidate: AppRiverLicenseCleanupCandidate,
  source: CandidateSource,
): AppRiverLicenseCleanupCandidate {
  return {
    ...snapshotCandidate,
    vendorProductKey: source.vendorProductKey,
    productCode: source.productCode ?? snapshotCandidate.productCode,
    productName: source.productName ?? snapshotCandidate.productName,
    subscriptionKey: source.subscriptionKey,
    domain: source.domain,
    totalLicenses: source.totalLicenses,
    assignedLicenses: source.assignedLicenses,
    unassignedLicenses: source.unassignedLicenses,
    proposedReduction: 0,
    proposedQuantity: source.totalLicenses,
    commitmentEndDate: source.commitmentEndDate,
    subscriptionTerm: source.subscriptionTerm,
    billingFrequency: source.billingFrequency,
    expirationBehavior: source.expirationBehavior,
    isTrial: source.isTrial,
    notes: source.notes,
    observedAt: source.observedAt,
    syncTimestamp: source.syncTimestamp,
  };
}

function candidateFromSource(
  source: CandidateSource,
  chargeIndex: ChargeIncreaseIndex,
  now: string,
  windowDays: number,
): AppRiverLicenseCleanupCandidate | undefined {
  if (!source.externalCustomerId || !source.subscriptionKey || source.totalLicenses <= 0) {
    return undefined;
  }

  const today = dateOnly(now) ?? dateOnly(new Date()) ?? new Date();
  const renewal = renewalEligibility(source.commitmentEndDate, source.subscriptionTerm ?? source.billingFrequency, today, windowDays);
  const recentIncrease = recentIncreaseFor(chargeIndex, source.customerName, source.productName ?? source.productCode ?? source.subscriptionKey, source.totalLicenses);
  const hasRenewal = renewal.isRecent;
  const hasRecentOrder = recentIncrease.availableLicensesToReduce > 0;
  if (source.unassignedLicenses <= 0 && source.latestAction) {
    return actionResultCandidate(source, renewal, recentIncrease);
  }

  if (
    source.unassignedLicenses > 0 &&
    isScheduledForCancellation(source) &&
    (renewal.isUpcoming || renewal.isRecent || hasRecentOrder)
  ) {
    return scheduledCancellationCandidate(source, renewal, recentIncrease);
  }

  if (!hasRenewal && !hasRecentOrder) {
    return source.latestAction ? actionResultCandidate(source, renewal, recentIncrease) : undefined;
  }

  const eligibilityReason = hasRenewal && hasRecentOrder ? 'Both' : hasRenewal ? 'Renewal' : 'RecentOrder';
  const rawMaxReduction =
    eligibilityReason === 'RecentOrder'
      ? Math.min(source.unassignedLicenses, recentIncrease.availableLicensesToReduce)
      : source.unassignedLicenses;
  const proposedReduction = Math.min(rawMaxReduction, Math.max(source.totalLicenses - 1, 0));
  if (proposedReduction <= 0) {
    return undefined;
  }

  return {
    id: source.id,
    customerId: source.customerId,
    connectWiseCompanyId: source.connectWiseCompanyId,
    customerName: source.customerName,
    externalCustomerId: source.externalCustomerId,
    vendorProductKey: source.vendorProductKey,
    productCode: source.productCode ?? fallbackAppRiverProductCode(source.vendorProductKey ?? source.productName ?? source.subscriptionKey),
    productName: source.productName ?? source.productCode ?? source.subscriptionKey,
    subscriptionKey: source.subscriptionKey,
    domain: source.domain,
    totalLicenses: source.totalLicenses,
    assignedLicenses: source.assignedLicenses,
    unassignedLicenses: source.unassignedLicenses,
    proposedReduction,
    proposedQuantity: source.totalLicenses - proposedReduction,
    eligibilityReason,
    renewalWindow: hasRenewal ? 'Recent' : undefined,
    daysFromRenewal: renewal.daysFromRenewal,
    daysUntilCommitmentEnd: renewal.daysUntilCommitmentEnd,
    commitmentEndDate: renewal.currentCommitmentEndDate ?? dateString(source.commitmentEndDate),
    previousCommitmentEndDate: renewal.previousCommitmentEndDate,
    effectiveDate: recentIncrease.effectiveDate,
    availableLicensesToReduce: recentIncrease.availableLicensesToReduce || undefined,
    subscriptionTerm: source.subscriptionTerm,
    billingFrequency: source.billingFrequency,
    expirationBehavior: source.expirationBehavior,
    isTrial: source.isTrial,
    notes: source.notes,
    observedAt: source.observedAt,
    syncTimestamp: source.syncTimestamp,
    pendingAction: source.pendingAction,
    latestAction: source.latestAction,
  };
}

function scheduledCancellationCandidate(
  source: CandidateSource,
  renewal: ReturnType<typeof renewalEligibility>,
  recentIncrease: ReturnType<typeof recentIncreaseFor>,
): AppRiverLicenseCleanupCandidate {
  return {
    id: source.id,
    customerId: source.customerId,
    connectWiseCompanyId: source.connectWiseCompanyId,
    customerName: source.customerName,
    externalCustomerId: source.externalCustomerId,
    vendorProductKey: source.vendorProductKey,
    productCode: source.productCode ?? fallbackAppRiverProductCode(source.vendorProductKey ?? source.productName ?? source.subscriptionKey),
    productName: source.productName ?? source.productCode ?? source.subscriptionKey,
    subscriptionKey: source.subscriptionKey,
    domain: source.domain,
    totalLicenses: source.totalLicenses,
    assignedLicenses: source.assignedLicenses,
    unassignedLicenses: source.unassignedLicenses,
    proposedReduction: 0,
    proposedQuantity: source.totalLicenses,
    eligibilityReason: recentIncrease.availableLicensesToReduce > 0 ? 'RecentOrder' : 'Renewal',
    renewalWindow: renewal.isUpcoming ? 'Upcoming' : renewal.isRecent ? 'Recent' : undefined,
    daysFromRenewal: renewal.daysFromRenewal,
    daysUntilCommitmentEnd: renewal.daysUntilCommitmentEnd,
    commitmentEndDate: renewal.currentCommitmentEndDate ?? dateString(source.commitmentEndDate),
    previousCommitmentEndDate: renewal.previousCommitmentEndDate,
    effectiveDate: recentIncrease.effectiveDate,
    availableLicensesToReduce: recentIncrease.availableLicensesToReduce || undefined,
    subscriptionTerm: source.subscriptionTerm,
    billingFrequency: source.billingFrequency,
    expirationBehavior: source.expirationBehavior,
    skipReason: 'ScheduledCancellation',
    isTrial: source.isTrial,
    notes: 'Scheduled to cancel at the end of the current term. No license decrease will be sent.',
    observedAt: source.observedAt,
    syncTimestamp: source.syncTimestamp,
    pendingAction: source.pendingAction,
    latestAction: source.latestAction,
  };
}

function isScheduledForCancellation(source: CandidateSource) {
  return (
    /^none$/i.test(source.expirationBehavior ?? '') ||
    /scheduled\s+to\s+uninstall/i.test(source.subscriptionStatus ?? '') ||
    Boolean(source.cancellationDate || source.scheduledUninstallDate)
  );
}

function actionResultCandidate(
  source: CandidateSource,
  renewal: ReturnType<typeof renewalEligibility>,
  recentIncrease: ReturnType<typeof recentIncreaseFor>,
): AppRiverLicenseCleanupCandidate | undefined {
  const latestAction = source.latestAction;
  if (!latestAction) {
    return undefined;
  }

  const requestedReduction = latestAction.requestedReduction || Math.max(source.totalLicenses - latestAction.requestedQuantity, 0);
  const proposedQuantity = latestAction.finalQuantity ?? latestAction.requestedQuantity;
  return {
    id: source.id,
    customerId: source.customerId,
    connectWiseCompanyId: source.connectWiseCompanyId,
    customerName: source.customerName,
    externalCustomerId: source.externalCustomerId,
    vendorProductKey: source.vendorProductKey,
    productCode: source.productCode ?? fallbackAppRiverProductCode(source.vendorProductKey ?? source.productName ?? source.subscriptionKey),
    productName: source.productName ?? source.productCode ?? source.subscriptionKey,
    subscriptionKey: source.subscriptionKey,
    domain: source.domain,
    totalLicenses: source.totalLicenses,
    assignedLicenses: source.assignedLicenses,
    unassignedLicenses: source.unassignedLicenses,
    proposedReduction: requestedReduction,
    proposedQuantity,
    eligibilityReason: recentIncrease.availableLicensesToReduce > 0 ? 'RecentOrder' : 'Renewal',
    renewalWindow: renewal.isUpcoming ? 'Upcoming' : renewal.isRecent ? 'Recent' : undefined,
    daysFromRenewal: renewal.daysFromRenewal,
    daysUntilCommitmentEnd: renewal.daysUntilCommitmentEnd,
    commitmentEndDate: renewal.currentCommitmentEndDate ?? dateString(source.commitmentEndDate),
    previousCommitmentEndDate: renewal.previousCommitmentEndDate,
    effectiveDate: recentIncrease.effectiveDate,
    availableLicensesToReduce: recentIncrease.availableLicensesToReduce || undefined,
    subscriptionTerm: source.subscriptionTerm,
    billingFrequency: source.billingFrequency,
    expirationBehavior: source.expirationBehavior,
    isTrial: source.isTrial,
    notes: source.notes ? `${source.notes} Latest cleanup action result.` : 'Latest cleanup action result.',
    observedAt: source.observedAt,
    syncTimestamp: source.syncTimestamp,
    pendingAction: source.pendingAction,
    latestAction,
  };
}

function candidateWithRequestedQuantity(
  candidate: AppRiverLicenseCleanupCandidate,
  requestedQuantity: number,
): AppRiverLicenseCleanupCandidate | undefined {
  const normalizedQuantity = Math.trunc(requestedQuantity);
  if (!Number.isFinite(normalizedQuantity)) {
    return undefined;
  }

  const maxReduction = candidate.proposedReduction;
  const requestedReduction = candidate.totalLicenses - normalizedQuantity;
  if (
    normalizedQuantity < 1 ||
    requestedReduction <= 0 ||
    requestedReduction > maxReduction ||
    (typeof candidate.assignedLicenses === 'number' && normalizedQuantity < candidate.assignedLicenses)
  ) {
    return undefined;
  }

  return {
    ...candidate,
    proposedReduction: requestedReduction,
    proposedQuantity: normalizedQuantity,
    notes: candidate.notes ? `${candidate.notes} Manual count override requested.` : 'Manual count override requested.',
  };
}

function renewalEligibility(
  commitmentEndDate: string | undefined,
  termText: string | undefined,
  today: Date,
  windowDays: number,
) {
  const commitmentDate = dateOnly(commitmentEndDate);
  if (!commitmentDate) {
    return {
      isUpcoming: false,
      isRecent: false,
    };
  }

  const normalizedTerm = termText?.toLowerCase() ?? '';
  const previousCommitmentDate = /month/.test(normalizedTerm)
    ? addMonths(commitmentDate, -1)
    : /annual|year/.test(normalizedTerm)
      ? addYears(commitmentDate, -1)
      : addDays(commitmentDate, -365);
  const upcomingWindowEnd = addDays(today, windowDays);
  const recentWindowStart = addDays(today, -windowDays);
  const isUpcoming = commitmentDate >= today && commitmentDate <= upcomingWindowEnd;
  const currentJustRenewed = commitmentDate >= recentWindowStart && commitmentDate <= today;
  const previousJustRenewed = previousCommitmentDate >= recentWindowStart && previousCommitmentDate <= today;
  const isRecent = currentJustRenewed || previousJustRenewed;
  const comparisonDate = isUpcoming ? commitmentDate : currentJustRenewed ? commitmentDate : previousCommitmentDate;

  return {
    isUpcoming,
    isRecent,
    currentCommitmentEndDate: formatDateOnly(commitmentDate),
    previousCommitmentEndDate: formatDateOnly(previousCommitmentDate),
    daysUntilCommitmentEnd: daysBetween(today, commitmentDate),
    daysFromRenewal: isUpcoming || isRecent ? daysBetween(today, comparisonDate) : undefined,
  };
}

function buildChargeIncreaseIndex(events: AppRiverChargeEvent[], now: string, windowDays: number): ChargeIncreaseIndex {
  const today = dateOnly(now) ?? new Date();
  const recentWindowStart = addDays(today, -windowDays);
  const index: ChargeIncreaseIndex = new Map();

  for (const event of events) {
    if (!event.customerName || !event.productName || event.eventType !== 'Adjustment') {
      continue;
    }
    const quantity = integerValue(event.quantity);
    const previousQuantity = integerValue(event.previousQuantity);
    if (quantity <= previousQuantity) {
      continue;
    }
    const effectiveDate = dateOnly(event.effectiveDate);
    if (!effectiveDate || effectiveDate < recentWindowStart || effectiveDate > today) {
      continue;
    }

    const key = chargeKey(event.customerName, event.productName, quantity);
    const existing = index.get(key);
    if (!existing || effectiveDate > existing.effectiveDate) {
      index.set(key, {
        effectiveDate,
        previousQuantity,
        addedLicenses: quantity - previousQuantity,
      });
    }
  }

  return index;
}

function recentIncreaseFor(index: ChargeIncreaseIndex, customerName: string, productName: string, currentQuantity: number) {
  let chainQuantity = currentQuantity;
  let availableLicensesToReduce = 0;
  let effectiveDate: Date | undefined;

  for (let indexGuard = 0; indexGuard < 20; indexGuard += 1) {
    const event = index.get(chargeKey(customerName, productName, chainQuantity));
    if (!event) break;

    availableLicensesToReduce += event.addedLicenses;
    if (!effectiveDate || event.effectiveDate < effectiveDate) {
      effectiveDate = event.effectiveDate;
    }
    chainQuantity = event.previousQuantity;
  }

  return {
    availableLicensesToReduce,
    effectiveDate: effectiveDate?.toISOString(),
  };
}

async function createCleanupBatch(
  database: Queryable,
  input: {
    actor: string;
    requestedCount: number;
    now: string;
  },
) {
  const result = await database.query<BatchRow>(
    `insert into appriver_license_cleanup_batches (requested_by, status, requested_count, metadata, created_at, updated_at)
     values ($1, 'queued', $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
     returning id`,
    [
      input.actor,
      input.requestedCount,
      JSON.stringify({
        source: 'discrepancy-appriver-license-cleanup',
      }),
      input.now,
    ],
  );
  const batchId = result.rows[0]?.id;
  if (!batchId) {
    throw new Error('Unable to create AppRiver license cleanup batch.');
  }

  return batchId;
}

async function findActiveCleanupAction(database: Queryable, externalCustomerId: string, subscriptionKey: string) {
  const result = await database.query<ExistingActionRow>(
    `select id, status
     from appriver_license_cleanup_actions
     where external_customer_id = $1
       and subscription_key = $2
       and status = any($3::text[])
     order by created_at desc
     limit 1`,
    [externalCustomerId, subscriptionKey, activeActionStatuses],
  );

  return result.rows[0];
}

async function insertCleanupAction(
  database: Queryable,
  batchId: string,
  candidate: AppRiverLicenseCleanupCandidate,
  now: string,
) {
  await database.query(
    `insert into appriver_license_cleanup_actions (
       batch_id,
       customer_id,
       customer_name,
       external_customer_id,
       vendor_product_key,
       product_code,
       product_name,
       subscription_key,
       domain,
       status,
       current_total_licenses,
       current_assigned_licenses,
       current_unassigned_licenses,
       requested_reduction,
       requested_quantity,
       eligibility_reason,
       renewal_window,
       effective_date,
       commitment_end_date,
       previous_commitment_end_date,
       next_check_at,
       expires_at,
       request_payload,
       created_at,
       updated_at
     )
     values (
       $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, 'queued',
       $10, $11, $12, $13, $14, $15, $16, $17::timestamptz, $18::date, $19::date,
       $20::timestamptz, $20::timestamptz + interval '24 hours', $21::jsonb, $20::timestamptz, $20::timestamptz
     )`,
    [
      batchId,
      candidate.customerId ?? null,
      candidate.customerName,
      candidate.externalCustomerId,
      candidate.vendorProductKey ?? null,
      candidate.productCode,
      candidate.productName,
      candidate.subscriptionKey,
      candidate.domain ?? null,
      candidate.totalLicenses,
      candidate.assignedLicenses ?? null,
      candidate.unassignedLicenses,
      candidate.proposedReduction,
      candidate.proposedQuantity,
      candidate.eligibilityReason,
      candidate.renewalWindow ?? null,
      candidate.effectiveDate ?? null,
      candidate.commitmentEndDate ?? null,
      candidate.previousCommitmentEndDate ?? null,
      now,
      JSON.stringify(candidate),
    ],
  );
}

async function updateCleanupBatchAfterQueue(
  database: Queryable,
  batchId: string,
  input: {
    status: string;
    queued: number;
    skipped: number;
    now: string;
  },
) {
  await database.query(
    `update appriver_license_cleanup_batches
     set status = $2,
         queued_count = $3,
         skipped_count = $4,
         completed_at = case when $2 = 'skipped' then $5::timestamptz else completed_at end,
         updated_at = $5::timestamptz
     where id = $1::uuid`,
    [batchId, input.status, input.queued, input.skipped, input.now],
  );
}

async function loadCleanupActionSummary(database: Queryable, actionId: string) {
  const result = await database.query<CleanupActionSummaryRow>(
    `${cleanupActionSummarySelectSql()}
     where appriver_license_cleanup_actions.id = $1::uuid`,
    [actionId],
  );
  const row = result.rows[0];
  return row ? mapCleanupActionSummaryRow(row) : undefined;
}

function cleanupActionSummarySelectSql() {
  return `select
       appriver_license_cleanup_actions.id,
       appriver_license_cleanup_actions.batch_id,
       appriver_license_cleanup_batches.status as batch_status,
       appriver_license_cleanup_batches.requested_by,
       appriver_license_cleanup_actions.customer_id,
       appriver_license_cleanup_actions.customer_name,
       appriver_license_cleanup_actions.external_customer_id,
       appriver_license_cleanup_actions.vendor_product_key,
       appriver_license_cleanup_actions.product_code,
       appriver_license_cleanup_actions.product_name,
       appriver_license_cleanup_actions.subscription_key,
       appriver_license_cleanup_actions.domain,
       appriver_license_cleanup_actions.status,
       appriver_license_cleanup_actions.current_total_licenses,
       appriver_license_cleanup_actions.current_assigned_licenses,
       appriver_license_cleanup_actions.current_unassigned_licenses,
       appriver_license_cleanup_actions.requested_reduction,
       appriver_license_cleanup_actions.requested_quantity,
       appriver_license_cleanup_actions.live_total_licenses,
       appriver_license_cleanup_actions.live_assigned_licenses,
       appriver_license_cleanup_actions.live_unassigned_licenses,
       appriver_license_cleanup_actions.final_quantity,
       appriver_license_cleanup_actions.eligibility_reason,
       appriver_license_cleanup_actions.renewal_window,
       appriver_license_cleanup_actions.effective_date,
       appriver_license_cleanup_actions.commitment_end_date,
       appriver_license_cleanup_actions.previous_commitment_end_date,
       appriver_license_cleanup_actions.attempts,
       appriver_license_cleanup_actions.verification_attempts,
       appriver_license_cleanup_actions.next_check_at,
       appriver_license_cleanup_actions.accepted_at,
       appriver_license_cleanup_actions.verified_at,
       appriver_license_cleanup_actions.started_at,
       appriver_license_cleanup_actions.completed_at,
       appriver_license_cleanup_actions.expires_at,
       appriver_license_cleanup_actions.error_message,
       appriver_license_cleanup_actions.dismissed_at,
       appriver_license_cleanup_actions.dismissed_by,
       appriver_license_cleanup_actions.created_at,
       appriver_license_cleanup_actions.updated_at
     from appriver_license_cleanup_actions
     join appriver_license_cleanup_batches
       on appriver_license_cleanup_batches.id = appriver_license_cleanup_actions.batch_id`;
}

async function claimNextCleanupAction(database: Queryable, now: string) {
  const result = await database.query<CleanupActionRow>(
    `with candidate as (
       select action.*
       from appriver_license_cleanup_actions action
       where (
         (action.status = 'queued' and action.next_check_at <= $1::timestamptz)
         or (
           action.status in ('running', 'reviewing', 'updating')
           and action.updated_at <= $1::timestamptz - interval '5 minutes'
         )
         or (
           action.status = 'confirm'
           and action.next_check_at <= $1::timestamptz
           and not exists (
             select 1
             from appriver_license_cleanup_actions pending_update
             where pending_update.status in ('queued', 'running', 'reviewing', 'updating')
           )
         )
       )
       order by
         case action.status
           when 'queued' then 0
           when 'running' then 1
           when 'reviewing' then 1
           when 'updating' then 2
           else 3
         end,
         case when action.status = 'confirm' then action.accepted_at end,
         action.created_at,
         action.id
       for update skip locked
       limit 1
     )
     update appriver_license_cleanup_actions
     set status = case
           when candidate.status in ('queued', 'running', 'reviewing') then 'running'
           when candidate.status = 'updating' then 'confirm'
           else candidate.status
         end,
         attempts = appriver_license_cleanup_actions.attempts + 1,
         started_at = coalesce(appriver_license_cleanup_actions.started_at, $1::timestamptz),
         next_check_at = case when candidate.status = 'updating' then $1::timestamptz else appriver_license_cleanup_actions.next_check_at end,
         updated_at = $1::timestamptz
     from candidate
     where appriver_license_cleanup_actions.id = candidate.id
     returning
       appriver_license_cleanup_actions.id,
       appriver_license_cleanup_actions.batch_id,
       appriver_license_cleanup_actions.customer_id,
       appriver_license_cleanup_actions.customer_name,
       appriver_license_cleanup_actions.external_customer_id,
       appriver_license_cleanup_actions.vendor_product_key,
       appriver_license_cleanup_actions.product_code,
       appriver_license_cleanup_actions.product_name,
       appriver_license_cleanup_actions.subscription_key,
       appriver_license_cleanup_actions.domain,
       appriver_license_cleanup_actions.status,
       appriver_license_cleanup_actions.current_total_licenses,
       appriver_license_cleanup_actions.current_assigned_licenses,
       appriver_license_cleanup_actions.current_unassigned_licenses,
       appriver_license_cleanup_actions.requested_reduction,
       appriver_license_cleanup_actions.requested_quantity,
       appriver_license_cleanup_actions.attempts,
       appriver_license_cleanup_actions.verification_attempts,
       appriver_license_cleanup_actions.expires_at,
       appriver_license_cleanup_actions.request_payload,
       candidate.status as previous_status`,
    [now],
  );

  return result.rows[0];
}

async function markCleanupActionVerified(
  database: Queryable,
  actionId: string,
  now: string,
  payload: Record<string, unknown>,
) {
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'verified',
         completed_at = $2::timestamptz,
         verified_at = $2::timestamptz,
          final_quantity = requested_quantity,
          live_total_licenses = coalesce(($3::jsonb->'liveCandidate'->>'totalLicenses')::integer, live_total_licenses),
          live_assigned_licenses = coalesce(($3::jsonb->'liveCandidate'->>'assignedLicenses')::integer, live_assigned_licenses),
          live_unassigned_licenses = coalesce(($3::jsonb->'liveCandidate'->>'unassignedLicenses')::integer, live_unassigned_licenses),
          response_payload = response_payload || $3::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [actionId, now, JSON.stringify(payload)],
  );
}

async function markCleanupActionReviewing(database: Queryable, actionId: string, now: string) {
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'reviewing',
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [actionId, now],
  );
}

async function markCleanupActionUpdating(
  database: Queryable,
  actionId: string,
  now: string,
  live: CandidateSource,
  detail: AppRiverSubscriptionDetail,
) {
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'updating',
         live_total_licenses = $3,
         live_assigned_licenses = $4,
         live_unassigned_licenses = $5,
         response_payload = response_payload || $6::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [actionId, now, live.totalLicenses, live.assignedLicenses ?? null, live.unassignedLicenses, JSON.stringify({ reviewDetail: detail })],
  );
}

async function markCleanupActionConfirm(
  database: Queryable,
  actionId: string,
  now: string,
  payload: Record<string, unknown>,
  incrementVerification = false,
) {
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'confirm',
         accepted_at = coalesce(accepted_at, $2::timestamptz),
         verification_attempts = verification_attempts + case when $3::boolean then 1 else 0 end,
         next_check_at = $4::timestamptz,
         live_total_licenses = coalesce(($5::jsonb->'liveCandidate'->>'totalLicenses')::integer, live_total_licenses),
         live_assigned_licenses = coalesce(($5::jsonb->'liveCandidate'->>'assignedLicenses')::integer, live_assigned_licenses),
         live_unassigned_licenses = coalesce(($5::jsonb->'liveCandidate'->>'unassignedLicenses')::integer, live_unassigned_licenses),
         response_payload = response_payload || $5::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [
      actionId,
      now,
      incrementVerification,
      new Date(Date.parse(now) + verificationDelayMs).toISOString(),
      JSON.stringify(payload),
    ],
  );
}

async function markCleanupActionNeedsReview(
  database: Queryable,
  action: CleanupActionRow,
  now: string,
  live: CandidateSource,
  detail: AppRiverSubscriptionDetail,
  changes: string[],
) {
  const message = changes.join(' ');
  const payload = {
    review: {
      queuedCounts: {
        total: integerValue(action.current_total_licenses),
        assigned: optionalInteger(action.current_assigned_licenses),
        unassigned: integerValue(action.current_unassigned_licenses),
      },
      liveCounts: {
        total: live.totalLicenses,
        assigned: live.assignedLicenses,
        unassigned: live.unassignedLicenses,
      },
      changes,
      detail,
    },
  };
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'needs_review',
         completed_at = $2::timestamptz,
         live_total_licenses = $3,
         live_assigned_licenses = $4,
         live_unassigned_licenses = $5,
         error_message = $6,
         response_payload = response_payload || $7::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [action.id, now, live.totalLicenses, live.assignedLicenses ?? null, live.unassignedLicenses, message, JSON.stringify(payload)],
  );
  await insertAuditEvent(database, {
    actor: 'system:appriver-license-cleanup-worker',
    eventType: 'appriver.license-cleanup.action.needs-review',
    entityType: 'appriver_license_cleanup_action',
    entityId: action.id,
    payload: {
      batchId: action.batch_id,
      requestedQuantity: integerValue(action.requested_quantity),
      ...payload,
    },
  });
}

async function markCleanupActionFailed(database: Queryable, actionId: string, now: string, message: string) {
  await database.query(
    `update appriver_license_cleanup_actions
     set status = 'failed',
         completed_at = $2::timestamptz,
         error_message = $3,
         response_payload = response_payload || $4::jsonb,
         updated_at = $2::timestamptz
     where id = $1::uuid`,
    [actionId, now, message, JSON.stringify({ error: message })],
  );
}

async function refreshCleanupBatch(database: Queryable, batchId: string, now: string) {
  const result = await database.query<BatchCountRow>(
    `select
       count(*) as total_count,
       count(*) filter (where status = 'queued') as queued_count,
       count(*) filter (where status = 'running') as running_count,
       count(*) filter (where status = 'reviewing') as reviewing_count,
       count(*) filter (where status = 'updating') as updating_count,
       count(*) filter (where status = 'confirm') as confirm_count,
       count(*) filter (where status in ('skipped', 'cancelled')) as skipped_count,
       count(*) filter (where status = 'verified') as verified_count,
       count(*) filter (where status = 'needs_review') as needs_review_count,
       count(*) filter (where status = 'failed') as failed_count,
       count(*) filter (where status = 'timed_out') as timed_out_count
     from appriver_license_cleanup_actions
     where batch_id = $1::uuid`,
    [batchId],
  );
  const counts = result.rows[0];
  const activeCount =
    integerValue(counts?.queued_count) +
    integerValue(counts?.running_count) +
    integerValue(counts?.reviewing_count) +
    integerValue(counts?.updating_count) +
    integerValue(counts?.confirm_count);
  const failureCount =
    integerValue(counts?.needs_review_count) +
    integerValue(counts?.failed_count) +
    integerValue(counts?.timed_out_count);
  const status = activeCount > 0 ? 'processing' : failureCount > 0 ? 'partial' : 'complete';

  await database.query(
    `update appriver_license_cleanup_batches
     set status = $2,
         queued_count = $3,
         skipped_count = $4,
         verified_count = $5,
         failed_count = $6,
         timed_out_count = $7,
         completed_at = case when $8 = 0 then $9::timestamptz else null end,
         updated_at = $9::timestamptz
     where id = $1::uuid`,
    [
      batchId,
      status,
      integerValue(counts?.queued_count),
      integerValue(counts?.skipped_count),
      integerValue(counts?.verified_count),
      integerValue(counts?.failed_count) + integerValue(counts?.needs_review_count),
      integerValue(counts?.timed_out_count),
      activeCount,
      now,
    ],
  );
}

async function hasDueCleanupAction(database: Queryable, now: string) {
  const result = await database.query<DueCountRow>(
    `select count(*) as due_count
     from appriver_license_cleanup_actions action
     where (
       (action.status = 'queued' and action.next_check_at <= $1::timestamptz)
       or (
         action.status in ('running', 'reviewing', 'updating')
         and action.updated_at <= $1::timestamptz - interval '5 minutes'
       )
       or (
         action.status = 'confirm'
         and action.next_check_at <= $1::timestamptz
         and not exists (
           select 1
           from appriver_license_cleanup_actions pending_update
           where pending_update.status in ('queued', 'running', 'reviewing', 'updating')
         )
       )
     )`,
    [now],
  );

  return integerValue(result.rows[0]?.due_count) > 0;
}

async function insertAuditEvent(
  database: Queryable,
  input: {
    actor: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [input.actor, input.eventType, input.entityType, input.entityId, JSON.stringify(input.payload)],
  );
}

async function saveCleanupPreview(
  database: Queryable,
  input: {
    actor: string;
    rowId: string;
    now: string;
    payload: Record<string, unknown>;
  },
) {
  const result = await database.query<{ id: string }>(
    `insert into audit_events (actor, event_type, entity_type, entity_id, occurred_at, payload)
     values ($1, 'appriver.license-cleanup.preview.refreshed', 'appriver_license_cleanup_preview', $2, $3::timestamptz, $4::jsonb)
     returning id`,
    [input.actor, input.rowId, input.now, JSON.stringify(input.payload)],
  );
  const previewId = result.rows[0]?.id;
  if (!previewId) {
    throw new Error('Unable to save the refreshed AppRiver preview.');
  }
  return previewId;
}

async function loadCleanupPreview(database: Queryable, previewId: string, actor: string, now: string) {
  const result = await database.query<CleanupPreviewRow>(
    `select id, entity_id, payload
     from audit_events
     where id = $1
       and actor = $2
       and event_type = 'appriver.license-cleanup.preview.refreshed'
       and entity_type = 'appriver_license_cleanup_preview'
       and occurred_at >= $3::timestamptz - interval '15 minutes'
     limit 1`,
    [previewId, actor, now],
  );
  const row = result.rows[0];
  if (!row || !isRecord(row.payload) || !isRecord(row.payload.candidate)) {
    return undefined;
  }
  const status = row.payload.status;
  if (!['eligible', 'matched', 'scheduled-cancellation', 'unavailable'].includes(String(status))) {
    return undefined;
  }
  const candidate = cleanupCandidateFromUnknown(row.payload.candidate, row.entity_id);
  if (!candidate) return undefined;
  return {
    rowId: row.entity_id,
    status: status as AppRiverLicenseCleanupPreviewStatus,
    candidate,
  };
}

function compareCleanupCandidates(left: AppRiverLicenseCleanupCandidate, right: AppRiverLicenseCleanupCandidate) {
  return (
    left.customerName.localeCompare(right.customerName) ||
    left.productName.localeCompare(right.productName) ||
    left.subscriptionKey.localeCompare(right.subscriptionKey)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapCleanupActionSummaryRow(row: CleanupActionSummaryRow): AppRiverLicenseCleanupActionSummary {
  const startedAt = isoDate(row.started_at);
  return {
    id: row.id,
    batchId: row.batch_id,
    batchStatus: row.batch_status,
    requestedBy: row.requested_by,
    customerId: row.customer_id ?? undefined,
    customerName: row.customer_name ?? undefined,
    externalCustomerId: row.external_customer_id,
    vendorProductKey: row.vendor_product_key ?? undefined,
    productCode: row.product_code ?? undefined,
    productName: row.product_name,
    subscriptionKey: row.subscription_key,
    domain: row.domain ?? undefined,
    status: row.status,
    currentTotalLicenses: integerValue(row.current_total_licenses),
    currentAssignedLicenses: optionalInteger(row.current_assigned_licenses),
    currentUnassignedLicenses: integerValue(row.current_unassigned_licenses),
    requestedReduction: integerValue(row.requested_reduction),
    requestedQuantity: integerValue(row.requested_quantity),
    liveTotalLicenses: optionalInteger(row.live_total_licenses),
    liveAssignedLicenses: optionalInteger(row.live_assigned_licenses),
    liveUnassignedLicenses: optionalInteger(row.live_unassigned_licenses),
    finalQuantity: optionalInteger(row.final_quantity),
    eligibilityReason: stringValue(row.eligibility_reason),
    renewalWindow: stringValue(row.renewal_window),
    effectiveDate: isoDate(row.effective_date),
    commitmentEndDate: dateString(isoDate(row.commitment_end_date)),
    previousCommitmentEndDate: dateString(isoDate(row.previous_commitment_end_date)),
    attempts: integerValue(row.attempts),
    verificationAttempts: integerValue(row.verification_attempts),
    nextCheckAt: isoDate(row.next_check_at) ?? new Date(0).toISOString(),
    acceptedAt: isoDate(row.accepted_at),
    verifiedAt: isoDate(row.verified_at),
    startedAt,
    completedAt: isoDate(row.completed_at),
    expiresAt: isoDate(row.expires_at) ?? new Date(0).toISOString(),
    errorMessage: stringValue(row.error_message),
    dismissedAt: isoDate(row.dismissed_at),
    dismissedBy: stringValue(row.dismissed_by),
    createdAt: isoDate(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: isoDate(row.updated_at) ?? new Date(0).toISOString(),
    canCancel: row.status === 'queued' && !startedAt,
    canDismiss: row.status === 'cancelled' && !row.dismissed_at,
  };
}

function chargeKey(customerName: string, productName: string, quantity: number) {
  return `${normalizeChargeText(customerName)}|${normalizeChargeText(productName)}|${quantity}`;
}

function normalizeChargeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addYears(date: Date, years: number) {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function daysBetween(anchor: Date, value: Date) {
  return Math.round((value.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000));
}

function dateOnly(value: string | Date | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return undefined;
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function dateString(value: string | undefined) {
  const parsed = dateOnly(value);
  return parsed ? formatDateOnly(parsed) : undefined;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeComparisonValue(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function booleanValue(value: boolean | string | undefined) {
  return value === true || value === 'true' || value === 't' || value === '1';
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function optionalInteger(value: unknown) {
  if (typeof value === 'undefined' || value === null || (typeof value === 'string' && value.trim().length === 0)) {
    return undefined;
  }

  return integerValue(value);
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
