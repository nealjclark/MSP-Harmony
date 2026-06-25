import assert from 'node:assert/strict';
import { automapMappingsHttp, listMappingsHttp, updateAccountMappingHttp } from './mappingsFunction';

const envKeys = ['DATABASE_URL', 'DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'] as const;
const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) {
    process.env[key] = '';
  }

  try {
    const unsupportedResponse = await listMappingsHttp(
      {
        params: { vendorId: 'unknown' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(unsupportedResponse.status, 400);

    const missingDatabaseResponse = await automapMappingsHttp(
      {
        params: { vendorId: 'cove' },
        headers: adminHeaders,
        async json() {
          return {};
        },
      } as never,
      { log() {} } as never,
    );
    assert.equal(missingDatabaseResponse.status, 400);
    assert.match(String((missingDatabaseResponse.jsonBody as { error?: string }).error), /PostgreSQL/);

    const invalidStatusResponse = await updateAccountMappingHttp(
      {
        params: { vendorId: 'cove', externalAccountId: '101' },
        headers: adminHeaders,
        async json() {
          return { status: 'bogus' };
        },
      } as never,
      { log() {} } as never,
    );
    assert.equal(invalidStatusResponse.status, 400);
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

  console.log('mapping function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
