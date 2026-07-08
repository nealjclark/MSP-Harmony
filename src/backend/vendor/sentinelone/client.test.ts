import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import { SentinelOneClient, machineTypeForAgent, parseAgent, sentinelOneCredentialsFromSettings } from './client';

const sentinelOneDefinition = requireSentinelOneDefinition();

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });

    if (String(url).includes('/accounts')) {
      return jsonResponse({
        data: [{ id: 'acct-1', name: 'Partner Account' }],
        pagination: { nextCursor: null, totalItems: 1 },
      });
    }

    if (String(url).includes('/sites')) {
      return jsonResponse({
        data: [{ id: 'site-1', name: 'Northstar Dental', accountId: 'acct-1' }],
        pagination: { nextCursor: null, totalItems: 1 },
      });
    }

    if (String(url).includes('/agents') && !String(url).includes('cursor=page-2')) {
      return jsonResponse({
        data: [
          {
            id: 'agent-1',
            computerName: 'desktop-01',
            machineType: 'desktop',
            siteId: 'site-1',
            siteName: 'Northstar Dental',
            accountId: 'acct-1',
          },
        ],
        pagination: { nextCursor: 'page-2', totalItems: 2 },
      });
    }

    return jsonResponse({
      data: [
        {
          id: 'agent-2',
          computerName: 'SERVER-03',
          machineType: 'server',
          siteId: 'site-1',
          siteName: 'Northstar Dental',
          accountId: 'acct-1',
        },
      ],
      pagination: { nextCursor: null, totalItems: 2 },
    });
  }) as typeof fetch;

  try {
    const client = new SentinelOneClient({
      endpoint: 'https://usea1.sentinelone.net',
      apiToken: 'token-123',
    });

    const accounts = await client.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.accountId, 'acct-1');

    const sites = await client.listSites();
    assert.equal(sites[0]?.siteId, 'site-1');

    const agents = await client.listAgents({ pageSize: 1, maxPages: 2 });
    assert.equal(agents.length, 2);
    assert.equal(agents[0]?.machineType, 'workstation');
    assert.equal(agents[1]?.machineType, 'server');

    assert.equal(requests[0]?.init?.headers && (requests[0].init.headers as Record<string, string>).Authorization, 'ApiToken token-123');
    assert.match(requests[0]?.url ?? '', /\/web\/api\/v2\.1\/accounts/);

    const parsed = parseAgent({
      id: 'agent-3',
      computerName: 'sql-01',
      osType: 'Windows Server 2022',
    });
    assert.equal(parsed?.machineType, 'server');
    assert.equal(machineTypeForAgent({ machineType: 'laptop' }), 'workstation');

    assert.throws(
      () =>
        sentinelOneCredentialsFromSettings({
          definition: sentinelOneDefinition,
          nonSecrets: {
            endpoint: 'https://usea1.sentinelone.net',
          },
          secrets: {
            apiToken: jwtWithPayload({ exp: 1758220801 }),
          },
          secretSource: 'environment',
          validation: {
            integrationId: 'sentinelone',
            displayName: 'SentinelOne',
            configuredStatus: 'connected',
            missingSecrets: [],
            missingNonSecrets: [],
            lastTestResult: 'untested',
          },
        } satisfies IntegrationRuntimeSettings),
      /SentinelOne API token expired on 2025-09-18T18:40:01.000Z/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('sentinelone client tests passed');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jwtWithPayload(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function requireSentinelOneDefinition() {
  const definition = getIntegrationSettingsDefinition('sentinelone');
  if (!definition) {
    throw new Error('SentinelOne integration definition is not registered.');
  }

  return definition;
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
