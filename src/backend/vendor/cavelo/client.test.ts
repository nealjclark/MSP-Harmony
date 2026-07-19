import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import { CaveloClient, caveloCredentialsFromSettings } from './client';

const originalFetch = globalThis.fetch;

async function run() {
  const requests: Array<{ url: string; apiKey: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, apiKey: headers.get('X-API-Key') });

    if (url.endsWith('/organizations')) {
      return new Response(JSON.stringify({ data: [{ organizationUuid: 'org-1', id: 42, name: 'BMB Test' }] }));
    }
    return new Response(JSON.stringify({
      data: [{ id: 'agent-1', hostname: 'PC-1', enabled: true, latestHeartbeatTime: '2026-07-18T12:00:00Z' }],
    }));
  };

  try {
    const client = new CaveloClient({ endpoint: 'https://api.prod.cavelodata.com/v1/', apiKey: 'secret-key' });
    const organizations = await client.listOrganizations();
    const agents = await client.listOrganizationAgents(organizations[0]!.organizationUuid);

    assert.deepEqual(organizations.map(({ organizationUuid, organizationId, name }) => ({ organizationUuid, organizationId, name })), [
      { organizationUuid: 'org-1', organizationId: '42', name: 'BMB Test' },
    ]);
    assert.equal(agents[0]?.agentId, 'agent-1');
    assert.equal(agents[0]?.organizationUuid, 'org-1');
    assert.deepEqual(requests.map((request) => request.url), [
      'https://api.prod.cavelodata.com/v1/organizations',
      'https://api.prod.cavelodata.com/v1/organizations/org-1/agents',
    ]);
    assert.equal(requests.every((request) => request.apiKey === 'secret-key'), true);

    const definition = getIntegrationSettingsDefinition('cavelo');
    assert.ok(definition);
    const credentials = caveloCredentialsFromSettings({
      definition,
      nonSecrets: { endpoint: definition.endpoint },
      secrets: { apiKey: 'configured-key' },
      secretSource: 'environment',
      validation: {
        integrationId: 'cavelo',
        displayName: 'Cavelo',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings);
    assert.equal(credentials.apiKey, 'configured-key');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('cavelo client tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
