import {
  KeyVaultIntegrationSecretWriter,
  updateIntegrationSettings,
  type IntegrationSettingsRepository,
  type UpdateIntegrationSettingsRequest,
} from '../config/settingsUpdater';

export async function updateIntegrationSettingsFromInterface(
  request: UpdateIntegrationSettingsRequest,
  keyVaultUrl: string,
  repository?: IntegrationSettingsRepository,
) {
  return updateIntegrationSettings(request, new KeyVaultIntegrationSecretWriter(keyVaultUrl), repository);
}
