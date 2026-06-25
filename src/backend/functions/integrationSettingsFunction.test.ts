import assert from 'node:assert/strict';
import { updateIntegrationSettingsHttp } from './integrationSettingsFunction';

const originalKeyVaultUrl = process.env.KEY_VAULT_URL;
const originalBootstrapAdminEmails = process.env.BOOTSTRAP_ADMIN_EMAILS;
const originalAuthDisableBootstrapUpsert = process.env.AUTH_DISABLE_BOOTSTRAP_UPSERT;
const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

async function run() {
  process.env.KEY_VAULT_URL = '';
  process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.com';
  process.env.AUTH_DISABLE_BOOTSTRAP_UPSERT = 'true';

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
  restoreEnv('AUTH_DISABLE_BOOTSTRAP_UPSERT', originalAuthDisableBootstrapUpsert);

  console.log('integration settings function tests passed');
}

run().catch((error: unknown) => {
  restoreEnv('KEY_VAULT_URL', originalKeyVaultUrl);
  restoreEnv('BOOTSTRAP_ADMIN_EMAILS', originalBootstrapAdminEmails);
  restoreEnv('AUTH_DISABLE_BOOTSTRAP_UPSERT', originalAuthDisableBootstrapUpsert);
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
