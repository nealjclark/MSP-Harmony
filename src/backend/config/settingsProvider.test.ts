import assert from 'node:assert/strict';
import {
  createDefaultSecretReader,
  createIntegrationSettingsProvider,
  type SecretReader,
} from './settingsProvider';
import { listIntegrationSettingsDefinitions } from '../../shared/integrationSettings';

async function run() {
  const localProvider = createIntegrationSettingsProvider({
    env: {
      CONNECTWISE_COMPANY_ID: 'bmb',
      CONNECTWISE_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
      CONNECTWISE_PUBLIC_KEY: 'public-key',
      CONNECTWISE_PRIVATE_KEY: 'private-key',
    },
  });

  const connectWise = await localProvider.getIntegrationSettings('connectwise');
  assert.equal(connectWise.secretSource, 'environment');
  assert.equal(connectWise.nonSecrets.endpoint, 'https://api-na.myconnectwise.net');
  assert.equal(connectWise.nonSecrets.companyId, 'bmb');
  assert.equal(connectWise.secrets.publicKey, 'public-key');
  assert.equal(connectWise.validation.configuredStatus, 'connected');

  const microsoft365 = await localProvider.getIntegrationSettings('microsoft-365');
  assert.equal(microsoft365.nonSecrets.detailOnlySync, 'true');

  const databaseBackedProvider = createIntegrationSettingsProvider({
    env: {
      CONNECTWISE_COMPANY_ID: 'env-company',
      CONNECTWISE_CLIENT_ID: 'env-client-id',
      CONNECTWISE_PUBLIC_KEY: 'public-key',
      CONNECTWISE_PRIVATE_KEY: 'private-key',
    },
    metadataReader: {
      async loadMetadata(integrationId) {
        if (integrationId !== 'connectwise') return undefined;

        return {
          nonSecrets: {
            companyId: 'db-company',
            clientId: 'db-client-id',
          },
          lastTestedAt: '2026-06-03T12:15:00.000Z',
          lastTestResult: 'success',
        };
      },
    },
  });
  const databaseBackedConnectWise = await databaseBackedProvider.getIntegrationSettings('connectwise');
  assert.equal(databaseBackedConnectWise.nonSecrets.companyId, 'db-company');
  assert.equal(databaseBackedConnectWise.nonSecrets.clientId, 'db-client-id');
  assert.equal(databaseBackedConnectWise.validation.lastTestResult, 'success');

  let skippedSecretReads = 0;
  const metadataOnlyProvider = createIntegrationSettingsProvider({
    env: {
      KEY_VAULT_URL: 'https://mspharmony-dev.vault.azure.net/',
    },
    loadSecrets: false,
    secretReader: {
      source: 'key-vault',
      async getSecret() {
        skippedSecretReads += 1;
        throw new Error('Secret reader should not be called when loadSecrets is false.');
      },
    },
    metadataReader: {
      async loadMetadata(integrationId) {
        if (integrationId !== 'connectwise') return undefined;

        return {
          nonSecrets: {
            companyId: 'db-company',
            clientId: 'db-client-id',
          },
          availableKeyVaultSecrets: [
            'mspharmony-connectwise-public-key',
            'mspharmony-connectwise-private-key',
          ],
          lastTestResult: 'success',
        };
      },
    },
  });
  const metadataOnlyConnectWise = await metadataOnlyProvider.getIntegrationSettings('connectwise');
  assert.equal(skippedSecretReads, 0);
  assert.deepEqual(metadataOnlyConnectWise.secrets, {});
  assert.equal(metadataOnlyConnectWise.secretSource, 'key-vault');
  assert.equal(metadataOnlyConnectWise.validation.configuredStatus, 'connected');

  const keyVaultReader: SecretReader = {
    source: 'key-vault',
    async getSecret(name: string) {
      if (name === 'mspharmony-connectwise-public-key') return 'public-key';
      return undefined;
    },
  };

  const keyVaultProvider = createIntegrationSettingsProvider({
    env: {
      KEY_VAULT_URL: 'https://mspharmony-dev.vault.azure.net/',
      CONNECTWISE_COMPANY_ID: 'bmb',
      CONNECTWISE_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
    },
    secretReader: keyVaultReader,
  });

  const missingPrivateKey = await keyVaultProvider.getIntegrationSettings('connectwise');
  assert.equal(missingPrivateKey.secretSource, 'key-vault');
  assert.equal(missingPrivateKey.keyVaultUrl, 'https://mspharmony-dev.vault.azure.net/');
  assert.equal(missingPrivateKey.validation.configuredStatus, 'not-configured');
  assert.deepEqual(
    missingPrivateKey.validation.missingSecrets.map((secret) => secret.keyVaultSecretName),
    ['mspharmony-connectwise-private-key'],
  );

  const allSettings = await localProvider.listIntegrationSettings();
  assert.equal(allSettings.length, listIntegrationSettingsDefinitions().length);

  const envReader = createDefaultSecretReader(
    {
      COVE_USERNAME: 'api-user@example.com',
    },
    undefined,
  );
  assert.equal(await envReader.getSecret('mspharmony-cove-username', 'COVE_USERNAME'), 'api-user@example.com');

  console.log('settings provider tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
