import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import {
  listAzureOnboardingState,
  refreshAzureLighthouseTenants,
  getCurrentAzureLighthouseTemplate,
  prepareAzureOnboardingPackage,
  saveAzureSubscriptionMapping,
  uploadAzureLighthouseTemplate,
  verifyAzureOnboarding,
  azureServiceProvidersPortalUrl,
  type AzureLighthouseTemplateUploadInput,
  type AzureOnboardingInput,
} from '../vendor/azure/onboarding';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { requireRole } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';

type OnboardingDependencies = {
  createRepositoryContext?: typeof createOptionalPostgresSettingsRepository;
};

export async function listAzureOnboardingHttp(
  request: HttpRequest,
  context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, await listAzureOnboardingState({
      pool: repositoryContext.pool,
      discoverAzure: request.query.get('discoverAzure') === 'true',
      includeCustomerOptions: request.query.get('includeCustomers') === 'true',
      ...(request.query.get('discoverAzure') === 'true'
        ? {
            provider: createIntegrationSettingsProvider({
              loadLocalEnv: true,
              metadataReader: repositoryContext.repository,
            }),
          }
        : {}),
    }));
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to load Azure onboarding.', 'azure_onboarding_list_failed');
  } finally {
    await repositoryContext.close();
  }
}

export async function prepareAzureOnboardingHttp(
  request: HttpRequest,
  _context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;
  const bodyResult = await readJsonBody<AzureOnboardingInput>(request);
  if (!bodyResult.ok) return bodyResult.response;

  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, await prepareAzureOnboardingPackage({
      pool: repositoryContext.pool,
      onboarding: bodyResult.body,
      actor: auth.principal.name,
    }));
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to prepare Azure onboarding package.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function verifyAzureOnboardingHttp(
  request: HttpRequest,
  _context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;
  const bodyResult = await readJsonBody<AzureOnboardingInput>(request);
  if (!bodyResult.ok) return bodyResult.response;

  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    const result = await verifyAzureOnboarding({
      pool: repositoryContext.pool,
      onboarding: bodyResult.body,
      actor: auth.principal.name,
      provider: createIntegrationSettingsProvider({
        loadLocalEnv: true,
        metadataReader: repositoryContext.repository,
      }),
    });
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to verify Azure onboarding.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function saveAzureSubscriptionMappingHttp(
  request: HttpRequest,
  _context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;
  const bodyResult = await readJsonBody<AzureOnboardingInput>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const subscriptionId = request.params.subscriptionId?.trim();
  if (!subscriptionId) return jsonResponse(400, { error: 'Azure subscription ID is required.' });

  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, await saveAzureSubscriptionMapping({
      pool: repositoryContext.pool,
      subscriptionId,
      mapping: bodyResult.body,
      actor: auth.principal.name,
    }));
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save the Azure subscription mapping.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function uploadAzureLighthouseTemplateHttp(
  request: HttpRequest,
  _context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;
  const bodyResult = await readJsonBody<AzureLighthouseTemplateUploadInput>(request);
  if (!bodyResult.ok) return bodyResult.response;

  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, await uploadAzureLighthouseTemplate({
      pool: repositoryContext.pool,
      upload: bodyResult.body,
      actor: auth.principal.name,
    }));
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to upload the Azure Lighthouse template.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function refreshAzureLighthouseTenantsHttp(
  request: HttpRequest,
  context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;
  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, await refreshAzureLighthouseTenants({
      pool: repositoryContext.pool,
      actor: auth.principal.name,
      provider: createIntegrationSettingsProvider({
        loadLocalEnv: true,
        metadataReader: repositoryContext.repository,
      }),
    }));
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to refresh Azure Lighthouse tenants.', 'azure_lighthouse_tenants_refresh_failed');
  } finally {
    await repositoryContext.close();
  }
}

export async function getAzureLighthouseTemplateHttp(
  request: HttpRequest,
  context: InvocationContext,
  dependencies: OnboardingDependencies = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool) {
    await repositoryContext.close();
    return databaseRequiredResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    return jsonResponse(200, {
      currentTemplate: await getCurrentAzureLighthouseTemplate(repositoryContext.pool),
      portalUrl: azureServiceProvidersPortalUrl,
    });
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to load the Azure Lighthouse template.', 'azure_lighthouse_template_get_failed');
  } finally {
    await repositoryContext.close();
  }
}

async function manageAzureLighthouseTemplateHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return request.method.toUpperCase() === 'GET'
    ? getAzureLighthouseTemplateHttp(request, context)
    : uploadAzureLighthouseTemplateHttp(request, context);
}

function databaseRequiredResponse(missingDatabaseSettings: string[]) {
  return jsonResponse(400, {
    error: 'Azure onboarding needs PostgreSQL settings before it can save subscription mappings.',
    missingDatabaseSettings,
  });
}

app.http('listAzureOnboarding', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding',
  handler: listAzureOnboardingHttp,
});

app.http('prepareAzureOnboarding', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding/package',
  handler: prepareAzureOnboardingHttp,
});

app.http('verifyAzureOnboarding', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding/verify',
  handler: verifyAzureOnboardingHttp,
});

app.http('saveAzureSubscriptionMapping', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding/mappings/{subscriptionId}',
  handler: saveAzureSubscriptionMappingHttp,
});

app.http('manageAzureLighthouseTemplate', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding/template',
  handler: manageAzureLighthouseTemplateHttp,
});

app.http('refreshAzureLighthouseTenants', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'integrations/microsoft-azure/onboarding/tenants/refresh',
  handler: refreshAzureLighthouseTenantsHttp,
});
