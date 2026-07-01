import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { type IntegrationId, getIntegrationSettingsDefinition } from '../../shared/integrationSettings';
import { type InvoiceImportMode, importAppRiverInvoiceCsv, listInvoiceImports } from '../invoices/appriverInvoiceImports';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type InvoiceImportBody = {
  fileName?: string;
  content?: string;
  importMode?: string;
};

export async function importAppRiverInvoiceHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  if (request.params.vendorId !== 'opentext-appriver') {
    return jsonResponse(400, {
      error: `Invoice import is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
      supportedVendorIds: ['opentext-appriver'],
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

app.http('importAppRiverInvoice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoice-imports/{vendorId}',
  handler: importAppRiverInvoiceHttp,
});

app.http('listInvoiceImports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoice-imports',
  handler: listInvoiceImportsHttp,
});

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function parseInvoiceImportMode(value: string | undefined): InvoiceImportMode {
  return value === 'overwrite' ? 'overwrite' : 'merge';
}
