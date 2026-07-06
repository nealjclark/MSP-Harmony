import assert from 'node:assert/strict';
import {
  updateIntegrationSettings,
  type IntegrationSecretWriter,
  type IntegrationSettingsRepository,
} from './settingsUpdater';

const writtenSecrets: Record<string, string> = {};
const secretWriter: IntegrationSecretWriter = {
  async setSecret(name: string, value: string) {
    writtenSecrets[name] = value;
  },
};
const savedNonSecrets: Array<Record<string, unknown>> = [];
const repository: IntegrationSettingsRepository = {
  async saveNonSecrets(input) {
    savedNonSecrets.push(input);
  },
};

async function run() {
  const result = await updateIntegrationSettings(
    {
      integrationId: 'connectwise',
      actor: 'neal@bmbsolutions.com',
      role: 'Admin',
      nonSecrets: {
        endpoint: 'https://api-na.myconnectwise.net',
        companyId: 'bmb',
        clientId: 'client-id',
      },
      secrets: {
        publicKey: 'public-key',
        privateKey: 'private-key',
      },
    },
    secretWriter,
    repository,
  );

  assert.equal(writtenSecrets['mspharmony-connectwise-public-key'], 'public-key');
  assert.equal(writtenSecrets['mspharmony-connectwise-private-key'], 'private-key');
  assert.deepEqual(result.writtenKeyVaultSecretNames, [
    'mspharmony-connectwise-public-key',
    'mspharmony-connectwise-private-key',
  ]);
  assert.equal(result.validation.configuredStatus, 'connected');
  assert.deepEqual(result.savedNonSecretKeys, ['endpoint', 'companyId', 'clientId']);
  assert.equal(savedNonSecrets.length, 1);

  const microsoftResult = await updateIntegrationSettings(
    {
      integrationId: 'microsoft-365',
      actor: 'neal@bmbsolutions.com',
      role: 'Admin',
      nonSecrets: {
        endpoint: 'https://graph.microsoft.com',
        clientId: 'client-id',
        tenantId: 'tenant-id',
        detailOnlySync: 'false',
      },
      secrets: {},
    },
    secretWriter,
    repository,
  );
  assert.equal(microsoftResult.savedNonSecretKeys.includes('detailOnlySync'), true);
  assert.equal(savedNonSecrets[1]?.nonSecrets && (savedNonSecrets[1].nonSecrets as Record<string, string>).detailOnlySync, 'false');

  await assert.rejects(
    () =>
      updateIntegrationSettings(
        {
          integrationId: 'connectwise',
          actor: 'analyst@example.com',
          role: 'Analyst',
          nonSecrets: {},
          secrets: {},
        },
        secretWriter,
      ),
    /Only Admin/,
  );

  await assert.rejects(
    () =>
      updateIntegrationSettings(
        {
          integrationId: 'connectwise',
          actor: 'neal@bmbsolutions.com',
          role: 'Admin',
          nonSecrets: {
            unexpected: 'value',
          },
          secrets: {},
        },
        secretWriter,
      ),
    /Unknown non-secret/,
  );

  console.log('settings updater tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
