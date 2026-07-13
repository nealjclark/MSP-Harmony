import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import { isVendorDatapointId, vendorSupportsMapping, type VendorKey } from '../../shared/vendorDatapoints';
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
  deleteProductLinkRule,
  deactivateProductLinkRule,
  deactivateProductBundle,
  listProductMappingCustomers,
  listMappingState,
  runAccountAutomap,
  searchConnectWiseProductCatalog,
  setProductLinkRuleActive,
  testProductLinkRule,
  updateAccountMapping,
  updateProductMapping,
  upsertProductLinkRule,
  upsertProductBundle,
  upsertConnectWiseCatalogProducts,
  type ProductCatalogSearchResult,
  type ProductBundleComponent,
  type UpsertProductLinkRuleInput,
  type MappingStatus,
  type ProductMappingTarget,
} from '../mapping/mappingService';
import {
  createUsageOverride,
  deactivateUsageOverride,
  listUsageOverrides,
  type CreateUsageOverrideInput,
} from '../mapping/usageOverridesService';
import {
  listLaborMappings,
  upsertLaborMapping,
} from '../mapping/laborMappings';
import {
  getInvestigationTicketMapping,
  upsertInvestigationTicketMapping,
} from '../mapping/investigationTicketMappings';
import {
  integrationSupportsLaborMapping,
  type ConnectWiseBoardOption,
  type ConnectWiseStatusOption,
  type ConnectWiseSubTypeOption,
  type ConnectWiseTypeOption,
  type UpsertLaborMappingInput,
} from '../../shared/laborMappings';
import {
  integrationSupportsInvestigationTicketMapping,
  type UpsertInvestigationTicketMappingInput,
} from '../../shared/investigationTicketMappings';
import { NcentralClient, ncentralCredentialsFromSettings } from '../vendor/ncentral/client';
import { assertNcentralReady } from '../vendor/ncentral/operations';
import {
  listNcentralFilterMappings,
  upsertNcentralFilterMapping,
  type UpsertNcentralFilterMappingInput,
} from '../vendor/ncentral/filterMappings';
import { requireRole } from './auth';
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

type ProductBundleBody = {
  bundleKey?: string;
  bundleName?: string;
  components?: ProductBundleComponent[];
  targetProduct?: ProductMappingTarget;
  reviewedBy?: string;
  active?: boolean;
};

type ProductLinkRuleBody = UpsertProductLinkRuleInput;

type UsageOverrideBody = CreateUsageOverrideInput & {
  reviewedBy?: string;
};

type NcentralFilterMappingBody = UpsertNcentralFilterMappingInput;

type LaborMappingBody = UpsertLaborMappingInput;

type InvestigationTicketMappingBody = UpsertInvestigationTicketMappingInput;

export async function listMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Automapping needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const result = await runAccountAutomap(repositoryContext.pool, integrationId, {
      actor: auth.principal.name,
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const externalAccountId = decodedRouteParam(request.params.externalAccountId);
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

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
      reviewedBy: auth.principal.name,
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const vendorProductKey = decodedRouteParam(request.params.vendorProductKey);
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

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
      reviewedBy: auth.principal.name,
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

export async function listProductMappingCustomersHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const vendorProductKey = decodedRouteParam(request.params.vendorProductKey);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!vendorProductKey) {
    return jsonResponse(400, { error: 'Product customer review requires vendorProductKey.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product customer review needs PostgreSQL settings before it can load customers.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await listProductMappingCustomers(repositoryContext.pool, integrationId, vendorProductKey),
    );
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load product customer review.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function upsertProductBundleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const body = (await request.json().catch(() => ({}))) as ProductBundleBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product bundle mapping needs PostgreSQL settings before it can save bundles.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      vendorId: integrationId,
      bundle: await upsertProductBundle(repositoryContext.pool, integrationId, {
        bundleKey: body.bundleKey,
        bundleName: body.bundleName,
        components: body.components,
        targetProduct: body.targetProduct,
        active: body.active,
        reviewedBy: auth.principal.name,
      }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save product bundle mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deactivateProductBundleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const bundleKey = decodedRouteParam(request.params.bundleKey);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!bundleKey) {
    return jsonResponse(400, { error: 'Product bundle deactivation requires bundleKey.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Product bundle deactivation needs PostgreSQL settings before it can save bundles.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await deactivateProductBundle(repositoryContext.pool, integrationId, bundleKey, {
        reviewedBy: auth.principal.name,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to deactivate product bundle mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function upsertProductLinkRuleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const body = (await request.json().catch(() => ({}))) as ProductLinkRuleBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Linked count rule creation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      vendorId: integrationId,
      rule: await upsertProductLinkRule(repositoryContext.pool, integrationId, {
        id: body.id,
        sourceVendorProductKey: body.sourceVendorProductKey,
        ruleName: body.ruleName,
        sources: body.sources,
        active: body.active,
        reviewedBy: auth.principal.name,
      }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save linked count rule.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deactivateProductLinkRuleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const ruleId = decodedRouteParam(request.params.ruleId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!ruleId) {
    return jsonResponse(400, { error: 'Linked count rule deactivation requires ruleId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Linked count rule deactivation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await deactivateProductLinkRule(repositoryContext.pool, integrationId, ruleId, {
        reviewedBy: auth.principal.name,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to deactivate linked count rule.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function activateProductLinkRuleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const ruleId = decodedRouteParam(request.params.ruleId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!ruleId) {
    return jsonResponse(400, { error: 'Linked count rule activation requires ruleId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Linked count rule activation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await setProductLinkRuleActive(repositoryContext.pool, integrationId, ruleId, true, {
        reviewedBy: auth.principal.name,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to activate linked count rule.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deleteProductLinkRuleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const ruleId = decodedRouteParam(request.params.ruleId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!ruleId) {
    return jsonResponse(400, { error: 'Linked count rule deletion requires ruleId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Linked count rule deletion needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, await deleteProductLinkRule(repositoryContext.pool, integrationId, ruleId));
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to delete linked count rule.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function testProductLinkRuleHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const ruleId = decodedRouteParam(request.params.ruleId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!ruleId) {
    return jsonResponse(400, { error: 'Linked count rule test requires ruleId.' });
  }

  const body = (await request.json().catch(() => ({}))) as {
    customerId?: string;
    agreementId?: string;
  };
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Linked count rule test needs PostgreSQL settings before it can evaluate rows.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await testProductLinkRule(repositoryContext.pool, integrationId, {
        ruleId,
        customerId: body.customerId,
        agreementId: body.agreementId,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to test linked count rule.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function searchProductCatalogHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Approving suggested mappings needs PostgreSQL settings before it can save mappings.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await approveSuggestedAccountMappings(repositoryContext.pool, integrationId, {
        actor: auth.principal.name,
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
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }

  const body = (await request.json().catch(() => ({}))) as UsageOverrideBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
        reviewedBy: auth.principal.name,
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
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const overrideId = decodedRouteParam(request.params.overrideId);
  if (!integrationId) {
    return unsupportedVendorResponse(request.params.vendorId);
  }
  if (!overrideId) {
    return jsonResponse(400, { error: 'Usage override deactivation requires overrideId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
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
        reviewedBy: auth.principal.name,
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

export async function listNcentralFiltersHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (integrationId !== 'ncentral') {
    return jsonResponse(400, { error: 'Live filter listing is only available for N-central.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  try {
    const settings = await provider.getIntegrationSettings('ncentral');
    assertNcentralReady(settings);
    const client = new NcentralClient(ncentralCredentialsFromSettings(settings));
    const pageSize = boundedInteger(request.query.get('pageSize'), 500, 1, 1000);
    const maxPages = boundedInteger(request.query.get('maxPages'), 20, 1, 100);
    const filters = await client.listDeviceFilters({ pageSize, maxPages });

    return jsonResponse(200, {
      integrationId: 'ncentral',
      filters,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to list N-central filters.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listNcentralFilterMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (integrationId !== 'ncentral') {
    return jsonResponse(400, { error: 'Filter mappings are only available for N-central.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'N-central filter mappings need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId: 'ncentral',
      mappings: await listNcentralFilterMappings(repositoryContext.pool),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load N-central filter mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function upsertNcentralFilterMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (integrationId !== 'ncentral') {
    return jsonResponse(400, { error: 'Filter mappings are only available for N-central.' });
  }

  const body = (await request.json().catch(() => ({}))) as NcentralFilterMappingBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'N-central filter mapping updates need PostgreSQL settings before they can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId: 'ncentral',
      mapping: await upsertNcentralFilterMapping(repositoryContext.pool, body),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save N-central filter mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listLaborMappingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId || !integrationSupportsLaborMapping(integrationId)) {
    return jsonResponse(400, {
      error: `Labor mapping is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Labor mappings need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId,
      mappings: await listLaborMappings(repositoryContext.pool, integrationId),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load labor mappings.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function upsertLaborMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId || !integrationSupportsLaborMapping(integrationId)) {
    return jsonResponse(400, {
      error: `Labor mapping is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const body = (await request.json().catch(() => ({}))) as LaborMappingBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Labor mapping updates need PostgreSQL settings before they can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId,
      mapping: await upsertLaborMapping(repositoryContext.pool, integrationId, body),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save labor mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listLaborTicketClassificationsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  try {
    const settingsProvider = createIntegrationSettingsProvider({
      loadLocalEnv: true,
      metadataReader: repositoryContext.repository,
    });
    const connectWiseSettings = await settingsProvider.getIntegrationSettings('connectwise');
    assertConnectWiseReady(connectWiseSettings);
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(connectWiseSettings));
    const boardIdParam = request.query.get('boardId');
    const boardId = boardIdParam ? Number(boardIdParam) : null;

    if (boardId != null && Number.isFinite(boardId)) {
      const [types, subTypes, statuses] = await Promise.all([
        listAllConnectWisePages((page, pageSize) => client.listBoardTypes(boardId, { page, pageSize, orderBy: 'name' })),
        listAllConnectWisePages((page, pageSize) =>
          client.listBoardSubTypes(boardId, { page, pageSize, orderBy: 'name' }),
        ),
        listAllConnectWisePages((page, pageSize) =>
          client.listBoardStatuses(boardId, { page, pageSize, orderBy: 'name' }),
        ),
      ]);

      const typeOptions: ConnectWiseTypeOption[] = types
        .filter((item) => item.inactiveFlag !== true)
        .map((item) => ({
          id: item.id,
          name: item.name,
          boardId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      const subTypeOptions: ConnectWiseSubTypeOption[] = subTypes
        .filter((item) => item.inactiveFlag !== true)
        .map((item) => ({
          id: item.id,
          name: item.name,
          boardId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      const statusOptions: ConnectWiseStatusOption[] = statuses
        .filter((item) => item.inactiveFlag !== true)
        .map((item) => ({
          id: item.id,
          name: item.name,
          boardId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      return jsonResponse(200, {
        boardId,
        types: typeOptions,
        subTypes: subTypeOptions,
        statuses: statusOptions,
      });
    }

    const boards = await listAllConnectWisePages((page, pageSize) =>
      client.listBoards({ page, pageSize, orderBy: 'name', conditions: 'inactiveFlag=false' }),
    );
    const boardOptions: ConnectWiseBoardOption[] = boards
      .map((item) => ({
        id: item.id,
        name: item.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return jsonResponse(200, {
      boards: boardOptions,
      types: [] as ConnectWiseTypeOption[],
      subTypes: [] as ConnectWiseSubTypeOption[],
      statuses: [] as ConnectWiseStatusOption[],
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load ConnectWise ticket classifications.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function getInvestigationTicketMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId || !integrationSupportsInvestigationTicketMapping(integrationId)) {
    return jsonResponse(400, {
      error: `Investigation ticket mapping is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Investigation ticket mappings need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId,
      mapping: await getInvestigationTicketMapping(repositoryContext.pool, integrationId),
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to load investigation ticket mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function upsertInvestigationTicketMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId || !integrationSupportsInvestigationTicketMapping(integrationId)) {
    return jsonResponse(400, {
      error: `Investigation ticket mapping is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const body = (await request.json().catch(() => ({}))) as InvestigationTicketMappingBody;
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Investigation ticket mapping updates need PostgreSQL settings before they can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      integrationId,
      mapping: await upsertInvestigationTicketMapping(repositoryContext.pool, integrationId, body),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save investigation ticket mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listMappings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}',
  handler: listMappingsHttp,
});

app.http('automapMappings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/automap',
  handler: automapMappingsHttp,
});

app.http('updateAccountMapping', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/accounts/{externalAccountId}',
  handler: updateAccountMappingHttp,
});

app.http('updateProductMapping', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/products/{vendorProductKey}',
  handler: updateProductMappingHttp,
});

app.http('listProductMappingCustomers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/products/{vendorProductKey}/customers',
  handler: listProductMappingCustomersHttp,
});

app.http('upsertProductBundle', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/bundles',
  handler: upsertProductBundleHttp,
});

app.http('deactivateProductBundle', {
  methods: ['DELETE', 'POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/bundles/{bundleKey}/deactivate',
  handler: deactivateProductBundleHttp,
});

app.http('upsertProductLinkRule', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/linked-products',
  handler: upsertProductLinkRuleHttp,
});

app.http('deactivateProductLinkRule', {
  methods: ['DELETE', 'POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/linked-products/{ruleId}/deactivate',
  handler: deactivateProductLinkRuleHttp,
});

app.http('activateProductLinkRule', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/linked-products/{ruleId}/activate',
  handler: activateProductLinkRuleHttp,
});

app.http('deleteProductLinkRule', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/linked-products/{ruleId}',
  handler: deleteProductLinkRuleHttp,
});

app.http('testProductLinkRule', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/linked-products/{ruleId}/test',
  handler: testProductLinkRuleHttp,
});

app.http('searchProductCatalog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/product-catalog',
  handler: searchProductCatalogHttp,
});

app.http('applyMappings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/apply',
  handler: applyMappingsHttp,
});

app.http('approveSuggestedMappings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/approve-suggested',
  handler: approveSuggestedMappingsHttp,
});

app.http('listUsageOverrides', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/overrides',
  handler: listUsageOverridesHttp,
});

app.http('createUsageOverride', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/overrides',
  handler: createUsageOverrideHttp,
});

app.http('deactivateUsageOverride', {
  methods: ['DELETE', 'POST'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/overrides/{overrideId}/deactivate',
  handler: deactivateUsageOverrideHttp,
});

app.http('listNcentralFilters', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/ncentral-filters',
  handler: listNcentralFiltersHttp,
});

app.http('listNcentralFilterMappings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/filter-mappings',
  handler: listNcentralFilterMappingsHttp,
});

app.http('upsertNcentralFilterMapping', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/filter-mappings',
  handler: upsertNcentralFilterMappingHttp,
});

app.http('listLaborMappings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/labor-mappings',
  handler: listLaborMappingsHttp,
});

app.http('upsertLaborMapping', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/labor-mappings',
  handler: upsertLaborMappingHttp,
});

app.http('listLaborTicketClassifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/connectwise/labor-classifications',
  handler: listLaborTicketClassificationsHttp,
});

app.http('getInvestigationTicketMapping', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/investigation-ticket-mapping',
  handler: getInvestigationTicketMappingHttp,
});

app.http('upsertInvestigationTicketMapping', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'mappings/{vendorId}/investigation-ticket-mapping',
  handler: upsertInvestigationTicketMappingHttp,
});

function parseIntegrationId(value: string | undefined): VendorKey | undefined {
  if (!value) {
    return undefined;
  }

  if (isVendorDatapointId(value) || getIntegrationSettingsDefinition(value as IntegrationId)) {
    return value as VendorKey;
  }

  return undefined;
}

function vendorHasMappingWorkspace(vendorId: VendorKey) {
  return vendorSupportsMapping(vendorId);
}

function unsupportedVendorResponse(value: string | undefined) {
  return jsonResponse(400, {
    error: `Mapping is not available for integration "${value ?? 'unknown'}".`,
  });
}

function decodedRouteParam(value: string | undefined) {
  if (!value) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

async function listAllConnectWisePages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<T[]>,
  pageSize = 100,
) {
  const items: T[] = [];
  let page = 1;

  while (page <= 50) {
    const batch = await fetchPage(page, pageSize);
    items.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    page += 1;
  }

  return items;
}
