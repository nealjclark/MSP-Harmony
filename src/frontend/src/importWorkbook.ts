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

export type WorkbookTableSheet = {
  name: string;
  rows: unknown[][];
};

export function readWorkbookTableSheets(arrayBuffer: ArrayBuffer): WorkbookTableSheet[] {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    }),
  }));
}
