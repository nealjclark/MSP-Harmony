import { BlobServiceClient } from '@azure/storage-blob';
import * as XLSX from '@e965/xlsx';
import JSZip from 'jszip';
import pdf from 'pdf-parse';
import { createHash } from 'node:crypto';
import { safeFileName } from '../invoices/invoiceFileStorage';

const salesContainerName = 'sales-quote-attachments';
const maximumAttachmentBytes = 10 * 1024 * 1024;
const maximumExtractedCharacters = 50000;
const supportedExtensions = new Set(['.pdf', '.docx', '.xlsx', '.pptx']);
const explicitlyRejectedExtensions = new Set([
  '.doc',
  '.docm',
  '.xls',
  '.xlsm',
  '.ppt',
  '.pptm',
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.com',
  '.js',
  '.vbs',
  '.ps1',
  '.msi',
  '.zip',
  '.rar',
  '.7z',
]);

export type AttachmentExtractionResult =
  | { status: 'extracted'; text: string }
  | { status: 'rejected' | 'failed'; error: string };

export async function retainAndExtractSalesAttachment(input: {
  requestId: string;
  messageId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}) {
  const fileName = safeFileName(input.fileName);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const blobName = `${input.requestId}/${input.messageId}/${sha256.slice(0, 16)}-${fileName}`;
  const container = await salesAttachmentContainer();
  await container.getBlockBlobClient(blobName).uploadData(input.bytes, {
    blobHTTPHeaders: { blobContentType: input.contentType || 'application/octet-stream' },
    metadata: {
      originalFileName: Buffer.from(input.fileName, 'utf8').toString('base64url'),
      sha256,
    },
  });
  const extraction = await extractSalesAttachment({
    fileName,
    bytes: input.bytes,
  });
  return {
    blobName,
    fileName,
    contentType: input.contentType || 'application/octet-stream',
    fileSize: input.bytes.byteLength,
    sha256,
    extraction,
  };
}

export async function extractSalesAttachment(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<AttachmentExtractionResult> {
  if (input.bytes.byteLength > maximumAttachmentBytes) {
    return { status: 'rejected', error: 'Attachment exceeds the 10 MB pilot limit.' };
  }
  const extension = fileExtension(input.fileName);
  if (explicitlyRejectedExtensions.has(extension) || !supportedExtensions.has(extension)) {
    return {
      status: 'rejected',
      error: 'Only searchable PDF, DOCX, XLSX, and PPTX files are accepted.',
    };
  }

  try {
    const text =
      extension === '.pdf'
        ? await extractPdf(input.bytes)
        : extension === '.xlsx'
          ? extractWorkbook(input.bytes)
          : await extractOpenXml(input.bytes, extension);
    const normalized = normalizeExtractedText(text);
    if (!normalized) {
      return {
        status: 'rejected',
        error:
          extension === '.pdf'
            ? 'The PDF does not contain searchable text. Send a searchable PDF or modern Office file.'
            : 'The attachment did not contain readable text or table values.',
      };
    }
    return { status: 'extracted', text: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment extraction failed.';
    const looksEncrypted = /password|encrypted|encryption/i.test(message);
    return {
      status: looksEncrypted ? 'rejected' : 'failed',
      error: looksEncrypted
        ? 'Password-protected or encrypted attachments are not accepted.'
        : `Attachment extraction failed: ${message.slice(0, 300)}`,
    };
  }
}

async function extractPdf(bytes: Buffer) {
  const result = await pdf(bytes, { max: 100 });
  return result.text ?? '';
}

function extractWorkbook(bytes: Buffer) {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: false, cellHTML: false });
  const sections: string[] = [];
  for (const name of workbook.SheetNames.slice(0, 25)) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });
    const textRows = rows
      .slice(0, 2000)
      .map((row) => row.map((cell) => String(cell ?? '').trim()).join('\t').trim())
      .filter(Boolean);
    if (textRows.length > 0) sections.push(`[Worksheet: ${name}]\n${textRows.join('\n')}`);
  }
  return sections.join('\n\n');
}

async function extractOpenXml(bytes: Buffer, extension: string) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  if (Object.keys(zip.files).some((name) => /vbaProject\.bin$/i.test(name))) {
    throw new Error('Macro-enabled Office files are not accepted.');
  }
  const candidates =
    extension === '.docx'
      ? Object.keys(zip.files).filter((name) => /^word\/(document|footnotes|endnotes)\.xml$/i.test(name))
      : Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort(naturalSort);
  const sections: string[] = [];
  for (const name of candidates.slice(0, 200)) {
    const xml = await zip.files[name].async('string');
    const label = extension === '.pptx' ? `[${name.replace('ppt/slides/', '').replace('.xml', '')}]` : '';
    const text = xmlToText(xml);
    if (text) sections.push(label ? `${label}\n${text}` : text);
  }
  return sections.join('\n\n');
}

function xmlToText(xml: string) {
  return xml
    .replace(/<(w:tab|a:tab)\b[^>]*\/>/gi, '\t')
    .replace(/<\/(w:p|a:p|a:tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maximumExtractedCharacters);
}

async function salesAttachmentContainer() {
  const connection = process.env.AzureWebJobsStorage;
  if (!connection) throw new Error('AzureWebJobsStorage is required to retain sales quote attachments.');
  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient(salesContainerName);
  await container.createIfNotExists({ access: undefined });
  return container;
}

function fileExtension(fileName: string) {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase());
  return match?.[0] ?? '';
}

function naturalSort(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}
