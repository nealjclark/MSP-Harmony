import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { listIntegrationSettingsDefinitions } from '../../shared/integrationSettings';
import { getAgreementReportDetails, listAgreementReportSyncRuns } from '../reports/agreementReports';
import { getProductProfitabilityReport } from '../reports/productProfitabilityReports';
import { getRawSyncDetails, isRawSyncIntegrationId, listRawSyncRuns } from '../reports/rawSyncReports';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function listAgreementReportSyncRunsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

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
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

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
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = request.query.get('integrationId') ?? undefined;
  const dataset = request.query.get('dataset') ?? undefined;

  if (!isRawSyncIntegrationId(integrationId)) {
    return jsonResponse(400, {
      error: 'Raw sync report requires a supported integrationId.',
      supportedIntegrationIds: listIntegrationSettingsDefinitions().map((definition) => definition.integrationId),
    });
  }

  if (dataset && (integrationId !== 'microsoft-365' || (dataset !== 'users' && dataset !== 'licenses'))) {
    return jsonResponse(400, {
      error: 'Raw sync report dataset is not supported for this integration.',
      supportedDatasets: integrationId === 'microsoft-365' ? ['users', 'licenses'] : [],
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
    const runs = await listRawSyncRuns(repositoryContext.pool, integrationId, {
      dataset: integrationId === 'microsoft-365' ? dataset === 'licenses' ? 'licenses' : 'users' : undefined,
    });

    return jsonResponse(200, {
      reportType: 'raw-sync',
      integrationId,
      dataset: integrationId === 'microsoft-365' ? dataset === 'licenses' ? 'licenses' : 'users' : undefined,
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
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = request.query.get('integrationId') ?? undefined;
  const dataset = request.query.get('dataset') ?? undefined;
  const customerId = request.query.get('customerId') ?? undefined;
  const includeSensitive = booleanQueryValue(request.query.get('includeSensitive') ?? request.query.get('includePii'));
  const syncRunId = request.params.syncRunId;

  if (!isRawSyncIntegrationId(integrationId)) {
    return jsonResponse(400, {
      error: 'Raw sync report requires a supported integrationId.',
      supportedIntegrationIds: listIntegrationSettingsDefinitions().map((definition) => definition.integrationId),
    });
  }

  if (dataset && (integrationId !== 'microsoft-365' || (dataset !== 'users' && dataset !== 'licenses'))) {
    return jsonResponse(400, {
      error: 'Raw sync report dataset is not supported for this integration.',
      supportedDatasets: integrationId === 'microsoft-365' ? ['users', 'licenses'] : [],
    });
  }

  if (customerId && !isUuid(customerId)) {
    return jsonResponse(400, {
      error: 'Raw sync report customerId must be a UUID.',
    });
  }

  if (includeSensitive && integrationId === 'microsoft-365' && !auth.principal.roles.includes('Admin')) {
    return jsonResponse(403, {
      error: 'The Admin role is required to include sensitive Microsoft 365 report fields.',
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
    const details = syncRunId
      ? await getRawSyncDetails(repositoryContext.pool, integrationId, syncRunId, {
          dataset: integrationId === 'microsoft-365' ? dataset === 'licenses' ? 'licenses' : 'users' : undefined,
          customerId,
          includeSensitive: integrationId === 'microsoft-365' ? includeSensitive : undefined,
        })
      : undefined;

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

export async function getProductProfitabilityReportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product profitability reporting needs PostgreSQL settings before it can load profitability data.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const report = await getProductProfitabilityReport(repositoryContext.pool);

    return jsonResponse(200, report);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load product profitability report.',
    });
  } finally {
    await repositoryContext.close();
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function booleanQueryValue(value: string | null) {
  return typeof value === 'string' && ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

app.http('listAgreementReportSyncRuns', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/agreement-sync-runs',
  handler: listAgreementReportSyncRunsHttp,
});

app.http('getAgreementReportDetails', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/agreement-sync-runs/{syncRunId}/details',
  handler: getAgreementReportDetailsHttp,
});

app.http('listRawSyncRuns', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/raw-sync-runs',
  handler: listRawSyncRunsHttp,
});

app.http('getRawSyncDetails', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/raw-sync-runs/{syncRunId}/details',
  handler: getRawSyncDetailsHttp,
});

app.http('getProductProfitabilityReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/product-profitability',
  handler: getProductProfitabilityReportHttp,
});
