import assert from 'node:assert/strict';
import { updateIntegrationSettingsHttp } from './integrationSettingsFunction';

const originalKeyVaultUrl = process.env.KEY_VAULT_URL;
const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

async function run() {
  process.env.KEY_VAULT_URL = '';

  const unauthenticatedResponse = await updateIntegrationSettingsHttp(
    {
      params: { integrationId: 'connectwise' },
      headers: new Headers(),
      async json() {
        return {};
      },
    } as never,
    { log() {} } as never,
  );
  assert.equal(unauthenticatedResponse.status, 401);

  const missingKeyVaultResponse = await updateIntegrationSettingsHttp(
    {
      params: { integrationId: 'connectwise' },
      headers: adminHeaders,
      async json() {
        return {};
      },
    } as never,
    { log() {} } as never,
  );

  assert.equal(missingKeyVaultResponse.status, 500);

  process.env.KEY_VAULT_URL = originalKeyVaultUrl;

  console.log('integration settings function tests passed');
}

run().catch((error: unknown) => {
  process.env.KEY_VAULT_URL = originalKeyVaultUrl;
  console.error(error);
  process.exitCode = 1;
});
