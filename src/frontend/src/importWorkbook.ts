import * as XLSX from '@e965/xlsx';

export function readWorkbookObjectRows(arrayBuffer: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The workbook does not contain a worksheet.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}
