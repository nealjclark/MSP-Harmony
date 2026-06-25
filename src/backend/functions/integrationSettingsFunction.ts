import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import type { IntegrationId } from '../../shared/integrationSettings';
import { updateIntegrationSettingsFromInterface } from '../api/integrationSettings';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import type { IntegrationSettingsRole } from '../config/settingsUpdater';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type IntegrationSettingsBody = {
  integrationId?: IntegrationId;
  nonSecrets?: Record<string, string | undefined>;
  secrets?: Record<string, string | undefined>;
};

export async function updateIntegrationSettingsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const integrationId = request.params.integrationId as IntegrationId | undefined;
  const keyVaultUrl = process.env.KEY_VAULT_URL;

  if (!keyVaultUrl) {
    return jsonResponse(500, {
      error: 'KEY_VAULT_URL is not configured for integration settings updates.',
    });
  }

  if (!integrationId) {
    return jsonResponse(400, {
      error: 'Missing integration id route parameter.',
    });
  }

  const body = (await request.json().catch(() => undefined)) as IntegrationSettingsBody | undefined;
  if (!body) {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  const actor = auth.principal.name;
  const role: IntegrationSettingsRole = 'Admin';
  const repositoryContext = createOptionalPostgresSettingsRepository();

  try {
    const existingSettings = await createIntegrationSettingsProvider({
      loadLocalEnv: true,
      metadataReader: repositoryContext.repository,
    }).getIntegrationSettings(integrationId);
    const existingMissingSecretNames = new Set(
      existingSettings.validation.missingSecrets.map((setting) => setting.keyVaultSecretName),
    );
    const existingKeyVaultSecretNames = existingSettings.definition.requiredSecrets
      .filter((setting) => !existingMissingSecretNames.has(setting.keyVaultSecretName))
      .map((setting) => setting.keyVaultSecretName);

    const result = await updateIntegrationSettingsFromInterface(
      {
        integrationId,
        actor,
        role,
        nonSecrets: body.nonSecrets ?? {},
        secrets: body.secrets ?? {},
        existingKeyVaultSecretNames,
      },
      keyVaultUrl,
      repositoryContext.repository,
    );

    context.log(`Updated integration settings for ${integrationId}; secrets written: ${result.writtenKeyVaultSecretNames.length}`);

    return jsonResponse(200, {
      integrationId: result.integrationId,
      updatedBy: result.updatedBy,
      writtenKeyVaultSecretNames: result.writtenKeyVaultSecretNames,
      savedNonSecretKeys: result.savedNonSecretKeys,
      validation: result.validation,
      nonSecretStorage: repositoryContext.repository ? 'database' : 'not-configured',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Integration settings update failed.';
    const status = message.includes('Only Admin') ? 403 : 400;

    return jsonResponse(status, {
      error: message,
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('updateIntegrationSettings', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'integrations/{integrationId}/settings',
  handler: updateIntegrationSettingsHttp,
});
