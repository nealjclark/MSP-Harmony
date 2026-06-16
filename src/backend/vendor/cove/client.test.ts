import assert from 'node:assert/strict';
import { CoveClient, getCoveStatisticColumns, parseCoveDeviceStatistic } from './client';

async function run() {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));

    if (requests.length === 1) {
      return jsonResponse({
        id: 'jsonrpc',
        jsonrpc: '2.0',
        result: {
          result: {
            PartnerId: 12345,
            Name: 'api-user@example.com',
          },
        },
        visa: 'visa-1',
      });
    }

    if (requests.length === 2) {
      return jsonResponse({
        id: 'jsonrpc',
        jsonrpc: '2.0',
        result: {
          result: [
            {
              AccountId: 987,
              PartnerId: 12345,
              Settings: [
                { I8: 'Northstar Dental' },
                { I1: 'ns-sql-01' },
                { I32: '2' },
                { T3: String(1135 * 1073741824) },
                { US: String(940 * 1073741824) },
                { I81: 'Virtual' },
              ],
            },
          ],
        },
        visa: 'visa-2',
      });
    }

    return jsonResponse({
      id: 'jsonrpc',
      jsonrpc: '2.0',
      result: {
        result: [],
      },
      visa: 'visa-3',
    });
  }) as typeof fetch;

  try {
    const client = new CoveClient({
      endpoint: 'https://api.backup.management',
      partnerName: 'BMB Consulting',
      username: 'api-user@example.com',
      password: 'secret',
    });

    const devices = await client.listAccountStatistics({ pageSize: 1, maxPages: 2 });
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.deviceType, 'server');
    assert.equal(devices[0]?.selectedStorageGb, 1135);

    assert.deepEqual(requests[0], {
      jsonrpc: '2.0',
      id: 'jsonrpc',
      method: 'Login',
      params: {
        partner: 'BMB Consulting',
        username: 'api-user@example.com',
        password: 'secret',
      },
    });

    assert.equal((requests[1] as { visa?: string }).visa, 'visa-1');
    assert.deepEqual(
      ((requests[1] as { params: { query: { Columns: string[] } } }).params.query.Columns),
      getCoveStatisticColumns(),
    );
    assert.equal((requests[2] as { visa?: string }).visa, 'visa-2');

    const lowerCaseSettings = parseCoveDeviceStatistic({
      accountId: 654,
      partnerId: 456,
      settings: {
        I8: 'Lower Case Customer',
        I1: 'laptop-01',
        I32: '1',
        T3: String(151 * 1073741824),
        US: String(208 * 1073741824),
      },
    });
    assert.equal(lowerCaseSettings.deviceType, 'workstation');
    assert.equal(lowerCaseSettings.customerName, 'Lower Case Customer');
    assert.equal(lowerCaseSettings.usedStorageGb, 208);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('cove client tests passed');
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
