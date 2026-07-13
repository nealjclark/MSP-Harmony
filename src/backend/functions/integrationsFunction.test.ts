import assert from 'node:assert/strict';
import { syncIntegrationHttp, testIntegrationHttp } from './integrationsFunction';

const adminHeaders = new Headers({
  'x-ms-client-principal-name': 'admin@example.com',
  'x-ms-client-principal-role': 'Admin',
});

const envKeys = [
  'BOOTSTRAP_ADMIN_EMAILS',
  'AUTH_DISABLE_BOOTSTRAP_UPSERT',
  'KEY_VAULT_URL',
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'COVE_ENDPOINT',
  'COVE_PARTNER_NAME',
  'COVE_USERNAME',
  'COVE_PASSWORD',
  'DATTO_ENDPOINT',
  'DATTO_API_KEY',
  'DATTO_API_SECRET',
  'MICROSOFT365_ENDPOINT',
  'MICROSOFT365_CLIENT_ID',
  'MICROSOFT365_TENANT_ID',
  'MICROSOFT365_CLIENT_SECRET',
  'OPENTEXT_APPRIVER_ENDPOINT',
  'OPENTEXT_APPRIVER_CLIENT_ID',
  'OPENTEXT_APPRIVER_CLIENT_SECRET',
  'OPENTEXT_APPRIVER_REFRESH_TOKEN',
  'OPENTEXT_APPRIVER_REFRESH_TOKEN_CACHE_PATH',
  'SENTINELONE_ENDPOINT',
  'SENTINELONE_API_TOKEN',
  'HUNTRESS_ENDPOINT',
  'HUNTRESS_API_KEY',
  'HUNTRESS_API_SECRET',
  'HUNTRESS_PRODUCT_CLASSES',
] as const;

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.BOOTSTRAP_ADMIN_EMAILS = 'admin@example.com';
  process.env.AUTH_DISABLE_BOOTSTRAP_UPSERT = 'true';
  for (const key of envKeys) {
    if (key === 'BOOTSTRAP_ADMIN_EMAILS' || key === 'AUTH_DISABLE_BOOTSTRAP_UPSERT') continue;
    if (key === 'KEY_VAULT_URL') {
      delete process.env.KEY_VAULT_URL;
      continue;
    }
    process.env[key] = '';
  }

  try {
    const unsupportedTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'proofpoint' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );

    assert.equal(unsupportedTestResponse.status, 501);

    const sentinelOneTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'sentinelone' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.notEqual(sentinelOneTestResponse.status, 501);
    assert.match(
      String((sentinelOneTestResponse.jsonBody as { error?: string }).error),
      /SentinelOne settings|SentinelOne test failed|SentinelOne request failed|SentinelOne endpoint is not configured/i,
    );
    assert.doesNotMatch(
      String((sentinelOneTestResponse.jsonBody as { error?: string }).error),
      /not implemented/i,
    );

    process.env.SENTINELONE_ENDPOINT = 'https://usea1.sentinelone.net';
    process.env.SENTINELONE_API_TOKEN = jwtWithPayload({ exp: 1758220801 });
    const expiredSentinelOneTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'sentinelone' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(expiredSentinelOneTestResponse.status, 400);
    assert.match(
      String((expiredSentinelOneTestResponse.jsonBody as { error?: string }).error),
      /SentinelOne API token expired on 2025-09-18T18:40:01.000Z/,
    );
    process.env.SENTINELONE_API_TOKEN = '';

    const huntressTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'huntress' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.notEqual(huntressTestResponse.status, 501);
    assert.match(
      String((huntressTestResponse.jsonBody as { error?: string }).error),
      /Huntress settings|Huntress test failed|Huntress API request failed|Huntress endpoint is not configured/i,
    );
    assert.doesNotMatch(
      String((huntressTestResponse.jsonBody as { error?: string }).error),
      /not implemented/i,
    );

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

    const dattoTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'datto' },
        headers: adminHeaders,
      } as never,
      { log() {} } as never,
    );
    assert.equal(dattoTestResponse.status, 400);
    assert.match(String((dattoTestResponse.jsonBody as { error?: string }).error), /Datto Backup setting/);
    assert.doesNotMatch(
      String((dattoTestResponse.jsonBody as { error?: string }).error),
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

    const queuedDattoSyncResponse = await syncIntegrationHttp(
      {
        params: { integrationId: 'datto' },
        headers: adminHeaders,
        async json() {
          return {};
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
    assert.equal(queuedDattoSyncResponse.status, 202);
    assert.deepEqual(queuedMessages[1], {
      integrationId: 'datto',
      requestedBy: 'admin@example.com',
      requestedAt: (queuedMessages[1] as { requestedAt: string }).requestedAt,
      pageSize: 100,
      maxPages: 100,
      seatPageSize: 500,
      seatMaxPages: 100,
      includeBcdr: true,
    });
    assert.equal((queuedDattoSyncResponse.jsonBody as { includeBcdr?: boolean }).includeBcdr, true);
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

function jwtWithPayload(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
