import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import {
  getSoftwareInventoryApplicationDevices,
  hasSoftwareApplicationPayloadRows,
  isSoftwareInventoryDevice,
  normalizeApplicationName,
  parseSoftwareApplications,
} from './ncentralSoftwareInventory';

async function run() {
  assert.equal(normalizeApplicationName('  Microsoft   Edge  '), 'microsoft edge');

  const arrayPayload = parseSoftwareApplications({
    application: [
      {
        displayName: 'Microsoft Edge',
        displayVersion: '126.0',
        publisher: 'Microsoft Corporation',
        installDate: '2026-08-01',
        installLocation: 'C:\\Program Files\\Edge',
      },
      {
        name: '  Microsoft   Edge ',
        version: '126.0',
        vendor: 'Microsoft Corporation',
        installedDate: '2026-08-01',
        location: 'C:\\Program Files\\Edge',
      },
      { name: '7-Zip', version: 24.08, manufacturer: 'Igor Pavlov' },
      { publisher: 'Missing a name' },
    ],
  });
  assert.equal(arrayPayload.length, 2, 'semantic duplicates should be discarded within one device payload');
  assert.deepEqual(
    arrayPayload.map((application) => ({
      name: application.applicationName,
      normalized: application.normalizedName,
      version: application.version,
      publisher: application.publisher,
    })),
    [
      {
        name: 'Microsoft Edge',
        normalized: 'microsoft edge',
        version: '126.0',
        publisher: 'Microsoft Corporation',
      },
      {
        name: '7-Zip',
        normalized: '7-zip',
        version: '24.08',
        publisher: 'Igor Pavlov',
      },
    ],
  );

  const nestedPayload = parseSoftwareApplications({
    Applications: {
      items: [
        { ProductName: 'Zoom Workplace', DisplayVersion: '6.1.0', Publisher: 'Zoom Video Communications' },
      ],
    },
  });
  assert.equal(nestedPayload[0]?.applicationName, 'Zoom Workplace');
  assert.equal(nestedPayload[0]?.version, '6.1.0');

  const columnPayload = parseSoftwareApplications({
    application: {
      Name: ['Firefox', 'VLC media player'],
      Version: ['128.0', '3.0.21'],
      Publisher: ['Mozilla', 'VideoLAN'],
    },
  });
  assert.deepEqual(columnPayload.map((application) => application.applicationName), ['Firefox', 'VLC media player']);
  assert.deepEqual(columnPayload.map((application) => application.publisher), ['Mozilla', 'VideoLAN']);

  const ncentralAssetPayload = parseSoftwareApplications({
    _extra: {
      application: {
        list: [
          {
            _index: 0,
            displayname: 'Microsoft 365 Apps for enterprise',
            installationdate: '20260810',
            publisher: 'Microsoft Corporation',
            version: '16.0.19127.20202',
          },
        ],
      },
    },
    application: {
      list: [{ _index: 0, displayname: 'Microsoft 365 Apps for enterprise' }],
    },
  });
  assert.equal(ncentralAssetPayload.length, 1, 'the enriched N-central application list should take precedence');
  assert.deepEqual(
    {
      name: ncentralAssetPayload[0]?.applicationName,
      publisher: ncentralAssetPayload[0]?.publisher,
      version: ncentralAssetPayload[0]?.version,
      installDate: ncentralAssetPayload[0]?.installDate,
    },
    {
      name: 'Microsoft 365 Apps for enterprise',
      publisher: 'Microsoft Corporation',
      version: '16.0.19127.20202',
      installDate: '20260810',
    },
  );

  const ncentralRootListPayload = parseSoftwareApplications({
    application: { list: [{ displayname: 'Google Chrome' }] },
  });
  assert.equal(ncentralRootListPayload[0]?.applicationName, 'Google Chrome');
  assert.equal(hasSoftwareApplicationPayloadRows({ application: { list: [{ unexpectedName: 'Chrome' }] } }), true);
  assert.equal(hasSoftwareApplicationPayloadRows({ application: { list: [] } }), false);

  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Windows Workstation' }), true);
  assert.equal(isSoftwareInventoryDevice({ supportedOs: 'Microsoft Windows Server 2022' }), true);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'MacBook', supportedOs: 'macOS Sonoma' }), true);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Linux Server', supportedOs: 'Ubuntu 24.04' }), false);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Network Device', osId: 'Cisco IOS' }), false);

  let applicationDeviceQuery: { sql: string; values?: unknown[] } | undefined;
  const applicationDevices = await getSoftwareInventoryApplicationDevices({
    query: async (sql: string, values?: unknown[]) => {
      applicationDeviceQuery = { sql, values };
      return {
        rows: [{
          customer_name: 'Acme',
          site_name: 'HQ',
          device_id: '101',
          device_name: 'PC-01',
          device_class: 'Workstations - Windows',
          last_user: 'ACME\\jane',
          publishers: ['Microsoft Corporation'],
          versions: ['126.0'],
        }],
      };
    },
  } as unknown as Pool, '00000000-0000-0000-0000-000000000001', '  Microsoft   Edge  ');
  assert.match(applicationDeviceQuery?.sql ?? '', /applications\.normalized_name = \$2/);
  assert.deepEqual(applicationDeviceQuery?.values, ['00000000-0000-0000-0000-000000000001', 'microsoft edge']);
  assert.deepEqual(applicationDevices, [{
    customerName: 'Acme',
    siteName: 'HQ',
    deviceId: '101',
    deviceName: 'PC-01',
    deviceClass: 'Workstations - Windows',
    lastUser: 'ACME\\jane',
    publishers: ['Microsoft Corporation'],
    versions: ['126.0'],
  }]);

  console.log('ncentral software inventory tests passed');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
