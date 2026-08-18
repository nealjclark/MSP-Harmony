import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from '@e965/xlsx';
import JSZip from 'jszip';
import { freezeWorkbookHeaderRows } from './ncentralSoftwareInventoryFunction';

async function run() {
  const source = readFileSync(new URL('./ncentralSoftwareInventoryFunction.ts', import.meta.url), 'utf8');
  assert.match(source, /route: 'reports\/ncentral-software-inventory\/scopes'/);
  assert.match(source, /route: 'reports\/ncentral-software-inventory\/\{reportId:guid\}'/);

  const workbook = XLSX.utils.book_new();
  const counts = XLSX.utils.json_to_sheet([
    { Software: 'Microsoft Edge', Devices: 3, Installations: 3, Publishers: 'Microsoft', Versions: '126.0' },
  ]);
  const details = XLSX.utils.json_to_sheet([
    { Customer: 'Acme', Site: 'HQ', Device: 'PC-01', Software: 'Microsoft Edge', 'Collection status': 'Complete' },
    { Customer: 'Acme', Site: 'HQ', Device: 'PC-02', Software: '', 'Collection status': 'Failed', 'Collection error': 'Offline' },
  ]);
  if (counts['!ref']) counts['!autofilter'] = { ref: counts['!ref'] };
  if (details['!ref']) details['!autofilter'] = { ref: details['!ref'] };
  XLSX.utils.book_append_sheet(workbook, counts, 'Counts');
  XLSX.utils.book_append_sheet(workbook, details, 'Full details');

  const bytes = await freezeWorkbookHeaderRows(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(parsed.SheetNames, ['Counts', 'Full details']);
  assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.Counts), [
    { Software: 'Microsoft Edge', Devices: 3, Installations: 3, Publishers: 'Microsoft', Versions: '126.0' },
  ]);
  const detailRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets['Full details']);
  assert.equal(detailRows.length, 2);
  assert.equal(detailRows[1]?.['Collection status'], 'Failed');
  assert.equal(detailRows[1]?.['Collection error'], 'Offline');

  const zip = await JSZip.loadAsync(bytes);
  const sheetXmlFiles = Object.values(zip.files).filter((file) => /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name));
  assert.equal(sheetXmlFiles.length, 2);
  for (const file of sheetXmlFiles) {
    const xml = await file.async('string');
    assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(xml, /<autoFilter ref=/);
  }

  console.log('ncentral software inventory workbook tests passed');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
