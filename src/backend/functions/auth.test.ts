import assert from 'node:assert/strict';
import { readAuthPrincipal, requireRole } from './auth';

async function run() {
  const anonymous = requireRole({ headers: new Headers() } as never, 'Analyst');
  assert.equal(anonymous.response?.status, 401);

  const analystRequest = {
    headers: new Headers({
      'x-ms-client-principal-name': 'analyst@example.com',
      'x-ms-client-principal-role': 'Analyst',
    }),
  } as never;
  assert.equal(requireRole(analystRequest, 'Analyst').principal?.name, 'analyst@example.com');
  assert.equal(requireRole(analystRequest, 'Admin').response?.status, 403);

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
});
