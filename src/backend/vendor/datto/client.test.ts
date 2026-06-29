import assert from 'node:assert/strict';
import { DattoClient, parseDattoBcdrDevice, parseDattoBcdrDeviceAgents, parseSaasDomain, parseSaasSeat } from './client';

const bcdrDeviceRecord = {
  serialNumber: 'ABC123',
  name: 'siris-01',
  organizationId: 12345,
  organizationName: 'Mapped Client',
  model: 'S3B2000',
  agentCount: 1,
};
const bcdrDeviceResponse = {
  pagination: {
    page: 1,
    perPage: 100,
    totalPages: 1,
    count: 1,
  },
  items: [bcdrDeviceRecord],
};
const bcdrDeviceAgentsResponse = [
  {
    name: 'dc-01',
    assetId: 98765,
    volume: 'asset-volume-1',
    os: 'Windows Server',
    protectedVolumesCount: 2,
    unprotectedVolumesCount: 0,
    protectedVolumeNames: ['C:', 'D:'],
    unprotectedVolumeNames: [],
    agentVersion: '3.0.18.5',
    isPaused: false,
    isArchived: false,
    latestOffsite: 1640098561,
    localSnapshots: 5,
    lastSnapshot: 1640098562,
    lastScreenshotAttempt: 1640098563,
    lastScreenshotAttemptStatus: true,
    fqdn: 'dc-01.mapped.example',
    protectedMachine: {
      serial: 'PM-ABC123',
    },
  },
];

const parsedDevice = parseDattoBcdrDevice(bcdrDeviceRecord);
assert.ok(parsedDevice);
const agents = parseDattoBcdrDeviceAgents(parsedDevice, bcdrDeviceAgentsResponse);
assert.equal(agents.length, 1);
assert.equal(agents[0]?.customerName, 'Mapped Client');
assert.equal(agents[0]?.organizationId, '12345');
assert.equal(agents[0]?.deviceHostname, 'siris-01');
assert.equal(agents[0]?.deviceSerial, 'ABC123');
assert.equal(agents[0]?.deviceModel, 'S3B2000');
assert.equal(agents[0]?.agentName, 'dc-01');
assert.equal(agents[0]?.assetId, '98765');
assert.equal(agents[0]?.agentVersion, '3.0.18.5');
assert.equal(agents[0]?.protectedVolumesCount, 2);
assert.equal(agents[0]?.lastSnapshot, 1640098562);

const parsedDeviceWithBlankOrganizationName = parseDattoBcdrDevice({
  serialNumber: 'XYZ789',
  name: 'siris-02',
  organizationName: '',
  clientCompanyName: 'Client Company Fallback',
  agentCount: 1,
});
assert.equal(parsedDeviceWithBlankOrganizationName?.customerName, 'Client Company Fallback');

const domain = parseSaasDomain({
  saasCustomerId: 'saas-1',
  customerName: 'Mapped Client',
  domain: 'mapped.example',
  productType: 'Office365',
  retentionType: 'ICR',
  seatsUsed: 42,
});
assert.equal(domain?.saasCustomerId, 'saas-1');
assert.equal(domain?.productType, 'Office365');
assert.equal(domain?.retentionType, 'ICR');
assert.equal(domain?.seatsUsed, 42);

const domainWithDattoNames = parseSaasDomain({
  saasCustomerId: 456789,
  organizationId: 12345,
  organizationName: 'Organization Name Fallback',
  saasCustomerName: 'SaaS Customer Name',
  domain: 'mapped.example',
  productType: 'Office365',
  retentionType: 'TBR',
  seatsUsed: 7,
});
assert.equal(domainWithDattoNames?.saasCustomerId, '456789');
assert.equal(domainWithDattoNames?.organizationId, '12345');
assert.equal(domainWithDattoNames?.customerName, 'SaaS Customer Name');

const seat = parseSaasSeat({
  remoteId: 'remote-1',
  displayName: 'Licensed User',
  userPrincipalName: 'licensed.user@mapped.example',
  seat_type: 'User',
  licenseStatus: 'Licensed',
});
assert.equal(seat?.remoteId, 'remote-1');
assert.equal(seat?.seatType, 'User');

async function run() {
  const requests: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = String(url);
    requests.push(urlText);

    const headers = new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined));
    assert.equal(headers.get('authorization'), `Basic ${Buffer.from('public:private').toString('base64')}`);

    if (urlText.includes('/v1/bcdr/device') && !urlText.includes('/asset/agent')) {
      assert.equal(new URL(urlText).searchParams.get('_page'), '1');
      assert.equal(new URL(urlText).searchParams.get('_perPage'), '100');
      assert.equal(new URL(urlText).searchParams.get('showHiddenDevices'), '0');
      assert.equal(new URL(urlText).searchParams.get('showChildResellerDevices'), '1');
      return Response.json(bcdrDeviceResponse);
    }

    if (urlText.includes('/v1/bcdr/device/ABC123/asset/agent')) {
      return Response.json(bcdrDeviceAgentsResponse);
    }

    if (urlText.includes('/v1/saas/domains')) {
      return Response.json({
        domains: [
          {
            saasCustomerId: 'saas-1',
            customerName: 'Mapped Client',
            domain: 'mapped.example',
            productType: 'Office365',
            retentionType: 'ICR',
          },
        ],
      });
    }

    if (urlText.includes('/v1/saas/saas-1/seats')) {
      return Response.json({
        seats: [
          { remoteId: 'user-1', seatType: 'User', licenseStatus: 'Licensed' },
          { remoteId: 'shared-1', seatType: 'SharedMailbox', licenseStatus: 'Licensed' },
          { remoteId: 'paused-1', seatType: 'User', licenseStatus: 'Paused' },
        ],
      });
    }

    return Response.json({}, { status: 404 });
  }) as typeof fetch;

  try {
    const client = new DattoClient({
      endpoint: 'https://api.datto.com',
      apiKey: 'public',
      apiSecret: 'private',
    });

    const fetchedAgents = await client.listBcdrProtectedAgents({ pageSize: 100, maxPages: 1 });
    assert.equal(fetchedAgents.length, 1);

    const summaries = await client.listSaasUsageSummaries({ pageSize: 100, maxPages: 1 });
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.productKey, 'datto-saas-office365-icr');
    assert.equal(summaries[0]?.quantity, 2);
    assert.equal(summaries[0]?.source, 'seat-detail-fallback');
    assert.equal(requests.some((request) => request.includes('limit=100')), true);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('datto client tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
