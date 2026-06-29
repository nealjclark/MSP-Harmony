import assert from 'node:assert/strict';
import {
  getCustomerLicenseReportHttp,
  listCustomerLicenseReportCustomersHttp,
} from './reportsFunction';

const originalAllowHeaderRoleAuth = process.env.ALLOW_HEADER_ROLE_AUTH;
const databaseEnvKeys = ['DATABASE_URL', 'DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'] as const;
const originalDatabaseEnv = Object.fromEntries(databaseEnvKeys.map((key) => [key, process.env[key]]));

const analystHeaders = new Headers({
  'x-ms-client-principal-name': 'analyst@example.com',
  'x-ms-client-principal-role': 'Analyst',
});

async function run() {
  process.env.ALLOW_HEADER_ROLE_AUTH = 'true';

  const invalidCustomerResponse = await getCustomerLicenseReportHttp(
    request({ customerId: 'not-a-uuid', vendorId: 'cove' }, analystHeaders),
    {} as never,
  );
  assert.equal(invalidCustomerResponse.status, 400);

  const unsupportedVendorResponse = await getCustomerLicenseReportHttp(
    request(
      {
        customerId: '11111111-1111-4111-8111-111111111111',
        vendorId: 'sentinelone',
      },
      analystHeaders,
    ),
    {} as never,
  );
  assert.equal(unsupportedVendorResponse.status, 400);

  const forbiddenMicrosoftDetailsResponse = await getCustomerLicenseReportHttp(
    request(
      {
        customerId: '11111111-1111-4111-8111-111111111111',
        vendorId: 'microsoft-365',
        includeMicrosoftUserDetails: 'true',
      },
      analystHeaders,
    ),
    {} as never,
  );
  assert.equal(forbiddenMicrosoftDetailsResponse.status, 403);

  const forbiddenCombinedMicrosoftDetailsResponse = await getCustomerLicenseReportHttp(
    request(
      {
        customerId: '11111111-1111-4111-8111-111111111111',
        vendorId: 'all',
        includeMicrosoftUserDetails: 'true',
      },
      analystHeaders,
    ),
    {} as never,
  );
  assert.equal(forbiddenCombinedMicrosoftDetailsResponse.status, 403);

  clearDatabaseEnv();
  const missingDatabaseResponse = await listCustomerLicenseReportCustomersHttp(
    request({}, analystHeaders),
    {} as never,
  );
  assert.equal(missingDatabaseResponse.status, 400);
  assert.ok(Array.isArray((missingDatabaseResponse.jsonBody as { missingDatabaseSettings?: string[] }).missingDatabaseSettings));

  console.log('reports function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  restoreEnv('ALLOW_HEADER_ROLE_AUTH', originalAllowHeaderRoleAuth);
  for (const key of databaseEnvKeys) {
    restoreEnv(key, originalDatabaseEnv[key]);
  }
});

function request(query: Record<string, string>, headers: Headers) {
  return {
    headers,
    query: new URLSearchParams(query),
  } as never;
}

function clearDatabaseEnv() {
  for (const key of databaseEnvKeys) {
    delete process.env[key];
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
