import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'node:crypto';

const containerName = 'vendor-invoice-files';

export type StoredInvoiceFile = {
  blobName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
};

export async function storeInvoiceFile(input: {
  importId: string;
  integrationId: string;
  fileName: string;
  contentType?: string;
  bytes: Buffer;
}): Promise<StoredInvoiceFile> {
  const container = await invoiceContainer();
  const blobName = `${safeSegment(input.integrationId)}/${input.importId}/${safeFileName(input.fileName)}`;
  const contentType = input.contentType || 'application/octet-stream';
  await container.getBlockBlobClient(blobName).uploadData(input.bytes, {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata: { originalFileName: Buffer.from(input.fileName, 'utf8').toString('base64url') },
  });
  return {
    blobName,
    contentType,
    fileSize: input.bytes.byteLength,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
  };
}

export async function deleteInvoiceFile(blobName: string) {
  const container = await invoiceContainer();
  await container.deleteBlob(blobName, { deleteSnapshots: 'include' });
}

export async function downloadInvoiceFile(blobName: string) {
  const container = await invoiceContainer();
  const response = await container.getBlobClient(blobName).download();
  const bytes = await streamToBuffer(response.readableStreamBody);
  return { bytes, contentType: response.contentType ?? 'application/octet-stream' };
}

async function invoiceContainer() {
  const connection = process.env.AzureWebJobsStorage;
  if (!connection) throw new Error('AzureWebJobsStorage is required to retain original vendor invoice files.');
  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient(containerName);
  await container.createIfNotExists({ access: undefined });
  return container;
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined) {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'integration';
}

export function safeFileName(value: string) {
  const leaf = value.replace(/\\/g, '/').split('/').pop() ?? 'invoice';
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"|?*]+/g, '_').trim();
  return cleaned.slice(0, 180) || 'invoice';
}
