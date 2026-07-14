import assert from 'node:assert/strict';
import {
  automapMappingsHttp,
  deactivateCrossVendorBundleHttp,
  listCrossVendorBundlesHttp,
  listMappingsHttp,
  updateAccountMappingHttp,
  upsertCrossVendorBundleHttp,
} from './mappingsFunction';

const envKeys = [
  'BOOTSTRAP_ADMIN_EMAILS',
  'AUTH_DISABLE_BOOTSTRAP_UPSERT',
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
const adminMutationHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
  origin: 'http://localhost:4280',
});

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.com';
  process.env.AUTH_DISABLE_BOOTSTRAP_UPSERT = 'true';
  for (const key of envKeys) {
    if (key === 'BOOTSTRAP_ADMIN_EMAILS' || key === 'AUTH_DISABLE_BOOTSTRAP_UPSERT') continue;
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

    const missingCrossVendorListDatabaseResponse = await listCrossVendorBundlesHttp(
      {
        method: 'GET',
        url: 'http://localhost:4280/api/cross-vendor-bundles',
        params: {},
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(missingCrossVendorListDatabaseResponse.status, 400);
    assert.match(String((missingCrossVendorListDatabaseResponse.jsonBody as { error?: string }).error), /Cross-vendor bundles/);

    const missingCrossVendorSaveDatabaseResponse = await upsertCrossVendorBundleHttp(
      {
        method: 'PUT',
        url: 'http://localhost:4280/api/cross-vendor-bundles/managed-endpoint-o365',
        params: { bundleKey: 'managed-endpoint-o365' },
        headers: adminMutationHeaders,
        async json() {
          return {
            bundleName: 'Managed Endpoint + O365',
          };
        },
      } as never,
      { log() {} } as never,
    );
    assert.equal(missingCrossVendorSaveDatabaseResponse.status, 400);
    assert.match(String((missingCrossVendorSaveDatabaseResponse.jsonBody as { error?: string }).error), /Cross-vendor bundle save/);

    const missingCrossVendorDeactivateDatabaseResponse = await deactivateCrossVendorBundleHttp(
      {
        method: 'DELETE',
        url: 'http://localhost:4280/api/cross-vendor-bundles/managed-endpoint-o365/deactivate',
        params: { bundleKey: 'managed-endpoint-o365' },
        headers: adminMutationHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(missingCrossVendorDeactivateDatabaseResponse.status, 400);
    assert.match(
      String((missingCrossVendorDeactivateDatabaseResponse.jsonBody as { error?: string }).error),
      /Cross-vendor bundle deactivation/,
    );
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
