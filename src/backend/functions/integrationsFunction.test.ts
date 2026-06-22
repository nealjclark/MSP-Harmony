import assert from 'node:assert/strict';
import { syncIntegrationHttp, testIntegrationHttp } from './integrationsFunction';

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
      } as never,
      { log() {} } as never,
    );

    assert.equal(unsupportedTestResponse.status, 501);

    const coveTestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'cove' },
      } as never,
      { log() {} } as never,
    );
    assert.equal(coveTestResponse.status, 400);
    assert.match(String((coveTestResponse.jsonBody as { error?: string }).error), /Cove settings/);

    const microsoft365TestResponse = await testIntegrationHttp(
      {
        params: { integrationId: 'microsoft-365' },
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
        async json() {
          return {};
        },
      } as never,
      { log() {} } as never,
    );

    assert.equal(coveSyncResponse.status, 400);
    assert.match(String((coveSyncResponse.jsonBody as { error?: string }).error), /Cove sync needs PostgreSQL/);
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
