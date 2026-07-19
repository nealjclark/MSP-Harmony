import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  ProofpointClient,
  parseDomain,
  parseOrganization,
  parseUser,
  proofpointCredentialsFromSettings,
  proofpointCredentialSetsFromSettings,
} from './client';

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/orgs/partner.example/orgs')) {
      return jsonResponse({ orgs: [{
        name: 'Northstar Dental', primary_domain: 'northstar.example', eid: 101,
        active_users: 5, user_licenses: '50', licensing_package: 'business_plus', when_renewal: '2026/09/17',
      }] });
    }
    if (String(url).endsWith('/domains')) {
      return jsonResponse({ domains: [{ name: 'northstar.example', is_active: true }] });
    }
    return jsonResponse({ users: [
      { primary_email: 'alice@northstar.example', is_active: true, is_billable: true },
      { primary_email: 'service@northstar.example', is_active: true, is_billable: false },
    ] });
  }) as typeof fetch;

  try {
    const client = new ProofpointClient({
      endpoint: 'https://us2.proofpointessentials.com/api/v1/',
      organizationDomain: 'partner.example',
      username: 'api-admin@partner.example',
      password: 'secret',
    });
    const organization = (await client.listOrganizations())[0];
    assert.equal(organization?.primaryDomain, 'northstar.example');
    assert.equal(organization?.activeUsers, 5);
    assert.equal(organization?.userLicenses, 50);
    assert.equal(organization?.licensingPackage, 'business_plus');
    assert.equal(organization?.renewalDate, '2026/09/17');
    assert.equal((await client.listDomains('northstar.example'))[0]?.name, 'northstar.example');
    assert.equal((await client.listUsers('northstar.example')).length, 2);
    assert.match(requests[0]?.url ?? '', /\/api\/v1\/orgs\/partner\.example\/orgs$/);
    const headers = requests[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-User'], 'api-admin@partner.example');
    assert.equal(headers['X-Password'], 'secret');
    assert.equal(headers['X-Terms-Update'], 'true');
    assert.equal(parseOrganization({ primaryDomain: 'Example.COM' })?.primaryDomain, 'example.com');
    assert.equal(parseOrganization({ primaryDomain: 'example.com', active_users: '7' })?.activeUsers, 7);
    assert.equal(parseDomain({ domain_name: 'Alias.Example', active: 1 })?.isActive, true);
    assert.equal(parseUser({ email: 'User@Example.com', is_active: 'false' })?.isActive, false);

    const definition = getIntegrationSettingsDefinition('proofpoint');
    assert.ok(definition);
    assert.deepEqual(proofpointCredentialsFromSettings({
      definition,
      nonSecrets: { endpoint: 'us2.proofpointessentials.com', organizationDomain: 'PARTNER.EXAMPLE' },
      secrets: { username: 'admin', password: 'password' },
      secretSource: 'environment',
      validation: {
        integrationId: 'proofpoint', displayName: 'Proofpoint Essentials', configuredStatus: 'connected',
        missingSecrets: [], missingNonSecrets: [], lastTestResult: 'untested',
      },
    } satisfies IntegrationRuntimeSettings), {
      endpoint: 'us2.proofpointessentials.com', organizationDomain: 'partner.example',
      username: 'admin', password: 'password',
    });
    const settingsWithMultipleStacks = {
      definition,
      nonSecrets: {
        endpoint: 'us5.proofpointessentials.com', organizationDomain: 'US-PARTNER.EXAMPLE',
        additionalEndpoints: [
          'https://us1.proofpointessentials.com | US1-PARTNER-UUID',
          'https://us2.proofpointessentials.com | US2-PARTNER-UUID',
          'https://eu1.proofpointessentials.com | EU1-PARTNER-UUID',
        ].join('\n'),
      },
      secrets: { username: 'partner-admin', password: 'partner-password' },
      secretSource: 'environment',
      validation: {
        integrationId: 'proofpoint', displayName: 'Proofpoint Essentials', configuredStatus: 'connected',
        missingSecrets: [], missingNonSecrets: [], lastTestResult: 'untested',
      },
    } satisfies IntegrationRuntimeSettings;
    assert.deepEqual(proofpointCredentialSetsFromSettings(settingsWithMultipleStacks), [
      {
        endpoint: 'https://us5.proofpointessentials.com', organizationDomain: 'us-partner.example',
        username: 'partner-admin', password: 'partner-password',
      },
      {
        endpoint: 'https://us1.proofpointessentials.com', organizationDomain: 'us1-partner-uuid',
        username: 'partner-admin', password: 'partner-password',
      },
      {
        endpoint: 'https://us2.proofpointessentials.com', organizationDomain: 'us2-partner-uuid',
        username: 'partner-admin', password: 'partner-password',
      },
      {
        endpoint: 'https://eu1.proofpointessentials.com', organizationDomain: 'eu1-partner-uuid',
        username: 'partner-admin', password: 'partner-password',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('proofpoint client tests passed');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
