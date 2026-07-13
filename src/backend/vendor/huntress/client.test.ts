import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  HuntressClient,
  huntressCredentialsFromSettings,
  huntressProductClassesFromSettings,
  parseOrganizationUsageLineItem,
} from './client';

const huntressDefinition = requireHuntressDefinition();

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });

    if (String(url).includes('/v1/actor')) {
      return jsonResponse({
        reseller: { id: 7, name: 'BMB Consulting' },
        user: { id: 42, email: 'admin@example.com' },
      });
    }

    if (String(url).includes('/v1/organizations') && !String(url).includes('page_token=page-2')) {
      return jsonResponse({
        organizations: [
          { id: 101, name: 'Northstar Dental', billable_identity_count: 12 },
        ],
        pagination: { next_page_token: 'page-2' },
      });
    }

    if (String(url).includes('/v1/organizations')) {
      return jsonResponse({
        organizations: [
          { id: 102, name: 'Summit Legal', billable_identity_count: 4 },
        ],
        pagination: {},
      });
    }

    if (String(url).includes('/v1/agents')) {
      return jsonResponse({
        agents: [
          { id: 201, organization_id: 101, hostname: 'laptop-01', platform: 'windows' },
        ],
        pagination: {},
      });
    }

    if (String(url).includes('/v1/reseller/invoices/9001/organization_usage_line_items')) {
      return jsonResponse({
        organization_usage_line_items: [
          {
            id: 3001,
            organization: { id: 101, name: 'Northstar Dental' },
            account: { id: 7, name: 'BMB Consulting' },
            actual_usage: { itdr: 12, edr: 8 },
          },
        ],
        pagination: {},
      });
    }

    if (String(url).includes('/v1/reseller/invoices')) {
      return jsonResponse({
        invoices: [
          { id: 9001, status: 'paid', has_usage: true, created_at: '2026-07-01T00:00:00Z' },
        ],
        pagination: {},
      });
    }

    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const client = new HuntressClient({
      endpoint: 'https://api.huntress.io/v1',
      apiKey: 'hk_public',
      apiSecret: 'hs_private',
    });

    const actor = await client.getActor();
    assert.equal(actor.reseller?.name, 'BMB Consulting');

    const organizations = await client.listOrganizations({ pageSize: 1, maxPages: 2 });
    assert.equal(organizations.length, 2);
    assert.equal(organizations[0]?.organizationId, '101');
    assert.equal(organizations[0]?.billableIdentityCount, 12);

    const agents = await client.listAgents();
    assert.equal(agents[0]?.hostname, 'laptop-01');

    const invoices = await client.listResellerInvoices();
    assert.equal(invoices[0]?.invoiceId, '9001');

    const lineItems = await client.listResellerOrganizationUsageLineItems('9001');
    assert.equal(lineItems[0]?.actualUsage.itdr, 12);

    const authorization = requests[0]?.init?.headers && (requests[0].init.headers as Record<string, string>).Authorization;
    assert.equal(authorization, `Basic ${Buffer.from('hk_public:hs_private').toString('base64')}`);
    assert.match(requests[0]?.url ?? '', /https:\/\/api\.huntress\.io\/v1\/actor/);
    assert.match(requests[1]?.url ?? '', /limit=1/);

    const parsed = parseOrganizationUsageLineItem({
      id: 1,
      organization: { id: 55, name: 'ExampleCo' },
      actual_usage: { itdr: '9', siem_extended_retention: 2 },
    });
    assert.equal(parsed?.actualUsage.itdr, 9);
    assert.equal(parsed?.actualUsage.siem_extended_retention, 2);

    const settings = {
      definition: huntressDefinition,
      nonSecrets: {
        endpoint: 'api.huntress.io',
        productClasses: 'itdr, sat',
      },
      secrets: {
        apiKey: 'hk_public',
        apiSecret: 'hs_private',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'huntress',
        displayName: 'Huntress',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'untested',
      },
    } satisfies IntegrationRuntimeSettings;

    assert.deepEqual(huntressProductClassesFromSettings(settings), ['itdr', 'sat']);
    assert.equal(huntressCredentialsFromSettings(settings).endpoint, 'api.huntress.io');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('huntress client tests passed');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requireHuntressDefinition() {
  const definition = getIntegrationSettingsDefinition('huntress');
  if (!definition) {
    throw new Error('Huntress integration definition is not registered.');
  }

  return definition;
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
