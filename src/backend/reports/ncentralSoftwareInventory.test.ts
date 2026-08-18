import assert from 'node:assert/strict';
import {
  isSoftwareInventoryDevice,
  normalizeApplicationName,
  parseSoftwareApplications,
} from './ncentralSoftwareInventory';

function run() {
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

  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Windows Workstation' }), true);
  assert.equal(isSoftwareInventoryDevice({ supportedOs: 'Microsoft Windows Server 2022' }), true);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'MacBook', supportedOs: 'macOS Sonoma' }), true);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Linux Server', supportedOs: 'Ubuntu 24.04' }), false);
  assert.equal(isSoftwareInventoryDevice({ deviceClass: 'Network Device', osId: 'Cisco IOS' }), false);

  console.log('ncentral software inventory tests passed');
}

run();
