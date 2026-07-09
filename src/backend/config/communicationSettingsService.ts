import {
  defaultCommunicationSettings,
  defaultInvoiceFromEmail,
  defaultInvoiceNoticeTemplates,
  formatEmailList,
  normalizeInvoiceFromEmail,
  normalizeInvoiceNoticeTemplates,
  validateEmailList,
  type CommunicationSettings,
  type InvoiceNoticeTemplates,
} from '../../shared/communicationSettings';

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
  updated_at: Date | string | null;
  updated_by: string | null;
};

export type UpdateCommunicationSettingsInput = {
  invoiceFromEmail?: unknown;
  invoiceBccEmails?: unknown;
  invoiceNoticeTemplates?: unknown;
};

const settingsColumns = `
  id,
  invoice_from_email,
  invoice_bcc_emails,
  invoice_notice_templates,
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

  const result = await database.query<CommunicationSettingsRow>(
    `update communication_settings
     set invoice_from_email = $1,
         invoice_bcc_emails = $2,
         invoice_notice_templates = $3::jsonb,
         updated_at = now(),
         updated_by = $4
     where id = 'default'
     returning ${settingsColumns}`,
    [invoiceFromEmail, invoiceBccEmails, JSON.stringify(invoiceNoticeTemplates), actor],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Communication settings were not found.');
  }

  return mapCommunicationSettingsRow(row);
}

export async function ensureDefaultCommunicationSettings(database: Queryable): Promise<void> {
  await database.query(
    `insert into communication_settings (id, invoice_from_email, invoice_bcc_emails, invoice_notice_templates, updated_by)
     values ('default', $1, '', $2::jsonb, 'system')
     on conflict (id) do nothing`,
    [defaultInvoiceFromEmail, JSON.stringify(defaultInvoiceNoticeTemplates)],
  );
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
  return {
    invoiceFromEmail: fromEmail && fromEmail.length > 0 ? fromEmail : defaultInvoiceFromEmail,
    invoiceBccEmails: row.invoice_bcc_emails ?? '',
    invoiceNoticeTemplates: normalizeInvoiceNoticeTemplates(row.invoice_notice_templates) as InvoiceNoticeTemplates,
    updatedAt: row.updated_at ? isoDate(row.updated_at) : undefined,
    updatedBy: row.updated_by ?? undefined,
  };
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}
