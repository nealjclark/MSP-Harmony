import assert from 'node:assert/strict';
import { listUsersHttp } from './usersFunction';

const envKeys = [
  'BOOTSTRAP_ADMIN_EMAILS',
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
] as const;

const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.com';
  for (const key of envKeys) {
    if (key === 'BOOTSTRAP_ADMIN_EMAILS') continue;
    process.env[key] = '';
  }

  try {
    const unauthenticatedResponse = await listUsersHttp(
      {
        headers: new Headers(),
      } as never,
      { log() {} } as never,
    );
    assert.equal(unauthenticatedResponse.status, 401);

    const missingDatabaseResponse = await listUsersHttp(
      {
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(missingDatabaseResponse.status, 500);
    assert.match(String((missingDatabaseResponse.jsonBody as { error?: string }).error), /PostgreSQL/);
  } finally {
    for (const key of envKeys) {
      const originalValue = originalEnv[key];
      if (typeof originalValue === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  }

  console.log('users function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
