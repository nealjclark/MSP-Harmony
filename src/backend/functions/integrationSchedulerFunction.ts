import { app, output, type InvocationContext } from '@azure/functions';
import { getIntegrationSettingsDefinition, listIntegrationApiOperations } from '../../shared/integrationSettings';
import {
  dueIntegrationSyncSchedule,
  isIntegrationSchedulerBusinessHour,
  type IntegrationSyncScheduleEntry,
} from '../../shared/integrationSchedules';
import type { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import {
  buildIntegrationSyncQueueMessage,
  type IntegrationSyncQueueMessage,
  type IntegrationSyncRequest,
  type SyncableIntegrationId,
} from '../integrations/syncQueue';
import { createOptionalPostgresSettingsRepository } from './runtime';

const maximumScheduledSyncConcurrency = 2;
const integrationSyncQueueOutput = output.storageQueue({
  queueName: 'integration-sync-work',
  connection: 'AzureWebJobsStorage',
});

type SchedulerRepository = Pick<
  PostgresIntegrationSettingsRepository,
  'claimScheduledSync' | 'listSyncScheduleEntries'
>;

export async function dispatchDueIntegrationSyncs(input: {
  repository: SchedulerRepository;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!isIntegrationSchedulerBusinessHour(now)) {
    return [] as IntegrationSyncQueueMessage[];
  }

  const requestedAt = now.toISOString();
  const entries = await input.repository.listSyncScheduleEntries();
  const messages: IntegrationSyncQueueMessage[] = [];

  for (const entry of entries) {
    const due = dueIntegrationSyncSchedule(entry, now);
    if (!due) continue;

    const operation = listIntegrationApiOperations(entry.integrationId)
      .find((candidate) => candidate.key === entry.operationKey);
    const definition = getIntegrationSettingsDefinition(entry.integrationId);
    if (!operation || !definition) continue;

    const jobId = await input.repository.claimScheduledSync({
      integrationId: entry.integrationId,
      operationKey: operation.key,
      operationLabel: operation.label,
      slot: due.slot,
      requestedAt,
      maximumActiveJobs: maximumScheduledSyncConcurrency,
    });
    if (!jobId) continue;

    const syncRequest = scheduledSyncRequest(entry);
    messages.push({
      ...buildIntegrationSyncQueueMessage(
        entry.integrationId as SyncableIntegrationId,
        syncRequest,
        'MSP Harmony scheduler',
        requestedAt,
      ),
      jobId,
    });

    if (messages.length >= maximumScheduledSyncConcurrency) break;
  }

  return messages;
}

export async function processIntegrationSchedulerTimer(_timer: unknown, context: InvocationContext) {
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.repository) {
    context.warn(
      `Integration scheduler skipped because PostgreSQL is not configured: ${repositoryContext.missingDatabaseSettings.join(', ')}`,
    );
    return;
  }

  try {
    const messages = await dispatchDueIntegrationSyncs({
      repository: repositoryContext.repository,
    });
    if (messages.length > 0) {
      context.extraOutputs.set(integrationSyncQueueOutput, messages);
    }
    context.log(`Integration scheduler queued ${messages.length} sync${messages.length === 1 ? '' : 's'}.`);
  } finally {
    await repositoryContext.close();
  }
}

function scheduledSyncRequest(entry: IntegrationSyncScheduleEntry): IntegrationSyncRequest {
  return {
    operationKey: entry.operationKey,
    ...(entry.integrationId === 'microsoft-365'
      ? { dataset: entry.operationKey === 'm365-licenses' ? 'licenses' as const : 'users' as const }
      : {}),
  };
}

// Cover 6:00 AM-5:00 PM Eastern across both standard and daylight time.
// The handler exits before touching SQL for the single UTC edge invocation
// that falls outside that window during each season.
app.timer('processIntegrationSchedulerTimer', {
  schedule: '0 0 10-22 * * *',
  extraOutputs: [integrationSyncQueueOutput],
  handler: processIntegrationSchedulerTimer,
});
