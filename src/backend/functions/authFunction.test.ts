import assert from 'node:assert/strict';
import { getAuthSession, readAuthPrincipal } from './auth';
import { getAuthSessionHttp } from './authFunction';

const originalAllowHeaderRoleAuth = process.env.ALLOW_HEADER_ROLE_AUTH;

async function run() {
  const unauthenticated = await getAuthSessionHttp({ headers: new Headers() } as never, {} as never);
  assert.equal(unauthenticated.status, 401);

  const analystRequest = {
    headers: new Headers({
      'x-ms-client-principal-name': 'analyst@example.com',
      'x-ms-client-principal-id': 'analyst-id',
      'x-ms-client-principal-role': 'Analyst',
    }),
  } as never;

  process.env.ALLOW_HEADER_ROLE_AUTH = '';
  const pending = await getAuthSession(analystRequest);
  assert.equal(pending?.state, 'pending');

  process.env.ALLOW_HEADER_ROLE_AUTH = 'true';
  const authorized = await getAuthSession(analystRequest);
  assert.equal(authorized?.state, 'authorized');
  assert.deepEqual(authorized?.principal.roles, ['Analyst']);

  const authorizedResponse = await getAuthSessionHttp(analystRequest, {} as never);
  assert.equal(authorizedResponse.status, 200);
  assert.equal((authorizedResponse.jsonBody as { status: string }).status, 'authorized');

  const principal = readAuthPrincipal(analystRequest);
  assert.equal(principal?.email, 'analyst@example.com');

  console.log('auth session function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (typeof originalAllowHeaderRoleAuth === 'undefined') {
    delete process.env.ALLOW_HEADER_ROLE_AUTH;
  } else {
    process.env.ALLOW_HEADER_ROLE_AUTH = originalAllowHeaderRoleAuth;
  }
});
