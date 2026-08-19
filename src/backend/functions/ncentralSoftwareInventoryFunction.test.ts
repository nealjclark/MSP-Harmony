import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from '@e965/xlsx';
import JSZip from 'jszip';
import {
  appendSoftwareInventoryCountsSheet,
  appendSoftwareInventoryDetailsSheet,
  freezeWorkbookHeaderRows,
} from './ncentralSoftwareInventoryFunction';

async function run() {
  const source = readFileSync(new URL('./ncentralSoftwareInventoryFunction.ts', import.meta.url), 'utf8');
  assert.match(source, /route: 'reports\/ncentral-software-inventory\/scopes'/);
  assert.match(source, /route: 'reports\/ncentral-software-inventory\/\{reportId:guid\}'/);
  assert.match(source, /route: 'reports\/ncentral-software-inventory\/\{reportId:guid\}\/application-devices'/);

  const workbook = XLSX.utils.book_new();
  appendSoftwareInventoryCountsSheet(workbook, [{
    applicationName: 'Microsoft Edge',
    deviceCount: 3,
    installationCount: 3,
    publishers: ['Microsoft Corporation'],
    versions: ['126.0'],
  }]);
  appendSoftwareInventoryDetailsSheet(workbook, [
    {
      customerName: 'Acme', siteName: 'HQ', deviceId: 'device-1', deviceName: 'PC-01',
      deviceClass: 'Laptop - Windows', lastUser: 'AzureAD\\Taylor', applicationName: 'Microsoft Edge',
      publisher: 'Microsoft Corporation', version: '126.0', collectionStatus: 'Complete',
    },
    {
      customerName: 'Acme', siteName: 'HQ', deviceId: 'device-2', deviceName: 'PC-02',
      deviceClass: 'Workstation - Windows', lastUser: 'ACME\\Jordan', collectionStatus: 'Failed',
      collectionError: 'Offline',
    },
  ]);

  assert.equal(workbook.Sheets.Counts?.['!cols']?.length, 4);
  assert.equal(workbook.Sheets['Full details']?.['!cols']?.length, 11);
  assert.ok((workbook.Sheets.Counts?.['!cols']?.[0]?.wch ?? 0) >= 'Microsoft Edge'.length + 2);

  const bytes = await freezeWorkbookHeaderRows(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(parsed.SheetNames, ['Counts', 'Full details']);
  assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.Counts), [
    { Software: 'Microsoft Edge', Devices: 3, Publishers: 'Microsoft Corporation', Versions: '126.0' },
  ]);
  const detailRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets['Full details']);
  assert.equal(detailRows.length, 2);
  assert.equal(detailRows[0]?.['Last user'], 'AzureAD\\Taylor');
  assert.equal(detailRows[1]?.['Last user'], 'ACME\\Jordan');
  assert.equal('Installations' in (XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Counts)[0] ?? {}), false);
  assert.equal('Collection status' in (detailRows[0] ?? {}), false);
  assert.equal('Collection error' in (detailRows[1] ?? {}), false);

  const zip = await JSZip.loadAsync(bytes);
  const sheetXmlFiles = Object.values(zip.files).filter((file) => /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name));
  assert.equal(sheetXmlFiles.length, 2);
  for (const file of sheetXmlFiles) {
    const xml = await file.async('string');
    assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(xml, /<autoFilter ref=/);
    assert.match(xml, /<cols>/);
  }

  console.log('ncentral software inventory workbook tests passed');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
