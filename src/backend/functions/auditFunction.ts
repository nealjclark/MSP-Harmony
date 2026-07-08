import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import {
  getAuditBatchDetail,
  getAuditEvent,
  listAuditBatches,
  listAuditEvents,
  listAuditSyncRuns,
} from '../audit/auditHistory';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

function parseLimit(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function listAuditSyncRunsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Audit history needs PostgreSQL settings before sync activity can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      runs: await listAuditSyncRuns(repositoryContext.pool, { limit: parseLimit(request.query.get('limit')) }),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load audit sync runs.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listAuditEventsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Audit history needs PostgreSQL settings before events can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const limit = parseLimit(request.query.get('limit'));
  const view = request.query.get('view') === 'batch' ? 'batch' : 'timeline';

  try {
    if (view === 'batch') {
      return jsonResponse(200, {
        view,
        batches: await listAuditBatches(repositoryContext.pool, { limit }),
      });
    }

    return jsonResponse(200, {
      view,
      events: await listAuditEvents(repositoryContext.pool, { limit }),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load audit events.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getAuditEventHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const eventId = request.params.eventId;
  if (!eventId) {
    return jsonResponse(400, {
      error: 'Missing audit event id.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Audit history needs PostgreSQL settings before event details can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const event = await getAuditEvent(repositoryContext.pool, eventId);
    if (!event) {
      return jsonResponse(404, {
        error: 'Audit event was not found.',
      });
    }

    return jsonResponse(200, { event });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load audit event.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getAuditBatchHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const batchId = request.params.batchId;
  if (!batchId) {
    return jsonResponse(400, {
      error: 'Missing approval batch id.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Audit history needs PostgreSQL settings before batch details can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const batch = await getAuditBatchDetail(repositoryContext.pool, batchId);
    if (!batch) {
      return jsonResponse(404, {
        error: 'Approval batch was not found.',
      });
    }

    return jsonResponse(200, { batch });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load approval batch.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listAuditSyncRuns', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/sync-runs',
  handler: listAuditSyncRunsHttp,
});

app.http('listAuditEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/events',
  handler: listAuditEventsHttp,
});

app.http('getAuditEvent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/events/{eventId}',
  handler: getAuditEventHttp,
});

app.http('getAuditBatch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/batches/{batchId}',
  handler: getAuditBatchHttp,
});
