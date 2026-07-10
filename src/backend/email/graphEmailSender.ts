export type GraphEmailRecipient = {
  address: string;
  name?: string;
};

export type GraphEmailMessage = {
  subject: string;
  body: string;
  bodyContentType?: 'Text' | 'HTML';
  to: GraphEmailRecipient[];
  cc?: GraphEmailRecipient[];
  bcc?: GraphEmailRecipient[];
  saveToSentItems?: boolean;
};

export type GraphEmailCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sendAsMailbox: string;
};

export type GraphEmailSendResult = {
  sendAsMailbox: string;
  recipientCount: number;
};

type GraphTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const authorityHost = 'https://login.microsoftonline.com';
const graphBaseUrl = 'https://graph.microsoft.com';

export class GraphEmailError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'GraphEmailError';
  }
}

export async function sendGraphEmail(
  credentials: GraphEmailCredentials,
  message: GraphEmailMessage,
): Promise<GraphEmailSendResult> {
  const to = normalizeRecipients(message.to, 'to');
  if (to.length === 0) {
    throw new GraphEmailError('At least one To recipient is required.');
  }

  const sendAsMailbox = credentials.sendAsMailbox.trim();
  if (!sendAsMailbox) {
    throw new GraphEmailError('Send-as mailbox is required.');
  }

  const accessToken = await acquireGraphAccessToken(credentials);
  const payload = {
    message: {
      subject: message.subject,
      body: {
        contentType: message.bodyContentType ?? 'Text',
        content: message.body,
      },
      toRecipients: to.map(toGraphRecipient),
      ccRecipients: normalizeRecipients(message.cc ?? [], 'cc').map(toGraphRecipient),
      bccRecipients: normalizeRecipients(message.bcc ?? [], 'bcc').map(toGraphRecipient),
    },
    saveToSentItems: message.saveToSentItems ?? true,
  };

  const response = await fetch(
    `${graphBaseUrl}/v1.0/users/${encodeURIComponent(sendAsMailbox)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new GraphEmailError(
      parseGraphErrorMessage(responseText, response.status),
      response.status,
      responseText.slice(0, 500),
    );
  }

  return {
    sendAsMailbox,
    recipientCount: to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0),
  };
}

export async function acquireGraphAccessToken(credentials: GraphEmailCredentials): Promise<string> {
  const tenantId = credentials.tenantId.trim();
  const clientId = credentials.clientId.trim();
  const clientSecret = credentials.clientSecret.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphEmailError('Microsoft Graph tenant ID, client ID, and client secret are required.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: `${graphBaseUrl}/.default`,
  });

  const response = await fetch(`${authorityHost}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const responseText = await response.text();
  const parsed = parseJson<GraphTokenResponse>(responseText);

  if (!response.ok || !parsed?.access_token) {
    throw new GraphEmailError(
      parsed?.error_description ?? parsed?.error ?? `Microsoft Graph token request failed with HTTP ${response.status}.`,
      response.status,
      responseText.slice(0, 500),
    );
  }

  return parsed.access_token;
}

function normalizeRecipients(recipients: GraphEmailRecipient[], field: string): GraphEmailRecipient[] {
  const seen = new Set<string>();
  const normalized: GraphEmailRecipient[] = [];

  for (const recipient of recipients) {
    const address = recipient.address?.trim();
    if (!address) {
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new GraphEmailError(`Invalid ${field} email address: ${address}`);
    }
    const key = address.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      address,
      name: recipient.name?.trim() || undefined,
    });
  }

  return normalized;
}

function toGraphRecipient(recipient: GraphEmailRecipient) {
  return {
    emailAddress: {
      address: recipient.address,
      ...(recipient.name ? { name: recipient.name } : {}),
    },
  };
}

function parseGraphErrorMessage(responseText: string, status: number): string {
  const parsed = parseJson<{ error?: { message?: string; code?: string } }>(responseText);
  return (
    parsed?.error?.message ??
    parsed?.error?.code ??
    `Microsoft Graph sendMail failed with HTTP ${status}.`
  );
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
