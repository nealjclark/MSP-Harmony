import assert from 'node:assert/strict';
import { updateIntegrationSettingsHttp } from './integrationSettingsFunction';

const originalKeyVaultUrl = process.env.KEY_VAULT_URL;
const originalBootstrapAdminEmails = process.env.BOOTSTRAP_ADMIN_EMAILS;
const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

async function run() {
  process.env.KEY_VAULT_URL = '';
  process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.com';

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

  restoreEnv('KEY_VAULT_URL', originalKeyVaultUrl);
  restoreEnv('BOOTSTRAP_ADMIN_EMAILS', originalBootstrapAdminEmails);

  console.log('integration settings function tests passed');
}

run().catch((error: unknown) => {
  restoreEnv('KEY_VAULT_URL', originalKeyVaultUrl);
  restoreEnv('BOOTSTRAP_ADMIN_EMAILS', originalBootstrapAdminEmails);
  console.error(error);
  process.exitCode = 1;
});

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
