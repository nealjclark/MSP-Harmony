import assert from 'node:assert/strict';
import { syncIntegrationHttp, testIntegrationHttp } from './integrationsFunction';

const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

const envKeys = [
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'COVE_ENDPOINT',
  'COVE_PARTNER_NAME',
  'COVE_USERNAME',
  'COVE_PASSWORD',
  'MICROSOFT365_ENDPOINT',
  'MICROSOFT365_CLIENT_ID',
  'MICROSOFT365_TENANT_ID',
  'MICROSOFT365_CLIENT_SECRET',
  'OPENTEXT_APPRIVER_ENDPOINT',
  'OPENTEXT_APPRIVER_CLIENT_ID',
  'OPENTEXT_APPRIVER_CLIENT_SECRET',
  'OPENTEXT_APPRIVER_REFRESH_TOKEN',
  'OPENTEXT_APPRIVER_REFRESH_TOKEN_CACHE_PATH',
] as const;

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) {
    process.env[key] = '';
  }

  try {
    const unsupportedTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'sentinelone' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );

    assert.equal(unsupportedTestResponse.status, 501);

    const coveTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'cove' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(coveTestResponse.status, 400);
    assert.match(String((coveTestResponse.jsonBody as { error?: string }).error), /Cove settings/);

    const microsoft365TestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'microsoft-365' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(microsoft365TestResponse.status, 400);
    assert.match(String((microsoft365TestResponse.jsonBody as { error?: string }).error), /Microsoft 365 settings/);
    assert.doesNotMatch(
      String((microsoft365TestResponse.jsonBody as { error?: string }).error),
      /not implemented/i,
    );

    const appRiverTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'opentext-appriver' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(appRiverTestResponse.status, 400);
    assert.match(String((appRiverTestResponse.jsonBody as { error?: string }).error), /AppRiver - OpenText settings/);
    assert.doesNotMatch(
      String((appRiverTestResponse.jsonBody as { error?: string }).error),
      /not implemented/i,
    );

    const coveSyncResponse = await syncIntegrationHttp(
      {
        params: { integrationId: 'cove' },
        headers: adminHeaders,
        async json() {
          return {};
        },
      } as never,
      { log() {} } as never,
    );

    assert.equal(coveSyncResponse.status, 400);
    assert.match(String((coveSyncResponse.jsonBody as { error?: string }).error), /Cove sync needs PostgreSQL/);

    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/mspharmony';
    const queuedMessages: unknown[] = [];
    const queuedMicrosoft365SyncResponse = await syncIntegrationHttp(
      {
        params: { integrationId: 'microsoft-365' },
        headers: adminHeaders,
        async json() {
          return { dataset: 'licenses' };
        },
      } as never,
      {
        log() {},
        extraOutputs: {
          set(_output: unknown, value: unknown) {
            queuedMessages.push(value);
          },
        },
      } as never,
    );
    assert.equal(queuedMicrosoft365SyncResponse.status, 202);
    assert.equal((queuedMicrosoft365SyncResponse.jsonBody as { status?: string }).status, 'queued');
    assert.deepEqual(queuedMessages[0], {
      integrationId: 'microsoft-365',
      requestedBy: 'admin@example.com',
      requestedAt: (queuedMessages[0] as { requestedAt: string }).requestedAt,
      dataset: 'licenses',
      pageSize: 100,
      maxPages: 100,
    });
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

  console.log('integrations function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
