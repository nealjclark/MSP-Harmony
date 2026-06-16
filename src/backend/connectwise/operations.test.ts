import assert from 'node:assert/strict';
import type { IntegrationRuntimeSettings } from '../config/settingsProvider';
import type {
  IntegrationSettingsDefinition,
  IntegrationSettingsValidation,
} from '../../shared/integrationSettings';
import { assertConnectWiseReady, isInactiveAddition, isInactiveAgreement } from './operations';

const degradedButConfigured = {
  definition: { integrationId: 'connectwise' } as IntegrationSettingsDefinition,
  nonSecrets: {},
  secrets: {},
  secretSource: 'key-vault',
  validation: {
    configuredStatus: 'degraded',
    missingSecrets: [],
    missingNonSecrets: [],
  } as unknown as IntegrationSettingsValidation,
} satisfies IntegrationRuntimeSettings;

assert.doesNotThrow(() => assertConnectWiseReady(degradedButConfigured));

assert.throws(
  () =>
    assertConnectWiseReady({
      ...degradedButConfigured,
      validation: {
        ...degradedButConfigured.validation,
        missingSecrets: [
          {
            key: 'publicKey',
            label: 'Public Key',
            keyVaultSecretName: 'mspharmony-connectwise-public-key',
            envVar: 'CONNECTWISE_PUBLIC_KEY',
            required: true,
          },
        ],
      },
    }),
  /mspharmony-connectwise-public-key/,
);

assert.equal(isInactiveAgreement({ id: 78, name: 'Cancelled Agreement', status: { name: 'Cancelled' } }), true);
assert.equal(isInactiveAgreement({ id: 79, name: 'Expired Agreement', agreementStatus: 'Active', endDate: '2026-06-15' }, '2026-06-16'), true);
assert.equal(isInactiveAgreement({ id: 80, name: 'Current Agreement', agreementStatus: 'Active', endDate: '2026-06-16' }, '2026-06-16'), false);
assert.equal(isInactiveAddition({ id: 1386, additionStatus: 'Cancelled' }), true);
assert.equal(isInactiveAddition({ id: 2968, AdditionStatus: 'Canceled' } as { id: number; AdditionStatus: string }), true);
assert.equal(isInactiveAddition({ id: 2969, additionStatus: 'Active', agreementStatus: 'Expired' }), true);
assert.equal(isInactiveAddition({ id: 2970, additionStatus: 'Active', agreementStatus: 'Active' }), false);

console.log('connectwise operations tests passed');
