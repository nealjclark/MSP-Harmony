import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { listIntegrationSettingsDefinitions } from '../../shared/integrationSettings';
import { getAgreementReportDetails, listAgreementReportSyncRuns } from '../reports/agreementReports';
import { getRawSyncDetails, isRawSyncIntegrationId, listRawSyncRuns } from '../reports/rawSyncReports';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function listAgreementReportSyncRunsHttp(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Agreement reporting needs PostgreSQL settings before it can load sync runs.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const runs = await listAgreementReportSyncRuns(repositoryContext.pool);

    return jsonResponse(200, {
      reportType: 'agreements',
      runs,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load agreement report sync runs.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getAgreementReportDetailsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const syncRunId = request.params.syncRunId;
  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Agreement reporting needs PostgreSQL settings before it can load sync details.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const details = syncRunId ? await getAgreementReportDetails(repositoryContext.pool, syncRunId) : undefined;

    if (!details) {
      return jsonResponse(404, {
        error: 'Agreement report sync run was not found.',
      });
    }

    return jsonResponse(200, details);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load agreement report details.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listRawSyncRunsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = request.query.get('integrationId') ?? undefined;

  if (!isRawSyncIntegrationId(integrationId)) {
    return jsonResponse(400, {
      error: 'Raw sync report requires a supported integrationId.',
      supportedIntegrationIds: listIntegrationSettingsDefinitions().map((definition) => definition.integrationId),
    });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Raw sync reporting needs PostgreSQL settings before it can load sync runs.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const runs = await listRawSyncRuns(repositoryContext.pool, integrationId);

    return jsonResponse(200, {
      reportType: 'raw-sync',
      integrationId,
      runs,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load raw sync runs.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getRawSyncDetailsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = request.query.get('integrationId') ?? undefined;
  const syncRunId = request.params.syncRunId;

  if (!isRawSyncIntegrationId(integrationId)) {
    return jsonResponse(400, {
      error: 'Raw sync report requires a supported integrationId.',
      supportedIntegrationIds: listIntegrationSettingsDefinitions().map((definition) => definition.integrationId),
    });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Raw sync reporting needs PostgreSQL settings before it can load sync details.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const details = syncRunId ? await getRawSyncDetails(repositoryContext.pool, integrationId, syncRunId) : undefined;

    if (!details) {
      return jsonResponse(404, {
        error: 'Raw sync run was not found.',
      });
    }

    return jsonResponse(200, details);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load raw sync details.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listAgreementReportSyncRuns', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'reports/agreement-sync-runs',
  handler: listAgreementReportSyncRunsHttp,
});

app.http('getAgreementReportDetails', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'reports/agreement-sync-runs/{syncRunId}/details',
  handler: getAgreementReportDetailsHttp,
});

app.http('listRawSyncRuns', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'reports/raw-sync-runs',
  handler: listRawSyncRunsHttp,
});

app.http('getRawSyncDetails', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'reports/raw-sync-runs/{syncRunId}/details',
  handler: getRawSyncDetailsHttp,
});
