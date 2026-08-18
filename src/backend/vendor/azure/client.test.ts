import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  AzureCostManagementClient,
  azureCredentialsFromSettings,
  azureSubscriptionAllowlist,
  discoverDelegatedAzureTenants,
  enrichSubscriptionsWithTenants,
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
    if (String(url).includes('generateCostDetailsReport')) {
      const subscriptionId = String(url).match(/\/subscriptions\/([^/]+)/i)?.[1] ?? 'unknown';
      return new Response(undefined, {
        status: 202,
        headers: {
          Location:
            `https://management.azure.com/subscriptions/${subscriptionId}` +
            `/providers/Microsoft.CostManagement/costDetailsOperationResults/${subscriptionId}?api-version=2025-03-01`,
          'Retry-After': '0',
        },
      });
    }
    if (String(url).includes('costDetailsOperationResults')) {
      const subscriptionId = String(url).match(/costDetailsOperationResults\/([^?]+)/i)?.[1] ?? 'unknown';
      return jsonResponse({
        name: `operation-${subscriptionId}`,
        status: 'Completed',
        manifest: {
          blobCount: 1,
          compressData: false,
          dataFormat: 'Csv',
          manifestVersion: '2022-05-01',
          blobs: [{ blobLink: `https://reports.test/${subscriptionId}.csv` }],
        },
      });
    }
    if (String(url) === 'https://reports.test/sub-legacy.csv') {
      return textResponse([
        'UsageDateTime,ServiceName,ResourceId,ResourceType,MeterCategory,ChargeType,Currency,UsageQuantity,PreTaxCost',
        '2026-07-24,Virtual Machines,/subscriptions/sub-legacy/resourceGroups/rg-legacy/providers/Microsoft.Compute/virtualMachines/vm-legacy,microsoft.compute/virtualmachines,Virtual Machines,Usage,USD,10,4.56',
      ].join('\r\n'));
    }
    if (String(url).startsWith('https://reports.test/')) {
      return textResponse([
        'date,serviceFamily,ProductName,consumedService,meterCategory,chargeType,billingCurrency,resourceGroupName,ResourceId,quantity,costInBillingCurrency',
        '07/24/2026,Compute,"Virtual Machines, D2s",Microsoft.Compute,Virtual Machines,Usage,USD,rg-app,/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-1,72,12.34',
      ].join('\r\n'));
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
    if (String(url).includes('Microsoft.ManagedServices/registrationAssignments')) {
      return jsonResponse({
        value: [{
          id: '/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationAssignments/offer-1',
          properties: {
            registrationDefinition: {
              properties: {
                registrationDefinitionName: 'BMB Azure Management',
                manageeTenantId: 'customer-tenant',
                manageeTenantName: 'Callaghan CPA LLP',
                managedByTenantId: 'msp-tenant',
                managedByTenantName: 'BMB Solutions',
              },
            },
          },
        }],
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
    const delegations = await client.listLighthouseDelegations();
    assert.equal(delegations[0]?.manageeTenantName, 'Callaghan CPA LLP');
    assert.equal(delegations[0]?.subscriptionId, 'sub-1');
    const lighthouseRequest = requests.find((request) => request.url.includes('Microsoft.ManagedServices/registrationAssignments'));
    assert.equal(lighthouseRequest?.url.includes('$expandRegistrationDefinition=true'), true);
    assert.equal(lighthouseRequest?.url.includes('$expand=registrationDefinition'), false);
    const discovered = await discoverDelegatedAzureTenants(client, subscriptions);
    const named = enrichSubscriptionsWithTenants(subscriptions, discovered.tenantsById);
    assert.equal(named[0]?.tenantName, 'Northstar Legal');
    const lighthouseOnly = await discoverDelegatedAzureTenants({
      async listTenants() {
        return [{ tenantId: 'msp-tenant', displayName: 'BMB Solutions', domains: [], raw: {} }];
      },
      async listLighthouseDelegations() {
        return [{ manageeTenantId: 'customer-tenant', manageeTenantName: 'Callaghan CPA LLP' }];
      },
    }, [{ subscriptionId: 'sub-1', tenantId: 'customer-tenant', raw: {} }]);
    assert.equal(lighthouseOnly.tenantsById.get('customer-tenant')?.displayName, 'Callaghan CPA LLP');
    const fromSubscription = await discoverDelegatedAzureTenants({
      async listTenants() {
        return [{ tenantId: 'msp-tenant', displayName: 'BMB Solutions', domains: [], raw: {} }];
      },
      async listLighthouseDelegations() {
        throw new Error('Tenant-scope Lighthouse listing is forbidden');
      },
      async listLighthouseDelegationsForSubscription(subscriptionId) {
        assert.equal(subscriptionId, 'sub-1');
        return [{ subscriptionId, manageeTenantId: 'customer-tenant', manageeTenantName: 'Callaghan CPA LLP' }];
      },
    }, [{ subscriptionId: 'sub-1', tenantId: 'customer-tenant', raw: {} }]);
    assert.equal(fromSubscription.tenantsById.get('customer-tenant')?.displayName, 'Callaghan CPA LLP');
    const reportProgress: string[] = [];
    const rows = await client.queryCostUsage({
      subscriptionId: 'sub-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
      onProgress: async (progress) => {
        reportProgress.push(`${progress.phase}:${progress.message}`);
      },
    });
    assert.equal(rows[0]?.cost, 12.34);
    assert.equal(rows[0]?.usageQuantity, 72);
    assert.equal(rows[0]?.usageDate, '2026-07-24');
    assert.equal(rows[0]?.resourceGroup, 'rg-app');
    assert.equal(rows[0]?.resourceType, 'Microsoft.Compute');
    assert.equal(rows[0]?.meterCategory, 'Virtual Machines');
    assert.equal(rows[0]?.chargeType, 'Usage');
    assert.equal(rows[0]?.serviceName, 'Virtual Machines, D2s');
    assert.equal(rows[0]?.currency, 'USD');
    assert.equal(requests.filter((request) => request.url.includes('/oauth2/v2.0/token')).length, 1);
    const reportRequest = requests.find((request) => request.url.includes('generateCostDetailsReport'));
    assert.equal(reportRequest?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(reportRequest?.init?.body)), {
      metric: 'ActualCost',
      timePeriod: {
        start: '2026-07-01',
        end: '2026-07-24',
      },
    });
    assert.equal(new Headers(reportRequest?.init?.headers).get('ClientType'), 'MSPHarmonyAzureCostSync');
    const pollRequest = requests.find((request) => request.url.includes('costDetailsOperationResults'));
    assert.equal(new Headers(pollRequest?.init?.headers).get('ClientType'), 'MSPHarmonyAzureCostSync');
    assert.equal(requests.some((request) => request.url.includes('Microsoft.CostManagement/query')), false);
    assert.ok(reportProgress.some((status) => status.startsWith('requesting:')));
    assert.ok(reportProgress.some((status) => status.startsWith('waiting:')));
    assert.ok(reportProgress.some((status) => status.startsWith('polling:')));
    assert.ok(reportProgress.some((status) => status.startsWith('ready:')));
    assert.ok(reportProgress.some((status) => status.startsWith('downloading:')));
    assert.ok(reportProgress.some((status) => status.startsWith('parsing:')));
    assert.ok(reportProgress.some((status) => status.includes('complete:Cost report loaded · 1 rows')));

    const legacyRows = await client.queryCostUsage({
      subscriptionId: 'sub-legacy',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
    });
    assert.equal(legacyRows[0]?.cost, 4.56);
    assert.equal(legacyRows[0]?.usageQuantity, 10);
    assert.equal(legacyRows[0]?.usageDate, '2026-07-24');
    assert.equal(legacyRows[0]?.resourceGroup, 'rg-legacy');
    assert.equal(legacyRows[0]?.resourceType, 'microsoft.compute/virtualmachines');
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
      if (String(url).includes('generateCostDetailsReport')) {
        throttledCostAttempts += 1;
        if (throttledCostAttempts === 1) {
          return jsonResponse(
            { error: { code: 'TooManyRequests', message: 'Too many requests. Please retry.' } },
            429,
            { 'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '0' },
          );
        }
        return jsonResponse({ status: 'NoDataFound' });
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

function textResponse(body: string, status = 200, headers?: Record<string, string>) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/csv', ...headers },
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
