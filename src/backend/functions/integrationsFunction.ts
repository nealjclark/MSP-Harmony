import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import type { IntegrationId } from '../../shared/integrationSettings';
import { listRuntimeIntegrations } from '../api/integrations';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseApiError } from '../connectwise/client';
import { syncConnectWiseAgreementReport, testConnectWiseConnection } from '../connectwise/operations';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';
import { CoveApiError } from '../vendor/cove/client';
import { syncCoveUsageSnapshots, testCoveConnection } from '../vendor/cove/operations';
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
import { requireRole } from './auth';

loadDotEnv({ override: false });

type SyncBody = {
  pageSize?: number;
  maxPages?: number;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  dataset?: 'users' | 'licenses';
};

type SyncableIntegrationId = Extract<
  IntegrationId,
  'connectwise' | 'cove' | 'ncentral' | 'opentext-appriver' | 'microsoft-365'
>;

type IntegrationSyncQueueMessage = SyncBody & {
  integrationId: SyncableIntegrationId;
  requestedBy: string;
  requestedAt: string;
};

type AppRiverSyncQueueMessage = {
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
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = createOptionalPostgresSettingsRepository();

  try {
    const integrations = await listRuntimeIntegrations({
      metadataReader: repositoryContext.repository,
      operationalStatusReader: repositoryContext.repository,
    });

    return jsonResponse(200, {
      integrations,
      nonSecretStorage: repositoryContext.repository ? 'database' : 'not-configured',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unable to list integrations.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function testIntegrationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (
    integrationId !== 'connectwise' &&
    integrationId !== 'cove' &&
    integrationId !== 'ncentral' &&
    integrationId !== 'opentext-appriver' &&
    integrationId !== 'microsoft-365'
  ) {
    return jsonResponse(501, {
      error: `Live test is not implemented yet for integration "${integrationId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });
  const saveTestResult = async (result: 'success' | 'failure') => {
    if (!repositoryContext.repository) {
      return;
    }

    const settings = await provider.getIntegrationSettings(integrationId);
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
): Promise<HttpResponseInit> {
  const auth = requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (
    integrationId !== 'connectwise' &&
    integrationId !== 'cove' &&
    integrationId !== 'ncentral' &&
    integrationId !== 'opentext-appriver' &&
    integrationId !== 'microsoft-365'
  ) {
    return jsonResponse(501, {
      error: `Live sync is not implemented yet for integration "${integrationId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: `${integrationDisplayName(integrationId)} sync needs PostgreSQL settings before it can store sync data.`,
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const body = (await request.json().catch(() => ({}))) as SyncBody;

  try {
    if (body.dataset && body.dataset !== 'users' && body.dataset !== 'licenses') {
      return jsonResponse(400, {
        error: 'Microsoft 365 sync dataset must be "users" or "licenses".',
        supportedDatasets: ['users', 'licenses'],
      });
    }

    const queuedAt = new Date().toISOString();
    const message = buildIntegrationSyncQueueMessage(integrationId, body, auth.principal.name, queuedAt);
    enqueueIntegrationSyncWorker(context, message);

    return jsonResponse(202, {
      integrationId,
      status: 'queued',
      queued: true,
      dataset: integrationId === 'microsoft-365' ? message.dataset : undefined,
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
  const repositoryContext = createOptionalPostgresSettingsRepository();

  if (!repositoryContext.pool || !repositoryContext.repository) {
    throw new Error(`${integrationDisplayName(parsed.integrationId)} queued sync needs PostgreSQL settings before it can process.`);
  }

  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  try {
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
      context.log(`ConnectWise queued sync ${result.syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'cove') {
      const result = await syncCoveUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      context.log(`Cove queued sync ${result.syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'ncentral') {
      const result = await syncNcentralUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      context.log(`N-central queued sync ${result.syncRunId} completed.`);
      return;
    }

    if (parsed.integrationId === 'opentext-appriver') {
      const result = await startAppRiverQueuedSubscriptionSync({
        pool: repositoryContext.pool,
        provider,
        pageSize: parsed.pageSize,
        maxPages: parsed.maxPages,
      });
      if (result.status === 'queued') {
        enqueueAppRiverSyncWorker(context, result.syncRunId, {
          subscriptionPageSize: parsed.subscriptionPageSize,
          subscriptionMaxPages: parsed.subscriptionMaxPages,
        });
      }
      context.log(`AppRiver queued sync ${result.syncRunId} ${result.status}.`);
      return;
    }

    const dataset = parsed.dataset ?? 'users';
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
    context.log(`Microsoft 365 ${dataset} queued sync ${result.syncRunId} completed.`);
  } finally {
    await repositoryContext.close();
  }
}

export async function processAppRiverSyncQueueMessage(
  message: AppRiverSyncQueueMessage | string,
  context: InvocationContext,
) {
  const parsed = parseAppRiverSyncQueueMessage(message);
  const repositoryContext = createOptionalPostgresSettingsRepository();

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
      enqueueAppRiverSyncWorker(context, parsed.syncRunId, {
        subscriptionPageSize: parsed.subscriptionPageSize,
        subscriptionMaxPages: parsed.subscriptionMaxPages,
      });
    }
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

  return jsonResponse(400, {
    error: error instanceof Error ? error.message : fallback,
  });
}

function integrationDisplayName(integrationId: IntegrationId | undefined) {
  if (integrationId === 'cove') return 'Cove';
  if (integrationId === 'ncentral') return 'N-central';
  if (integrationId === 'opentext-appriver') return 'AppRiver - OpenText';
  if (integrationId === 'microsoft-365') return 'Microsoft 365';
  return 'ConnectWise';
}

function safePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function buildIntegrationSyncQueueMessage(
  integrationId: SyncableIntegrationId,
  body: SyncBody,
  requestedBy: string,
  requestedAt: string,
): IntegrationSyncQueueMessage {
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

  return {
    integrationId,
    requestedBy,
    requestedAt,
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
  syncRunId: string,
  options: Pick<AppRiverSyncQueueMessage, 'subscriptionPageSize' | 'subscriptionMaxPages'> = {},
) {
  context.extraOutputs?.set(appRiverSyncQueueOutput, {
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
    parsed.integrationId !== 'opentext-appriver' &&
    parsed.integrationId !== 'microsoft-365'
  ) {
    throw new Error('Integration sync queue message has an unsupported integrationId.');
  }

  if (parsed.dataset && parsed.dataset !== 'users' && parsed.dataset !== 'licenses') {
    throw new Error('Microsoft 365 sync queue message has an unsupported dataset.');
  }

  return buildIntegrationSyncQueueMessage(
    parsed.integrationId,
    parsed,
    parsed.requestedBy || 'unknown',
    parsed.requestedAt || new Date().toISOString(),
  );
}

function parseAppRiverSyncQueueMessage(message: AppRiverSyncQueueMessage | string): AppRiverSyncQueueMessage {
  const parsed =
    typeof message === 'string'
      ? (JSON.parse(message) as Partial<AppRiverSyncQueueMessage>)
      : message;

  if (!parsed.syncRunId) {
    throw new Error('AppRiver queue message is missing syncRunId.');
  }

  return {
    syncRunId: parsed.syncRunId,
    subscriptionPageSize: parsed.subscriptionPageSize,
    subscriptionMaxPages: parsed.subscriptionMaxPages,
  };
}
