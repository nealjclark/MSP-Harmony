import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { createHash, randomUUID } from 'node:crypto';
import { getIntegrationSettingsDefinition, type IntegrationDataSourceType, type IntegrationId } from '../../shared/integrationSettings';
import type { InvoiceTableColumnMap } from '../../shared/vendorDatapoints';
import { deleteInvoiceFile, downloadInvoiceFile, safeFileName, storeInvoiceFile } from '../invoices/invoiceFileStorage';
import { importMappedInvoiceTableCsv, previewMappedInvoiceTableCsv } from '../invoices/appriverInvoiceImports';
import {
  createInvoiceImportTemplate,
  getInvoiceImportTemplate,
  recordInvoiceHeaderSignature,
} from '../invoices/invoiceImportTemplatesService';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, requireMutatingRequestOrigin } from './runtime';

type UploadMetadata = {
  integrationId: string;
  templateId?: string;
  templateVersion?: number;
  templateName?: string;
  dataSourceKey?: string;
  sourceType: IntegrationDataSourceType;
  columnMap: InvoiceTableColumnMap;
  headers: string[];
  normalizedContent: string;
  tableLocator?: string;
  previewHash?: string;
};

export async function previewVendorInvoiceHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const parsed = await readInvoiceForm(request);
  if ('response' in parsed) return parsed.response;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice preview requires PostgreSQL settings.' });
  try {
    const hash = sha256(parsed.bytes);
    const preview = await previewMappedInvoiceTableCsv(repository.pool, {
      vendorId: parsed.integrationId,
      dataSourceKey: parsed.metadata.dataSourceKey,
      fileName: parsed.fileName,
      content: parsed.metadata.normalizedContent,
      columnMap: parsed.metadata.columnMap,
      sourceType: parsed.metadata.sourceType,
      syncMode: 'full-vendor-sync',
      templateId: parsed.metadata.templateId,
      templateVersion: parsed.metadata.templateVersion,
      sourceTableLocator: parsed.metadata.tableLocator,
      fileHash: hash,
    });
    return jsonResponse(200, { preview });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to preview vendor invoice.' });
  }
}

export async function approveVendorInvoiceHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const parsed = await readInvoiceForm(request);
  if ('response' in parsed) return parsed.response;
  const hash = sha256(parsed.bytes);
  if (parsed.metadata.previewHash && parsed.metadata.previewHash !== hash) {
    return jsonResponse(409, { error: 'The selected file changed after preview. Preview it again.' });
  }
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice import requires PostgreSQL settings.' });
  const existingTemplate = parsed.metadata.templateId
    ? await getInvoiceImportTemplate(repository.pool, parsed.metadata.templateId)
    : undefined;
  if (parsed.metadata.templateId && (!existingTemplate || existingTemplate.version !== parsed.metadata.templateVersion)) {
    return jsonResponse(409, { error: 'The invoice template changed after preview. Preview it again.' });
  }
  const preview = await previewMappedInvoiceTableCsv(repository.pool, {
    vendorId: parsed.integrationId,
    dataSourceKey: parsed.metadata.dataSourceKey,
    fileName: parsed.fileName,
    content: parsed.metadata.normalizedContent,
    columnMap: parsed.metadata.columnMap,
    sourceType: parsed.metadata.sourceType,
    sourceTableLocator: parsed.metadata.tableLocator,
    fileHash: hash,
  });
  if (preview.blockingErrors.length > 0) return jsonResponse(400, { error: preview.blockingErrors.join(' ') });

  const importId = randomUUID();
  let stored: Awaited<ReturnType<typeof storeInvoiceFile>> | undefined;
  const client = await repository.pool.connect();
  try {
    stored = await storeInvoiceFile({
      importId,
      integrationId: parsed.integrationId,
      fileName: parsed.fileName,
      contentType: parsed.contentType,
      bytes: parsed.bytes,
    });
    await client.query('begin');
    const actor = auth.principal.email ?? auth.principal.name;
    const template = existingTemplate ?? await createInvoiceImportTemplate(client, {
      integrationId: parsed.integrationId,
      name: parsed.metadata.templateName?.trim() || `${getIntegrationSettingsDefinition(parsed.integrationId)?.displayName ?? parsed.integrationId} invoice`,
      dataSourceKey: parsed.metadata.dataSourceKey,
      sourceType: parsed.metadata.sourceType,
      columnMap: parsed.metadata.columnMap,
      knownHeaders: parsed.metadata.headers,
    }, actor);
    if (!template) throw new Error('Unable to save the invoice template.');
    const imported = await importMappedInvoiceTableCsv(client, {
      importId,
      vendorId: parsed.integrationId,
      dataSourceKey: parsed.metadata.dataSourceKey,
      fileName: parsed.fileName,
      content: parsed.metadata.normalizedContent,
      columnMap: parsed.metadata.columnMap,
      sourceType: parsed.metadata.sourceType,
      syncMode: 'full-vendor-sync',
      templateId: template.id,
      templateName: template.name,
      templateVersion: template.version,
      importedBy: actor,
      originalBlobName: stored.blobName,
      originalContentType: stored.contentType,
      originalFileSize: stored.fileSize,
      originalSha256: stored.sha256,
      sourceTableLocator: parsed.metadata.tableLocator,
    });
    await recordInvoiceHeaderSignature(client, {
      templateId: template.id,
      headers: parsed.metadata.headers,
      columnMap: parsed.metadata.columnMap,
      fileName: parsed.fileName,
    });
    await client.query('commit');
    return jsonResponse(201, { import: imported, templateId: template.id });
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (stored) await deleteInvoiceFile(stored.blobName).catch(() => undefined);
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to approve vendor invoice.' });
  } finally {
    client.release();
  }
}

export async function downloadVendorInvoiceFileHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Invoice history requires PostgreSQL settings.' });
  const result = await repository.pool.query<{ file_name: string; original_blob_name: string | null; original_content_type: string | null }>(
    `select file_name, original_blob_name, original_content_type from invoice_imports where id = $1::uuid`,
    [request.params.importId],
  );
  const row = result.rows[0];
  if (!row?.original_blob_name) return jsonResponse(404, { error: 'The original invoice file is not available.' });
  const file = await downloadInvoiceFile(row.original_blob_name);
  return {
    status: 200,
    body: file.bytes,
    headers: {
      'Content-Type': row.original_content_type || file.contentType,
      'Content-Disposition': `attachment; filename="${safeFileName(row.file_name).replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  };
}

app.http('previewVendorInvoice', { methods: ['POST'], authLevel: 'anonymous', route: 'invoice-imports/preview', handler: previewVendorInvoiceHttp });
app.http('approveVendorInvoice', { methods: ['POST'], authLevel: 'anonymous', route: 'invoice-imports/approve', handler: approveVendorInvoiceHttp });
app.http('downloadVendorInvoiceFile', { methods: ['GET'], authLevel: 'anonymous', route: 'invoice-imports/{importId}/file', handler: downloadVendorInvoiceFileHttp });

async function readInvoiceForm(request: HttpRequest): Promise<{
  fileName: string; contentType: string; bytes: Buffer; metadata: UploadMetadata; integrationId: IntegrationId;
} | { response: HttpResponseInit }> {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const metadataRaw = form.get('metadata');
    if (!(file instanceof File) || typeof metadataRaw !== 'string') {
      return { response: jsonResponse(400, { error: 'Invoice file and metadata are required.' }) };
    }
    const metadata = JSON.parse(metadataRaw) as UploadMetadata;
    const integrationId = metadata.integrationId as IntegrationId;
    if (!getIntegrationSettingsDefinition(integrationId) || !metadata.normalizedContent || !metadata.columnMap) {
      return { response: jsonResponse(400, { error: 'A supported integration and mapped table are required.' }) };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const max = Number.parseInt(process.env.MAX_IMPORT_BODY_BYTES ?? '', 10) || 10 * 1024 * 1024;
    if (bytes.byteLength > max) return { response: jsonResponse(413, { error: 'Invoice file is too large.' }) };
    return { fileName: file.name, contentType: file.type || 'application/octet-stream', bytes, metadata, integrationId };
  } catch (error) {
    return { response: jsonResponse(400, { error: error instanceof Error ? error.message : 'Invalid invoice upload.' }) };
  }
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
