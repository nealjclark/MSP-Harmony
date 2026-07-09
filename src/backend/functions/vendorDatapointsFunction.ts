import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationDataSourceType, type IntegrationId } from '../../shared/integrationSettings';
import type { InvoiceTableColumnMap, ManualImportSyncMode, VendorDatapointImportMode } from '../../shared/vendorDatapoints';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';
import {
  createVendorDatapoint,
  getVendorDatapoint,
  importVendorDatapointFile,
  listVendorDatapoints,
  updateVendorDatapoint,
} from '../vendorDatapoints/vendorDatapointsService';

loadDotEnv({ override: false });

type CreateVendorDatapointBody = {
  displayName?: string;
  description?: string;
  linkedIntegrationId?: string;
  sourceType?: string;
  syncMode?: string;
  columnMap?: InvoiceTableColumnMap;
  knownHeaders?: string[];
  defaultImportMode?: string;
};

type UpdateVendorDatapointBody = CreateVendorDatapointBody & {
  active?: boolean;
};

type ImportVendorDatapointBody = {
  fileName?: string;
  content?: string;
  columnMap?: InvoiceTableColumnMap;
  importMode?: string;
  persistColumnMap?: boolean;
};

export async function listVendorDatapointsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Vendor datapoints need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      datapoints: await listVendorDatapoints(repositoryContext.pool),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to list vendor datapoints.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function createVendorDatapointHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as CreateVendorDatapointBody;
  if (!body.displayName?.trim() || !body.sourceType) {
    return jsonResponse(400, {
      error: 'Vendor datapoint requires displayName and sourceType.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Vendor datapoints need PostgreSQL settings before they can be created.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(201, {
      datapoint: await createVendorDatapoint(repositoryContext.pool, {
        displayName: body.displayName,
        description: body.description,
        linkedIntegrationId: parseIntegrationId(body.linkedIntegrationId),
        sourceType: body.sourceType,
        syncMode: parseSyncMode(body.syncMode),
        columnMap: body.columnMap,
        knownHeaders: body.knownHeaders,
        defaultImportMode: parseImportMode(body.defaultImportMode),
      }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to create vendor datapoint.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getVendorDatapointHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const datapointId = request.params.datapointId;
  if (!datapointId) {
    return jsonResponse(400, { error: 'Vendor datapoint id is required.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Vendor datapoints need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const datapoint = await getVendorDatapoint(repositoryContext.pool, datapointId);
    if (!datapoint) {
      return jsonResponse(404, { error: 'Vendor datapoint was not found.' });
    }

    return jsonResponse(200, { datapoint });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load vendor datapoint.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function updateVendorDatapointHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const datapointId = request.params.datapointId;
  if (!datapointId) {
    return jsonResponse(400, { error: 'Vendor datapoint id is required.' });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateVendorDatapointBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Vendor datapoints need PostgreSQL settings before they can be updated.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const datapoint = await updateVendorDatapoint(repositoryContext.pool, datapointId, {
      displayName: body.displayName,
      description: body.description,
      linkedIntegrationId:
        body.linkedIntegrationId === undefined
          ? undefined
          : body.linkedIntegrationId
            ? parseIntegrationId(body.linkedIntegrationId)
            : null,
      sourceType: body.sourceType,
      syncMode: body.syncMode ? parseSyncMode(body.syncMode) : undefined,
      columnMap: body.columnMap,
      knownHeaders: body.knownHeaders,
      defaultImportMode: body.defaultImportMode ? parseImportMode(body.defaultImportMode) : undefined,
      active: body.active,
    });
    if (!datapoint) {
      return jsonResponse(404, { error: 'Vendor datapoint was not found.' });
    }

    return jsonResponse(200, { datapoint });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to update vendor datapoint.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function importVendorDatapointHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const datapointId = request.params.datapointId;
  if (!datapointId) {
    return jsonResponse(400, { error: 'Vendor datapoint id is required.' });
  }

  const body = (await request.json().catch(() => ({}))) as ImportVendorDatapointBody;
  if (!body.fileName?.trim() || typeof body.content !== 'string') {
    return jsonResponse(400, {
      error: 'Vendor datapoint import requires fileName and file content.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Vendor datapoint import needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const result = await importVendorDatapointFile(repositoryContext.pool, datapointId, {
      fileName: body.fileName.trim(),
      content: body.content,
      columnMap: body.columnMap,
      importMode: body.importMode ? parseImportMode(body.importMode) : undefined,
      persistColumnMap: body.persistColumnMap,
    });

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to import vendor datapoint file.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listVendorDatapoints', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vendor-datapoints',
  handler: listVendorDatapointsHttp,
});

app.http('createVendorDatapoint', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'vendor-datapoints',
  handler: createVendorDatapointHttp,
});

app.http('getVendorDatapoint', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vendor-datapoints/{datapointId}',
  handler: getVendorDatapointHttp,
});

app.http('updateVendorDatapoint', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'vendor-datapoints/{datapointId}',
  handler: updateVendorDatapointHttp,
});

app.http('importVendorDatapoint', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'vendor-datapoints/{datapointId}/import',
  handler: importVendorDatapointHttp,
});

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function parseSyncMode(value: string | undefined): ManualImportSyncMode | undefined {
  return value === 'info-only' ? 'info-only' : value === 'full-vendor-sync' ? 'full-vendor-sync' : undefined;
}

function parseImportMode(value: string | undefined): VendorDatapointImportMode | undefined {
  return value === 'overwrite' ? 'overwrite' : value === 'merge' ? 'merge' : undefined;
}
