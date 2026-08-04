import { acquireGraphAccessToken } from '../email/graphEmailSender';

export type SalesMailboxCredentials = {
  endpoint: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sharedMailbox: string;
};

export type SalesMailboxMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject: string;
  bodyText: string;
  senderEmail?: string;
  senderName?: string;
  receivedAt?: string;
  hasAttachments: boolean;
};

export type SalesMailboxAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  bytes?: Buffer;
};

type GraphDeltaResponse = {
  value?: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
};

type GraphMessage = {
  id?: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  hasAttachments?: boolean;
  '@removed'?: unknown;
};

type GraphAttachmentResponse = {
  value?: Array<{
    id?: string;
    name?: string;
    contentType?: string;
    size?: number;
    isInline?: boolean;
    contentBytes?: string;
    '@odata.type'?: string;
  }>;
};

export class SalesMailboxClient {
  private readonly graphBaseUrl: string;

  constructor(private readonly credentials: SalesMailboxCredentials) {
    this.graphBaseUrl = credentials.endpoint.replace(/\/+$/, '') || 'https://graph.microsoft.com';
  }

  async pollDelta(checkpoint?: string): Promise<{ messages: SalesMailboxMessage[]; deltaLink?: string }> {
    const token = await this.token();
    let nextUrl =
      checkpoint ??
      `${this.graphBaseUrl}/v1.0/users/${encodeURIComponent(this.credentials.sharedMailbox)}` +
        `/mailFolders/inbox/messages/delta?` +
        new URLSearchParams({
          '$select': 'id,internetMessageId,conversationId,subject,body,from,receivedDateTime,hasAttachments',
          '$top': '25',
        }).toString();
    const messages: SalesMailboxMessage[] = [];
    let deltaLink: string | undefined;

    for (let page = 0; page < 20 && nextUrl; page += 1) {
      assertGraphUrl(nextUrl, this.graphBaseUrl);
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          Prefer: 'outlook.body-content-type="text"',
        },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Sales mailbox delta request failed with HTTP ${response.status}: ${safeRemoteError(body)}`);
      }
      const parsed = JSON.parse(body) as GraphDeltaResponse;
      for (const message of parsed.value ?? []) {
        if (message['@removed'] || !message.id) continue;
        messages.push({
          id: message.id,
          internetMessageId: cleanText(message.internetMessageId),
          conversationId: cleanText(message.conversationId),
          subject: cleanText(message.subject) ?? '(No subject)',
          bodyText: normalizeMessageBody(message.body),
          senderEmail: cleanText(message.from?.emailAddress?.address)?.toLowerCase(),
          senderName: cleanText(message.from?.emailAddress?.name),
          receivedAt: cleanText(message.receivedDateTime),
          hasAttachments: message.hasAttachments === true,
        });
      }
      nextUrl = parsed['@odata.nextLink'] ?? '';
      deltaLink = parsed['@odata.deltaLink'] ?? deltaLink;
    }
    if (nextUrl) throw new Error('Sales mailbox delta pagination exceeded the 20-page safety limit.');
    return { messages, deltaLink };
  }

  async listAttachments(messageId: string): Promise<SalesMailboxAttachment[]> {
    const token = await this.token();
    const url =
      `${this.graphBaseUrl}/v1.0/users/${encodeURIComponent(this.credentials.sharedMailbox)}` +
      `/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline,contentBytes`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Sales mailbox attachment request failed with HTTP ${response.status}: ${safeRemoteError(body)}`);
    }
    const parsed = JSON.parse(body) as GraphAttachmentResponse;
    return (parsed.value ?? [])
      .filter((attachment) => attachment['@odata.type'] === '#microsoft.graph.fileAttachment')
      .map((attachment) => ({
        id: attachment.id ?? '',
        name: attachment.name ?? 'attachment',
        contentType: attachment.contentType ?? 'application/octet-stream',
        size: attachment.size ?? 0,
        isInline: attachment.isInline === true,
        bytes: attachment.contentBytes ? Buffer.from(attachment.contentBytes, 'base64') : undefined,
      }))
      .filter((attachment) => attachment.id && !attachment.isInline);
  }

  async reply(messageId: string, comment: string) {
    const token = await this.token();
    const url =
      `${this.graphBaseUrl}/v1.0/users/${encodeURIComponent(this.credentials.sharedMailbox)}` +
      `/messages/${encodeURIComponent(messageId)}/reply`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sales mailbox reply failed with HTTP ${response.status}: ${safeRemoteError(body)}`);
    }
  }

  private token() {
    return acquireGraphAccessToken({
      tenantId: this.credentials.tenantId,
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
      sendAsMailbox: this.credentials.sharedMailbox,
    });
  }
}

export function salesMailboxCredentialsFromSettings(settings: {
  nonSecrets: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
}): SalesMailboxCredentials {
  return {
    endpoint: required(settings.nonSecrets.endpoint, 'SALES_MAILBOX_GRAPH_ENDPOINT'),
    tenantId: required(settings.nonSecrets.tenantId, 'SALES_MAILBOX_TENANT_ID'),
    clientId: required(settings.nonSecrets.clientId, 'SALES_MAILBOX_CLIENT_ID'),
    clientSecret: required(settings.secrets.clientSecret, 'SALES_MAILBOX_CLIENT_SECRET'),
    sharedMailbox: required(settings.nonSecrets.sharedMailbox, 'SALES_SHARED_MAILBOX'),
  };
}

function normalizeMessageBody(body: GraphMessage['body']) {
  const content = body?.content ?? '';
  if (body?.contentType?.toLowerCase() === 'html') {
    return content
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 100000);
  }
  return content.trim().slice(0, 100000);
}

function assertGraphUrl(value: string, graphBaseUrl: string) {
  const candidate = new URL(value);
  const expected = new URL(graphBaseUrl);
  if (candidate.protocol !== 'https:' || candidate.origin !== expected.origin) {
    throw new Error('Microsoft Graph returned an unexpected pagination URL.');
  }
}

function safeRemoteError(value: string) {
  try {
    const parsed = JSON.parse(value) as { error?: { message?: string; code?: string } };
    return (parsed.error?.message ?? parsed.error?.code ?? 'Remote service error.').slice(0, 500);
  } catch {
    return value.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
}

function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
