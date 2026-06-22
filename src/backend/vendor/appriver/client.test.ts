import assert from 'node:assert/strict';
import {
  AppRiverClient,
  appRiverLicenseQuantity,
  appRiverProductKeyForSubscription,
} from './client';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const calls: FetchCall[] = [];
const rotatedRefreshTokens: string[] = [];
const responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = [
  {
    status: 200,
    body: {
      token_type: 'Bearer',
      access_token: 'access-token-1',
      refresh_token: 'rotated-refresh-1',
      expires_in: 3600,
      scope: '*',
    },
  },
  {
    status: 200,
    body: {
      Customers: [
        {
          CustomerID: 'customer-1',
          Name: 'Mapped Client',
          CustomerType: 'Customer',
          ExternalCustomerAccountNumber: 'cw-123',
        },
      ],
    },
  },
  {
    status: 200,
    body: {
      Subscriptions: [
        {
          SubscriptionKey: 'subscription/key 1',
          ProductName: 'Microsoft 365 Business Premium',
        },
      ],
    },
  },
  {
    status: 401,
    body: {
      error: 'invalid_token',
      message: 'Access was denied due to expired token',
    },
  },
  {
    status: 200,
    body: {
      token_type: 'Bearer',
      access_token: 'access-token-2',
      refresh_token: 'rotated-refresh-2',
      expires_in: 3600,
      scope: '*',
    },
  },
  {
    status: 200,
    body: {
      ProductName: 'Microsoft 365 Business Premium',
      SubscriptionKey: 'subscription/key 1',
      SubscriptionTerm: 'Annual',
      BillingFrequency: 'Monthly',
      Domain: 'mapped.example',
      IsTrial: false,
      ExpirationBehavior: 'AutoRenew',
      ReadonlySubscriptionDetails: [
        { Name: 'TotalLicenses', Value: '3' },
        { Name: 'AssignedLicenses', Value: '1' },
        { Name: 'UnassignedLicenses', Value: '2' },
        { Name: 'CommitmentEndDate', Value: '2027-01-01T00:00:00Z' },
      ],
      ConfigurableSubscriptionDetails: [
        { Name: 'SubscriptionQuantity', Value: '3' },
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
  try {
    const client = new AppRiverClient(
      {
        endpoint: 'https://unityapi.webrootcloudav.com/',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'initial-refresh',
      },
      {
        onRefreshTokenRotated(refreshToken) {
          rotatedRefreshTokens.push(refreshToken);
        },
      },
    );

    const customers = await client.listCustomers({ pageSize: 1000, maxPages: 1 });
    assert.equal(customers[0]?.customerId, 'customer-1');
    assert.equal(customers[0]?.externalCustomerAccountNumber, 'cw-123');
    assert.equal(calls[0]?.url, 'https://unityapi.webrootcloudav.com/auth/token');
    assert.equal(String(calls[0]?.init?.body).includes('grant_type=refresh_token'), true);
    assert.equal(String(calls[0]?.init?.body).includes('refresh_token=initial-refresh'), true);
    assert.equal(
      calls[0]?.init?.headers && (calls[0].init.headers as Record<string, string>).Authorization,
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    assert.equal(
      calls[1]?.url,
      'https://unityapi.webrootcloudav.com/service/api/securecloud/customers?limit=1000&offset=0',
    );

    const subscriptions = await client.listCustomerSubscriptions('customer-1', { pageSize: 100, maxPages: 1 });
    assert.equal(subscriptions[0]?.subscriptionKey, 'subscription/key 1');
    assert.equal(
      calls[2]?.url,
      'https://unityapi.webrootcloudav.com/service/api/securecloud/customers/customer-1/subscriptions?limit=100&offset=0',
    );

    const detail = await client.getCustomerSubscriptionDetails('customer-1', 'subscription/key 1');
    assert.equal(detail.productName, 'Microsoft 365 Business Premium');
    assert.equal(detail.totalLicenses, 3);
    assert.equal(detail.assignedLicenses, 1);
    assert.equal(detail.unassignedLicenses, 2);
    assert.equal(detail.subscriptionQuantity, 3);
    assert.equal(detail.commitmentEndDate, '2027-01-01T00:00:00Z');
    assert.equal(appRiverLicenseQuantity(detail), 3);
    assert.equal(appRiverProductKeyForSubscription(detail), 'Microsoft 365 Business Premium|Annual|Monthly');
    assert.deepEqual(rotatedRefreshTokens, ['rotated-refresh-1', 'rotated-refresh-2']);
    assert.equal(
      calls[3]?.init?.headers && (calls[3].init.headers as Record<string, string>).Authorization,
      'Bearer access-token-1',
    );
    assert.equal(
      calls[5]?.init?.headers && (calls[5].init.headers as Record<string, string>).Authorization,
      'Bearer access-token-2',
    );

    responses.push({
      status: 200,
      body: {
        token_type: 'Bearer',
        access_token: 'access-token-3',
        refresh_token: 'rotated-refresh-3',
        expires_in: 3600,
        scope: '*',
      },
    });
    let persistAttempts = 0;
    const retryingClient = new AppRiverClient(
      {
        endpoint: 'https://unityapi.webrootcloudav.com/',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'initial-refresh-2',
      },
      {
        onRefreshTokenRotated(refreshToken) {
          persistAttempts += 1;
          if (persistAttempts === 1) {
            throw new Error('Key Vault write failed');
          }
          rotatedRefreshTokens.push(refreshToken);
        },
      },
    );

    await retryingClient.authenticate();
    assert.equal(persistAttempts, 2);
    assert.deepEqual(rotatedRefreshTokens, ['rotated-refresh-1', 'rotated-refresh-2', 'rotated-refresh-3']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('appriver client tests passed');
}

run().catch((error: unknown) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
