import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { createIntegrationSettingsProvider, type IntegrationSettingsMetadataReader } from '../config/settingsProvider';
import { AppRiverApiError } from '../vendor/appriver/client';
import { assertAppRiverReady, createAppRiverClient } from '../vendor/appriver/operations';
import {
  cancelAppRiverLicenseCleanupAction,
  dismissAppRiverLicenseCleanupAction,
  listAppRiverLicenseCleanupActions,
  processNextAppRiverLicenseCleanupAction,
  queueAppRiverLicenseCleanupPreview,
  queueAppRiverLicenseCleanupActions,
  refreshAppRiverLicenseCleanupCandidate,
} from '../vendor/appriver/licenseCleanup';
import { hasLicenseActionRole, requireRole } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
} from './runtime';

loadDotEnv({ override: false });

type QueueLicenseCleanupBody = {
  rowIds?: unknown;
  requestedQuantities?: unknown;
  previewId?: unknown;
};

type RefreshLicenseCleanupBody = {
  rowId?: unknown;
};

type AppRiverLicenseCleanupQueueMessage = {
  batchId: string;
};

const appRiverLicenseCleanupQueueName = 'appriver-license-cleanup-work';
const appRiverLicenseCleanupQueueOutput = output.storageQueue({
  queueName: appRiverLicenseCleanupQueueName,
  connection: 'AzureWebJobsStorage',
});

export async function queueAppRiverLicenseCleanupActionsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  if (!hasLicenseActionRole(auth.principal)) {
    return jsonResponse(403, {
      error: 'The Admin or License Admin role is required to queue AppRiver license cleanup actions.',
    });
  }

  const bodyResult = await readJsonBody<QueueLicenseCleanupBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;

  const rowIds = Array.isArray(bodyResult.body.rowIds)
    ? bodyResult.body.rowIds.filter((rowId): rowId is string => typeof rowId === 'string' && rowId.trim().length > 0)
    : [];
  if (rowIds.length === 0) {
    return jsonResponse(400, {
      error: 'Select at least one AppRiver cleanup row to queue.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: 'AppRiver license cleanup needs PostgreSQL settings before actions can be queued.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const previewId = typeof bodyResult.body.previewId === 'string' ? bodyResult.body.previewId.trim() : '';
    const requestedQuantities = parseRequestedQuantities(bodyResult.body.requestedQuantities);
    if (previewId) {
      if (!isUuid(previewId) || rowIds.length !== 1 || typeof requestedQuantities?.[rowIds[0]] !== 'number') {
        return jsonResponse(400, { error: 'A valid refreshed preview and requested count are required.' });
      }
      const result = await queueAppRiverLicenseCleanupPreview(repositoryContext.pool, {
        actor: auth.principal.email ?? auth.principal.name,
        previewId,
        rowId: rowIds[0],
        requestedQuantity: requestedQuantities[rowIds[0]],
      });
      if (result.queued > 0) {
        enqueueAppRiverLicenseCleanupWorker(context, result.batchId);
      }
      return jsonResponse(202, {
        reportType: 'appriver-license-cleanup-actions',
        ...result,
      });
    }

    const client = await createConfiguredAppRiverClient(repositoryContext.repository);
    const chargeEvents = await client.listChargeEvents({ pageSize: 1000, maxPages: 5 });
    const result = await queueAppRiverLicenseCleanupActions(repositoryContext.pool, {
      actor: auth.principal.email ?? auth.principal.name,
      rowIds,
      requestedQuantities,
      chargeEvents,
      liveClient: client,
    });

    if (result.queued > 0) {
      enqueueAppRiverLicenseCleanupWorker(context, result.batchId);
    }

    return jsonResponse(202, {
      reportType: 'appriver-license-cleanup-actions',
      ...result,
    });
  } catch (error) {
    return appRiverCleanupErrorResponse(error, 'Unable to queue AppRiver license cleanup actions.');
  } finally {
    await repositoryContext.close();
  }
}

export async function refreshAppRiverLicenseCleanupCandidateHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  if (!hasLicenseActionRole(auth.principal)) {
    return jsonResponse(403, {
      error: 'The Admin or License Admin role is required to refresh AppRiver cleanup counts.',
    });
  }

  const bodyResult = await readJsonBody<RefreshLicenseCleanupBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const rowId = typeof bodyResult.body.rowId === 'string' ? bodyResult.body.rowId.trim() : '';
  if (!rowId) {
    return jsonResponse(400, { error: 'Choose an AppRiver cleanup row to refresh.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: 'AppRiver license cleanup needs PostgreSQL settings before counts can be refreshed.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const client = await createConfiguredAppRiverClient(repositoryContext.repository);
    const chargeEvents = await client.listChargeEvents({ pageSize: 1000, maxPages: 5 });
    const preview = await refreshAppRiverLicenseCleanupCandidate(repositoryContext.pool, {
      actor: auth.principal.email ?? auth.principal.name,
      rowId,
      chargeEvents,
      liveClient: client,
    });
    if (!preview) {
      return jsonResponse(404, { error: 'This cleanup row is no longer available in the latest AppRiver audit.' });
    }
    return jsonResponse(200, {
      reportType: 'appriver-license-cleanup-preview',
      ...preview,
    });
  } catch (error) {
    return appRiverCleanupErrorResponse(error, 'Unable to refresh the AppRiver subscription count.');
  } finally {
    await repositoryContext.close();
  }
}

export async function listAppRiverLicenseCleanupActionsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'AppRiver license cleanup needs PostgreSQL settings before actions can be loaded.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      reportType: 'appriver-license-cleanup-actions',
      ...(await listAppRiverLicenseCleanupActions(repositoryContext.pool, {
        limit: boundedInteger(request.query.get('limit'), 200, 1, 500),
      })),
    });
  } catch (error) {
    return appRiverCleanupErrorResponse(error, 'Unable to load AppRiver license cleanup actions.');
  } finally {
    await repositoryContext.close();
  }
}

export async function cancelAppRiverLicenseCleanupActionHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  if (!hasLicenseActionRole(auth.principal)) {
    return jsonResponse(403, {
      error: 'The Admin or License Admin role is required to cancel AppRiver license cleanup actions.',
    });
  }

  const actionId = request.params.actionId;
  if (!actionId || !isUuid(actionId)) {
    return jsonResponse(400, {
      error: 'AppRiver cleanup action id must be a UUID.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'AppRiver license cleanup needs PostgreSQL settings before actions can be canceled.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const result = await cancelAppRiverLicenseCleanupAction(repositoryContext.pool, {
      actionId,
      actor: auth.principal.email ?? auth.principal.name,
    });
    if (!result.cancelled) {
      return jsonResponse(result.action ? 409 : 404, result);
    }

    return jsonResponse(200, result);
  } catch (error) {
    return appRiverCleanupErrorResponse(error, 'Unable to cancel AppRiver license cleanup action.');
  } finally {
    await repositoryContext.close();
  }
}

export async function dismissAppRiverLicenseCleanupActionHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  if (!hasLicenseActionRole(auth.principal)) {
    return jsonResponse(403, {
      error: 'The Admin or License Admin role is required to dismiss AppRiver license cleanup actions.',
    });
  }

  const actionId = request.params.actionId;
  if (!actionId || !isUuid(actionId)) {
    return jsonResponse(400, {
      error: 'AppRiver cleanup action id must be a UUID.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'AppRiver license cleanup needs PostgreSQL settings before actions can be dismissed.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const result = await dismissAppRiverLicenseCleanupAction(repositoryContext.pool, {
      actionId,
      actor: auth.principal.email ?? auth.principal.name,
    });
    if (!result.dismissed) {
      return jsonResponse(result.action ? 409 : 404, result);
    }

    return jsonResponse(200, result);
  } catch (error) {
    return appRiverCleanupErrorResponse(error, 'Unable to dismiss AppRiver license cleanup action.');
  } finally {
    await repositoryContext.close();
  }
}

export async function processAppRiverLicenseCleanupQueueMessage(
  message: AppRiverLicenseCleanupQueueMessage | string,
  context: InvocationContext,
) {
  const parsed = parseAppRiverLicenseCleanupQueueMessage(message);
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    throw new Error(`AppRiver license cleanup needs PostgreSQL settings before it can process batch ${parsed.batchId}.`);
  }

  try {
    const client = await createConfiguredAppRiverClient(repositoryContext.repository);
    const result = await processNextAppRiverLicenseCleanupAction({
      database: repositoryContext.pool,
      client,
      batchId: parsed.batchId,
    });
    context.log(
      `AppRiver license cleanup batch ${parsed.batchId}: ${result.status}${result.actionId ? ` ${result.actionId}` : ''}.`,
    );

    if (result.shouldContinue) {
      enqueueAppRiverLicenseCleanupWorker(context, result.batchId ?? parsed.batchId);
    }
  } finally {
    await repositoryContext.close();
  }
}

export async function processAppRiverLicenseCleanupTimer(_timer: unknown, context: InvocationContext) {
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return;
  }

  try {
    if (!(await hasDueAppRiverLicenseCleanupWork(repositoryContext.pool))) {
      return;
    }

    const client = await createConfiguredAppRiverClient(repositoryContext.repository);
    const result = await processNextAppRiverLicenseCleanupAction({
      database: repositoryContext.pool,
      client,
    });
    context.log(`AppRiver license cleanup timer: ${result.status}${result.actionId ? ` ${result.actionId}` : ''}.`);
  } finally {
    await repositoryContext.close();
  }
}

app.http('queueAppRiverLicenseCleanupActions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies/appriver-license-cleanup/actions',
  extraOutputs: [appRiverLicenseCleanupQueueOutput],
  handler: queueAppRiverLicenseCleanupActionsHttp,
});

app.http('refreshAppRiverLicenseCleanupCandidate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies/appriver-license-cleanup/preview',
  handler: refreshAppRiverLicenseCleanupCandidateHttp,
});

app.http('listAppRiverLicenseCleanupActions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies/appriver-license-cleanup/actions',
  handler: listAppRiverLicenseCleanupActionsHttp,
});

app.http('cancelAppRiverLicenseCleanupAction', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies/appriver-license-cleanup/actions/{actionId}/cancel',
  handler: cancelAppRiverLicenseCleanupActionHttp,
});

app.http('dismissAppRiverLicenseCleanupAction', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies/appriver-license-cleanup/actions/{actionId}/dismiss',
  handler: dismissAppRiverLicenseCleanupActionHttp,
});

app.storageQueue<AppRiverLicenseCleanupQueueMessage | string>('processAppRiverLicenseCleanupQueueMessage', {
  queueName: appRiverLicenseCleanupQueueName,
  connection: 'AzureWebJobsStorage',
  extraOutputs: [appRiverLicenseCleanupQueueOutput],
  handler: processAppRiverLicenseCleanupQueueMessage,
});

app.timer('processAppRiverLicenseCleanupTimer', {
  schedule: '0 */1 * * * *',
  handler: processAppRiverLicenseCleanupTimer,
});

async function createConfiguredAppRiverClient(metadataReader: IntegrationSettingsMetadataReader) {
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader,
  });
  const settings = await provider.getIntegrationSettings('opentext-appriver');
  assertAppRiverReady(settings);
  return createAppRiverClient(settings);
}

function enqueueAppRiverLicenseCleanupWorker(context: InvocationContext, batchId: string) {
  context.extraOutputs?.set(appRiverLicenseCleanupQueueOutput, {
    batchId,
  } satisfies AppRiverLicenseCleanupQueueMessage);
}

function parseAppRiverLicenseCleanupQueueMessage(message: AppRiverLicenseCleanupQueueMessage | string) {
  const parsed =
    typeof message === 'string'
      ? (JSON.parse(message) as Partial<AppRiverLicenseCleanupQueueMessage>)
      : message;

  if (!parsed.batchId) {
    throw new Error('AppRiver license cleanup queue message is missing batchId.');
  }

  return {
    batchId: parsed.batchId,
  };
}

function parseRequestedQuantities(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const parsed: Record<string, number> = {};
  for (const [rowId, quantity] of Object.entries(value)) {
    const numericQuantity = typeof quantity === 'number' ? quantity : typeof quantity === 'string' ? Number(quantity) : NaN;
    if (rowId.trim().length > 0 && Number.isFinite(numericQuantity)) {
      parsed[rowId] = Math.trunc(numericQuantity);
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

async function hasDueAppRiverLicenseCleanupWork(database: { query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> }) {
  const result = await database.query<{ count: string | number }>(
    `select count(*) as count
     from appriver_license_cleanup_actions
     where (
       (status = 'queued' and next_check_at <= now())
       or (status in ('running', 'reviewing', 'updating') and updated_at <= now() - interval '5 minutes')
       or (
         status = 'confirm'
         and next_check_at <= now()
         and not exists (
           select 1
           from appriver_license_cleanup_actions pending_update
           where pending_update.status in ('queued', 'running', 'reviewing', 'updating')
         )
       )
     )`,
  );

  return Number(result.rows[0]?.count ?? 0) > 0;
}

function appRiverCleanupErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AppRiverApiError) {
    return jsonResponse(502, {
      error: error.message || fallback,
      status: error.status,
    });
  }

  return jsonResponse(500, {
    error: error instanceof Error ? error.message : fallback,
  });
}
