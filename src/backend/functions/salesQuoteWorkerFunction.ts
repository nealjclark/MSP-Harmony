import { app, output, type InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import { getSharedDatabasePool } from '../database/pool';
import { retainAndExtractSalesAttachment } from '../sales/attachments';
import {
  SalesMailboxClient,
  salesMailboxCredentialsFromSettings,
} from '../sales/graphMailboxClient';
import { SalesQuoteRepository } from '../sales/repository';
import {
  processSalesQuoteRequest,
  type SalesQuoteWorkMessage,
} from '../sales/workflow';

const salesQuoteQueueOutput = output.storageQueue({
  queueName: 'sales-quote-work',
  connection: 'AzureWebJobsStorage',
});

export async function pollSalesQuoteMailbox(_timer: unknown, context: InvocationContext) {
  const pool = await getSharedDatabasePool();
  const repository = new SalesQuoteRepository(pool);
  const salesSettings = await repository.getSettings();
  if (salesSettings.requesterAllowlist.length === 0) {
    context.warn('Sales mailbox poll skipped because the requester allowlist is empty.');
    return;
  }
  const provider = createIntegrationSettingsProvider({
    metadataReader: new PostgresIntegrationSettingsRepository(pool),
  });
  const mailboxSettings = await provider.getIntegrationSettings('sales-mailbox');
  if (mailboxSettings.validation.configuredStatus !== 'connected') {
    context.warn('Sales mailbox poll skipped because the Sales Quote Mailbox integration is not configured.');
    return;
  }
  const credentials = salesMailboxCredentialsFromSettings(mailboxSettings);
  const client = new SalesMailboxClient(credentials);
  const checkpoint = await repository.getMailboxCheckpoint(credentials.sharedMailbox);
  const queueMessages: SalesQuoteWorkMessage[] = [];

  try {
    const delta = await client.pollDelta(checkpoint);
    const allowed = new Set(salesSettings.requesterAllowlist.map((email) => email.toLowerCase()));
    for (const message of delta.messages) {
      if (!message.senderEmail || !allowed.has(message.senderEmail.toLowerCase())) {
        context.warn(`Ignored sales quote email from non-allowlisted sender ${message.senderEmail ?? 'unknown'}.`);
        continue;
      }
      const ingested = await repository.ingestInboundMessage({
        graphMessageId: message.id,
        internetMessageId: message.internetMessageId,
        conversationId: message.conversationId,
        senderEmail: message.senderEmail,
        senderName: message.senderName,
        subject: message.subject,
        bodyText: message.bodyText,
        receivedAt: message.receivedAt,
      });
      if (message.hasAttachments && ingested.messageId) {
        const attachments = await client.listAttachments(message.id);
        for (const attachment of attachments.slice(0, 5)) {
          if (!attachment.bytes || attachment.size > 10 * 1024 * 1024) {
            const sha256 = createHash('sha256')
              .update(`${attachment.id}:${attachment.name}:${attachment.size}`)
              .digest('hex');
            await repository.addAttachment({
              requestId: ingested.requestId,
              messageId: ingested.messageId,
              graphAttachmentId: attachment.id,
              fileName: attachment.name,
              contentType: attachment.contentType,
              fileSize: attachment.size,
              sha256,
              blobName: 'not-retained',
              extractionStatus: 'rejected',
              extractionError:
                attachment.size > 10 * 1024 * 1024
                  ? 'Attachment exceeds the 10 MB pilot limit.'
                  : 'Microsoft Graph did not return attachment bytes.',
            });
            continue;
          }
          const retained = await retainAndExtractSalesAttachment({
            requestId: ingested.requestId,
            messageId: ingested.messageId,
            fileName: attachment.name,
            contentType: attachment.contentType,
            bytes: attachment.bytes,
          });
          await repository.addAttachment({
            requestId: ingested.requestId,
            messageId: ingested.messageId,
            graphAttachmentId: attachment.id,
            fileName: retained.fileName,
            contentType: retained.contentType,
            fileSize: retained.fileSize,
            sha256: retained.sha256,
            blobName: retained.blobName,
            extractionStatus: retained.extraction.status,
            extractedText: retained.extraction.status === 'extracted' ? retained.extraction.text : undefined,
            extractionError: retained.extraction.status !== 'extracted' ? retained.extraction.error : undefined,
          });
        }
        if (attachments.length > 5) {
          await repository.recordInternalComment(
            ingested.requestId,
            'MSP Harmony Quote Agent',
            `${attachments.length - 5} attachment(s) were not processed because the pilot limit is five files per message.`,
          );
        }
      }
      queueMessages.push({
        requestId: ingested.requestId,
        reason: 'mail',
        queuedAt: new Date().toISOString(),
      });
    }
    if (queueMessages.length > 0) context.extraOutputs.set(salesQuoteQueueOutput, queueMessages);
    await repository.saveMailboxCheckpoint(credentials.sharedMailbox, delta.deltaLink);
    context.log(`Sales mailbox queued ${queueMessages.length} quote request message(s).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sales mailbox poll failed.';
    await repository.saveMailboxCheckpoint(credentials.sharedMailbox, undefined, message);
    throw error;
  }
}

export async function processSalesQuoteQueue(
  message: SalesQuoteWorkMessage,
  context: InvocationContext,
) {
  if (!message?.requestId) throw new Error('Sales quote queue message is missing requestId.');
  const pool = await getSharedDatabasePool();
  await processSalesQuoteRequest(pool, message, context);
}

app.timer('pollSalesQuoteMailbox', {
  schedule: '0 * * * * *',
  extraOutputs: [salesQuoteQueueOutput],
  handler: pollSalesQuoteMailbox,
});

app.storageQueue('processSalesQuoteQueue', {
  queueName: 'sales-quote-work',
  connection: 'AzureWebJobsStorage',
  handler: processSalesQuoteQueue,
});
