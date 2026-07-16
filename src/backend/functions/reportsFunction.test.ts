import assert from 'node:assert/strict';
import {
  generateChangeReportHttp,
  getCustomerLicenseReportHttp,
  getDiscrepancyReportHttp,
  listCustomerLicenseReportCustomersHttp,
  listDiscrepancyComparisonsHttp,
  recordRawPayloadAccess,
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

  const emptyChangeReportResponse = await generateChangeReportHttp(
    requestWithJson({}, analystHeaders),
    {} as never,
  );
  assert.equal(emptyChangeReportResponse.status, 400);

  const unsupportedChangeReportModeResponse = await generateChangeReportHttp(
    requestWithJson(
      {
        comparisons: [
          {
            vendorId: 'cove',
            mode: 'microsoft365-license-counts',
            startSyncRunId: 'start',
            endSyncRunId: 'end',
          },
        ],
      },
      analystHeaders,
    ),
    {} as never,
  );
  assert.equal(unsupportedChangeReportModeResponse.status, 400);

  const comparisonListResponse = await listDiscrepancyComparisonsHttp(
    request({}, analystHeaders),
    {} as never,
  );
  assert.equal(comparisonListResponse.status, 200);
  assert.deepEqual(
    (comparisonListResponse.jsonBody as { comparisonPairs: Array<{ id: string }> }).comparisonPairs.map((pair) => pair.id),
    ['ncentral-sentinelone-devices', 'appriver-license-cleanup'],
  );

  const missingComparisonResponse = await getDiscrepancyReportHttp(
    request({}, analystHeaders),
    {} as never,
  );
  assert.equal(missingComparisonResponse.status, 400);

  const unsupportedComparisonResponse = await getDiscrepancyReportHttp(
    request({ comparisonId: 'proofpoint-microsoft365-users' }, analystHeaders),
    {} as never,
  );
  assert.equal(unsupportedComparisonResponse.status, 400);

  clearDatabaseEnv();
  const missingDatabaseResponse = await listCustomerLicenseReportCustomersHttp(
    request({}, analystHeaders),
    {} as never,
  );
  assert.equal(missingDatabaseResponse.status, 400);
  assert.ok(Array.isArray((missingDatabaseResponse.jsonBody as { missingDatabaseSettings?: string[] }).missingDatabaseSettings));

  const auditQueries: Array<{ sql: string; values?: unknown[] }> = [];
  await recordRawPayloadAccess(
    {
      async query<T = unknown>(sql: string, values?: unknown[]) {
        auditQueries.push({ sql, values });
        return { rows: [] as T[] };
      },
    },
    {
      actor: 'analyst@example.com',
      integrationId: 'cove',
      syncRunId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      rowCount: 2,
    },
  );
  assert.match(auditQueries[0]?.sql ?? '', /insert into audit_events/);
  assert.deepEqual(auditQueries[0]?.values?.slice(0, 2), [
    'analyst@example.com',
    '11111111-1111-4111-8111-111111111111',
  ]);
  assert.deepEqual(JSON.parse(String(auditQueries[0]?.values?.[2])), {
    integrationId: 'cove',
    customerId: '22222222-2222-4222-8222-222222222222',
    rowCount: 2,
  });

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

function requestWithJson(body: unknown, headers: Headers) {
  return {
    headers,
    query: new URLSearchParams(),
    json: async () => body,
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
