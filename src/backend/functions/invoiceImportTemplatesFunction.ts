import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getIntegrationSettingsDefinition, type IntegrationDataSourceType, type IntegrationId } from '../../shared/integrationSettings';
import type { InvoiceTableColumnMap } from '../../shared/vendorDatapoints';
import {
  createInvoiceImportTemplate,
  listInvoiceImportTemplates,
  setInvoiceImportTemplateArchived,
  updateInvoiceImportTemplate,
} from '../invoices/invoiceImportTemplatesService';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, readJsonBody, requireMutatingRequestOrigin } from './runtime';

type TemplateBody = {
  integrationId?: string;
  name?: string;
  dataSourceKey?: string;
  sourceType?: string;
  columnMap?: InvoiceTableColumnMap;
  knownHeaders?: string[];
  expectedVersion?: number;
};

export async function listInvoiceImportTemplatesHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const integrationId = integrationIdValue(request.query.get('integrationId'));
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice templates require PostgreSQL settings.' });
  try {
    return jsonResponse(200, { templates: await listInvoiceImportTemplates(repository.pool, integrationId) });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to load invoice templates.' });
  }
}

export async function createInvoiceImportTemplateHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<TemplateBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const input = templateInput(bodyResult.body);
  if (!input) return jsonResponse(400, { error: 'Integration, name, source type, and column mapping are required.' });
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice templates require PostgreSQL settings.' });
  try {
    return jsonResponse(201, { template: await createInvoiceImportTemplate(repository.pool, input, auth.principal.email ?? auth.principal.name) });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to create invoice template.' });
  }
}

export async function updateInvoiceImportTemplateHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<TemplateBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const input = templateInput(bodyResult.body);
  if (!input || !request.params.templateId) return jsonResponse(400, { error: 'A valid template update is required.' });
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice templates require PostgreSQL settings.' });
  try {
    const template = await updateInvoiceImportTemplate(repository.pool, request.params.templateId, input,
      auth.principal.email ?? auth.principal.name, bodyResult.body.expectedVersion);
    return template ? jsonResponse(200, { template }) : jsonResponse(409, { error: 'Template changed; reload before saving.' });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to update invoice template.' });
  }
}

export async function setInvoiceImportTemplateArchiveHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice templates require PostgreSQL settings.' });
  const archived = request.params.action === 'archive';
  const template = request.params.templateId
    ? await setInvoiceImportTemplateArchived(repository.pool, request.params.templateId, archived, auth.principal.email ?? auth.principal.name)
    : undefined;
  return template ? jsonResponse(200, { template }) : jsonResponse(404, { error: 'Invoice template was not found.' });
}

app.http('listInvoiceImportTemplates', { methods: ['GET'], authLevel: 'anonymous', route: 'invoice-import-templates', handler: listInvoiceImportTemplatesHttp });
app.http('createInvoiceImportTemplate', { methods: ['POST'], authLevel: 'anonymous', route: 'invoice-import-templates', handler: createInvoiceImportTemplateHttp });
app.http('updateInvoiceImportTemplate', { methods: ['PUT'], authLevel: 'anonymous', route: 'invoice-import-templates/{templateId}', handler: updateInvoiceImportTemplateHttp });
app.http('setInvoiceImportTemplateArchive', { methods: ['POST'], authLevel: 'anonymous', route: 'invoice-import-templates/{templateId}/{action}', handler: setInvoiceImportTemplateArchiveHttp });

function integrationIdValue(value: string | null | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? value as IntegrationId : undefined;
}

function templateInput(body: TemplateBody) {
  const integrationId = integrationIdValue(body.integrationId);
  if (!integrationId || !body.name?.trim() || !body.sourceType || !body.columnMap) return undefined;
  return {
    integrationId,
    name: body.name.trim(),
    dataSourceKey: body.dataSourceKey?.trim() || undefined,
    sourceType: body.sourceType as IntegrationDataSourceType,
    columnMap: body.columnMap,
    knownHeaders: body.knownHeaders,
  };
}
