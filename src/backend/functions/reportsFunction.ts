import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { listIntegrationSettingsDefinitions } from '../../shared/integrationSettings';
import { getAgreementReportDetails, listAgreementReportSyncRuns } from '../reports/agreementReports';
import {
  getCustomerLicenseReport,
  isCustomerLicenseReportVendorId,
  listCustomerLicenseReportCustomers,
} from '../reports/customerLicenseReports';
import {
  getDiscrepancyReport,
  isDiscrepancyBasis,
  isDiscrepancySeverity,
} from '../reports/discrepancyReports';
import { getProductProfitabilityReport, type ProductProfitabilityReport } from '../reports/productProfitabilityReports';
import {
  getSavedProductProfitabilityReport,
  listSavedProductProfitabilityReports,
  saveProductProfitabilityReport,
} from '../reports/savedProductProfitabilityReports';
import { getRawSyncDetails, isRawSyncIntegrationId, listRawSyncRuns } from '../reports/rawSyncReports';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseClient, connectWiseCredentialsFromSettings } from '../connectwise/client';
import { assertConnectWiseReady } from '../connectwise/operations';
import { listClosedTicketsInRange, syncClosedTicketsForRange } from '../connectwise/ticketSync';
import { listAllActiveLaborMappings } from '../mapping/laborMappings';
import { hasMinimumRole, requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function listAgreementReportSyncRunsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();

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
  const repositoryContext = await createOptionalPostgresSettingsRepository();

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

  const repositoryContext = await createOptionalPostgresSettingsRepository();

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

  const repositoryContext = await createOptionalPostgresSettingsRepository();

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

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product profitability reporting needs PostgreSQL settings before it can load profitability data.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const vendorIds = parseVendorIdsQuery(request.query.get('vendorIds'));
    const report = await buildLiveProductProfitabilityReport(repositoryContext, { vendorIds });
    return jsonResponse(200, report);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load product profitability report.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listSavedProductProfitabilityReportsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Saved profitability reports need PostgreSQL settings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const reports = await listSavedProductProfitabilityReports(repositoryContext.pool);
    return jsonResponse(200, { reports });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to list saved profitability reports.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getSavedProductProfitabilityReportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const savedId = request.params.id;
  if (!savedId || !isUuid(savedId)) {
    return jsonResponse(400, {
      error: 'Saved profitability report id must be a UUID.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Saved profitability reports need PostgreSQL settings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const saved = await getSavedProductProfitabilityReport(repositoryContext.pool, savedId);
    if (!saved) {
      return jsonResponse(404, {
        error: 'Saved profitability report was not found.',
      });
    }
    return jsonResponse(200, saved);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load saved profitability report.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function saveProductProfitabilityReportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    vendorIds?: string[];
    report?: ProductProfitabilityReport;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return jsonResponse(400, {
      error: 'Saved report name is required.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Saved profitability reports need PostgreSQL settings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const vendorIds = Array.isArray(body.vendorIds)
      ? body.vendorIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const report =
      body.report && body.report.reportType === 'product-profitability'
        ? body.report
        : await buildLiveProductProfitabilityReport(repositoryContext, { vendorIds });

    const saved = await saveProductProfitabilityReport(repositoryContext.pool, {
      name,
      vendorIds,
      report,
      createdBy: auth.principal.email ?? auth.principal.name,
    });

    return jsonResponse(201, saved);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to save profitability report.',
    });
  } finally {
    await repositoryContext.close();
  }
}

async function buildLiveProductProfitabilityReport(
  repositoryContext: Awaited<ReturnType<typeof createOptionalPostgresSettingsRepository>>,
  options: { vendorIds?: string[] } = {},
) {
  const pool = repositoryContext.pool;
  if (!pool) {
    throw new Error('PostgreSQL pool is required for product profitability reporting.');
  }

  const laborMappings = await listAllActiveLaborMappings(pool).catch(() => []);
  let laborWarning: string | undefined;
  let laborTickets: Awaited<ReturnType<typeof listClosedTicketsInRange>> = [];

  const monthCount = 12;
  const endExclusive = new Date();
  endExclusive.setUTCDate(1);
  endExclusive.setUTCHours(0, 0, 0, 0);
  endExclusive.setUTCMonth(endExclusive.getUTCMonth() + 1);
  const startInclusive = new Date(endExclusive);
  startInclusive.setUTCMonth(startInclusive.getUTCMonth() - monthCount);

  if (laborMappings.length > 0) {
    try {
      const provider = createIntegrationSettingsProvider({
        loadLocalEnv: true,
        metadataReader: repositoryContext.repository,
      });
      const settings = await provider.getIntegrationSettings('connectwise');
      assertConnectWiseReady(settings);
      const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
      const boardIds = [
        ...new Set(
          laborMappings
            .map((mapping) => mapping.boardId)
            .filter((boardId): boardId is number => typeof boardId === 'number'),
        ),
      ];
      await syncClosedTicketsForRange(pool, client, {
        startInclusive,
        endExclusive,
        boardIds: boardIds.length > 0 ? boardIds : undefined,
      });
      laborTickets = await listClosedTicketsInRange(pool, {
        startInclusive,
        endExclusive,
      });
    } catch (error) {
      laborWarning =
        error instanceof Error
          ? `Labor hours unavailable: ${error.message}`
          : 'Labor hours unavailable from ConnectWise tickets.';
      laborTickets = await listClosedTicketsInRange(pool, {
        startInclusive,
        endExclusive,
      }).catch(() => []);
    }
  }

  return getProductProfitabilityReport(pool, {
    monthCount,
    vendorIds: options.vendorIds,
    laborMappings,
    laborTickets,
    laborWarning,
  });
}

function parseVendorIdsQuery(value: string | null) {
  if (!value || !value.trim()) {
    return undefined;
  }
  const vendorIds = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return vendorIds.length > 0 ? vendorIds : undefined;
}

export async function getDiscrepancyReportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const customerId = request.query.get('customerId') ?? undefined;
  const basis = request.query.get('basis') ?? undefined;
  const severity = request.query.get('severity') ?? undefined;
  const includeMatched = booleanQueryValue(request.query.get('includeMatched'));

  if (customerId && !isUuid(customerId)) {
    return jsonResponse(400, {
      error: 'Discrepancy report customerId must be a UUID.',
    });
  }

  if (basis && !isDiscrepancyBasis(basis)) {
    return jsonResponse(400, {
      error: 'Discrepancy report basis must be "user" or "device".',
      supportedBasis: ['user', 'device'],
    });
  }

  if (severity && !isDiscrepancySeverity(severity)) {
    return jsonResponse(400, {
      error: 'Discrepancy report severity is not supported.',
      supportedSeverities: ['matched', 'warning', 'critical', 'unavailable'],
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Discrepancy reporting needs PostgreSQL settings before it can compare vendor data.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, await getDiscrepancyReport(repositoryContext.pool, {
      customerId,
      basis: isDiscrepancyBasis(basis) ? basis : undefined,
      severity: isDiscrepancySeverity(severity) ? severity : undefined,
      includeMatched,
    }));
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load discrepancy report.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listCustomerLicenseReportCustomersHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Customer license reporting needs PostgreSQL settings before it can load customers.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, await listCustomerLicenseReportCustomers(repositoryContext.pool));
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load customer license report customers.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getCustomerLicenseReportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const customerId = request.query.get('customerId') ?? undefined;
  const vendorId = request.query.get('vendorId') ?? undefined;
  const monthCount = boundedInteger(request.query.get('monthCount'), 12, 1, 24);
  const includeMicrosoftUserDetails = booleanQueryValue(request.query.get('includeMicrosoftUserDetails'));

  if (!customerId || !isUuid(customerId)) {
    return jsonResponse(400, {
      error: 'Customer license report customerId must be a UUID.',
    });
  }

  if (!isCustomerLicenseReportVendorId(vendorId)) {
    return jsonResponse(400, {
      error: 'Customer license report requires a supported vendorId.',
      supportedVendorIds: ['all', 'cove', 'ncentral', 'microsoft-365', 'opentext-appriver'],
    });
  }

  if (
    includeMicrosoftUserDetails &&
    (vendorId === 'microsoft-365' || vendorId === 'all') &&
    !hasMinimumRole(auth.principal, 'Admin')
  ) {
    return jsonResponse(403, {
      error: 'The Admin role is required to include Microsoft 365 licensed user details.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Customer license reporting needs PostgreSQL settings before it can generate a report.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const report = await getCustomerLicenseReport(repositoryContext.pool, {
      customerId,
      vendorId,
      monthCount,
      includeMicrosoftUserDetails:
        vendorId === 'microsoft-365' || vendorId === 'all' ? includeMicrosoftUserDetails : false,
    });

    if (!report) {
      return jsonResponse(404, {
        error: 'Customer was not found.',
      });
    }

    return jsonResponse(200, report);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to generate customer license report.',
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

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
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

app.http('listSavedProductProfitabilityReports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/product-profitability/saved',
  handler: listSavedProductProfitabilityReportsHttp,
});

app.http('getSavedProductProfitabilityReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/product-profitability/saved/{id}',
  handler: getSavedProductProfitabilityReportHttp,
});

app.http('saveProductProfitabilityReport', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/product-profitability/saved',
  handler: saveProductProfitabilityReportHttp,
});

app.http('getDiscrepancyReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/discrepancies',
  handler: getDiscrepancyReportHttp,
});

app.http('listCustomerLicenseReportCustomers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/customer-license/customers',
  handler: listCustomerLicenseReportCustomersHttp,
});

app.http('getCustomerLicenseReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/customer-license',
  handler: getCustomerLicenseReportHttp,
});
