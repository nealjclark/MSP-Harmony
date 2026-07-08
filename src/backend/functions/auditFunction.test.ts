import assert from 'node:assert/strict';
import { getAuditEventHttp, listAuditEventsHttp } from './auditFunction';

const originalAllowHeaderRoleAuth = process.env.ALLOW_HEADER_ROLE_AUTH;
const databaseEnvKeys = ['DATABASE_URL', 'DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'] as const;
const originalDatabaseEnv = Object.fromEntries(databaseEnvKeys.map((key) => [key, process.env[key]]));

const analystHeaders = new Headers({
  'x-ms-client-principal-name': 'analyst@example.com',
  'x-ms-client-principal-role': 'Analyst',
});

async function run() {
  process.env.ALLOW_HEADER_ROLE_AUTH = 'true';

  clearDatabaseEnv();
  const missingDatabaseResponse = await listAuditEventsHttp(request({}, analystHeaders), {} as never);
  assert.equal(missingDatabaseResponse.status, 400);
  assert.ok(Array.isArray((missingDatabaseResponse.jsonBody as { missingDatabaseSettings?: string[] }).missingDatabaseSettings));

  const missingEventResponse = await getAuditEventHttp(request({ eventId: '' }, analystHeaders), {} as never);
  assert.equal(missingEventResponse.status, 400);

  console.log('audit function tests passed');
}

function request(
  params: { eventId?: string },
  headers: Headers,
) {
  return {
    params,
    query: new URLSearchParams(),
    headers,
    json: async () => ({}),
  } as never;
}

function clearDatabaseEnv() {
  for (const key of databaseEnvKeys) {
    delete process.env[key];
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    restoreEnv('ALLOW_HEADER_ROLE_AUTH', originalAllowHeaderRoleAuth);
    for (const key of databaseEnvKeys) {
      restoreEnv(key, originalDatabaseEnv[key]);
    }
  });
