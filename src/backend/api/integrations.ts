import {
  getIntegrationSettingsDefinition,
  listIntegrationSettingsDefinitions,
  validateIntegrationRegistry,
  validateIntegrationSettings,
  type IntegrationId,
  type IntegrationSettingsState,
} from '../../shared/integrationSettings';
import { createIntegrationSettingsProvider, type IntegrationSettingsMetadataReader } from '../config/settingsProvider';

export type IntegrationOperationalStatus = {
  lastSyncAt?: string;
  lastSyncCompletedAt?: string;
  lastSyncStatus?: string;
  lastSyncRecordsRead?: number;
  lastSyncRecordsWritten?: number;
  lastSyncError?: string;
  storedRecordCount?: number;
};

export type IntegrationOperationalStatusReader = {
  loadOperationalStatus: (integrationId: IntegrationId) => Promise<IntegrationOperationalStatus | undefined>;
};

export function listIntegrations(states: IntegrationSettingsState[] = []) {
  const validationsById = new Map(
    validateIntegrationRegistry(states).map((validation) => [validation.integrationId, validation]),
  );

  return listIntegrationSettingsDefinitions().map((definition) => ({
    ...definition,
    validation: validationsById.get(definition.integrationId),
  }));
}

export function getIntegration(integrationId: IntegrationId, state?: IntegrationSettingsState) {
  const definition = getIntegrationSettingsDefinition(integrationId);

  if (!definition) {
    throw new Error(`Integration "${integrationId}" is not registered.`);
  }

  return {
    ...definition,
    validation: validateIntegrationSettings(definition, state),
  };
}

export async function listRuntimeIntegrations(
  options: {
    metadataReader?: IntegrationSettingsMetadataReader;
    operationalStatusReader?: IntegrationOperationalStatusReader;
  } = {},
) {
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: options.metadataReader,
  });
  const settings = await provider.listIntegrationSettings();

  return Promise.all(
    settings.map(async (setting) => ({
      ...setting.definition,
      nonSecrets: setting.nonSecrets,
      validation: setting.validation,
      secretSource: setting.secretSource,
      keyVaultUrl: setting.keyVaultUrl,
      operationalStatus: await options.operationalStatusReader?.loadOperationalStatus(setting.definition.integrationId),
    })),
  );
}

export async function getRuntimeIntegration(
  integrationId: IntegrationId,
  options: {
    metadataReader?: IntegrationSettingsMetadataReader;
    operationalStatusReader?: IntegrationOperationalStatusReader;
  } = {},
) {
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: options.metadataReader,
  });
  const setting = await provider.getIntegrationSettings(integrationId);

  return {
    ...setting.definition,
    nonSecrets: setting.nonSecrets,
    validation: setting.validation,
    secretSource: setting.secretSource,
    keyVaultUrl: setting.keyVaultUrl,
    operationalStatus: await options.operationalStatusReader?.loadOperationalStatus(setting.definition.integrationId),
  };
}
