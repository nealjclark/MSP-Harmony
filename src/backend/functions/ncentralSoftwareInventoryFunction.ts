import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as XLSX from '@e965/xlsx';
import { config as loadDotEnv } from 'dotenv';
import JSZip from 'jszip';
import { createIntegrationSettingsProvider, type IntegrationSettingsMetadataReader } from '../config/settingsProvider';
import {
  cleanupExpiredSoftwareInventoryReports,
  collectSoftwareInventoryBatch,
  createSoftwareInventoryReport,
  discoverSoftwareInventoryDevices,
  failSoftwareInventoryReport,
  getSoftwareInventoryApplicationDevices,
  getSoftwareInventoryCounts,
  getSoftwareInventoryDetails,
  getSoftwareInventoryReport,
  listSoftwareInventoryReports,
  listSoftwareInventoryScopes,
  type SoftwareInventoryScopeType,
} from '../reports/ncentralSoftwareInventory';
import { NcentralApiError, NcentralClient, ncentralCredentialsFromSettings } from '../vendor/ncentral/client';
import { assertNcentralReady } from '../vendor/ncentral/operations';
import { requireRole } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';

loadDotEnv({ override: false });

type SoftwareInventoryQueueMessage = {
  reportId: string;
};

type QueueSoftwareInventoryBody = {
  scopeType?: unknown;
  customerId?: unknown;
  siteId?: unknown;
};

const softwareInventoryQueueName = 'ncentral-software-inventory-work';
const softwareInventoryQueueOutput = output.storageQueue({
  queueName: softwareInventoryQueueName,
  connection: 'AzureWebJobsStorage',
});

export async function listSoftwareInventoryScopesHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) {
    return jsonResponse(400, {
      error: 'Software inventory reporting needs PostgreSQL settings.',
      missingDatabaseSettings: repository.missingDatabaseSettings,
    });
  }
  try {
    const client = await createConfiguredNcentralClient(repository.repository);
    return jsonResponse(200, await listSoftwareInventoryScopes(repository.pool, client));
  } catch (error) {
    return softwareInventoryError(context, error, 'Unable to load N-central customers and sites.');
  } finally {
    await repository.close();
  }
}

export async function queueSoftwareInventoryReportHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const bodyResult = await readJsonBody<QueueSoftwareInventoryBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const scopeType = text(bodyResult.body.scopeType) as SoftwareInventoryScopeType | undefined;
  const customerId = text(bodyResult.body.customerId);
  const siteId = text(bodyResult.body.siteId);
  if ((scopeType !== 'customer' && scopeType !== 'site') || !customerId || (scopeType === 'site' && !siteId)) {
    return jsonResponse(400, { error: 'Choose a valid N-central customer or site before running the report.' });
  }

  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) {
    return jsonResponse(400, {
      error: 'Software inventory reporting needs PostgreSQL settings.',
      missingDatabaseSettings: repository.missingDatabaseSettings,
    });
  }
  try {
    const client = await createConfiguredNcentralClient(repository.repository);
    const scopes = await listSoftwareInventoryScopes(repository.pool, client);
    const customer = scopes.customers.find((candidate) => candidate.customerId === customerId);
    const site = scopeType === 'site' ? customer?.sites.find((candidate) => candidate.siteId === siteId) : undefined;
    if (!customer || (scopeType === 'site' && !site)) {
      return jsonResponse(400, { error: 'The selected N-central customer or site is no longer available.' });
    }
    const result = await createSoftwareInventoryReport(repository.pool, {
      scopeType,
      customerId: customer.customerId,
      customerName: customer.customerName,
      siteId: site?.siteId,
      siteName: site?.siteName,
      requestedBy: auth.principal.email ?? auth.principal.name,
    });
    if (result.created) enqueueSoftwareInventoryWorker(context, result.report.id);
    return jsonResponse(result.created ? 202 : 200, {
      report: result.report,
      queued: result.created,
      existing: !result.created,
      jobId: result.report.id,
    });
  } catch (error) {
    return softwareInventoryError(context, error, 'Unable to queue the N-central software inventory report.');
  } finally {
    await repository.close();
  }
}

export async function listSoftwareInventoryReportsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, {
    reports: await listSoftwareInventoryReports(database, queryInteger(request, 'limit', 50)),
  }));
}

export async function getSoftwareInventoryReportHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => {
    const report = await getSoftwareInventoryReport(database, request.params.reportId ?? '');
    return report ? jsonResponse(200, { report }) : jsonResponse(404, { error: 'Software inventory report was not found.' });
  });
}

export async function getSoftwareInventoryCountsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, await getSoftwareInventoryCounts(
    database,
    request.params.reportId ?? '',
    pagingOptions(request),
  )));
}

export async function getSoftwareInventoryDetailsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, await getSoftwareInventoryDetails(
    database,
    request.params.reportId ?? '',
    pagingOptions(request),
  )));
}

export async function getSoftwareInventoryApplicationDevicesHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const applicationName = text(request.query.get('applicationName'));
  if (!applicationName) return jsonResponse(400, { error: 'Choose a software application to view its devices.' });
  return withDatabase(context, async (database) => {
    const reportId = request.params.reportId ?? '';
    const report = await getSoftwareInventoryReport(database, reportId);
    if (!report) return jsonResponse(404, { error: 'Software inventory report was not found.' });
    return jsonResponse(200, {
      applicationName,
      devices: await getSoftwareInventoryApplicationDevices(database, reportId, applicationName),
    });
  });
}

export async function exportSoftwareInventoryReportHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Software inventory export needs PostgreSQL settings.' });
  try {
    const reportId = request.params.reportId ?? '';
    const report = await getSoftwareInventoryReport(repository.pool, reportId);
    if (!report) return jsonResponse(404, { error: 'Software inventory report was not found.' });
    if (!['complete', 'partial'].includes(report.status)) {
      return jsonResponse(409, { error: 'The software inventory report is not ready to export.' });
    }
    const counts = await getSoftwareInventoryCounts(repository.pool, reportId, { pageSize: 1048575 });
    const workbook = XLSX.utils.book_new();
    appendSheet(workbook, counts.rows.map((row) => ({
      Software: row.applicationName,
      Devices: row.deviceCount,
      Installations: row.installationCount,
      Publishers: row.publishers.join('; '),
      Versions: row.versions.join('; '),
    })), 'Counts');

    const detailPageSize = 1048575;
    const firstDetails = await getSoftwareInventoryDetails(repository.pool, reportId, { pageSize: detailPageSize });
    const detailPages = Math.max(1, Math.ceil(firstDetails.total / detailPageSize));
    for (let page = 1; page <= detailPages; page += 1) {
      const details = page === 1
        ? firstDetails
        : await getSoftwareInventoryDetails(repository.pool, reportId, { page, pageSize: detailPageSize });
      appendSheet(workbook, details.rows.map((row) => ({
        Customer: row.customerName,
        Site: row.siteName ?? '',
        Device: row.deviceName,
        'Device ID': row.deviceId,
        'Device class': row.deviceClass ?? '',
        'Last user': row.lastUser ?? '',
        Software: row.applicationName ?? '',
        Publisher: row.publisher ?? '',
        Version: row.version ?? '',
        'Install date': row.installDate ?? '',
        'Install location': row.installLocation ?? '',
        'Collection status': row.collectionStatus,
        'Collection error': row.collectionError ?? '',
      })), detailPages === 1 ? 'Full details' : `Full details ${page}`);
    }
    const workbookBytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const bytes = await freezeWorkbookHeaderRows(workbookBytes);
    return {
      status: 200,
      body: bytes,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeFilePart(report.customerName)}${report.siteName ? `-${safeFilePart(report.siteName)}` : ''}-Software-Inventory.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    };
  } catch (error) {
    return softwareInventoryError(context, error, 'Unable to export the software inventory report.');
  } finally {
    await repository.close();
  }
}

export async function processSoftwareInventoryQueueMessage(
  message: SoftwareInventoryQueueMessage | string,
  context: InvocationContext,
) {
  const parsed = parseQueueMessage(message);
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) throw new Error('Software inventory worker needs PostgreSQL settings.');
  try {
    const report = await getSoftwareInventoryReport(repository.pool, parsed.reportId);
    if (!report || ['complete', 'partial', 'failed'].includes(report.status)) return;
    const client = await createConfiguredNcentralClient(repository.repository);
    if (report.status === 'queued') {
      const discovered = await discoverSoftwareInventoryDevices(repository.pool, report.id, client);
      if (discovered?.status === 'running') enqueueSoftwareInventoryWorker(context, report.id);
      return;
    }
    const result = await collectSoftwareInventoryBatch(repository.pool, report.id, client, { batchSize: 10, concurrency: 5 });
    if (result.hasRemaining) enqueueSoftwareInventoryWorker(context, report.id);
  } catch (error) {
    if (isFatalNcentralError(error) || isFinalQueueDelivery(context)) {
      await failSoftwareInventoryReport(
        repository.pool,
        parsed.reportId,
        error instanceof Error ? error.message : 'Software inventory worker failed.',
      );
      context.error('N-central software inventory report failed.', error);
      return;
    }
    throw error;
  } finally {
    await repository.close();
  }
}

export async function cleanupSoftwareInventoryReportsTimer(_timer: unknown, context: InvocationContext) {
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return;
  try {
    const removed = await cleanupExpiredSoftwareInventoryReports(repository.pool);
    if (removed > 0) context.log(`Removed ${removed} expired N-central software inventory report(s).`);
  } finally {
    await repository.close();
  }
}

app.http('listNcentralSoftwareInventoryScopes', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/scopes', handler: listSoftwareInventoryScopesHttp,
});
app.http('queueNcentralSoftwareInventoryReport', {
  methods: ['POST'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory', extraOutputs: [softwareInventoryQueueOutput], handler: queueSoftwareInventoryReportHttp,
});
app.http('listNcentralSoftwareInventoryReports', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory', handler: listSoftwareInventoryReportsHttp,
});
app.http('getNcentralSoftwareInventoryReport', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/{reportId:guid}', handler: getSoftwareInventoryReportHttp,
});
app.http('getNcentralSoftwareInventoryCounts', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/{reportId:guid}/counts', handler: getSoftwareInventoryCountsHttp,
});
app.http('getNcentralSoftwareInventoryDetails', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/{reportId:guid}/details', handler: getSoftwareInventoryDetailsHttp,
});
app.http('getNcentralSoftwareInventoryApplicationDevices', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/{reportId:guid}/application-devices', handler: getSoftwareInventoryApplicationDevicesHttp,
});
app.http('exportNcentralSoftwareInventoryReport', {
  methods: ['GET'], authLevel: 'anonymous', route: 'reports/ncentral-software-inventory/{reportId:guid}/export', handler: exportSoftwareInventoryReportHttp,
});
app.storageQueue<SoftwareInventoryQueueMessage | string>('processNcentralSoftwareInventoryQueue', {
  queueName: softwareInventoryQueueName,
  connection: 'AzureWebJobsStorage',
  extraOutputs: [softwareInventoryQueueOutput],
  handler: processSoftwareInventoryQueueMessage,
});
app.timer('cleanupNcentralSoftwareInventoryReports', {
  schedule: '0 15 3 * * *', handler: cleanupSoftwareInventoryReportsTimer,
});

async function createConfiguredNcentralClient(metadataReader: IntegrationSettingsMetadataReader) {
  const provider = createIntegrationSettingsProvider({ loadLocalEnv: true, metadataReader });
  const settings = await provider.getIntegrationSettings('ncentral');
  assertNcentralReady(settings);
  return new NcentralClient(ncentralCredentialsFromSettings(settings));
}

async function withDatabase(
  context: InvocationContext,
  handler: (database: NonNullable<Awaited<ReturnType<typeof createOptionalPostgresSettingsRepository>>['pool']>) => Promise<HttpResponseInit>,
) {
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Software inventory reporting needs PostgreSQL settings.' });
  try {
    return await handler(repository.pool);
  } catch (error) {
    return softwareInventoryError(context, error, 'Unable to load the software inventory report.');
  } finally {
    await repository.close();
  }
}

function enqueueSoftwareInventoryWorker(context: InvocationContext, reportId: string) {
  context.extraOutputs?.set(softwareInventoryQueueOutput, { reportId } satisfies SoftwareInventoryQueueMessage);
}

function parseQueueMessage(message: SoftwareInventoryQueueMessage | string) {
  const parsed = typeof message === 'string' ? JSON.parse(message) as Partial<SoftwareInventoryQueueMessage> : message;
  if (!parsed.reportId) throw new Error('Software inventory queue message is missing reportId.');
  return { reportId: parsed.reportId };
}

function pagingOptions(request: HttpRequest) {
  return {
    page: queryInteger(request, 'page', 1),
    pageSize: queryInteger(request, 'pageSize', 100),
    search: request.query.get('search') ?? undefined,
    sortBy: request.query.get('sortBy') ?? undefined,
    sortDirection: request.query.get('sortDirection') ?? undefined,
  };
}

function queryInteger(request: HttpRequest, name: string, fallback: number) {
  const parsed = Number(request.query.get(name));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function appendSheet(workbook: XLSX.WorkBook, rows: Record<string, unknown>[], name: string) {
  const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Message: 'No rows found.' }]);
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

export async function freezeWorkbookHeaderRows(bytes: Buffer) {
  const workbook = await JSZip.loadAsync(bytes);
  const worksheets = Object.values(workbook.files).filter((file) => /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name));
  await Promise.all(worksheets.map(async (file) => {
    const xml = await file.async('string');
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
    const frozen = xml.replace(
      /<sheetView([^>]*)\/>/,
      `<sheetView$1>${pane}</sheetView>`,
    ).replace(
      /<sheetView([^>]*)>(?!<pane\b)/,
      `<sheetView$1>${pane}`,
    );
    workbook.file(file.name, frozen);
  }));
  return Buffer.from(await workbook.generateAsync({ type: 'nodebuffer' }));
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'N-central';
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isFatalNcentralError(error: unknown) {
  return error instanceof NcentralApiError && (error.status === 401 || error.status === 403);
}

function isFinalQueueDelivery(context: InvocationContext) {
  const metadata = context.triggerMetadata as Record<string, unknown> | undefined;
  const count = Number(metadata?.dequeueCount ?? metadata?.DequeueCount ?? 0);
  return Number.isFinite(count) && count >= 5;
}

function softwareInventoryError(context: InvocationContext, error: unknown, fallback: string) {
  if (error instanceof NcentralApiError) {
    return jsonResponse(error.status === 401 || error.status === 403 ? 502 : error.status === 404 ? 404 : 502, {
      error: fallback,
      detail: error.message,
      status: error.status,
    });
  }
  return serverErrorResponse(context, error, fallback, 'ncentral_software_inventory_failed');
}
