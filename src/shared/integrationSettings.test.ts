import assert from 'node:assert/strict';
import {
  getIntegrationSettingsDefinition,
  validateIntegrationRegistry,
  validateIntegrationSettings,
} from './integrationSettings';

const connectWise = getIntegrationSettingsDefinition('connectwise');
assert.ok(connectWise);

const connectedConnectWise = validateIntegrationSettings(connectWise, {
  integrationId: 'connectwise',
  nonSecrets: {
    companyId: 'bmb',
    clientId: '00000000-0000-0000-0000-000000000000',
  },
  availableKeyVaultSecrets: ['mspharmony-connectwise-public-key', 'mspharmony-connectwise-private-key'],
  lastTestResult: 'success',
  lastTestedAt: '2026-06-03T12:00:00.000Z',
});

assert.equal(connectedConnectWise.configuredStatus, 'connected');
assert.equal(connectedConnectWise.missingSecrets.length, 0);
assert.equal(connectedConnectWise.missingNonSecrets.length, 0);

const missingPrivateKey = validateIntegrationSettings(connectWise, {
  integrationId: 'connectwise',
  nonSecrets: {
    companyId: 'bmb',
    clientId: '00000000-0000-0000-0000-000000000000',
  },
  availableKeyVaultSecrets: ['mspharmony-connectwise-public-key'],
});

assert.equal(missingPrivateKey.configuredStatus, 'degraded');
assert.deepEqual(
  missingPrivateKey.missingSecrets.map((secret) => secret.keyVaultSecretName),
  ['mspharmony-connectwise-private-key'],
);

const proofpoint = getIntegrationSettingsDefinition('proofpoint');
assert.ok(proofpoint);

const emptyProofpoint = validateIntegrationSettings(proofpoint);
assert.equal(emptyProofpoint.configuredStatus, 'not-configured');
assert.equal(emptyProofpoint.missingSecrets.length, 2);

const registryValidation = validateIntegrationRegistry([
  {
    integrationId: 'cove',
    nonSecrets: {
      partnerName: 'BMB Consulting',
    },
    availableKeyVaultSecrets: ['mspharmony-cove-username', 'mspharmony-cove-password'],
    lastTestResult: 'success',
  },
]);

const coveValidation = registryValidation.find((validation) => validation.integrationId === 'cove');
assert.equal(coveValidation?.configuredStatus, 'connected');

const ncentral = getIntegrationSettingsDefinition('ncentral');
assert.ok(ncentral);

const connectedNcentral = validateIntegrationSettings(ncentral, {
  integrationId: 'ncentral',
  nonSecrets: {
    endpoint: 'https://ncentral.example.com',
  },
  availableKeyVaultSecrets: ['mspharmony-ncentral-api-token'],
  lastTestResult: 'success',
});

assert.equal(connectedNcentral.configuredStatus, 'connected');
assert.deepEqual(connectedNcentral.missingSecrets, []);
assert.deepEqual(connectedNcentral.missingNonSecrets, []);

const microsoft365 = getIntegrationSettingsDefinition('microsoft-365');
assert.ok(microsoft365);

const connectedMicrosoft365 = validateIntegrationSettings(microsoft365, {
  integrationId: 'microsoft-365',
  nonSecrets: {
    endpoint: 'https://graph.microsoft.com',
    clientId: 'microsoft-app-id',
    tenantId: 'partner-tenant',
  },
  availableKeyVaultSecrets: [
    'mspharmony-microsoft365-client-secret',
  ],
  lastTestResult: 'success',
});

assert.equal(connectedMicrosoft365.configuredStatus, 'connected');
assert.deepEqual(connectedMicrosoft365.missingSecrets, []);
assert.deepEqual(connectedMicrosoft365.missingNonSecrets, []);

const appRiver = getIntegrationSettingsDefinition('opentext-appriver');
assert.ok(appRiver);

const connectedAppRiver = validateIntegrationSettings(appRiver, {
  integrationId: 'opentext-appriver',
  nonSecrets: {
    endpoint: 'https://unityapi.webrootcloudav.com',
    clientId: 'appriver-client-id',
  },
  availableKeyVaultSecrets: [
    'mspharmony-opentext-appriver-client-secret',
    'mspharmony-opentext-appriver-refresh-token',
  ],
  lastTestResult: 'success',
});

assert.equal(connectedAppRiver.configuredStatus, 'connected');
assert.deepEqual(connectedAppRiver.missingSecrets, []);
assert.deepEqual(connectedAppRiver.missingNonSecrets, []);

const datto = getIntegrationSettingsDefinition('datto');
assert.ok(datto);

const connectedDatto = validateIntegrationSettings(datto, {
  integrationId: 'datto',
  nonSecrets: {
    endpoint: 'https://api.datto.com',
  },
  availableKeyVaultSecrets: [
    'mspharmony-datto-api-key',
    'mspharmony-datto-api-secret',
  ],
  lastTestResult: 'success',
});

assert.equal(connectedDatto.configuredStatus, 'connected');
assert.deepEqual(connectedDatto.missingSecrets, []);
assert.deepEqual(connectedDatto.missingNonSecrets, []);

console.log('integration settings tests passed');
