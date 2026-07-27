import assert from 'node:assert/strict';
import { IngramClient, ingramReportDateRange } from './client';

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers?: HeadersInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: init?.headers });
    if (url.endsWith('/token')) {
      return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
    }
    if (url.includes('/reports?')) {
      return jsonResponse({
        data: [{
          id: 'report-1',
          name: 'Every Invoice',
          creationDate: '2026-06-21T00:00:00Z',
          downloadUrl: 'https://signed-storage.example.com/every-invoice.xlsx',
        }],
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new IngramClient({
      endpoint: 'https://api.ingram.example.com',
      apiUsername: 'username',
      apiSecret: 'secret',
      subscriptionKey: 'subscription-key',
      marketplace: 'us',
    });

    const reports = await client.listReports({ from: '2025-08-01', to: '2026-07-31' });
    const reportRequest = requests.find((request) => request.url.includes('/reports?'));
    assert.equal(
      reportRequest?.url,
      'https://api.ingram.example.com/reports?from=2025-08-01&to=2026-07-31&limit=500',
    );
    assert.equal(reports[0]?.createdAt, '2026-06-21T00:00:00Z');
    assert.deepEqual(ingramReportDateRange('2026-07-27T00:00:00Z'), {
      from: '2025-08-01',
      to: '2026-07-31',
    });

    await client.downloadReport('https://signed-storage.example.com/report.xlsx?sig=signed');
    const signedDownload = requests[requests.length - 1];
    assert.equal(signedDownload?.url, 'https://signed-storage.example.com/report.xlsx?sig=signed');
    assert.equal(signedDownload?.headers, undefined, 'Signed report downloads must not receive Marketplace API headers.');

    await client.downloadReport('/reports/report-1/download');
    const apiDownload = requests[requests.length - 1];
    const apiHeaders = new Headers(apiDownload?.headers);
    assert.equal(apiDownload?.url, 'https://api.ingram.example.com/reports/report-1/download');
    assert.equal(apiHeaders.get('Authorization'), 'Bearer test-token');
    assert.equal(apiHeaders.get('X-Subscription-Key'), 'subscription-key');
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
  .then(() => console.log('Ingram client tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
