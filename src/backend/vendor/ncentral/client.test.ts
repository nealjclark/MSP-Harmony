import assert from 'node:assert/strict';
import { NcentralClient } from './client';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const calls: FetchCall[] = [];
const responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = [
  {
    status: 200,
    body: {
      tokens: {
        access: { token: 'access-1', expirySeconds: 3600 },
        refresh: { token: 'refresh-1', expirySeconds: 7200 },
      },
    },
  },
  {
    status: 200,
    body: {
      data: [
        { filterId: '10', filterName: 'Billing - Servers - Physical' },
        { filterId: '11', filterName: 'Billing - Workstations and Laptops' },
      ],
    },
  },
  {
    status: 429,
    body: { message: 'Too many requests' },
    headers: { 'retry-after': '1' },
  },
  {
    status: 200,
    body: {
      data: [
        {
          deviceId: 101,
          longName: 'server-01',
          deviceClass: 'Windows Server',
          customerId: 200,
          customerName: 'Acme',
          supportedOs: 'Windows Server 2022',
        },
      ],
    },
  },
  {
    status: 200,
    body: {
      data: {
        deviceId: 101,
        longName: 'server-01',
        deviceClass: 'Windows Server',
        customerId: 200,
        customerName: 'Acme',
        supportedOs: 'Windows Server 2022',
        lastApplianceCheckinTime: '2026-06-16T12:00:00Z',
      },
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
  const client = new NcentralClient({
    endpoint: 'https://ncentral.example.com',
    apiToken: 'user-api-token',
  });

  const filters = await client.listDeviceFilters({ pageSize: 25, maxPages: 1 });
  assert.equal(filters.length, 2);
  assert.equal(filters[0]?.filterName, 'Billing - Servers - Physical');
  assert.equal(calls[0]?.url, 'https://ncentral.example.com/api/auth/authenticate');
  assert.equal(calls[0]?.init?.headers && (calls[0].init.headers as Record<string, string>).Authorization, 'Bearer user-api-token');

  const devices = await client.listDevicesByFilter('10', { pageSize: 25, maxPages: 1 });
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.deviceId, 101);
  assert.ok(calls.some((call) => call.url.includes('/api/devices?filterId=10')));

  const detail = await client.getDevice(101);
  assert.equal(detail.lastApplianceCheckinTime, '2026-06-16T12:00:00Z');

  globalThis.fetch = originalFetch;
  console.log('ncentral client tests passed');
}

run().catch((error: unknown) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
