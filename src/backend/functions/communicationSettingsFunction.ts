import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import {
  getCommunicationSettings,
  updateCommunicationSettings,
} from '../config/communicationSettingsService';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function getCommunicationSettingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    const settings = await getCommunicationSettings(repositoryContext.pool);
    return jsonResponse(200, { settings });
  } catch (error) {
    return communicationSettingsErrorResponse(error, 'Unable to load communication settings.');
  } finally {
    await repositoryContext.close();
  }
}

export async function updateCommunicationSettingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  try {
    const settings = await updateCommunicationSettings(
      repositoryContext.pool,
      body as Record<string, unknown>,
      auth.principal.email ?? auth.principal.name,
    );
    return jsonResponse(200, { settings });
  } catch (error) {
    return communicationSettingsErrorResponse(error, 'Unable to save communication settings.');
  } finally {
    await repositoryContext.close();
  }
}

app.http('getCommunicationSettings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'settings/communication',
  handler: getCommunicationSettingsHttp,
});

app.http('updateCommunicationSettings', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'settings/communication',
  handler: updateCommunicationSettingsHttp,
});

function missingDatabaseResponse(missingDatabaseSettings: string[]) {
  return jsonResponse(500, {
    error: 'PostgreSQL settings are required to manage communication settings.',
    missingDatabaseSettings,
  });
}

function communicationSettingsErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return jsonResponse(400, {
    error: message,
  });
}
