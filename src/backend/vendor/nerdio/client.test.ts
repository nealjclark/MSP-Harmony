import assert from 'node:assert/strict';
import { NerdioClient, NerdioApiError } from './client';

async function run() {
  const originalFetch = globalThis.fetch;
  let accountResponse = jsonResponse([{ id: 'account-1', name: 'Example Client' }]);
  let usageResponse = jsonResponse({
    usageItems: [{ collectDateTimeUtc: '2026-07-26T00:00:00Z', desktopUsersCount: 12 }],
  });
  let invoiceRequestUrl: string | undefined;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/oauth2/v2.0/token')) {
      return jsonResponse({ access_token: 'token', expires_in: 3600 });
    }
    if (url.endsWith('/api/v1/test')) {
      return new Response('Connection successful.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    if (url.endsWith('/rest-api/v1/accounts')) return accountResponse;
    if (url.endsWith('/rest-api/v1/accounts/account-1/usages')) return usageResponse;
    if (url.includes('/rest-api/v1/invoices?')) {
      invoiceRequestUrl = url;
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const client = new NerdioClient({
      endpoint: 'https://nerdio.example.com',
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      apiScope: 'api://nerdio/.default',
    });
    const test = await client.test();
    assert.equal(test.responseText, 'Connection successful.');
    const accounts = await client.listAccounts();
    assert.equal(accounts[0]?.id, 'account-1');
    const usage = await client.getAccountUsage(accounts[0]!);
    assert.equal(usage.length, 1);
    assert.equal(usage[0]?.desktopUsersCount, 12);
    await client.listInvoices({ periodStart: '03/01/2026', periodEnd: '06/30/2026' });
    const invoiceUrl = new URL(invoiceRequestUrl!);
    assert.equal(invoiceUrl.searchParams.get('periodStart'), '03/01/2026');
    assert.equal(invoiceUrl.searchParams.get('periodEnd'), '06/30/2026');

    accountResponse = new Response('<html>Sign in</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    await assert.rejects(
      () => client.listAccounts(),
      (error: unknown) =>
        error instanceof NerdioApiError &&
        error.message.includes('/rest-api/v1/accounts') &&
        error.message.includes('interactive sign-in page'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

run()
  .then(() => console.log('Nerdio client tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
