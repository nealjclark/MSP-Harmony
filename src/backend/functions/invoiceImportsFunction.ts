import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { type IntegrationId, getIntegrationSettingsDefinition } from '../../shared/integrationSettings';
import {
  detectInvoiceVendor,
  getInvoiceImportExceptionReview,
  type InvoiceImportMode,
  importAppRiverInvoiceCsv,
  listInvoiceImports,
  refreshInvoiceImportMappings,
  supportedInvoiceVendorIds,
} from '../invoices/appriverInvoiceImports';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type InvoiceImportBody = {
  fileName?: string;
  content?: string;
  importMode?: string;
};

export async function importDetectedInvoiceHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as InvoiceImportBody;
  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : undefined;
  const content = typeof body.content === 'string' ? body.content : undefined;
  const importMode = parseInvoiceImportMode(body.importMode);

  if (!fileName || !content) {
    return jsonResponse(400, {
      error: 'Invoice import requires fileName and CSV content.',
    });
  }

  const detectedVendor = detectInvoiceVendor({ fileName, content });
  if (!detectedVendor) {
    return jsonResponse(400, {
      error: 'Unable to detect a supported invoice vendor from this CSV.',
      supportedVendorIds: supportedInvoiceVendorIds,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice import needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    if (detectedVendor.vendorId === 'opentext-appriver') {
      return jsonResponse(200, {
        detectedVendor,
        import: await importAppRiverInvoiceCsv(repositoryContext.pool, { fileName, content, importMode }),
        importMode,
      });
    }

    return unsupportedInvoiceVendorResponse(detectedVendor.vendorId);
  } catch (error) {
    return jsonResponse(400, {
      detectedVendor,
      error: error instanceof Error ? error.message : 'Unable to import invoice CSV.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function importAppRiverInvoiceHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  if (request.params.vendorId !== 'opentext-appriver') {
    return jsonResponse(400, {
      error: `Invoice import is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
      supportedVendorIds: supportedInvoiceVendorIds,
    });
  }

  const body = (await request.json().catch(() => ({}))) as InvoiceImportBody;
  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : undefined;
  const content = typeof body.content === 'string' ? body.content : undefined;
  const importMode = parseInvoiceImportMode(body.importMode);

  if (!fileName || !content) {
    return jsonResponse(400, {
      error: 'AppRiver invoice import requires fileName and CSV content.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice import needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      detectedVendor: {
        vendorId: 'opentext-appriver',
        vendorName: 'AppRiver - OpenText',
        confidence: 'high',
        reason: 'Vendor-specific import route was used.',
      },
      import: await importAppRiverInvoiceCsv(repositoryContext.pool, { fileName, content, importMode }),
      importMode,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to import AppRiver invoice CSV.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listInvoiceImportsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const vendorId = parseIntegrationId(request.query.get('vendorId') ?? undefined);
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice imports need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      imports: await listInvoiceImports(repositoryContext.pool, { vendorId }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load invoice imports.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getInvoiceImportExceptionsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const vendorId = parseIntegrationId(request.params.vendorId);
  const importId = request.params.importId;
  if (vendorId !== 'opentext-appriver') {
    return unsupportedInvoiceVendorResponse(request.params.vendorId);
  }
  if (!importId) {
    return jsonResponse(400, { error: 'Invoice exception review requires importId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice exception review needs PostgreSQL settings before it can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const review = await getInvoiceImportExceptionReview(repositoryContext.pool, vendorId, importId);
    if (!review) {
      return jsonResponse(404, { error: 'Invoice import was not found.' });
    }

    return jsonResponse(200, review);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load invoice exception review.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function refreshInvoiceImportMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const vendorId = parseIntegrationId(request.params.vendorId);
  const importId = request.params.importId;
  if (vendorId !== 'opentext-appriver') {
    return unsupportedInvoiceVendorResponse(request.params.vendorId);
  }
  if (!importId) {
    return jsonResponse(400, { error: 'Invoice mapping refresh requires importId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice mapping refresh needs PostgreSQL settings before it can update.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const result = await refreshInvoiceImportMappings(repositoryContext.pool, vendorId, importId);
    if (!result) {
      return jsonResponse(404, { error: 'Invoice import was not found.' });
    }

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to refresh invoice mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('importAppRiverInvoice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}',
  handler: importAppRiverInvoiceHttp,
});

app.http('importDetectedInvoice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoice-imports',
  handler: importDetectedInvoiceHttp,
});

app.http('listInvoiceImports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoice-imports',
  handler: listInvoiceImportsHttp,
});

app.http('getInvoiceImportExceptions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}/{importId}/exceptions',
  handler: getInvoiceImportExceptionsHttp,
});

app.http('refreshInvoiceImportMappings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}/{importId}/refresh-mappings',
  handler: refreshInvoiceImportMappingsHttp,
});

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function parseInvoiceImportMode(value: string | undefined): InvoiceImportMode {
  return value === 'overwrite' ? 'overwrite' : 'merge';
}

function unsupportedInvoiceVendorResponse(value: string | undefined): HttpResponseInit {
  return jsonResponse(400, {
    error: `Invoice import is not available for integration "${value ?? 'unknown'}".`,
    supportedVendorIds: supportedInvoiceVendorIds,
  });
}
