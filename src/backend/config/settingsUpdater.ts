import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import {
  getIntegrationSettingsDefinition,
  listIntegrationNonSecretDefinitions,
  validateIntegrationSettings,
  type IntegrationId,
  type IntegrationSettingsValidation,
} from '../../shared/integrationSettings';

export type IntegrationSettingsRole = 'Admin' | 'Approver' | 'Analyst';

export type UpdateIntegrationSettingsRequest = {
  integrationId: IntegrationId;
  actor: string;
  role: IntegrationSettingsRole;
  nonSecrets: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
  existingKeyVaultSecretNames?: string[];
};

export type UpdateIntegrationSettingsResult = {
  integrationId: IntegrationId;
  updatedBy: string;
  writtenKeyVaultSecretNames: string[];
  savedNonSecretKeys: string[];
  validation: IntegrationSettingsValidation;
};

export type IntegrationSecretWriter = {
  setSecret: (name: string, value: string) => Promise<void>;
};

export type IntegrationSettingsRepository = {
  saveNonSecrets: (input: {
    integrationId: IntegrationId;
    displayName: string;
    authMode: string;
    endpoint: string;
    syncFrequency: string;
    nonSecrets: Record<string, string | undefined>;
    requiredKeyVaultSecrets: string[];
    updatedBy: string;
  }) => Promise<void>;
};

export class KeyVaultIntegrationSecretWriter implements IntegrationSecretWriter {
  private readonly client: SecretClient;

  constructor(keyVaultUrl: string) {
    this.client = new SecretClient(keyVaultUrl, new DefaultAzureCredential());
  }

  async setSecret(name: string, value: string) {
    await this.client.setSecret(name, value);
  }
}

export async function updateIntegrationSettings(
  request: UpdateIntegrationSettingsRequest,
  secretWriter: IntegrationSecretWriter,
  repository?: IntegrationSettingsRepository,
): Promise<UpdateIntegrationSettingsResult> {
  if (request.role !== 'Admin') {
    throw new Error('Only Admin users can update integration settings.');
  }

  const definition = getIntegrationSettingsDefinition(request.integrationId);
  if (!definition) {
    throw new Error(`Integration "${request.integrationId}" is not registered.`);
  }

  assertKnownKeys(
    request.nonSecrets,
    listIntegrationNonSecretDefinitions(definition).map((setting) => setting.key),
    'non-secret',
  );
  assertKnownKeys(
    request.secrets,
    definition.requiredSecrets.map((setting) => setting.key),
    'secret',
  );

  const writtenKeyVaultSecretNames: string[] = [];

  for (const setting of definition.requiredSecrets) {
    const value = request.secrets[setting.key];
    if (hasValue(value)) {
      await secretWriter.setSecret(setting.keyVaultSecretName, value);
      writtenKeyVaultSecretNames.push(setting.keyVaultSecretName);
    }
  }

  const availableKeyVaultSecrets = Array.from(
    new Set([...(request.existingKeyVaultSecretNames ?? []), ...writtenKeyVaultSecretNames]),
  );

  if (repository) {
    await repository.saveNonSecrets({
      integrationId: definition.integrationId,
      displayName: definition.displayName,
      authMode: definition.authMode,
      endpoint: request.nonSecrets.endpoint ?? definition.endpoint,
      syncFrequency: definition.syncFrequency,
      nonSecrets: request.nonSecrets,
      requiredKeyVaultSecrets: availableKeyVaultSecrets,
      updatedBy: request.actor,
    });
  }

  const validation = validateIntegrationSettings(definition, {
    integrationId: definition.integrationId,
    nonSecrets: request.nonSecrets,
    availableKeyVaultSecrets,
    lastTestResult: 'untested',
  });

  return {
    integrationId: definition.integrationId,
    updatedBy: request.actor,
    writtenKeyVaultSecretNames,
    savedNonSecretKeys: Object.keys(request.nonSecrets).filter((key) => hasValue(request.nonSecrets[key])),
    validation,
  };
}

function assertKnownKeys(values: Record<string, string | undefined>, allowedKeys: string[], kind: string) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));

  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind} setting keys: ${unknown.join(', ')}`);
  }
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
