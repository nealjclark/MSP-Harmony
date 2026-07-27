import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  AzureCostManagementClient,
  azureCredentialsFromSettings,
  azureSubscriptionAllowlist,
} from './client';

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (String(url).includes('/subscriptions?')) {
      return jsonResponse({
        value: [
          {
            subscriptionId: 'sub-1',
            displayName: 'Northstar Azure',
            tenantId: 'customer-tenant',
            state: 'Enabled',
          },
        ],
      });
    }
    if (String(url).includes('Microsoft.CostManagement/query')) {
      return jsonResponse({
        properties: {
          columns: [
            { name: 'PreTaxCost', type: 'Number' },
            { name: 'UsageQuantity', type: 'Number' },
            { name: 'ServiceName', type: 'String' },
            { name: 'ResourceId', type: 'String' },
            { name: 'UsageDate', type: 'Number' },
            { name: 'Currency', type: 'String' },
          ],
          rows: [
            [
              12.34,
              72,
              'Virtual Machines',
              '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1',
              20260724,
              'USD',
            ],
          ],
        },
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const client = new AzureCostManagementClient({
      endpoint: 'https://management.azure.com',
      tenantId: 'msp-tenant',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const subscriptions = await client.listSubscriptions();
    assert.equal(subscriptions[0]?.subscriptionId, 'sub-1');
    const rows = await client.queryCostUsage({
      subscriptionId: 'sub-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
    });
    assert.equal(rows[0]?.cost, 12.34);
    assert.equal(rows[0]?.usageQuantity, 72);
    assert.equal(rows[0]?.usageDate, '2026-07-24');
    assert.equal(rows[0]?.resourceGroup, 'rg-app');
    assert.equal(requests.filter((request) => request.url.includes('/oauth2/v2.0/token')).length, 1);
    const queryRequest = requests.find((request) => request.url.includes('Microsoft.CostManagement/query'));
    assert.equal(queryRequest?.init?.method, 'POST');
    assert.match(String(queryRequest?.init?.body), /UsageQuantity/);

    const definition = getIntegrationSettingsDefinition('microsoft-azure');
    assert.ok(definition);
    const settings = {
      definition,
      nonSecrets: {
        endpoint: 'https://management.azure.com',
        tenantId: 'msp-tenant',
        clientId: 'client-id',
        subscriptionIds: 'SUB-1,\nsub-2',
      },
      secrets: { clientSecret: 'client-secret' },
      secretSource: 'environment',
      validation: {
        integrationId: 'microsoft-azure',
        displayName: 'Microsoft Azure',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      },
    } satisfies IntegrationRuntimeSettings;
    assert.equal(azureCredentialsFromSettings(settings).tenantId, 'msp-tenant');
    assert.deepEqual(azureSubscriptionAllowlist(settings), ['sub-1', 'sub-2']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('azure client tests passed');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
