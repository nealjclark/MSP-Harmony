import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { config as loadDotEnv } from 'dotenv';
import {
  getIntegrationSettingsDefinition,
  listIntegrationSettingsDefinitions,
  validateIntegrationSettings,
  type IntegrationId,
  type IntegrationSettingsDefinition,
  type IntegrationTestResult,
  type IntegrationSettingsValidation,
} from '../../shared/integrationSettings';

export type SettingsEnvironment = Record<string, string | undefined>;

export type IntegrationRuntimeSettings = {
  definition: IntegrationSettingsDefinition;
  nonSecrets: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
  validation: IntegrationSettingsValidation;
  secretSource: 'environment' | 'key-vault';
  keyVaultUrl?: string;
};

export type IntegrationSettingsMetadata = {
  nonSecrets: Record<string, string | undefined>;
  lastTestedAt?: string;
  lastTestResult?: IntegrationTestResult;
};

export type IntegrationSettingsMetadataReader = {
  loadMetadata: (integrationId: IntegrationId) => Promise<IntegrationSettingsMetadata | undefined>;
};

export type SecretReader = {
  source: 'environment' | 'key-vault';
  getSecret: (name: string, envVar: string) => Promise<string | undefined>;
};

export type IntegrationSettingsProvider = {
  getIntegrationSettings: (integrationId: IntegrationId) => Promise<IntegrationRuntimeSettings>;
  listIntegrationSettings: () => Promise<IntegrationRuntimeSettings[]>;
};

export type IntegrationSettingsProviderOptions = {
  env?: SettingsEnvironment;
  secretReader?: SecretReader;
  metadataReader?: IntegrationSettingsMetadataReader;
  keyVaultUrl?: string;
  loadLocalEnv?: boolean;
  localEnvPath?: string;
};

export function loadLocalEnvironment(path = '.env') {
  loadDotEnv({
    path,
    override: false,
  });
}

export function createIntegrationSettingsProvider(options: IntegrationSettingsProviderOptions = {}): IntegrationSettingsProvider {
  if (options.loadLocalEnv) {
    loadLocalEnvironment(options.localEnvPath);
  }

  const env = options.env ?? process.env;
  const keyVaultUrl = options.keyVaultUrl ?? env.KEY_VAULT_URL;
  const secretReader = options.secretReader ?? createDefaultSecretReader(env, keyVaultUrl);

  return {
    async getIntegrationSettings(integrationId: IntegrationId) {
      const definition = getIntegrationSettingsDefinition(integrationId);

      if (!definition) {
        throw new Error(`Integration "${integrationId}" is not registered.`);
      }

      return loadIntegrationRuntimeSettings(definition, secretReader, env, keyVaultUrl, options.metadataReader);
    },
    async listIntegrationSettings() {
      return Promise.all(
        listIntegrationSettingsDefinitions().map((definition) =>
          loadIntegrationRuntimeSettings(definition, secretReader, env, keyVaultUrl, options.metadataReader),
        ),
      );
    },
  };
}

export function createDefaultSecretReader(env: SettingsEnvironment, keyVaultUrl?: string): SecretReader {
  if (keyVaultUrl && keyVaultUrl.trim().length > 0) {
    return new KeyVaultSecretReader(keyVaultUrl);
  }

  return new EnvironmentSecretReader(env);
}

export class EnvironmentSecretReader implements SecretReader {
  source = 'environment' as const;

  constructor(private readonly env: SettingsEnvironment = process.env) {}

  async getSecret(_name: string, envVar: string) {
    return this.env[envVar];
  }
}

export class KeyVaultSecretReader implements SecretReader {
  source = 'key-vault' as const;
  private readonly client: SecretClient;

  constructor(private readonly keyVaultUrl: string) {
    this.client = new SecretClient(keyVaultUrl, new DefaultAzureCredential());
  }

  async getSecret(name: string) {
    try {
      const result = await this.client.getSecret(name);
      return result.value;
    } catch (error) {
      if (isKeyVaultMissingSecretError(error)) {
        return undefined;
      }

      throw error;
    }
  }
}

async function loadIntegrationRuntimeSettings(
  definition: IntegrationSettingsDefinition,
  secretReader: SecretReader,
  env: SettingsEnvironment,
  keyVaultUrl?: string,
  metadataReader?: IntegrationSettingsMetadataReader,
): Promise<IntegrationRuntimeSettings> {
  const metadata = await metadataReader?.loadMetadata(definition.integrationId);
  const nonSecretsFromEnvironment = Object.fromEntries(
    definition.requiredNonSecrets.map((setting) => [
      setting.key,
      env[setting.envVar] ?? setting.defaultValue,
    ]),
  );
  const nonSecrets = {
    ...nonSecretsFromEnvironment,
    ...cleanNonSecrets(metadata?.nonSecrets ?? {}),
  };
  const secretEntries = await Promise.all(
    definition.requiredSecrets.map(async (setting) => [
      setting.key,
      await secretReader.getSecret(setting.keyVaultSecretName, setting.envVar),
    ] as const),
  );
  const secrets = Object.fromEntries(secretEntries);
  const availableKeyVaultSecrets = definition.requiredSecrets
    .filter((setting) => hasValue(secrets[setting.key]))
    .map((setting) => setting.keyVaultSecretName);
  const validation = validateIntegrationSettings(definition, {
    integrationId: definition.integrationId,
    nonSecrets,
    availableKeyVaultSecrets,
    lastTestedAt: metadata?.lastTestedAt,
    lastTestResult: metadata?.lastTestResult,
  });

  return {
    definition,
    nonSecrets,
    secrets,
    validation,
    secretSource: secretReader.source,
    keyVaultUrl,
  };
}

function hasValue(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanNonSecrets(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => hasValue(value)));
}

function isKeyVaultMissingSecretError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { statusCode?: number; code?: string };
  return candidate.statusCode === 404 || candidate.code === 'SecretNotFound';
}
