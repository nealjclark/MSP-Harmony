import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import {
  enableApiSyncSettingKey,
  integrationChannelEnabled,
  listIntegrationApiOperations,
  listIntegrationNonSecretDefinitions,
  validateIntegrationSettings,
  type IntegrationId,
} from '../../shared/integrationSettings';
import { listRuntimeIntegrations } from '../api/integrations';
import { createIntegrationSettingsProvider, type IntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseApiError } from '../connectwise/client';
import { syncConnectWiseAgreementReport, testConnectWiseConnection } from '../connectwise/operations';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';
import { CoveApiError } from '../vendor/cove/client';
import { syncCoveUsageSnapshots, testCoveConnection } from '../vendor/cove/operations';
import { DattoApiError } from '../vendor/datto/client';
import { syncDattoUsageSnapshots, testDattoConnection } from '../vendor/datto/operations';
import { NcentralApiError } from '../vendor/ncentral/client';
import { syncNcentralUsageSnapshots, testNcentralConnection } from '../vendor/ncentral/operations';
import { AppRiverApiError } from '../vendor/appriver/client';
import {
  processNextAppRiverQueuedCustomer,
  startAppRiverQueuedSubscriptionSync,
  testAppRiverConnection,
} from '../vendor/appriver/operations';
import { Microsoft365ApiError } from '../vendor/microsoft365/client';
import {
  syncMicrosoft365ProductSubscriptionSnapshots,
  syncMicrosoft365UserLicenseSnapshots,
  testMicrosoft365Connection,
} from '../vendor/microsoft365/operations';
import { SentinelOneApiError } from '../vendor/sentinelone/client';
import { syncSentinelOneUsageSnapshots, testSentinelOneConnection } from '../vendor/sentinelone/operations';
import { HuntressApiError } from '../vendor/huntress/client';
import { syncHuntressUsageSnapshots, testHuntressConnection } from '../vendor/huntress/operations';
import { requireRole } from './auth';

loadDotEnv({ override: false });

type SyncBody = {
  operationKey?: string;
  pageSize?: number;
  maxPages?: number;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  seatPageSize?: number;
  seatMaxPages?: number;
  includeBcdr?: boolean;
  dataset?: 'users' | 'licenses';
};

type TestBody = {
  nonSecrets?: Record<string, string | undefined>;
  secrets?: Record<string, string | undefined>;
};

type SyncableIntegrationId = Extract<
  IntegrationId,
  | 'connectwise'
  | 'cove'
  | 'ncentral'
  | 'datto'
  | 'opentext-appriver'
  | 'microsoft-365'
  | 'sentinelone'
  | 'huntress'
>;

type IntegrationSyncQueueMessage = SyncBody & {
  jobId: string;
  integrationId: SyncableIntegrationId;
  requestedBy: string;
  requestedAt: string;
};

type AppRiverSyncQueueMessage = {
  jobId: string;
  syncRunId: string;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
};

const integrationSyncQueueName = 'integration-sync-work';
const appRiverSyncQueueName = 'appriver-sync-work';
const integrationSyncQueueOutput = output.storageQueue({
  queueName: integrationSyncQueueName,
  connection: 'AzureWebJobsStorage',
});
const appRiverSyncQueueOutput = output.storageQueue({
  queueName: appRiverSyncQueueName,
  connection: 'AzureWebJobsStorage',
});

export async function listIntegrationsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();

  try {
    const integrations = await listRuntimeIntegrations({
      metadataReader: repositoryContext.repository,
      operationalStatusReader: repositoryContext.repository,
    });

    return jsonResponse(200, {
      integrations,
      syncJobs: await repositoryContext.repository?.listRecentSyncJobs() ?? [],
      nonSecretStorage: repositoryContext.repository ? 'database' : 'not-configured',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to list integrations.', 'integrations_list_failed');
  } finally {
    await repositoryContext.close();
  }
}

export async function testIntegrationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (
    integrationId !== 'connectwise' &&
    integrationId !== 'cove' &&
    integrationId !== 'ncentral' &&
    integrationId !== 'datto' &&
    integrationId !== 'opentext-appriver' &&
    integrationId !== 'microsoft-365' &&
    integrationId !== 'sentinelone' &&
    integrationId !== 'huntress'
  ) {
    return jsonResponse(501, {
      error: `Live test is not implemented yet for integration "${integrationId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  const savedProvider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });
  const bodyResult = await readJsonBody<TestBody>(request, { fallback: {} });
  if (!bodyResult.ok) {
    await repositoryContext.close();
    return bodyResult.response;
  }
  const transient = Object.keys(bodyResult.body.nonSecrets ?? {}).length > 0 || Object.keys(bodyResult.body.secrets ?? {}).length > 0;
  let provider = savedProvider;

  if (transient) {
    try {
      provider = await transientTestProvider(savedProvider, integrationId, bodyResult.body);
    } catch (error) {
      await repositoryContext.close();
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Invalid test settings.' });
    }
  }
  const saveTestResult = async (result: 'success' | 'failure') => {
    if (!repositoryContext.repository || transient) {
      return;
    }

    const settings = await savedProvider.getIntegrationSettings(integrationId);
    await repositoryContext.repository.saveTestResult({
      integrationId,
      displayName: settings.definition.displayName,
      authMode: settings.definition.authMode,
      endpoint: settings.nonSecrets.endpoint ?? settings.definition.endpoint,
      syncFrequency: settings.definition.syncFrequency,
      nonSecrets: settings.nonSecrets,
      requiredKeyVaultSecrets: settings.definition.requiredSecrets.map((setting) => setting.keyVaultSecretName),
      result,
    });
  };

  try {
    if (integrationId === 'connectwise') {
      const result = await testConnectWiseConnection(provider);

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        companyCount: result.companyCount,
        sampleCompanies: result.sampleCompanies,
      });
    }

    if (integrationId === 'cove') {
      const result = await testCoveConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        partnerId: result.partnerId,
        username: result.username,
      });
    }

    if (integrationId === 'ncentral') {
      const result = await testNcentralConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        filterCount: result.filterCount,
        sampleFilters: result.sampleFilters,
      });
    }

    if (integrationId === 'datto') {
      const result = await testDattoConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        bcdrAgentCount: result.bcdrAgentCount,
        sampleBcdrAgents: result.sampleBcdrAgents,
        saasDomainCount: result.saasDomainCount,
        sampleSaasDomains: result.sampleSaasDomains,
      });
    }

    if (integrationId === 'opentext-appriver') {
      const result = await testAppRiverConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        customerCount: result.customerCount,
        sampleCustomers: result.sampleCustomers,
        firstCustomerSubscriptionCount: result.firstCustomerSubscriptionCount,
      });
    }

    if (integrationId === 'sentinelone') {
      const result = await testSentinelOneConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        accountCount: result.accountCount,
        siteCount: result.siteCount,
        sampleSites: result.sampleSites,
      });
    }

    if (integrationId === 'huntress') {
      const result = await testHuntressConnection({ provider });

      await saveTestResult('success');

      return jsonResponse(200, {
        integrationId: result.integrationId,
        testedAt: result.testedAt,
        actor: result.actor,
        organizationCount: result.organizationCount,
        agentCount: result.agentCount,
        resellerInvoiceCount: result.resellerInvoiceCount,
        sampleOrganizations: result.sampleOrganizations,
        productClasses: result.productClasses,
      });
    }

    const result = await testMicrosoft365Connection({ provider, pool: repositoryContext.pool });

    await saveTestResult('success');

    return jsonResponse(200, {
      integrationId: result.integrationId,
      testedAt: result.testedAt,
      tenantCount: result.tenantCount,
      sampleTenants: result.sampleTenants,
    });
  } catch (error) {
    await saveTestResult('failure').catch(() => undefined);
    return integrationErrorResponse(error, `${integrationDisplayName(integrationId)} test failed.`);
  } finally {
    await repositoryContext.close();
  }
}

export async function syncIntegrationHttp(
  request: HttpRequest,
  context: InvocationContext,
  dependencies: {
    createRepositoryContext?: typeof createOptionalPostgresSettingsRepository;
  } = {},
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (
    integrationId !== 'connectwise' &&
    integrationId !== 'cove' &&
    integrationId !== 'ncentral' &&
    integrationId !== 'datto' &&
    integrationId !== 'opentext-appriver' &&
    integrationId !== 'microsoft-365' &&
    integrationId !== 'sentinelone' &&
    integrationId !== 'huntress'
  ) {
    return jsonResponse(501, {
      error: `Live sync is not implemented yet for integration "${integrationId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await (dependencies.createRepositoryContext ?? createOptionalPostgresSettingsRepository)();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: `${integrationDisplayName(integrationId)} sync needs PostgreSQL settings before it can store sync data.`,
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const bodyResult = await readJsonBody<SyncBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  try {
    if (body.dataset && body.dataset !== 'users' && body.dataset !== 'licenses') {
      return jsonResponse(400, {
        error: 'Microsoft 365 sync dataset must be "users" or "licenses".',
        supportedDatasets: ['users', 'licenses'],
      });
    }
    const supportedOperationKeys = listIntegrationApiOperations(integrationId).map((operation) => operation.key);
    if (body.operationKey && !supportedOperationKeys.includes(body.operationKey)) {
      return jsonResponse(400, {
        error: `Unsupported sync operation "${body.operationKey}" for ${integrationDisplayName(integrationId)}.`,
        supportedOperationKeys,
      });
    }

    const queuedAt = new Date().toISOString();
    const operationKey = body.operationKey ?? listIntegrationApiOperations(integrationId)[0]?.key ?? 'sync';
    const operationLabel = listIntegrationApiOperations(integrationId).find((operation) => operation.key === operationKey)?.label
      ?? `${integrationDisplayName(integrationId)} sync`;
    const jobId = await repositoryContext.repository.createSyncJob({
      integrationId,
      integrationName: integrationDisplayName(integrationId),
      operationKey,
      operationLabel,
      requestedBy: auth.principal.name,
      requestedAt: queuedAt,
    });
    const message = { ...buildIntegrationSyncQueueMessage(integrationId, body, auth.principal.name, queuedAt), jobId };
    enqueueIntegrationSyncWorker(context, message);

    return jsonResponse(202, {
      integrationId,
      status: 'queued',
      queued: true,
      dataset: integrationId === 'microsoft-365' ? message.dataset : undefined,
      includeBcdr: integrationId === 'datto' ? message.includeBcdr : undefined,
      operationKey: message.operationKey,
      jobId,
      queuedAt,
      requestedBy: auth.principal.name,
    });
  } catch (error) {
    return integrationErrorResponse(error, `${integrationDisplayName(integrationId)} sync failed.`);
  } finally {
    await repositoryContext.close();
  }
}

export async function processIntegrationSyncQueueMessage(
  message: IntegrationSyncQueueMessage | string,
  context: InvocationContext,
) {
  const parsed = parseIntegrationSyncQueueMessage(message);
  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool || !repositoryContext.repository) {
    throw new Error(`${integrationDisplayName(parsed.integrationId)} queued sync needs PostgreSQL settings before it can process.`);
  }

  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  let syncRunId: string | undefined;
  try {
    await repositoryContext.repository.markSyncJobRunning(parsed.jobId);
    const settings = await provider.getIntegrationSettings(parsed.integrationId);
    if (!integrationChannelEnabled(settings.nonSecrets, enableApiSyncSettingKey, true)) {
      throw new Error(
        `API Sync is disabled for ${integrationDisplayName(parsed.integrationId)}. Enable it in Configure before starting a sync.`,
      );
    }
    context.log(
      `Starting queued ${integrationDisplayName(parsed.integrationId)} sync requested by ${parsed.requestedBy}.`,
    );

    if (parsed.integrationId === 'connectwise') {
      const result = await syncConnectWiseAgreementReport({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`ConnectWise queued sync ${syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'cove') {
      const result = await syncCoveUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`Cove queued sync ${syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'ncentral') {
      const result = await syncNcentralUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`N-central queued sync ${syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'datto') {
      const result = await syncDattoUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
        seatPageSize: parsed.seatPageSize,
        seatMaxPages: parsed.seatMaxPages,
        includeBcdr: parsed.includeBcdr,
        dataset: parsed.operationKey === 'datto-bcdr' ? 'bcdr' : parsed.operationKey === 'datto-saas' ? 'saas' : undefined,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`Datto queued sync ${syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'opentext-appriver') {
      const result = await startAppRiverQueuedSubscriptionSync({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.attachSyncJobRun(parsed.jobId, syncRunId);
      if (result.status === 'queued') {
        enqueueAppRiverSyncWorker(context, parsed.jobId, result.syncRunId, {
          subscriptionPageSize: parsed.subscriptionPageSize,
          subscriptionMaxPages: parsed.subscriptionMaxPages,
        });
      } else {
        await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      }
      context.log(`AppRiver queued sync ${result.syncRunId} ${result.status}.`);
      return;
    }

    if (parsed.integrationId === 'sentinelone') {
      const result = await syncSentinelOneUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`SentinelOne queued sync ${syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'huntress') {
      const result = await syncHuntressUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      syncRunId = result.syncRunId;
      await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
      context.log(`Huntress queued sync ${syncRunId} completed.`);
      return;
    }

    const dataset = parsed.operationKey === 'm365-licenses'
      ? 'licenses'
      : parsed.operationKey === 'm365-users'
        ? 'users'
        : parsed.dataset ?? 'users';
    const result =
      dataset === 'licenses'
        ? await syncMicrosoft365ProductSubscriptionSnapshots({
            pool: repositoryContext.pool,
            provider,
          })
        : await syncMicrosoft365UserLicenseSnapshots({
            pool: repositoryContext.pool,
            provider,
            pageSize: parsed.pageSize,
            maxPages: parsed.maxPages,
          });
    syncRunId = result.syncRunId;
    await repositoryContext.repository.completeSyncJob(parsed.jobId, syncRunId);
    context.log(`Microsoft 365 ${dataset} queued sync ${syncRunId} completed.`);
  } catch (error) {
    await repositoryContext.repository.failSyncJob(
      parsed.jobId,
      error instanceof Error ? error.message : 'Sync worker failed.',
      syncRunId,
    ).catch(() => undefined);
    throw error;
  } finally {
    await repositoryContext.close();
  }
}

export async function processAppRiverSyncQueueMessage(
  message: AppRiverSyncQueueMessage | string,
  context: InvocationContext,
) {
  const parsed = parseAppRiverSyncQueueMessage(message);
  const repositoryContext = await createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool || !repositoryContext.repository) {
    throw new Error(`AppRiver - OpenText queued sync needs PostgreSQL settings before it can process ${parsed.syncRunId}.`);
  }

  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  try {
    const result = await processNextAppRiverQueuedCustomer({
      pool: repositoryContext.pool,
      provider,
      syncRunId: parsed.syncRunId,
      subscriptionPageSize: parsed.subscriptionPageSize,
      subscriptionMaxPages: parsed.subscriptionMaxPages,
    });
    context.log(
      `AppRiver queued sync ${parsed.syncRunId}: ${result.status}${result.processedCustomerId ? ` ${result.processedCustomerId}` : ''}.`,
    );

    if (result.shouldContinue) {
      enqueueAppRiverSyncWorker(context, parsed.jobId, parsed.syncRunId, {
        subscriptionPageSize: parsed.subscriptionPageSize,
        subscriptionMaxPages: parsed.subscriptionMaxPages,
      });
    } else if (result.status === 'completed') {
      await repositoryContext.repository.completeSyncJob(parsed.jobId, parsed.syncRunId);
    } else if (result.status === 'failed') {
      await repositoryContext.repository.failSyncJob(parsed.jobId, result.errorMessage ?? 'AppRiver sync failed.', parsed.syncRunId);
    }
  } catch (error) {
    await repositoryContext.repository.failSyncJob(
      parsed.jobId,
      error instanceof Error ? error.message : 'AppRiver sync worker failed.',
      parsed.syncRunId,
    ).catch(() => undefined);
    throw error;
  } finally {
    await repositoryContext.close();
  }
}

app.http('listIntegrations', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'integrations',
  handler: listIntegrationsHttp,
});

app.http('testIntegration', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'integrations/{integrationId}/test',
  handler: testIntegrationHttp,
});

app.http('syncIntegration', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'integrations/{integrationId}/sync',
  extraOutputs: [integrationSyncQueueOutput],
  handler: syncIntegrationHttp,
});

app.storageQueue<IntegrationSyncQueueMessage | string>('processIntegrationSyncQueueMessage', {
  queueName: integrationSyncQueueName,
  connection: 'AzureWebJobsStorage',
  extraOutputs: [appRiverSyncQueueOutput],
  handler: processIntegrationSyncQueueMessage,
});

app.storageQueue<AppRiverSyncQueueMessage | string>('processAppRiverSyncQueueMessage', {
  queueName: appRiverSyncQueueName,
  connection: 'AzureWebJobsStorage',
  extraOutputs: [appRiverSyncQueueOutput],
  handler: processAppRiverSyncQueueMessage,
});

function integrationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ConnectWiseApiError) {
    return jsonResponse(502, {
      error: fallback,
      status: error.status,
    });
  }

  if (error instanceof CoveApiError) {
    return jsonResponse(502, {
      error: fallback,
    });
  }

  if (error instanceof NcentralApiError) {
    return jsonResponse(502, {
      error: fallback,
      status: error.status,
    });
  }

  if (error instanceof DattoApiError) {
    return jsonResponse(502, {
      error: fallback,
      status: error.status,
    });
  }

  if (error instanceof AppRiverApiError) {
    return jsonResponse(502, {
      error: fallback,
      status: error.status,
    });
  }

  if (error instanceof Microsoft365ApiError) {
    return jsonResponse(502, {
      error: fallback,
      status: error.status,
      requestId: error.requestId,
      correlationId: error.correlationId,
    });
  }

  if (error instanceof SentinelOneApiError) {
    return jsonResponse(error.status ? 502 : 400, {
      error: error.message || fallback,
      status: error.status,
    });
  }

  if (error instanceof HuntressApiError) {
    return jsonResponse(error.status ? 502 : 400, {
      error: error.message || fallback,
      status: error.status,
    });
  }

  return jsonResponse(400, {
    error: error instanceof Error ? error.message : fallback,
  });
}

function integrationDisplayName(integrationId: IntegrationId | undefined) {
  if (integrationId === 'cove') return 'Cove';
  if (integrationId === 'ncentral') return 'N-central';
  if (integrationId === 'datto') return 'Datto Backup';
  if (integrationId === 'opentext-appriver') return 'AppRiver - OpenText';
  if (integrationId === 'microsoft-365') return 'Microsoft 365';
  if (integrationId === 'sentinelone') return 'SentinelOne';
  if (integrationId === 'huntress') return 'Huntress';
  return 'ConnectWise';
}

function safePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

async function transientTestProvider(
  savedProvider: IntegrationSettingsProvider,
  integrationId: IntegrationId,
  body: TestBody,
): Promise<IntegrationSettingsProvider> {
  const saved = await savedProvider.getIntegrationSettings(integrationId);
  const allowedNonSecrets = new Set(listIntegrationNonSecretDefinitions(saved.definition).map((setting) => setting.key));
  const allowedSecrets = new Set(saved.definition.requiredSecrets.map((setting) => setting.key));
  const unknownNonSecrets = Object.keys(body.nonSecrets ?? {}).filter((key) => !allowedNonSecrets.has(key));
  const unknownSecrets = Object.keys(body.secrets ?? {}).filter((key) => !allowedSecrets.has(key));
  if (unknownNonSecrets.length > 0 || unknownSecrets.length > 0) {
    throw new Error(`Unknown test setting keys: ${[...unknownNonSecrets, ...unknownSecrets].join(', ')}`);
  }

  const nonSecrets = { ...saved.nonSecrets, ...(body.nonSecrets ?? {}) };
  const secrets = { ...saved.secrets };
  for (const [key, value] of Object.entries(body.secrets ?? {})) {
    if (value?.trim()) secrets[key] = value.trim();
  }
  const validation = validateIntegrationSettings(saved.definition, {
    integrationId,
    nonSecrets,
    availableKeyVaultSecrets: saved.definition.requiredSecrets
      .filter((setting) => Boolean(secrets[setting.key]?.trim()))
      .map((setting) => setting.keyVaultSecretName),
    lastTestResult: 'untested',
  });
  const transientSettings = { ...saved, nonSecrets, secrets, validation };

  return {
    async getIntegrationSettings(requestedId) {
      return requestedId === integrationId ? transientSettings : savedProvider.getIntegrationSettings(requestedId);
    },
    async listIntegrationSettings() {
      const settings = await savedProvider.listIntegrationSettings();
      return settings.map((item) => item.definition.integrationId === integrationId ? transientSettings : item);
    },
  };
}

function buildIntegrationSyncQueueMessage(
  integrationId: SyncableIntegrationId,
  body: SyncBody,
  requestedBy: string,
  requestedAt: string,
): Omit<IntegrationSyncQueueMessage, 'jobId'> {
  if (integrationId === 'connectwise') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 100),
      maxPages: safePositiveInteger(body.maxPages, 50),
    };
  }

  if (integrationId === 'cove') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 10000),
      maxPages: safePositiveInteger(body.maxPages, 1),
    };
  }

  if (integrationId === 'ncentral') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 500),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'datto') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      ...(body.operationKey ? { operationKey: body.operationKey } : {}),
      pageSize: safePositiveInteger(body.pageSize, 100),
      maxPages: safePositiveInteger(body.maxPages, 100),
      seatPageSize: safePositiveInteger(body.seatPageSize, 500),
      seatMaxPages: safePositiveInteger(body.seatMaxPages, 100),
      includeBcdr: body.includeBcdr !== false,
    };
  }

  if (integrationId === 'opentext-appriver') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 1000),
      maxPages: safePositiveInteger(body.maxPages, 100),
      subscriptionPageSize: safePositiveInteger(body.subscriptionPageSize, 100),
      subscriptionMaxPages: safePositiveInteger(body.subscriptionMaxPages, 25),
    };
  }

  if (integrationId === 'sentinelone') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 1000),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'huntress') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 500),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  return {
    integrationId,
    requestedBy,
    requestedAt,
    ...(body.operationKey ? { operationKey: body.operationKey } : {}),
    dataset: body.dataset ?? 'users',
    pageSize: safePositiveInteger(body.pageSize, 100),
    maxPages: safePositiveInteger(body.maxPages, 100),
  };
}

function enqueueIntegrationSyncWorker(context: InvocationContext, message: IntegrationSyncQueueMessage) {
  context.extraOutputs?.set(integrationSyncQueueOutput, message);
}

function enqueueAppRiverSyncWorker(
  context: InvocationContext,
  jobId: string,
  syncRunId: string,
  options: Pick<AppRiverSyncQueueMessage, 'subscriptionPageSize' | 'subscriptionMaxPages'> = {},
) {
  context.extraOutputs?.set(appRiverSyncQueueOutput, {
    jobId,
    syncRunId,
    ...options,
  } satisfies AppRiverSyncQueueMessage);
}

function parseIntegrationSyncQueueMessage(message: IntegrationSyncQueueMessage | string): IntegrationSyncQueueMessage {
  const parsed =
    typeof message === 'string'
      ? (JSON.parse(message) as Partial<IntegrationSyncQueueMessage>)
      : message;

  if (
    parsed.integrationId !== 'connectwise' &&
    parsed.integrationId !== 'cove' &&
    parsed.integrationId !== 'ncentral' &&
    parsed.integrationId !== 'datto' &&
    parsed.integrationId !== 'opentext-appriver' &&
    parsed.integrationId !== 'microsoft-365' &&
    parsed.integrationId !== 'sentinelone' &&
    parsed.integrationId !== 'huntress'
  ) {
    throw new Error('Integration sync queue message has an unsupported integrationId.');
  }

  if (parsed.dataset && parsed.dataset !== 'users' && parsed.dataset !== 'licenses') {
    throw new Error('Microsoft 365 sync queue message has an unsupported dataset.');
  }

  if (!parsed.jobId) throw new Error('Integration sync queue message is missing jobId.');
  return {
    ...buildIntegrationSyncQueueMessage(
      parsed.integrationId,
      parsed,
      parsed.requestedBy || 'unknown',
      parsed.requestedAt || new Date().toISOString(),
    ),
    jobId: parsed.jobId,
  };
}

function parseAppRiverSyncQueueMessage(message: AppRiverSyncQueueMessage | string): AppRiverSyncQueueMessage {
  const parsed =
    typeof message === 'string'
      ? (JSON.parse(message) as Partial<AppRiverSyncQueueMessage>)
      : message;

  if (!parsed.syncRunId || !parsed.jobId) {
    throw new Error('AppRiver queue message is missing syncRunId or jobId.');
  }

  return {
    jobId: parsed.jobId,
    syncRunId: parsed.syncRunId,
    subscriptionPageSize: parsed.subscriptionPageSize,
    subscriptionMaxPages: parsed.subscriptionMaxPages,
  };
}
