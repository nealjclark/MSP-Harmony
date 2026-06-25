import assert from 'node:assert/strict';
import { readAuthPrincipal, requireRole } from './auth';

const originalAllowHeaderRoleAuth = process.env.ALLOW_HEADER_ROLE_AUTH;

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
  assert.equal((await requireRole(analystRequest, 'Analyst')).principal?.name, 'analyst@example.com');
  assert.equal((await requireRole(analystRequest, 'Admin')).response?.status, 403);

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

  console.log('auth function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  restoreEnv('ALLOW_HEADER_ROLE_AUTH', originalAllowHeaderRoleAuth);
});

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
