import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
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

loadDotEnv({ override: false });

type SyncBody = {
  pageSize?: number;
  maxPages?: number;
};

export async function listIntegrationsHttp(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
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
  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (integrationId !== 'connectwise' && integrationId !== 'cove' && integrationId !== 'ncentral') {
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

    const result = await testNcentralConnection({ provider });

    await saveTestResult('success');

    return jsonResponse(200, {
      integrationId: result.integrationId,
      testedAt: result.testedAt,
      filterCount: result.filterCount,
      sampleFilters: result.sampleFilters,
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
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const integrationId = request.params.integrationId as IntegrationId | undefined;

  if (integrationId !== 'connectwise' && integrationId !== 'cove' && integrationId !== 'ncentral') {
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
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  try {
    if (integrationId === 'connectwise') {
      const result = await syncConnectWiseAgreementReport({
        pool: repositoryContext.pool,
        provider,
        pageSize: safePositiveInteger(body.pageSize, 100),
        maxPages: safePositiveInteger(body.maxPages, 50),
      });

      return jsonResponse(200, {
        integrationId: 'connectwise',
        ...result,
      });
    }

    if (integrationId === 'cove') {
      const result = await syncCoveUsageSnapshots({
        pool: repositoryContext.pool,
        provider,
        pageSize: safePositiveInteger(body.pageSize, 10000),
        maxPages: safePositiveInteger(body.maxPages, 1),
      });

      return jsonResponse(200, {
        integrationId: 'cove',
        ...result,
      });
    }

    const result = await syncNcentralUsageSnapshots({
      pool: repositoryContext.pool,
      provider,
      pageSize: safePositiveInteger(body.pageSize, 500),
      maxPages: safePositiveInteger(body.maxPages, 100),
    });

    return jsonResponse(200, {
      integrationId: 'ncentral',
      ...result,
    });
  } catch (error) {
    return integrationErrorResponse(error, `${integrationDisplayName(integrationId)} sync failed.`);
  } finally {
    await repositoryContext.close();
  }
}

app.http('listIntegrations', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'integrations',
  handler: listIntegrationsHttp,
});

app.http('testIntegration', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'integrations/{integrationId}/test',
  handler: testIntegrationHttp,
});

app.http('syncIntegration', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'integrations/{integrationId}/sync',
  handler: syncIntegrationHttp,
});

function integrationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ConnectWiseApiError) {
    return jsonResponse(502, {
      error: error.message,
      status: error.status,
      responseText: error.responseText,
    });
  }

  if (error instanceof CoveApiError) {
    return jsonResponse(502, {
      error: error.message,
      responseText: error.responseText,
    });
  }

  if (error instanceof NcentralApiError) {
    return jsonResponse(502, {
      error: error.message,
      status: error.status,
      responseText: error.responseText,
    });
  }

  return jsonResponse(400, {
    error: error instanceof Error ? error.message : fallback,
  });
}

function integrationDisplayName(integrationId: IntegrationId | undefined) {
  if (integrationId === 'cove') return 'Cove';
  if (integrationId === 'ncentral') return 'N-central';
  return 'ConnectWise';
}

function safePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
