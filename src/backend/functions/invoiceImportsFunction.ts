import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationDataSourceType, type IntegrationId } from '../../shared/integrationSettings';
import { isVendorDatapointId, vendorSupportsInvoiceImport, type VendorKey } from '../../shared/vendorDatapoints';
import {
  deleteInvoiceImport,
  detectInvoiceVendor,
  getInvoiceImportExceptionReview,
  importMappedInvoiceTableCsv,
  type InvoiceImportMode,
  type ManualImportSyncMode,
  type InvoiceTableColumnMap,
  importAppRiverInvoiceCsv,
  listInvoiceImports,
  refreshInvoiceImportMappings,
  supportedInvoiceVendorIds,
} from '../invoices/appriverInvoiceImports';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, readJsonBody, requireMutatingRequestOrigin } from './runtime';

loadDotEnv({ override: false });

type InvoiceImportBody = {
  fileName?: string;
  content?: string;
  importMode?: string;
  linkedIntegrationId?: string;
  columnMap?: InvoiceTableColumnMap;
  sourceType?: string;
  syncMode?: string;
};

export async function importDetectedInvoiceHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const bodyResult = await readJsonBody<InvoiceImportBody>(request, { limit: 'import', fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
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

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  if (request.params.vendorId !== 'opentext-appriver') {
    return jsonResponse(400, {
      error: `Invoice import is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
      supportedVendorIds: supportedInvoiceVendorIds,
    });
  }

  const bodyResult = await readJsonBody<InvoiceImportBody>(request, { limit: 'import', fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
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

export async function importMappedInvoiceTableHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseRegistryIntegrationId(request.params.vendorId);
  if (!vendorId || !integrationSupportsRegistryInvoiceImport(vendorId)) {
    return unsupportedInvoiceVendorResponse(request.params.vendorId);
  }

  const bodyResult = await readJsonBody<InvoiceImportBody>(request, { limit: 'import', fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : undefined;
  const content = typeof body.content === 'string' ? body.content : undefined;
  const importMode = parseInvoiceImportMode(body.importMode);
  const columnMap = body.columnMap && typeof body.columnMap === 'object' ? body.columnMap : undefined;
  const sourceType = parseInvoiceImportSourceType(body.sourceType);
  const syncMode = parseManualImportSyncMode(body.syncMode);
  const linkedIntegrationId = parseRegistryIntegrationId(body.linkedIntegrationId);

  if (!fileName || !content || !columnMap) {
    return jsonResponse(400, {
      error: 'Invoice table import requires fileName, file content, and columnMap.',
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
        vendorId,
        vendorName: getIntegrationSettingsDefinition(vendorId)?.displayName ?? vendorId,
        confidence: 'high',
        reason: 'User selected this integration and mapped invoice table columns.',
      },
      import: await importMappedInvoiceTableCsv(repositoryContext.pool, {
        vendorId,
        linkedIntegrationId,
        fileName,
        content,
        columnMap,
        sourceType,
        syncMode,
        importMode,
      }),
      importMode,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to import mapped invoice table.',
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
  const datapointId = request.query.get('datapointId')?.trim() || undefined;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice imports need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      imports: await listInvoiceImports(repositoryContext.pool, { vendorId, datapointId }),
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
  if (!vendorId || !vendorSupportsInvoiceImport(vendorId)) {
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

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseIntegrationId(request.params.vendorId);
  const importId = request.params.importId;
  if (!vendorId || !vendorSupportsInvoiceImport(vendorId)) {
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

export async function deleteInvoiceImportHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseIntegrationId(request.params.vendorId);
  const importId = request.params.importId;
  if (!vendorId || !vendorSupportsInvoiceImport(vendorId)) {
    return unsupportedInvoiceVendorResponse(request.params.vendorId);
  }
  if (!importId) {
    return jsonResponse(400, { error: 'Invoice import delete requires importId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Invoice import delete needs PostgreSQL settings before it can update.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const deleted = await deleteInvoiceImport(repositoryContext.pool, vendorId, importId);
    if (!deleted) {
      return jsonResponse(404, { error: 'Invoice import was not found.' });
    }

    return jsonResponse(200, { import: deleted });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to delete invoice import.',
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

app.http('importMappedInvoiceTable', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}/table',
  handler: importMappedInvoiceTableHttp,
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

app.http('deleteInvoiceImport', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}/{importId}',
  handler: deleteInvoiceImportHttp,
});

function parseRegistryIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function parseIntegrationId(value: string | undefined): VendorKey | undefined {
  if (!value) {
    return undefined;
  }

  if (vendorSupportsInvoiceImport(value)) {
    return value as VendorKey;
  }

  return undefined;
}

function parseInvoiceImportMode(value: string | undefined): InvoiceImportMode {
  return value === 'overwrite' ? 'overwrite' : 'merge';
}

function parseManualImportSyncMode(value: string | undefined): ManualImportSyncMode {
  return value === 'info-only' ? 'info-only' : 'full-vendor-sync';
}

function parseInvoiceImportSourceType(value: string | undefined): IntegrationDataSourceType | undefined {
  if (
    value === 'user-license-detail' ||
    value === 'customer-product-breakdown' ||
    value === 'reseller-product-total' ||
    value === 'device-count' ||
    value === 'invoice' ||
    value === 'license-count'
  ) {
    return value;
  }

  return undefined;
}

function integrationSupportsRegistryInvoiceImport(value: IntegrationId) {
  return supportedInvoiceVendorIds.includes(value);
}

function unsupportedInvoiceVendorResponse(value: string | undefined): HttpResponseInit {
  return jsonResponse(400, {
    error: `Invoice import is not available for integration "${value ?? 'unknown'}".`,
    supportedVendorIds: supportedInvoiceVendorIds,
  });
}
