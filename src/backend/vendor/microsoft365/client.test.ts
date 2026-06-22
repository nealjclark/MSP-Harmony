import assert from 'node:assert/strict';
import { Microsoft365Client } from './client';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const calls: FetchCall[] = [];
const responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = [
  {
    status: 200,
    body: {
      token_type: 'Bearer',
      access_token: 'partner-graph-token',
      expires_in: 3600,
    },
  },
  {
    status: 200,
    body: {
      value: [
        {
          customerId: 'tenant-1',
          displayName: 'Mapped Client',
          defaultDomainName: 'mapped.example',
          contractType: 'ResellerPartner',
        },
      ],
    },
  },
  {
    status: 200,
    body: {
      token_type: 'Bearer',
      access_token: 'customer-graph-token',
      expires_in: 3600,
    },
  },
  {
    status: 429,
    body: {
      error: { message: 'Too many requests' },
    },
    headers: {
      'retry-after': '0',
    },
  },
  {
    status: 200,
    body: {
      value: [
        {
          id: 'user-1',
          userPrincipalName: 'licensed.user@mapped.example',
          mail: 'licensed.user@mapped.example',
          displayName: 'Licensed User',
          accountEnabled: true,
          assignedLicenses: [
            {
              skuId: 'sku-spb',
              disabledPlans: ['disabled-plan-1'],
            },
          ],
        },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=next',
    },
  },
  {
    status: 200,
    body: {
      value: [
        {
          id: 'user-2',
          userPrincipalName: 'unlicensed.user@mapped.example',
          displayName: 'Unlicensed User',
          accountEnabled: true,
          assignedLicenses: [],
        },
      ],
    },
  },
  {
    status: 200,
    body: {
      value: [
        {
          skuId: 'sku-spb',
          skuPartNumber: 'SPB',
          subscriptionIds: ['subscription-id-1'],
          consumedUnits: 1,
          capabilityStatus: 'Enabled',
          prepaidUnits: {
            enabled: 3,
            suspended: 0,
            warning: 0,
            lockedOut: 0,
          },
          servicePlans: [
            {
              servicePlanId: 'plan-exchange',
              servicePlanName: 'EXCHANGE_S_STANDARD',
              provisioningStatus: 'Success',
              appliesTo: 'User',
            },
          ],
        },
      ],
    },
  },
  {
    status: 200,
    body: {
      value: [
        {
          id: 'directory-subscription-1',
          commerceSubscriptionId: 'commerce-subscription-1',
          skuId: 'sku-spb',
          skuPartNumber: 'SPB',
          status: 'Enabled',
          totalLicenses: 3,
          isTrial: false,
          createdDateTime: '2026-01-01T00:00:00Z',
          nextLifecycleDateTime: '2027-01-01T00:00:00Z',
          ownerTenantId: 'tenant-1',
          ownerType: 'Company',
          serviceStatus: [
            {
              servicePlanId: 'plan-exchange',
              servicePlanName: 'EXCHANGE_S_STANDARD',
              provisioningStatus: 'Success',
              appliesTo: 'User',
            },
          ],
        },
      ],
    },
  },
];

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  calls.push({ url: String(url), init });
  const next = responses.shift();
  assert.ok(next, `Unexpected fetch call to ${String(url)}`);

  return new Response(JSON.stringify(next.body), {
    status: next.status,
    headers: next.headers,
  });
}) as typeof fetch;

async function run() {
  const client = new Microsoft365Client({
    endpoint: 'https://graph.microsoft.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tenantId: 'partner-tenant',
  });

  const tenants = await client.listPartnerCustomerContracts({ pageSize: 20, maxPages: 1 });
  assert.equal(tenants[0]?.tenantId, 'tenant-1');
  assert.equal(tenants[0]?.defaultDomainName, 'mapped.example');
  assert.equal(tenants[0]?.contractType, 'ResellerPartner');
  assert.equal(calls[0]?.url, 'https://login.microsoftonline.com/partner-tenant/oauth2/v2.0/token');
  assert.equal(
    calls[1]?.url,
    'https://graph.microsoft.com/v1.0/contracts?$select=id,customerId,displayName,defaultDomainName,contractType&$top=20',
  );

  const users = await client.listTenantUsers('tenant-1', { pageSize: 1, maxPages: 2 });
  assert.equal(users.length, 2);
  assert.equal(users[0]?.userPrincipalName, 'licensed.user@mapped.example');
  assert.equal(users[0]?.assignedLicenses[0]?.skuId, 'sku-spb');
  assert.deepEqual(users[0]?.assignedLicenses[0]?.disabledPlans, ['disabled-plan-1']);
  assert.equal(calls[2]?.url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
  assert.equal(String(calls[2]?.init?.body).includes('grant_type=client_credentials'), true);
  assert.equal(String(calls[2]?.init?.body).includes('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default'), true);
  assert.equal(
    calls[4]?.url,
    'https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,assignedLicenses&$top=1',
  );
  assert.equal(calls[5]?.url, 'https://graph.microsoft.com/v1.0/users?$skiptoken=next');
  assert.equal(
    calls[4]?.init?.headers && (calls[4].init.headers as Record<string, string>).Authorization,
    'Bearer customer-graph-token',
  );

  const subscribedSkus = await client.listTenantSubscribedSkus('tenant-1');
  assert.equal(subscribedSkus[0]?.skuPartNumber, 'SPB');
  assert.deepEqual(subscribedSkus[0]?.subscriptionIds, ['subscription-id-1']);
  assert.equal(subscribedSkus[0]?.consumedUnits, 1);
  assert.equal(subscribedSkus[0]?.enabledUnits, 3);
  assert.equal(subscribedSkus[0]?.lockedOutUnits, 0);
  assert.equal(subscribedSkus[0]?.servicePlans[0]?.serviceName, 'EXCHANGE_S_STANDARD');

  const directorySubscriptions = await client.listTenantDirectorySubscriptions('tenant-1');
  assert.equal(directorySubscriptions[0]?.commerceSubscriptionId, 'commerce-subscription-1');
  assert.equal(directorySubscriptions[0]?.totalLicenses, 3);
  assert.equal(directorySubscriptions[0]?.nextLifecycleDateTime, '2027-01-01T00:00:00Z');
  assert.equal(directorySubscriptions[0]?.serviceStatus[0]?.serviceName, 'EXCHANGE_S_STANDARD');

  globalThis.fetch = originalFetch;
  console.log('microsoft365 client tests passed');
}

run().catch((error: unknown) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
