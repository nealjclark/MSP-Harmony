import assert from 'node:assert/strict';
import { hasLicenseActionRole, readAuthPrincipal, requireRole } from './auth';

const originalAllowHeaderRoleAuth = process.env.ALLOW_HEADER_ROLE_AUTH;
const originalWebsiteSiteName = process.env.WEBSITE_SITE_NAME;
const originalFunctionsExtensionVersion = process.env.FUNCTIONS_EXTENSION_VERSION;

async function run() {
  const anonymous = await requireRole({ headers: new Headers() } as never, 'Analyst');
  assert.equal(anonymous.response?.status, 401);

  const analystRequest = {
    headers: new Headers({
      'x-ms-client-principal-name': 'analyst@example.com',
      'x-ms-client-principal-role': 'Analyst',
    }),
  } as never;

  process.env.ALLOW_HEADER_ROLE_AUTH = '';
  assert.equal((await requireRole(analystRequest, 'Analyst')).response?.status, 403);

  process.env.ALLOW_HEADER_ROLE_AUTH = 'true';
  delete process.env.FUNCTIONS_EXTENSION_VERSION;
  assert.equal((await requireRole(analystRequest, 'Analyst')).principal?.name, 'analyst@example.com');
  assert.equal((await requireRole(analystRequest, 'Admin')).response?.status, 403);

  process.env.WEBSITE_SITE_NAME = 'func-mspharmony-flex';
  assert.equal((await requireRole(analystRequest, 'Analyst')).response?.status, 403);
  delete process.env.WEBSITE_SITE_NAME;

  const licenseAdminRequest = {
    headers: new Headers({
      'x-ms-client-principal-name': 'license@example.com',
      'x-ms-client-principal-role': 'LicenseAdmin',
    }),
  } as never;
  const licenseAdmin = await requireRole(licenseAdminRequest, 'Analyst');
  assert.equal(licenseAdmin.principal?.name, 'license@example.com');
  assert.deepEqual(licenseAdmin.principal?.roles, ['LicenseAdmin']);
  assert.equal(hasLicenseActionRole(licenseAdmin.principal), true);
  assert.equal((await requireRole(licenseAdminRequest, 'Admin')).response?.status, 403);

  const principalPayload = Buffer.from(
    JSON.stringify({
      userId: 'principal-id',
      userDetails: 'admin@example.com',
      userRoles: ['authenticated', 'Admin'],
    }),
  ).toString('base64');
  const principal = readAuthPrincipal({
    headers: new Headers({
      'x-ms-client-principal': principalPayload,
    }),
  } as never);

  assert.equal(principal?.id, 'principal-id');
  assert.equal(principal?.name, 'admin@example.com');
  assert.deepEqual(principal?.roles, ['Admin']);
  assert.equal(hasLicenseActionRole(principal), true);

  console.log('auth function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  restoreEnv('ALLOW_HEADER_ROLE_AUTH', originalAllowHeaderRoleAuth);
  restoreEnv('WEBSITE_SITE_NAME', originalWebsiteSiteName);
  restoreEnv('FUNCTIONS_EXTENSION_VERSION', originalFunctionsExtensionVersion);
});

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
