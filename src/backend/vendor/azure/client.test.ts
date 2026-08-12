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
  let rejectModernCostColumns = false;

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
      const body = String(init?.body ?? '');
      if (rejectModernCostColumns && body.includes('CostInBillingCurrency')) {
        return jsonResponse({
          error: { message: "Invalid dataset configuration columns: 'CostInBillingCurrency'." },
        }, 400);
      }
      if (body.includes('PreTaxCost')) {
        return jsonResponse({
          properties: {
            columns: [
              { name: 'PreTaxCost', type: 'Number' },
              { name: 'UsageQuantity', type: 'Number' },
              { name: 'ServiceName', type: 'String' },
              { name: 'ResourceId', type: 'String' },
              { name: 'ResourceType', type: 'String' },
              { name: 'MeterCategory', type: 'String' },
              { name: 'ChargeType', type: 'String' },
              { name: 'UsageDate', type: 'Number' },
              { name: 'Currency', type: 'String' },
            ],
            rows: [[
              12.34,
              72,
              'Virtual Machines',
              '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1',
              'microsoft.compute/virtualmachines',
              'Virtual Machines',
              'Usage',
              20260724,
              'USD',
            ]],
          },
        });
      }
      return jsonResponse({
        properties: {
          columns: [
            { name: 'CostInBillingCurrency', type: 'Number' },
            { name: 'Quantity', type: 'Number' },
            { name: 'Product', type: 'String' },
            { name: 'InstanceName', type: 'String' },
            { name: 'ConsumedService', type: 'String' },
            { name: 'ResourceGroup', type: 'String' },
            { name: 'MeterCategory', type: 'String' },
            { name: 'ChargeType', type: 'String' },
            { name: 'Date', type: 'Number' },
            { name: 'BillingCurrencyCode', type: 'String' },
          ],
          rows: [
            [
              12.34,
              72,
              'Virtual Machines',
              '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1',
              'microsoft.compute/virtualmachines',
              'rg-app',
              'Virtual Machines',
              'Usage',
              20260724,
              'USD',
            ],
          ],
        },
      });
    }
    if (String(url).includes('/tenants?page=2')) {
      return jsonResponse({
        value: [{
          id: '/tenants/customer-tenant',
          displayName: 'Northstar Legal',
          defaultDomain: 'northstar.example',
          domains: ['northstar.example'],
          tenantCategory: 'ProjectedBy',
        }],
      });
    }
    if (String(url).includes('/tenants?')) {
      return jsonResponse({
        value: [{ tenantId: 'msp-tenant', displayName: 'BMB Solutions', defaultDomain: 'bmb.example' }],
        nextLink: 'https://management.azure.com/tenants?page=2',
      });
    }
    if (String(url).includes('Microsoft.Advisor/recommendations') || String(url).includes('/advisor?page=')) {
      if (String(url).includes('page=2')) {
        return jsonResponse({ value: [{ id: '/recommendations/advisor-2', properties: { category: 'Reliability', impact: 'Medium', shortDescription: { problem: 'Increase redundancy', solution: 'Use zones' } } }] });
      }
      return jsonResponse({
        value: [{
          id: '/recommendations/advisor-1',
          properties: {
            category: 'Cost',
            impact: 'High',
            impactedValue: 'vm-1',
            shortDescription: { problem: 'Underutilized VM', solution: 'Resize or shut down' },
            extendedProperties: { annualSavingsAmount: '410.25', savingsCurrency: 'USD' },
          },
        }],
        nextLink: 'https://management.azure.com/advisor?page=2',
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
    const tenants = await client.listTenants();
    assert.equal(tenants.length, 2);
    assert.equal(tenants[1]?.tenantId, 'customer-tenant');
    assert.equal(tenants[1]?.displayName, 'Northstar Legal');
    assert.equal(tenants[1]?.defaultDomain, 'northstar.example');
    const rows = await client.queryCostUsage({
      subscriptionId: 'sub-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
    });
    assert.equal(rows[0]?.cost, 12.34);
    assert.equal(rows[0]?.usageQuantity, 72);
    assert.equal(rows[0]?.usageDate, '2026-07-24');
    assert.equal(rows[0]?.resourceGroup, 'rg-app');
    assert.equal(rows[0]?.resourceType, 'microsoft.compute/virtualmachines');
    assert.equal(rows[0]?.meterCategory, 'Virtual Machines');
    assert.equal(rows[0]?.chargeType, 'Usage');
    assert.equal(requests.filter((request) => request.url.includes('/oauth2/v2.0/token')).length, 1);
    const queryRequest = requests.find((request) => request.url.includes('Microsoft.CostManagement/query'));
    assert.equal(queryRequest?.init?.method, 'POST');
    assert.match(String(queryRequest?.init?.body), /CostInBillingCurrency/);
    assert.match(String(queryRequest?.init?.body), /"type":"ActualCost"/);
    assert.match(String(queryRequest?.init?.body), /ChargeType/);
    assert.doesNotMatch(String(queryRequest?.init?.body), /"grouping"/);
    rejectModernCostColumns = true;
    const legacyRows = await client.queryCostUsage({
      subscriptionId: 'sub-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
    });
    assert.equal(legacyRows[0]?.cost, 12.34);
    assert.equal(legacyRows[0]?.resourceGroup, 'rg-app');
    assert.match(String(requests[requests.length - 1]?.init?.body), /PreTaxCost/);
    const advisor = await client.listAdvisorRecommendations('sub-1');
    assert.equal(advisor.length, 2);
    assert.equal(advisor[0]?.category, 'Cost');
    assert.equal(advisor[0]?.annualSavings, 410.25);
    assert.equal(advisor[1]?.impact, 'Medium');

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
        displayName: 'Azure - Lighthouse',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      },
    } satisfies IntegrationRuntimeSettings;
    assert.equal(azureCredentialsFromSettings(settings).tenantId, 'msp-tenant');
    assert.deepEqual(azureSubscriptionAllowlist(settings), ['sub-1', 'sub-2']);

    let throttledCostAttempts = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes('/oauth2/v2.0/token')) {
        return jsonResponse({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (String(url).includes('Microsoft.CostManagement/query')) {
        throttledCostAttempts += 1;
        if (throttledCostAttempts === 1) {
          return jsonResponse(
            { error: { code: 'TooManyRequests', message: 'Too many requests. Please retry.' } },
            429,
            { 'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '0' },
          );
        }
        return jsonResponse({ properties: { columns: [], rows: [] } });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;
    const throttledClient = new AzureCostManagementClient({
      endpoint: 'https://management.azure.com',
      tenantId: 'msp-tenant',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    await throttledClient.queryCostUsage({
      subscriptionId: 'sub-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
    });
    assert.equal(throttledCostAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('azure client tests passed');
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
