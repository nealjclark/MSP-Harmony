import {
  defaultCommunicationSettings,
  defaultInvoiceFromEmail,
  defaultInvoiceNoticeTemplates,
  emailGraphClientSecretEnvVar,
  emailGraphClientSecretName,
  formatEmailList,
  isEmailDeliveryConfigured,
  normalizeEmailDeliveryTestResult,
  normalizeGraphClientId,
  normalizeGraphTenantId,
  normalizeInvoiceFromEmail,
  normalizeInvoiceNoticeTemplates,
  normalizeSendAsMailbox,
  validateEmailList,
  type CommunicationSettings,
  type EmailDeliveryTestResult,
  type InvoiceNoticeTemplates,
} from '../../shared/communicationSettings';
import {
  createDefaultSecretReader,
  type SecretReader,
} from './settingsProvider';
import {
  KeyVaultIntegrationSecretWriter,
  type IntegrationSecretWriter,
} from './settingsUpdater';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

type CommunicationSettingsRow = {
  id: string;
  invoice_from_email: string | null;
  invoice_bcc_emails: string;
  invoice_notice_templates: unknown;
  email_delivery_provider: string | null;
  graph_tenant_id: string | null;
  graph_client_id: string | null;
  send_as_mailbox: string | null;
  graph_client_secret_present: boolean | null;
  last_tested_at: Date | string | null;
  last_test_result: string | null;
  last_test_error: string | null;
  updated_at: Date | string | null;
  updated_by: string | null;
};

export type UpdateCommunicationSettingsInput = {
  invoiceFromEmail?: unknown;
  invoiceBccEmails?: unknown;
  invoiceNoticeTemplates?: unknown;
  graphTenantId?: unknown;
  graphClientId?: unknown;
  sendAsMailbox?: unknown;
  graphClientSecret?: unknown;
};

export type GraphEmailDeliveryCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sendAsMailbox: string;
};

const settingsColumns = `
  id,
  invoice_from_email,
  invoice_bcc_emails,
  invoice_notice_templates,
  email_delivery_provider,
  graph_tenant_id,
  graph_client_id,
  send_as_mailbox,
  graph_client_secret_present,
  last_tested_at,
  last_test_result,
  last_test_error,
  updated_at,
  updated_by
`;

export async function getCommunicationSettings(database: Queryable): Promise<CommunicationSettings> {
  await ensureDefaultCommunicationSettings(database);

  const result = await database.query<CommunicationSettingsRow>(
    `select ${settingsColumns}
     from communication_settings
     where id = 'default'
     limit 1`,
  );

  const row = result.rows[0];
  if (!row) {
    return { ...defaultCommunicationSettings };
  }

  return mapCommunicationSettingsRow(row);
}

export async function updateCommunicationSettings(
  database: Queryable,
  input: UpdateCommunicationSettingsInput,
  actor: string,
  options: {
    secretWriter?: IntegrationSecretWriter;
    secretReader?: SecretReader;
    keyVaultUrl?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<CommunicationSettings> {
  await ensureDefaultCommunicationSettings(database);

  const current = await getCommunicationSettings(database);
  const invoiceFromEmail =
    input.invoiceFromEmail === undefined
      ? current.invoiceFromEmail
      : normalizeInvoiceFromEmail(input.invoiceFromEmail);
  const invoiceBccEmails =
    input.invoiceBccEmails === undefined
      ? current.invoiceBccEmails
      : normalizeBccEmails(input.invoiceBccEmails);
  const invoiceNoticeTemplates =
    input.invoiceNoticeTemplates === undefined
      ? current.invoiceNoticeTemplates
      : normalizeInvoiceNoticeTemplates(input.invoiceNoticeTemplates);
  const graphTenantId =
    input.graphTenantId === undefined ? current.graphTenantId : normalizeGraphTenantId(input.graphTenantId);
  const graphClientId =
    input.graphClientId === undefined ? current.graphClientId : normalizeGraphClientId(input.graphClientId);
  const sendAsMailbox =
    input.sendAsMailbox === undefined
      ? current.sendAsMailbox || invoiceFromEmail
      : normalizeSendAsMailbox(input.sendAsMailbox, invoiceFromEmail);

  let graphClientSecretPresent = current.graphClientSecretPresent;
  const graphClientSecret = optionalSecretValue(input.graphClientSecret);
  if (graphClientSecret) {
    const secretWriter =
      options.secretWriter ??
      createSecretWriter(options.keyVaultUrl ?? process.env.KEY_VAULT_URL);
    await secretWriter.setSecret(emailGraphClientSecretName, graphClientSecret);
    graphClientSecretPresent = true;
  } else if (!graphClientSecretPresent) {
    const secretReader =
      options.secretReader ??
      createDefaultSecretReader(options.env ?? process.env, options.keyVaultUrl ?? process.env.KEY_VAULT_URL);
    const existingSecret = await secretReader.getSecret(emailGraphClientSecretName, emailGraphClientSecretEnvVar);
    graphClientSecretPresent = Boolean(existingSecret?.trim());
  }

  const result = await database.query<CommunicationSettingsRow>(
    `update communication_settings
     set invoice_from_email = $1,
         invoice_bcc_emails = $2,
         invoice_notice_templates = $3::jsonb,
         email_delivery_provider = 'microsoft-graph',
         graph_tenant_id = $4,
         graph_client_id = $5,
         send_as_mailbox = $6,
         graph_client_secret_present = $7,
         updated_at = now(),
         updated_by = $8
     where id = 'default'
     returning ${settingsColumns}`,
    [
      invoiceFromEmail,
      invoiceBccEmails,
      JSON.stringify(invoiceNoticeTemplates),
      graphTenantId,
      graphClientId,
      sendAsMailbox,
      graphClientSecretPresent,
      actor,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Communication settings were not found.');
  }

  return mapCommunicationSettingsRow(row);
}

export async function recordEmailDeliveryTestResult(
  database: Queryable,
  input: {
    result: EmailDeliveryTestResult;
    error?: string;
    actor: string;
  },
): Promise<CommunicationSettings> {
  await ensureDefaultCommunicationSettings(database);

  const result = await database.query<CommunicationSettingsRow>(
    `update communication_settings
     set last_tested_at = now(),
         last_test_result = $1,
         last_test_error = $2,
         updated_at = now(),
         updated_by = $3
     where id = 'default'
     returning ${settingsColumns}`,
    [input.result, input.error?.trim() || null, input.actor],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Communication settings were not found.');
  }

  return mapCommunicationSettingsRow(row);
}

export async function resolveGraphEmailDeliveryCredentials(
  database: Queryable,
  options: {
    secretReader?: SecretReader;
    keyVaultUrl?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<GraphEmailDeliveryCredentials> {
  const settings = await getCommunicationSettings(database);
  if (!settings.deliveryConfigured) {
    throw new Error(
      'Microsoft Graph email delivery is not configured. Add tenant ID, client ID, send-as mailbox, and client secret under Settings → Email Communication.',
    );
  }

  const secretReader =
    options.secretReader ??
    createDefaultSecretReader(options.env ?? process.env, options.keyVaultUrl ?? process.env.KEY_VAULT_URL);
  const clientSecret = await secretReader.getSecret(emailGraphClientSecretName, emailGraphClientSecretEnvVar);
  if (!clientSecret?.trim()) {
    throw new Error(
      'Microsoft Graph client secret is missing. Save a client secret under Settings → Email Communication.',
    );
  }

  return {
    tenantId: settings.graphTenantId,
    clientId: settings.graphClientId,
    clientSecret: clientSecret.trim(),
    sendAsMailbox: settings.sendAsMailbox || settings.invoiceFromEmail,
  };
}

export async function ensureDefaultCommunicationSettings(database: Queryable): Promise<void> {
  await database.query(
    `insert into communication_settings (id, invoice_from_email, invoice_bcc_emails, invoice_notice_templates, updated_by)
     values ('default', $1, '', $2::jsonb, 'system')
     on conflict (id) do nothing`,
    [defaultInvoiceFromEmail, JSON.stringify(defaultInvoiceNoticeTemplates)],
  );
}

function createSecretWriter(keyVaultUrl: string | undefined): IntegrationSecretWriter {
  if (!keyVaultUrl?.trim()) {
    throw new Error('KEY_VAULT_URL is not configured for email delivery secret updates.');
  }
  return new KeyVaultIntegrationSecretWriter(keyVaultUrl);
}

function optionalSecretValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('graphClientSecret must be a string.');
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBccEmails(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('invoiceBccEmails must be a string.');
  }

  const { emails, invalid } = validateEmailList(value);
  if (invalid.length > 0) {
    throw new Error(`Invalid BCC email address(es): ${invalid.join(', ')}`);
  }

  return formatEmailList(emails);
}

function mapCommunicationSettingsRow(row: CommunicationSettingsRow): CommunicationSettings {
  const fromEmail = row.invoice_from_email?.trim();
  const invoiceFromEmail = fromEmail && fromEmail.length > 0 ? fromEmail : defaultInvoiceFromEmail;
  const graphTenantId = row.graph_tenant_id?.trim() ?? '';
  const graphClientId = row.graph_client_id?.trim() ?? '';
  const sendAsMailboxRaw = row.send_as_mailbox?.trim();
  const sendAsMailbox =
    sendAsMailboxRaw && sendAsMailboxRaw.length > 0 ? sendAsMailboxRaw : invoiceFromEmail;
  const graphClientSecretPresent = Boolean(row.graph_client_secret_present);

  return {
    invoiceFromEmail,
    invoiceBccEmails: row.invoice_bcc_emails ?? '',
    invoiceNoticeTemplates: normalizeInvoiceNoticeTemplates(row.invoice_notice_templates) as InvoiceNoticeTemplates,
    emailDeliveryProvider: 'microsoft-graph',
    graphTenantId,
    graphClientId,
    sendAsMailbox,
    graphClientSecretPresent,
    deliveryConfigured: isEmailDeliveryConfigured({
      graphTenantId,
      graphClientId,
      sendAsMailbox,
      graphClientSecretPresent,
    }),
    lastTestedAt: row.last_tested_at ? isoDate(row.last_tested_at) : undefined,
    lastTestResult: normalizeEmailDeliveryTestResult(row.last_test_result),
    lastTestError: row.last_test_error ?? undefined,
    updatedAt: row.updated_at ? isoDate(row.updated_at) : undefined,
    updatedBy: row.updated_by ?? undefined,
  };
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}
