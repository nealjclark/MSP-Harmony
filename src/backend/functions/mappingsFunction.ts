import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import {
  ConnectWiseClient,
  connectWiseCredentialsFromSettings,
  type ConnectWiseCatalogItem,
} from '../connectwise/client';
import { assertConnectWiseReady } from '../connectwise/operations';
import {
  applyApprovedMappings,
  approveSuggestedAccountMappings,
  listMappingState,
  runAccountAutomap,
  searchConnectWiseProductCatalog,
  updateAccountMapping,
  updateProductMapping,
  upsertConnectWiseCatalogProducts,
  type ProductCatalogSearchResult,
  type MappingStatus,
  type ProductMappingTarget,
} from '../mapping/mappingService';
import {
  createUsageOverride,
  deactivateUsageOverride,
  listUsageOverrides,
  type CreateUsageOverrideInput,
} from '../mapping/usageOverridesService';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type AccountMappingBody = {
  status?: MappingStatus;
  customerId?: string;
  agreementId?: string;
  externalAccountName?: string;
  reviewedBy?: string;
};

type ProductMappingBody = {
  status?: MappingStatus;
  targetProducts?: ProductMappingTarget[];
  reviewedBy?: string;
};

type UsageOverrideBody = CreateUsageOverrideInput & {
  reviewedBy?: string;
};

export async function listMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Mapping review needs PostgreSQL settings before it can load mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, await listMappingState(repositoryContext.pool, integrationId));
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function automapMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Automapping needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const body = (await request.json().catch(() => ({}))) as { actor?: string };

  try {
    const result = await runAccountAutomap(repositoryContext.pool, integrationId, {
      actor: typeof body.actor === 'string' ? body.actor : undefined,
    });

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to run automap.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function updateAccountMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  const externalAccountId = request.params.externalAccountId;
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!externalAccountId) {
    return jsonResponse(400, { error: 'Account mapping update requires externalAccountId.' });
  }

  const body = (await request.json().catch(() => ({}))) as AccountMappingBody;
  if (!isMappingStatus(body.status)) {
    return jsonResponse(400, { error: 'Account mapping update requires a valid status.' });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Account mapping update needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    await updateAccountMapping(repositoryContext.pool, integrationId, externalAccountId, {
      status: body.status,
      customerId: body.customerId,
      agreementId: body.agreementId,
      externalAccountName: body.externalAccountName,
      reviewedBy: body.reviewedBy,
    });

    return jsonResponse(200, {
      vendorId: integrationId,
      externalAccountId,
      status: body.status,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to update account mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function updateProductMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  const vendorProductKey = request.params.vendorProductKey;
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!vendorProductKey) {
    return jsonResponse(400, { error: 'Product mapping update requires vendorProductKey.' });
  }

  const body = (await request.json().catch(() => ({}))) as ProductMappingBody;
  if (!isMappingStatus(body.status)) {
    return jsonResponse(400, { error: 'Product mapping update requires a valid status.' });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product mapping update needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    await updateProductMapping(repositoryContext.pool, integrationId, vendorProductKey, {
      status: body.status,
      targetProducts: body.targetProducts,
      reviewedBy: body.reviewedBy,
    });

    return jsonResponse(200, {
      vendorId: integrationId,
      vendorProductKey,
      status: body.status,
      targetCount: body.targetProducts?.length ?? 0,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to update product mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function searchProductCatalogHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product catalog search needs PostgreSQL settings before it can load products.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const query = request.query.get('query')?.trim() ?? '';
  const limit = boundedInteger(request.query.get('limit'), 25, 1, 50);
  let connectWiseWarning: string | undefined;
  let liveTargets: ProductCatalogSearchResult[] = [];

  try {
    try {
      const provider = createIntegrationSettingsProvider({
        loadLocalEnv: true,
        metadataReader: repositoryContext.repository,
      });
      const settings = await provider.getIntegrationSettings('connectwise');
      assertConnectWiseReady(settings);
      const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
      const catalogItems = await searchLiveConnectWiseCatalog(client, query, limit);
      liveTargets = catalogItems.map(catalogItemToTarget);
      await upsertConnectWiseCatalogProducts(repositoryContext.pool, liveTargets);
    } catch (error) {
      connectWiseWarning = error instanceof Error
        ? `Live ConnectWise catalog search failed: ${error.message}`
        : 'Live ConnectWise catalog search failed.';
    }

    const localTargets = await searchConnectWiseProductCatalog(repositoryContext.pool, { query, limit });
    const targets = mergeProductCatalogTargets([...liveTargets, ...localTargets]).slice(0, limit);

    return jsonResponse(200, {
      query,
      targets,
      source: liveTargets.length > 0 ? 'connectwise' : 'local',
      warning: connectWiseWarning,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to search product catalog.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function applyMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Applying mappings needs PostgreSQL settings before it can update snapshots.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, await applyApprovedMappings(repositoryContext.pool, integrationId));
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to apply mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function approveSuggestedMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Approving suggested mappings needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const body = (await request.json().catch(() => ({}))) as { actor?: string };

  try {
    return jsonResponse(
      200,
      await approveSuggestedAccountMappings(repositoryContext.pool, integrationId, {
        actor: typeof body.actor === 'string' ? body.actor : undefined,
      }),
    );
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to approve suggested mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listUsageOverridesHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Usage overrides need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      vendorId: integrationId,
      overrides: await listUsageOverrides(repositoryContext.pool, integrationId),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load usage overrides.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function createUsageOverrideHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const body = (await request.json().catch(() => ({}))) as UsageOverrideBody;
  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Usage override creation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      vendorId: integrationId,
      override: await createUsageOverride(repositoryContext.pool, integrationId, {
        customerId: body.customerId,
        agreementId: body.agreementId,
        sourceVendorProductKey: body.sourceVendorProductKey,
        targetVendorProductKey: body.targetVendorProductKey,
        dimensionFilters: body.dimensionFilters,
        targetDimensions: body.targetDimensions,
        reason: body.reason,
        reviewedBy: body.reviewedBy,
      }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to create usage override.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deactivateUsageOverrideHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = parseIntegrationId(request.params.vendorId);
  const overrideId = request.params.overrideId;
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!overrideId) {
    return jsonResponse(400, { error: 'Usage override deactivation requires overrideId.' });
  }

  const body = (await request.json().catch(() => ({}))) as { reviewedBy?: string };
  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Usage override deactivation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await deactivateUsageOverride(repositoryContext.pool, integrationId, overrideId, {
        reviewedBy: body.reviewedBy,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to deactivate usage override.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listMappings', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'mappings/{vendorId}',
  handler: listMappingsHttp,
});

app.http('automapMappings', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/automap',
  handler: automapMappingsHttp,
});

app.http('updateAccountMapping', {
  methods: ['PUT'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/accounts/{externalAccountId}',
  handler: updateAccountMappingHttp,
});

app.http('updateProductMapping', {
  methods: ['PUT'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/products/{vendorProductKey}',
  handler: updateProductMappingHttp,
});

app.http('searchProductCatalog', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/product-catalog',
  handler: searchProductCatalogHttp,
});

app.http('applyMappings', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/apply',
  handler: applyMappingsHttp,
});

app.http('approveSuggestedMappings', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/approve-suggested',
  handler: approveSuggestedMappingsHttp,
});

app.http('listUsageOverrides', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/overrides',
  handler: listUsageOverridesHttp,
});

app.http('createUsageOverride', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/overrides',
  handler: createUsageOverrideHttp,
});

app.http('deactivateUsageOverride', {
  methods: ['DELETE', 'POST'],
  authLevel: 'function',
  route: 'mappings/{vendorId}/overrides/{overrideId}/deactivate',
  handler: deactivateUsageOverrideHttp,
});

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function unsupportedVendorResponse(value: string | undefined) {
  return jsonResponse(400, {
    error: `Mapping is not available for integration "${value ?? 'unknown'}".`,
  });
}

function isMappingStatus(value: unknown): value is MappingStatus {
  return value === 'candidate' || value === 'approved' || value === 'needs-review' || value === 'rejected';
}

async function searchLiveConnectWiseCatalog(client: ConnectWiseClient, query: string, limit: number) {
  const conditions = query ? catalogSearchConditions(query) : undefined;
  try {
    return await client.listCatalogItems({
      page: 1,
      pageSize: limit,
      orderBy: 'identifier',
      conditions,
    });
  } catch (error) {
    if (!conditions) {
      throw error;
    }

    const fallbackItems = await client.listCatalogItems({
      page: 1,
      pageSize: Math.max(limit, 100),
      orderBy: 'identifier',
    });
    const normalizedQuery = query.toLowerCase();
    return fallbackItems
      .filter((item) =>
        [item.identifier, item.description, String(item.id)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, limit);
  }
}

function catalogSearchConditions(query: string) {
  const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `(identifier like "%${escaped}%" OR description like "%${escaped}%")`;
}

function catalogItemToTarget(item: ConnectWiseCatalogItem): ProductCatalogSearchResult & { rawPayload: unknown } {
  const code = item.identifier?.trim() || String(item.id);
  const name = item.description?.trim() || item.identifier?.trim() || code;
  return {
    connectwiseProductId: String(item.id),
    connectwiseProductCode: code,
    connectwiseProductName: name,
    source: 'connectwise',
    rawPayload: item,
  };
}

function mergeProductCatalogTargets(targets: ProductCatalogSearchResult[]) {
  const byCode = new Map<string, ProductCatalogSearchResult>();
  for (const target of targets) {
    const existing = byCode.get(target.connectwiseProductCode);
    if (!existing || existing.source === 'local') {
      byCode.set(target.connectwiseProductCode, target);
    }
  }

  return [...byCode.values()];
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}
