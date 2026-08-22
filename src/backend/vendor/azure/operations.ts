import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import {
  runAzureCostMonitor,
  storeAzureAdvisorRecommendations,
  upsertAzureDailyCost,
} from '../../azureMonitoring/azureCostMonitorService';
import {
  AzureApiError,
  AzureCostManagementClient,
  azureCredentialsFromSettings,
  azureIntegrationId,
  discoverDelegatedAzureTenants,
  enrichSubscriptionsWithTenants,
  type AzureCostUsageRow,
  type AzureCostReportRequest,
  type AzureSubscription,
} from './client';

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type AzureUsageClient = {
  listSubscriptions: AzureCostManagementClient['listSubscriptions'];
  listTenants?: AzureCostManagementClient['listTenants'];
  listLighthouseDelegations?: AzureCostManagementClient['listLighthouseDelegations'];
  listLighthouseDelegationsForSubscription?: AzureCostManagementClient['listLighthouseDelegationsForSubscription'];
  queryCostUsage: AzureCostManagementClient['queryCostUsage'];
  requestCostUsageReport?: AzureCostManagementClient['requestCostUsageReport'];
  collectCostUsageReport?: AzureCostManagementClient['collectCostUsageReport'];
  listResources?: AzureCostManagementClient['listResources'];
  getVmInstanceView?: AzureCostManagementClient['getVmInstanceView'];
  queryDailyMetrics?: AzureCostManagementClient['queryDailyMetrics'];
  getAvdActivity?: AzureCostManagementClient['getAvdActivity'];
  listAdvisorRecommendations?: AzureCostManagementClient['listAdvisorRecommendations'];
};

type AccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_addition_id: string | null;
};

type AccountMapping = {
  customerId: string;
  customerName?: string;
  agreementId?: string;
  agreementAdditionId?: string;
};

const azureCostCalendarTimeZone = 'America/New_York';
const azureDailyCorrectionDays = 5;
const azureThrottleMinimumRetryMs = 60_000;

export type AzureCostSyncMode = 'daily' | 'monthly';

export type AzureCostSyncCheckpoint = {
  subscriptionId: string;
  syncMode: AzureCostSyncMode;
  coveredFrom?: string;
  coveredThrough?: string;
  cursorDate?: string;
  lastAttemptAt?: Date;
  lastSuccessAt?: Date;
  lastRowCount: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  nextRetryAt?: Date;
  lastError?: string;
};

export type AzureCostCheckpointWindow = {
  from: string;
  to: string;
  coveredThrough: string;
  cursorDate?: string;
};

export function azureCostSyncMode(operationKey?: string): AzureCostSyncMode {
  return operationKey === 'azure-cost-monthly' ? 'monthly' : 'daily';
}

export function azureCostQueryWindow(input: {
  mode: AzureCostSyncMode;
  now: Date;
  monthlyBackfillMonths?: number;
}) {
  const today = calendarDateInTimeZone(input.now, azureCostCalendarTimeZone);
  const [year, month, day] = today.split('-').map((part) => Number(part));
  if (input.mode === 'daily') {
    const monthStart = `${year}-${pad2(month)}-01`;
    const from = day === 1 ? shiftCalendarDate(today, -1) : monthStart;
    return {
      from: `${from}T00:00:00.000Z`,
      to: `${today}T00:00:00.000Z`,
      mode: input.mode,
      lookbackDays: Math.max(0, day - 1),
    };
  }

  const months = Math.min(12, Math.max(1, input.monthlyBackfillMonths ?? 3));
  const startIndex = year * 12 + (month - 1) - months;
  const startYear = Math.floor(startIndex / 12);
  const startMonth = (startIndex % 12) + 1;
  return {
    from: `${startYear}-${pad2(startMonth)}-01T00:00:00.000Z`,
    to: `${year}-${pad2(month)}-01T00:00:00.000Z`,
    mode: input.mode,
    lookbackDays: 0,
    months,
  };
}

export function azureCostMonthWindows(from: string, to: string) {
  const windows: Array<{ from: string; to: string }> = [];
  const end = new Date(to);
  let cursor = new Date(from);
  if (!(cursor.getTime() < end.getTime())) return [{ from, to }];
  while (cursor < end) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const chunkTo = next < end ? next : end;
    windows.push({ from: cursor.toISOString(), to: chunkTo.toISOString() });
    cursor = next;
  }
  return windows;
}

export function azureCheckpointCostWindows(input: {
  mode: AzureCostSyncMode;
  fullWindow: { from: string; to: string };
  checkpoint?: AzureCostSyncCheckpoint;
  correctionDays?: number;
}) {
  const fullFrom = input.fullWindow.from.slice(0, 10);
  const fullTo = input.fullWindow.to.slice(0, 10);
  if (input.mode === 'daily') {
    const targetDate = shiftCalendarDate(fullTo, -1);
    if (input.checkpoint?.coveredThrough && input.checkpoint.coveredThrough >= targetDate) {
      return [] as AzureCostCheckpointWindow[];
    }
    const correctionDays = Math.max(1, input.correctionDays ?? azureDailyCorrectionDays);
    const correctionFrom = shiftCalendarDate(targetDate, -(correctionDays - 1));
    const nextUncovered = input.checkpoint?.coveredThrough
      ? shiftCalendarDate(input.checkpoint.coveredThrough, 1)
      : fullFrom;
    const requestedFrom = input.checkpoint
      ? [nextUncovered, correctionFrom].sort()[0] ?? fullFrom
      : fullFrom;
    const from = [fullFrom, requestedFrom].sort()[1] ?? fullFrom;
    return [{
      from: `${from}T00:00:00.000Z`,
      to: input.fullWindow.to,
      coveredThrough: targetDate,
    }];
  }

  let cursor = input.checkpoint?.cursorDate ?? fullFrom;
  if (input.checkpoint?.coveredFrom && fullFrom < input.checkpoint.coveredFrom) {
    cursor = fullFrom;
  }
  if (cursor < fullFrom) cursor = fullFrom;
  if (cursor >= fullTo) return [] as AzureCostCheckpointWindow[];
  return azureCostMonthWindows(`${cursor}T00:00:00.000Z`, input.fullWindow.to).map((window) => ({
    ...window,
    coveredThrough: shiftCalendarDate(window.to.slice(0, 10), -1),
    cursorDate: window.to.slice(0, 10),
  }));
}

export async function testAzureConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  now?: string;
} = {}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(azureIntegrationId);
  assertAzureReady(settings);
  const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
  const discoveredSubscriptions = await client.listSubscriptions(5);
  const tenantDiscovery = await discoverDelegatedAzureTenants(client, discoveredSubscriptions);
  const subscriptions = filterSubscriptions(
    enrichSubscriptionsWithTenants(discoveredSubscriptions, tenantDiscovery.tenantsById),
    settings,
  );

  return {
    integrationId: azureIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    subscriptionCount: subscriptions.length,
    sampleSubscriptions: subscriptions.slice(0, 10).map(subscriptionSummary),
    tenantLookupWarning: tenantDiscovery.warning,
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncAzureCostUsage(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  now?: string;
  operationKey?: string;
  jobId?: string;
  syncRunId?: string;
  maxCostQueryWindows?: number;
  onProgress?: SyncProgressReporter;
}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(azureIntegrationId);
  assertAzureReady(settings);

  const now = input.now ? new Date(input.now) : new Date();
  const mode = azureCostSyncMode(input.operationKey);
  const operationKey = mode === 'monthly' ? 'azure-cost-monthly' : 'azure-cost-usage';
  const window = azureCostQueryWindow({
    mode,
    now,
    monthlyBackfillMonths: boundedInteger(settings.nonSecrets.monthlyBackfillMonths, 3, 1, 12),
  });
  const collectLiveInventory = mode === 'daily';
  const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
  const discoveredSubscriptions = await client.listSubscriptions(100);
  const tenantDiscovery = await discoverDelegatedAzureTenants(client, discoveredSubscriptions);
  const subscriptions = filterSubscriptions(
    enrichSubscriptionsWithTenants(discoveredSubscriptions, tenantDiscovery.tenantsById),
    settings,
  );
  await persistAzureLighthouseTenantsFromSubscriptions(input.pool, subscriptions);
  let syncRunId = input.syncRunId;

  try {
    const accountMappings = await loadAccountMappings(input.pool);
    const checkpoints = await loadAzureCostSyncCheckpoints(
      input.pool,
      subscriptions.map((subscription) => subscription.subscriptionId),
      mode,
    );
    const costCoverage = await loadAzureCostCoverage(
      input.pool,
      subscriptions.map((subscription) => subscription.subscriptionId),
    );
    let recordsRead = 0;
    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let totalCost = 0;
    let resourceSnapshots = 0;
    let metricSnapshots = 0;
    let advisorRecommendations = 0;
    const advisorFailures: Array<{ subscriptionId: string; error: string }> = [];
    const failures: Array<{
      subscriptionId: string;
      subscriptionName?: string;
      customerName?: string;
      error: string;
    }> = [];
    const emptyCostWithResources: Array<{
      subscriptionId: string;
      customerName?: string;
      resourceCount: number;
    }> = [];
    const skippedCostQueries: string[] = [];
    const deferredCostQueries: Array<{
      subscriptionId: string;
      reason: string;
      nextRetryAt?: string;
    }> = [];
    let costQueryWindowsCompleted = 0;
    let sharedThrottleUntil: Date | undefined;
    const progressTotal = Math.max(1, subscriptions.length);
    const plans = subscriptions.map((subscription) => {
      const mapping = accountMappings.get(subscription.tenantId?.toLowerCase() ?? '')
        ?? accountMappings.get(subscription.subscriptionId.toLowerCase());
      const checkpoint = checkpoints.get(subscription.subscriptionId.toLowerCase());
      const retryDeferred = checkpoint?.nextRetryAt && checkpoint.nextRetryAt > now;
      const windows = retryDeferred
        ? []
        : azureCheckpointCostWindows({ mode, fullWindow: window, checkpoint });
      const skipReason = retryDeferred
        ? 'retry-not-due'
        : windows.length === 0
          ? 'already-covered'
          : undefined;
      if (skipReason) skippedCostQueries.push(subscription.subscriptionId);
      if (retryDeferred) {
        deferredCostQueries.push({
          subscriptionId: subscription.subscriptionId,
          reason: skipReason ?? 'retry-not-due',
          nextRetryAt: checkpoint?.nextRetryAt?.toISOString(),
        });
      }
      return {
        subscription,
        mapping,
        checkpoint,
        windows,
        skipReason,
        failed: false,
        deferred: Boolean(retryDeferred),
        costQuerySucceeded: false,
        costRowsWritten: 0,
      };
    });

    const maxWindowCount = Math.max(0, ...plans.map((plan) => plan.windows.length));
    const availableWorkItems: Array<{ planIndex: number; windowIndex: number }> = [];
    for (let windowIndex = 0; windowIndex < maxWindowCount; windowIndex += 1) {
      for (const [planIndex, plan] of plans.entries()) {
        if (plan.windows[windowIndex] && !plan.skipReason) {
          availableWorkItems.push({ planIndex, windowIndex });
        }
      }
    }
    const requestedWindowLimit = input.maxCostQueryWindows;
    const windowLimit = typeof requestedWindowLimit === 'number' && Number.isFinite(requestedWindowLimit)
      ? Math.max(1, Math.floor(requestedWindowLimit))
      : availableWorkItems.length;
    const selectedWorkItems = availableWorkItems.slice(0, windowLimit);
    const selectedWorkItemKeys = new Set(
      selectedWorkItems.map((item) => `${item.planIndex}:${item.windowIndex}`),
    );
    const remainingCostQueryWindows = Math.max(0, availableWorkItems.length - selectedWorkItems.length);

    if (mode === 'monthly' && availableWorkItems.length === 0) {
      const runningSyncRunId = await findRunningAzureSyncRun(input.pool, {
        requestedSyncRunId: syncRunId,
        jobId: input.jobId,
        operationKey,
      });
      if (runningSyncRunId) {
        syncRunId = runningSyncRunId;
        await completeSyncRun(input.pool, runningSyncRunId, 0, 0, {
          entity: operationKey,
          operationKey,
          queryWindow: window,
          subscriptionCount: subscriptions.length,
          costQueryWindowsCompleted: 0,
          remainingCostQueryWindows: 0,
          continuationPending: false,
        });
        await input.onProgress?.({
          completed: progressTotal,
          total: progressTotal,
          failed: 0,
          currentItem: 'Completed-month backfill checkpoints are complete',
          unitLabel: 'subscriptions',
        });
        return {
          syncRunId: runningSyncRunId,
          recordsRead: 0,
          recordsWritten: 0,
          subscriptionCount: subscriptions.length,
          successfulSubscriptions: subscriptions.length,
          failedSubscriptions: 0,
          mappedSnapshots: 0,
          unmappedSnapshots: 0,
          totalCost: 0,
          resourceSnapshots: 0,
          metricSnapshots: 0,
          advisorRecommendations: 0,
          advisorFailures: [],
          tenantLookupWarning: tenantDiscovery.warning,
          emptyCostWithResources: [],
          skippedCostQueries,
          deferredCostQueries,
          costQueryWindowsCompleted: 0,
          remainingCostQueryWindows: 0,
          continuationPending: false,
          alreadyCovered: false,
          sharedThrottleUntil: undefined,
          operationKey,
          mode,
          monitoring: undefined,
          monitoringWarning: undefined,
          queryWindow: window,
        };
      }
      const completedSyncRunId = await latestCompletedAzureSyncRun(input.pool, operationKey);
      if (completedSyncRunId) {
        await input.onProgress?.({
          completed: progressTotal,
          total: progressTotal,
          failed: 0,
          currentItem: 'Completed-month charges are already fully covered',
          unitLabel: 'subscriptions',
        });
        return {
          syncRunId: completedSyncRunId,
          recordsRead: 0,
          recordsWritten: 0,
          subscriptionCount: subscriptions.length,
          successfulSubscriptions: subscriptions.length,
          failedSubscriptions: 0,
          mappedSnapshots: 0,
          unmappedSnapshots: 0,
          totalCost: 0,
          resourceSnapshots: 0,
          metricSnapshots: 0,
          advisorRecommendations: 0,
          advisorFailures: [],
          tenantLookupWarning: tenantDiscovery.warning,
          emptyCostWithResources: [],
          skippedCostQueries,
          deferredCostQueries,
          costQueryWindowsCompleted: 0,
          remainingCostQueryWindows: 0,
          continuationPending: false,
          alreadyCovered: true,
          sharedThrottleUntil: undefined,
          operationKey,
          mode,
          monitoring: undefined,
          monitoringWarning: undefined,
          queryWindow: window,
        };
      }
    }

    const activeSyncRunId = await resolveAzureSyncRun(input.pool, {
      requestedSyncRunId: syncRunId,
      jobId: input.jobId,
      operationKey,
      window,
      subscriptionCount: subscriptions.length,
    });
    syncRunId = activeSyncRunId;

    await input.onProgress?.({
      completed: 0,
      total: progressTotal,
      currentItem: 'Discovering delegated subscriptions',
      unitLabel: 'subscriptions',
    });
    const reportProgress = (
      planIndex: number,
      progressPrefix: string,
    ) => async (progress: { message: string }) => input.onProgress?.({
      completed: Math.min(planIndex, progressTotal - 1),
      total: progressTotal,
      failed: failures.length,
      currentItem: `${progressPrefix} · ${progress.message}`,
      unitLabel: 'subscriptions',
    });
    const recordCostQueryFailure = async (
      planIndex: number,
      plan: (typeof plans)[number],
      queryWindow: AzureCostCheckpointWindow,
      progressPrefix: string,
      error: unknown,
    ) => {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        subscriptionId: plan.subscription.subscriptionId,
        subscriptionName: plan.subscription.displayName,
        customerName: plan.mapping?.customerName ?? plan.subscription.displayName,
        error: message,
      });
      plan.failed = true;
      const retry = azureRetryState(error, now);
      await markAzureCostSyncFailure(input.pool, {
        subscriptionId: plan.subscription.subscriptionId,
        mode,
        syncRunId: activeSyncRunId,
        window: queryWindow,
        error: message,
        nextRetryAt: retry?.nextRetryAt,
      });
      await input.onProgress?.({
        completed: Math.min(planIndex, progressTotal - 1),
        total: progressTotal,
        failed: failures.length,
        currentItem: `${progressPrefix} · Failed: ${message}`,
        unitLabel: 'subscriptions',
      });
      if (retry?.shared) sharedThrottleUntil = retry.nextRetryAt;
    };
    const supportsStagedCostReports = Boolean(
      client.requestCostUsageReport && client.collectCostUsageReport,
    );
    for (let windowIndex = 0; windowIndex < maxWindowCount; windowIndex += 1) {
      const submittedReports: Array<{
        planIndex: number;
        plan: (typeof plans)[number];
        queryWindow: AzureCostCheckpointWindow;
        progressPrefix: string;
        request?: AzureCostReportRequest;
      }> = [];

      // Submit every report in this window before polling or downloading any
      // one of them. Azure can generate the reports in parallel while the
      // remaining subscription requests are being issued.
      for (const [planIndex, plan] of plans.entries()) {
        const queryWindow = plan.windows[windowIndex];
        if (
          !queryWindow
          || plan.failed
          || plan.skipReason
          || !selectedWorkItemKeys.has(`${planIndex}:${windowIndex}`)
        ) continue;
        if (sharedThrottleUntil) {
          if (!plan.deferred) {
            plan.deferred = true;
            skippedCostQueries.push(plan.subscription.subscriptionId);
            deferredCostQueries.push({
              subscriptionId: plan.subscription.subscriptionId,
              reason: 'shared-throttle',
              nextRetryAt: sharedThrottleUntil.toISOString(),
            });
          }
          continue;
        }

        const label = azureSubscriptionLabel(plan.subscription, plan.mapping);
        const progressPrefix = mode === 'monthly'
          ? `Backfilling ${label} · ${queryWindow.from.slice(0, 7)}`
          : `Collecting ${label}`;
        await input.onProgress?.({
          completed: Math.min(planIndex, progressTotal - 1),
          total: progressTotal,
          failed: failures.length,
          currentItem: progressPrefix,
          unitLabel: 'subscriptions',
        });
        if (mode === 'monthly') {
          await clearPartialAzureCostWindowSnapshots(input.pool, {
            syncRunId,
            subscriptionId: plan.subscription.subscriptionId,
            window: queryWindow,
          });
        }
        await markAzureCostSyncAttempt(input.pool, {
          subscriptionId: plan.subscription.subscriptionId,
          mode,
          syncRunId,
          window: queryWindow,
        });

        try {
          const request = supportsStagedCostReports
            ? await client.requestCostUsageReport?.({
                subscriptionId: plan.subscription.subscriptionId,
                from: queryWindow.from,
                to: queryWindow.to,
                onProgress: reportProgress(planIndex, progressPrefix),
              })
            : undefined;
          submittedReports.push({ planIndex, plan, queryWindow, progressPrefix, request });
        } catch (error) {
          await recordCostQueryFailure(planIndex, plan, queryWindow, progressPrefix, error);
        }
      }

      for (const submission of submittedReports) {
        const { planIndex, plan, queryWindow, progressPrefix, request } = submission;
        if (plan.failed) continue;
        try {
          const rows = request && client.collectCostUsageReport
            ? await client.collectCostUsageReport(request, {
                onProgress: reportProgress(planIndex, progressPrefix),
              })
            : await client.queryCostUsage({
                subscriptionId: plan.subscription.subscriptionId,
                from: queryWindow.from,
                to: queryWindow.to,
                onProgress: reportProgress(planIndex, progressPrefix),
              });
          recordsRead += rows.length;

          if (rows.length > 0) {
            await input.onProgress?.({
              completed: Math.min(planIndex, progressTotal - 1),
              total: progressTotal,
              failed: failures.length,
              currentItem: `${progressPrefix} · Storing ${rows.length.toLocaleString('en-US')} cost rows`,
              unitLabel: 'subscriptions',
            });
          }
          for (const [rowIndex, row] of rows.entries()) {
            if (row.cost === 0 && row.usageQuantity === 0) continue;
            const productKey = azureProductKey(row);
            if (plan.mapping?.customerId) mappedSnapshots += 1;
            else unmappedSnapshots += 1;
            totalCost += row.cost;
            await insertSnapshot(input.pool, {
              syncRunId,
              subscription: plan.subscription,
              row,
              customerId: plan.mapping?.customerId,
              agreementId: plan.mapping?.agreementId,
              agreementAdditionId: plan.mapping?.agreementAdditionId,
              vendorProductKey: productKey,
              productCode: productKey,
              productName: row.serviceName ?? row.meterCategory ?? 'Azure consumption',
            });
            if (row.usageDate) {
              await upsertAzureDailyCost(input.pool, {
                syncRunId,
                subscriptionId: plan.subscription.subscriptionId,
                usageDate: row.usageDate,
                serviceName: row.serviceName,
                resourceId: row.resourceId,
                resourceGroup: row.resourceGroup,
                resourceType: row.resourceType,
                meterCategory: row.meterCategory,
                chargeType: row.chargeType,
                currency: row.currency,
                actualCost: row.cost,
                usageQuantity: row.usageQuantity,
                raw: row.raw,
              });
            }
            recordsWritten += 1;
            plan.costRowsWritten += 1;
            const storedCount = rowIndex + 1;
            if (storedCount % 100 === 0 || storedCount === rows.length) {
              await input.onProgress?.({
                completed: Math.min(planIndex, progressTotal - 1),
                total: progressTotal,
                failed: failures.length,
                currentItem:
                  `${progressPrefix} · Storing cost rows ${storedCount.toLocaleString('en-US')}` +
                  ` of ${rows.length.toLocaleString('en-US')}`,
                unitLabel: 'subscriptions',
              });
            }
          }
          await markAzureCostSyncSuccess(input.pool, {
            subscriptionId: plan.subscription.subscriptionId,
            mode,
            syncRunId,
            window: queryWindow,
            rowCount: rows.length,
          });
          plan.costQuerySucceeded = true;
          costQueryWindowsCompleted += 1;
        } catch (error) {
          await recordCostQueryFailure(planIndex, plan, queryWindow, progressPrefix, error);
        }
      }
    }

    if (collectLiveInventory) {
      for (const [planIndex, plan] of plans.entries()) {
        if (!plan.costQuerySucceeded || plan.failed || plan.skipReason || plan.deferred) continue;
        const label = azureSubscriptionLabel(plan.subscription, plan.mapping);
        await input.onProgress?.({
          completed: Math.min(planIndex, progressTotal - 1),
          total: progressTotal,
          failed: failures.length,
          currentItem: `Collecting resources for ${label}`,
          unitLabel: 'subscriptions',
        });
        try {
          let inventory = { resourceSnapshots: 0, metricSnapshots: 0 };
          if (client.listResources) {
            inventory = await collectAzureResourceInventory(input.pool, client, syncRunId, plan.subscription, window);
            resourceSnapshots += inventory.resourceSnapshots;
            metricSnapshots += inventory.metricSnapshots;
            recordsWritten += inventory.resourceSnapshots + inventory.metricSnapshots;
          }
          if (plan.costRowsWritten === 0 && inventory.resourceSnapshots > 0
            && (costCoverage.get(plan.subscription.subscriptionId.toLowerCase())?.rowCount ?? 0) === 0) {
            emptyCostWithResources.push({
              subscriptionId: plan.subscription.subscriptionId,
              customerName: plan.mapping?.customerName ?? plan.subscription.displayName,
              resourceCount: inventory.resourceSnapshots,
            });
          }
          if (client.listAdvisorRecommendations) {
            try {
              const recommendations = await client.listAdvisorRecommendations(plan.subscription.subscriptionId, 100);
              await storeAzureAdvisorRecommendations(input.pool, syncRunId, plan.subscription.subscriptionId, recommendations);
              advisorRecommendations += recommendations.length;
            } catch (error) {
              advisorFailures.push({
                subscriptionId: plan.subscription.subscriptionId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } catch (error) {
          failures.push({
            subscriptionId: plan.subscription.subscriptionId,
            subscriptionName: plan.subscription.displayName,
            customerName: plan.mapping?.customerName ?? plan.subscription.displayName,
            error: error instanceof Error ? error.message : String(error),
          });
          plan.failed = true;
        }
      }
    }

    const deferredSubscriptionCount = new Set(
      deferredCostQueries.map((item) => item.subscriptionId.toLowerCase()),
    ).size;
    const continuationPending = mode === 'monthly' && remainingCostQueryWindows > 0;
    const successfulSubscriptions = Math.max(
      0,
      subscriptions.length - failures.length - deferredSubscriptionCount,
    );

    const failureSummary = failures
      .map((failure) => failure.customerName ?? failure.subscriptionName ?? failure.subscriptionId)
      .join(', ');
    await input.onProgress?.({
      completed: continuationPending
        ? Math.min(
            progressTotal - 1,
            selectedWorkItems[selectedWorkItems.length - 1]?.planIndex ?? 0,
          )
        : subscriptions.length,
      total: progressTotal,
      failed: failures.length,
      currentItem: continuationPending
        ? `Stored a completed-month slice · ${remainingCostQueryWindows.toLocaleString('en-US')} remaining`
        : failures.length
        ? `${collectLiveInventory ? 'Evaluating monitor window' : 'Collecting completed months'} · ${failureSummary} failed`
        : collectLiveInventory
          ? 'Evaluating cost changes, idle VMs, and Advisor results'
          : 'Storing completed-month charges',
      unitLabel: 'subscriptions',
    });

    if (subscriptions.length > 0 && failures.length === subscriptions.length) {
      throw new Error(
        `Azure Cost Management failed for every delegated subscription: ${
          failures
            .map((failure) => `${failure.customerName ?? failure.subscriptionId}: ${failure.error}`)
            .join('; ')
        }`,
      );
    }

    if (continuationPending) {
      await updateRunningSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
        entity: operationKey,
        operationKey,
        queryWindow: window,
        subscriptionCount: subscriptions.length,
        mappedSnapshots,
        unmappedSnapshots,
        totalCost: roundMoney(totalCost),
        skippedCostQueries,
        deferredCostQueries,
        costQueryWindowsCompleted,
        remainingCostQueryWindows,
        continuationPending: true,
      });
      return {
        syncRunId,
        recordsRead,
        recordsWritten,
        subscriptionCount: subscriptions.length,
        successfulSubscriptions,
        failedSubscriptions: failures.length,
        mappedSnapshots,
        unmappedSnapshots,
        totalCost: roundMoney(totalCost),
        resourceSnapshots,
        metricSnapshots,
        advisorRecommendations,
        advisorFailures,
        tenantLookupWarning: tenantDiscovery.warning,
        emptyCostWithResources,
        skippedCostQueries,
        deferredCostQueries,
        costQueryWindowsCompleted,
        remainingCostQueryWindows,
        continuationPending: true,
        alreadyCovered: false,
        sharedThrottleUntil: sharedThrottleUntil?.toISOString(),
        operationKey,
        mode,
        monitoring: undefined,
        monitoringWarning: undefined,
        queryWindow: window,
      };
    }

    await completeSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: operationKey,
      operationKey,
      queryWindow: window,
      subscriptionCount: subscriptions.length,
      successfulSubscriptions,
      failedSubscriptions: failures,
      mappedSnapshots,
      unmappedSnapshots,
      totalCost: roundMoney(totalCost),
      resourceSnapshots,
      metricSnapshots,
      advisorRecommendations,
      advisorFailures,
      tenantLookupWarning: tenantDiscovery.warning,
      emptyCostWithResources,
      skippedCostQueries,
      deferredCostQueries,
      costQueryWindowsCompleted,
      remainingCostQueryWindows: 0,
      continuationPending: false,
      sharedThrottleUntil: sharedThrottleUntil?.toISOString(),
    });

    let monitoring:
      | Awaited<ReturnType<typeof runAzureCostMonitor>>
      | undefined;
    let monitoringWarning: string | undefined;
    if (collectLiveInventory) {
      try {
        monitoring = await runAzureCostMonitor({ database: input.pool, syncRunId, now });
      } catch (error) {
        monitoringWarning = error instanceof Error ? error.message : String(error);
      }
    }
    const monitorSummary = !collectLiveInventory
      ? 'Completed-month backfill stored'
      : monitoringWarning
        ? 'Azure Cost Monitor completed with an evaluation warning'
        : 'Azure Cost Monitor complete';
    await input.onProgress?.({
      completed: progressTotal,
      total: progressTotal,
      failed: failures.length,
      currentItem: [
        monitorSummary,
        failureSummary ? `${failureSummary} failed` : '',
        emptyCostWithResources.length
          ? `${emptyCostWithResources.map((item) => item.customerName ?? item.subscriptionId).join(', ')} returned no cost data`
          : '',
      ].filter(Boolean).join(' · '),
      unitLabel: 'subscriptions',
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      subscriptionCount: subscriptions.length,
      successfulSubscriptions,
      failedSubscriptions: failures.length,
      mappedSnapshots,
      unmappedSnapshots,
      totalCost: roundMoney(totalCost),
      resourceSnapshots,
      metricSnapshots,
      advisorRecommendations,
      advisorFailures,
      tenantLookupWarning: tenantDiscovery.warning,
      emptyCostWithResources,
      skippedCostQueries,
      deferredCostQueries,
      costQueryWindowsCompleted,
      remainingCostQueryWindows: 0,
      continuationPending: false,
      alreadyCovered: false,
      sharedThrottleUntil: sharedThrottleUntil?.toISOString(),
      operationKey,
      mode,
      monitoring,
      monitoringWarning,
      queryWindow: window,
    };
  } catch (error) {
    if (syncRunId) await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

async function collectAzureResourceInventory(
  database: Queryable,
  client: AzureUsageClient,
  syncRunId: string,
  subscription: AzureSubscription,
  window: { from: string; to: string },
) {
  if (!client.listResources) return { resourceSnapshots: 0, metricSnapshots: 0 };
  const resources = await client.listResources(subscription.subscriptionId, 100);
  let resourceSnapshots = 0;
  let metricSnapshots = 0;
  for (const resource of resources) {
    let powerState: string | undefined;
    let properties: Record<string, unknown> = resource.properties;
    try {
      if (resource.type?.toLowerCase() === 'microsoft.compute/virtualmachines' && client.getVmInstanceView) {
        const instanceView = await client.getVmInstanceView(resource.id);
        powerState = powerStateFromInstanceView(instanceView);
        properties = { ...properties, instanceView };
      }
      if (resource.type?.toLowerCase() === 'microsoft.desktopvirtualization/hostpools' && client.getAvdActivity) {
        const activity = await client.getAvdActivity(resource.id);
        properties = {
          ...properties,
          activeSessions: activity.activeSessions,
          disconnectedSessions: activity.disconnectedSessions,
          sessionHosts: activity.sessionHosts,
        };
      }
    } catch (error) {
      properties = {
        ...properties,
        telemetryWarning: error instanceof Error ? error.message : String(error),
      };
    }
    await database.query(
      `insert into azure_resource_snapshots (
         sync_run_id, subscription_id, resource_id, resource_name, resource_type,
         resource_group, location, power_state, tags, properties, observed_at, raw_payload
       ) values (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, now(), $11::jsonb
       )
       on conflict (sync_run_id, resource_id) do nothing`,
      [
        syncRunId,
        subscription.subscriptionId,
        resource.id,
        resource.name,
        resource.type ?? null,
        resource.resourceGroup ?? null,
        resource.location ?? null,
        powerState ?? null,
        JSON.stringify(resource.tags),
        JSON.stringify(properties),
        JSON.stringify(resource.raw),
      ],
    );
    resourceSnapshots += 1;

    if (resource.type?.toLowerCase() === 'microsoft.compute/virtualmachines' && client.queryDailyMetrics) {
      try {
        const metrics = await client.queryDailyMetrics({
          resourceId: resource.id,
          metricNames: ['Percentage CPU'],
          from: window.from,
          to: window.to,
        });
        try {
          metrics.push(...await client.queryDailyMetrics({
            resourceId: resource.id,
            metricNames: ['Available Memory Bytes'],
            from: window.from,
            to: window.to,
          }));
        } catch {
          // Guest memory is optional and only exists when the customer's existing
          // Azure Monitor Agent / Log Analytics configuration publishes it.
        }
        for (const metric of metrics) {
          await database.query(
            `insert into azure_resource_metric_daily (
               sync_run_id, resource_id, metric_date, metric_name,
               average_value, maximum_value, total_value, unit, raw_payload
             ) values ($1::uuid, $2, $3::date, $4, $5, $6, $7, $8, $9::jsonb)
             on conflict (sync_run_id, resource_id, metric_date, metric_name) do nothing`,
            [
              syncRunId,
              resource.id,
              metric.date,
              metric.metricName,
              metric.average ?? null,
              metric.maximum ?? null,
              metric.total ?? null,
              metric.unit ?? null,
              JSON.stringify(metric.raw),
            ],
          );
          metricSnapshots += 1;
        }
      } catch {
        // Cost collection remains usable when Monitor metrics are not delegated.
      }
    }
  }
  return { resourceSnapshots, metricSnapshots };
}

function powerStateFromInstanceView(instanceView: Record<string, unknown>) {
  const statuses = Array.isArray(instanceView.statuses) ? instanceView.statuses : [];
  for (const status of statuses) {
    if (!status || typeof status !== 'object') continue;
    const code = String((status as Record<string, unknown>).code ?? '');
    if (code.toLowerCase().startsWith('powerstate/')) return code.split('/')[1];
  }
  return undefined;
}

export function assertAzureReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) return;
  throw new Error(
    `Azure - Lighthouse settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export function azureProductKey(row: Pick<AzureCostUsageRow, 'serviceName' | 'meterCategory'>) {
  return `azure:${slug(row.serviceName ?? row.meterCategory ?? 'consumption')}`;
}

export async function persistAzureLighthouseTenantsFromSubscriptions(
  pool: Queryable,
  subscriptions: Array<{
    subscriptionId: string;
    displayName?: string;
    tenantId?: string;
    tenantName?: string;
    tenantDefaultDomain?: string;
  }>,
) {
  const tenants = new Map<string, {
    tenantId: string;
    tenantName?: string;
    tenantDefaultDomain?: string;
    subscriptionIds: string[];
    subscriptionNames: Record<string, string>;
  }>();
  for (const subscription of subscriptions) {
    const tenantId = subscription.tenantId?.trim();
    if (!tenantId) continue;
    const key = tenantId.toLowerCase();
    const displayName = readableAzureSubscriptionName(subscription.displayName, subscription.subscriptionId);
    const existing = tenants.get(key);
    if (existing) {
      existing.subscriptionIds.push(subscription.subscriptionId);
      existing.tenantName = existing.tenantName ?? subscription.tenantName;
      existing.tenantDefaultDomain = existing.tenantDefaultDomain ?? subscription.tenantDefaultDomain;
      if (displayName) existing.subscriptionNames[subscription.subscriptionId.toLowerCase()] = displayName;
      continue;
    }
    tenants.set(key, {
      tenantId,
      tenantName: subscription.tenantName,
      tenantDefaultDomain: subscription.tenantDefaultDomain,
      subscriptionIds: [subscription.subscriptionId],
      subscriptionNames: displayName ? { [subscription.subscriptionId.toLowerCase()]: displayName } : {},
    });
  }

  for (const tenant of tenants.values()) {
    await pool.query(
      `insert into azure_lighthouse_tenants (
         tenant_id, tenant_name, tenant_default_domain, subscription_ids, subscription_names,
         subscription_count, last_seen_at, updated_at
       )
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now(), now())
       on conflict (tenant_id) do update set
         tenant_name = coalesce(excluded.tenant_name, azure_lighthouse_tenants.tenant_name),
         tenant_default_domain = coalesce(excluded.tenant_default_domain, azure_lighthouse_tenants.tenant_default_domain),
         subscription_ids = excluded.subscription_ids,
         subscription_names = coalesce(azure_lighthouse_tenants.subscription_names, '{}'::jsonb)
           || coalesce(excluded.subscription_names, '{}'::jsonb),
         subscription_count = excluded.subscription_count,
         last_seen_at = now(),
         updated_at = now()`,
      [
        tenant.tenantId,
        tenant.tenantName ?? null,
        tenant.tenantDefaultDomain ?? null,
        JSON.stringify(tenant.subscriptionIds),
        JSON.stringify(tenant.subscriptionNames),
        tenant.subscriptionIds.length,
      ],
    );
  }
}

function filterSubscriptions(subscriptions: AzureSubscription[], _settings: IntegrationRuntimeSettings) {
  return subscriptions
    .filter((subscription) => subscription.state?.toLowerCase() !== 'disabled')
    .sort((left, right) =>
      (left.displayName ?? left.subscriptionId).localeCompare(right.displayName ?? right.subscriptionId),
    );
}

function subscriptionSummary(subscription: AzureSubscription) {
  return {
    subscriptionId: subscription.subscriptionId,
    displayName: subscription.displayName,
    tenantId: subscription.tenantId,
    tenantName: subscription.tenantName,
    tenantDefaultDomain: subscription.tenantDefaultDomain,
    state: subscription.state,
  };
}

async function loadAccountMappings(database: Queryable) {
  const result = await database.query<AccountMappingRow>(
    `select mappings.external_account_id, mappings.customer_id, customers.name as customer_name,
            mappings.agreement_id, mappings.agreement_addition_id
     from vendor_account_mappings mappings
     left join customers on customers.id = mappings.customer_id
     where mappings.vendor_id = $1
       and mappings.active = true
       and mappings.mapping_status = 'approved'`,
    [azureIntegrationId],
  );
  return new Map(
    result.rows.map((row) => [
      row.external_account_id.toLowerCase(),
      {
        customerId: row.customer_id,
        customerName: row.customer_name ?? undefined,
        agreementId: row.agreement_id ?? undefined,
        agreementAdditionId: row.agreement_addition_id ?? undefined,
      } satisfies AccountMapping,
    ]),
  );
}

type AzureCostSyncCheckpointRow = {
  subscription_id: string;
  sync_mode: AzureCostSyncMode;
  covered_from: Date | string | null;
  covered_through: Date | string | null;
  cursor_date: Date | string | null;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  last_row_count: string | number;
  status: AzureCostSyncCheckpoint['status'];
  next_retry_at: Date | string | null;
  last_error: string | null;
};

async function loadAzureCostSyncCheckpoints(
  database: Queryable,
  subscriptionIds: string[],
  mode: AzureCostSyncMode,
) {
  if (subscriptionIds.length === 0) return new Map<string, AzureCostSyncCheckpoint>();
  const result = await database.query<AzureCostSyncCheckpointRow>(
    `select subscription_id, sync_mode, covered_from, covered_through, cursor_date,
            last_attempt_at, last_success_at, last_row_count, status, next_retry_at, last_error
     from azure_cost_sync_checkpoints
     where lower(subscription_id) = any($1::text[])
       and sync_mode = $2`,
    [subscriptionIds.map((id) => id.toLowerCase()), mode],
  );
  return new Map(result.rows.map((row) => [
    row.subscription_id.toLowerCase(),
    {
      subscriptionId: row.subscription_id,
      syncMode: row.sync_mode,
      coveredFrom: dateOnly(row.covered_from),
      coveredThrough: dateOnly(row.covered_through),
      cursorDate: dateOnly(row.cursor_date),
      lastAttemptAt: dateTime(row.last_attempt_at),
      lastSuccessAt: dateTime(row.last_success_at),
      lastRowCount: Number(row.last_row_count) || 0,
      status: row.status,
      nextRetryAt: dateTime(row.next_retry_at),
      lastError: row.last_error ?? undefined,
    } satisfies AzureCostSyncCheckpoint,
  ]));
}

async function markAzureCostSyncAttempt(database: Queryable, input: {
  subscriptionId: string;
  mode: AzureCostSyncMode;
  syncRunId: string;
  window: AzureCostCheckpointWindow;
}) {
  await database.query(
    `insert into azure_cost_sync_checkpoints (
       subscription_id, sync_mode, status, last_window_from, last_window_to,
       last_attempt_at, last_sync_run_id, updated_at
     ) values ($1, $2, 'running', $3::date, $4::date, now(), $5::uuid, now())
     on conflict (subscription_id, sync_mode) do update set
       status = 'running',
       last_window_from = excluded.last_window_from,
       last_window_to = excluded.last_window_to,
       last_attempt_at = excluded.last_attempt_at,
       next_retry_at = null,
       last_error = null,
       last_sync_run_id = excluded.last_sync_run_id,
       updated_at = now()`,
    [
      input.subscriptionId,
      input.mode,
      input.window.from.slice(0, 10),
      input.window.coveredThrough,
      input.syncRunId,
    ],
  );
}

async function markAzureCostSyncSuccess(database: Queryable, input: {
  subscriptionId: string;
  mode: AzureCostSyncMode;
  syncRunId: string;
  window: AzureCostCheckpointWindow;
  rowCount: number;
}) {
  await database.query(
    `insert into azure_cost_sync_checkpoints (
       subscription_id, sync_mode, covered_from, covered_through, cursor_date,
       last_window_from, last_window_to, last_attempt_at, last_success_at,
       last_row_count, status, next_retry_at, last_error, last_sync_run_id, updated_at
     ) values (
       $1, $2, $3::date, $4::date, $5::date, $3::date, $4::date,
       now(), now(), $6, 'success', null, null, $7::uuid, now()
     )
     on conflict (subscription_id, sync_mode) do update set
       covered_from = least(
         coalesce(azure_cost_sync_checkpoints.covered_from, excluded.covered_from),
         excluded.covered_from
       ),
       covered_through = greatest(
         coalesce(azure_cost_sync_checkpoints.covered_through, excluded.covered_through),
         excluded.covered_through
       ),
       cursor_date = coalesce(excluded.cursor_date, azure_cost_sync_checkpoints.cursor_date),
       last_window_from = excluded.last_window_from,
       last_window_to = excluded.last_window_to,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_row_count = excluded.last_row_count,
       status = 'success',
       next_retry_at = null,
       last_error = null,
       last_sync_run_id = excluded.last_sync_run_id,
       updated_at = now()`,
    [
      input.subscriptionId,
      input.mode,
      input.window.from.slice(0, 10),
      input.window.coveredThrough,
      input.window.cursorDate ?? null,
      input.rowCount,
      input.syncRunId,
    ],
  );
}

async function markAzureCostSyncFailure(database: Queryable, input: {
  subscriptionId: string;
  mode: AzureCostSyncMode;
  syncRunId: string;
  window: AzureCostCheckpointWindow;
  error: string;
  nextRetryAt?: Date;
}) {
  await database.query(
    `insert into azure_cost_sync_checkpoints (
       subscription_id, sync_mode, status, last_window_from, last_window_to,
       last_attempt_at, next_retry_at, last_error, last_sync_run_id, updated_at
     ) values ($1, $2, 'failed', $3::date, $4::date, now(), $5, $6, $7::uuid, now())
     on conflict (subscription_id, sync_mode) do update set
       status = 'failed',
       last_window_from = excluded.last_window_from,
       last_window_to = excluded.last_window_to,
       last_attempt_at = excluded.last_attempt_at,
       next_retry_at = excluded.next_retry_at,
       last_error = excluded.last_error,
       last_sync_run_id = excluded.last_sync_run_id,
       updated_at = now()`,
    [
      input.subscriptionId,
      input.mode,
      input.window.from.slice(0, 10),
      input.window.coveredThrough,
      input.nextRetryAt?.toISOString() ?? null,
      input.error.slice(0, 2000),
      input.syncRunId,
    ],
  );
}

type CostCoverage = {
  rowCount: number;
};

async function loadAzureCostCoverage(database: Queryable, subscriptionIds: string[]) {
  if (subscriptionIds.length === 0) return new Map<string, CostCoverage>();
  const result = await database.query<{
    subscription_id: string;
    row_count: string | number;
  }>(
    `select lower(subscription_id) as subscription_id,
            count(*)::int as row_count
     from azure_cost_daily
     where lower(subscription_id) = any($1::text[])
     group by 1`,
    [subscriptionIds.map((id) => id.toLowerCase())],
  );
  return new Map(result.rows.map((row) => [
    row.subscription_id,
    {
      rowCount: Number(row.row_count) || 0,
    } satisfies CostCoverage,
  ]));
}

function azureSubscriptionLabel(subscription: AzureSubscription, mapping?: AccountMapping) {
  return mapping?.customerName ?? subscription.displayName ?? subscription.subscriptionId;
}

function readableAzureSubscriptionName(name: string | undefined, subscriptionId: string) {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === subscriptionId.toLowerCase()) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return undefined;
  return trimmed;
}

async function startSyncRun(
  database: Queryable,
  operationKey: string,
  window: { from: string; to: string; lookbackDays?: number; mode?: string; months?: number },
  subscriptionCount: number,
  jobId?: string,
) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [azureIntegrationId, JSON.stringify({
      entity: operationKey,
      operationKey,
      queryWindow: window,
      subscriptionCount,
      ...(jobId ? { jobId } : {}),
    })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to create Azure - Lighthouse cost usage sync run.');
  return id;
}

async function resolveAzureSyncRun(database: Queryable, input: {
  requestedSyncRunId?: string;
  jobId?: string;
  operationKey: string;
  window: { from: string; to: string; lookbackDays?: number; mode?: string; months?: number };
  subscriptionCount: number;
}) {
  const existing = await findRunningAzureSyncRun(database, input);
  if (existing) return existing;

  return startSyncRun(
    database,
    input.operationKey,
    input.window,
    input.subscriptionCount,
    input.jobId,
  );
}

async function findRunningAzureSyncRun(database: Queryable, input: {
  requestedSyncRunId?: string;
  jobId?: string;
  operationKey: string;
}) {
  if (input.requestedSyncRunId) {
    const requested = await database.query<{ id: string }>(
      `select id
       from sync_runs
       where id = $1::uuid
         and integration_id = $2
         and status = 'running'
         and metadata->>'entity' = $3
       limit 1`,
      [input.requestedSyncRunId, azureIntegrationId, input.operationKey],
    );
    if (requested.rows[0]?.id) return requested.rows[0].id;
  }

  if (input.jobId) {
    const existing = await database.query<{ id: string }>(
      `select id
       from sync_runs
       where integration_id = $1
         and status = 'running'
         and metadata->>'entity' = $2
         and metadata->>'jobId' = $3
       order by started_at desc
       limit 1`,
      [azureIntegrationId, input.operationKey, input.jobId],
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }
  return undefined;
}

async function latestCompletedAzureSyncRun(database: Queryable, operationKey: string) {
  const result = await database.query<{ id: string }>(
    `select id
     from sync_runs
     where integration_id = $1
       and status = 'complete'
       and metadata->>'entity' = $2
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [azureIntegrationId, operationKey],
  );
  return result.rows[0]?.id;
}

async function clearPartialAzureCostWindowSnapshots(database: Queryable, input: {
  syncRunId: string;
  subscriptionId: string;
  window: AzureCostCheckpointWindow;
}) {
  await database.query(
    `delete from vendor_usage_snapshots
     where sync_run_id = $1::uuid
       and vendor_id = $2
       and lower(external_account_id) = lower($3)
       and observed_at >= $4::date
       and observed_at < $5::date`,
    [
      input.syncRunId,
      azureIntegrationId,
      input.subscriptionId,
      input.window.from.slice(0, 10),
      input.window.to.slice(0, 10),
    ],
  );
}

async function insertSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    subscription: AzureSubscription;
    row: AzureCostUsageRow;
    customerId?: string;
    agreementId?: string;
    agreementAdditionId?: string;
    vendorProductKey: string;
    productCode: string;
    productName: string;
  },
) {
  const observedAt = input.row.usageDate
    ? new Date(`${input.row.usageDate}T00:00:00.000Z`).toISOString()
    : new Date().toISOString();
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id, vendor_id, customer_id, agreement_id, agreement_addition_id, external_account_id,
       vendor_product_key, product_code, product_name, quantity, observed_at, dimensions, raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
    [
      input.syncRunId,
      azureIntegrationId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.agreementAdditionId ?? null,
      input.subscription.subscriptionId,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.row.usageQuantity,
      observedAt,
      JSON.stringify({
        sourceType: 'azure-cost-management',
        syncMode: 'live-api',
        externalAccountName: input.subscription.displayName,
        subscriptionId: input.subscription.subscriptionId,
        subscriptionName: input.subscription.displayName,
        tenantId: input.subscription.tenantId,
        tenantName: input.subscription.tenantName,
        tenantDefaultDomain: input.subscription.tenantDefaultDomain,
        usageDate: input.row.usageDate,
        serviceName: input.row.serviceName,
        resourceId: input.row.resourceId,
        resourceGroup: input.row.resourceGroup,
        meterCategory: input.row.meterCategory,
        resourceType: input.row.resourceType,
        chargeType: input.row.chargeType,
        cost: input.row.cost,
        currency: input.row.currency,
      }),
      JSON.stringify(input.row.raw),
    ],
  );
}

async function completeSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete',
         completed_at = now(),
         records_read = records_read + $2,
         records_written = records_written + $3,
         metadata = metadata || $4::jsonb
     where id = $1`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function updateRunningSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set records_read = records_read + $2,
         records_written = records_written + $3,
         metadata = metadata || $4::jsonb
     where id = $1
       and status = 'running'`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed', completed_at = now(), error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function calendarDateInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function shiftCalendarDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateOnly(value: Date | string | null | undefined) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const direct = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function dateTime(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'consumption';
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function azureRetryState(error: unknown, now: Date) {
  const throttled = error instanceof AzureApiError
    ? error.status === 429
    : /too many requests/i.test(error instanceof Error ? error.message : String(error));
  if (!throttled) return undefined;
  const retryAfterMs = error instanceof AzureApiError ? error.retryAfterMs : undefined;
  const nextRetryAt = new Date(now.getTime() + Math.max(azureThrottleMinimumRetryMs, retryAfterMs ?? 0));
  const scope = error instanceof AzureApiError ? error.throttleScope : 'unknown';
  return {
    nextRetryAt,
    shared: scope !== 'entity',
  };
}
