export type InvoiceNoticeType = 'past-due-reminder' | 'credit-hold' | 'service-suspension';

export type InvoiceNoticeTemplate = {
  subject: string;
  body: string;
};

export type InvoiceNoticeTemplates = Record<InvoiceNoticeType, InvoiceNoticeTemplate>;

export type CommunicationSettings = {
  invoiceBccEmails: string;
  invoiceNoticeTemplates: InvoiceNoticeTemplates;
  updatedAt?: string;
  updatedBy?: string;
};

export const invoiceNoticeTypes: InvoiceNoticeType[] = [
  'past-due-reminder',
  'credit-hold',
  'service-suspension',
];

export const invoiceNoticeTypeLabels: Record<InvoiceNoticeType, string> = {
  'past-due-reminder': 'Past Due Reminder',
  'credit-hold': 'Credit Hold',
  'service-suspension': 'Service Suspension',
};

export const invoiceNoticeTypePillLabels: Record<InvoiceNoticeType, string> = {
  'past-due-reminder': 'Reminder',
  'credit-hold': 'Credit Hold',
  'service-suspension': 'Suspension',
};

export const invoiceNoticeTypeRanges: Record<InvoiceNoticeType, string> = {
  'past-due-reminder': '1–30 days past due',
  'credit-hold': '31–60 days past due',
  'service-suspension': '61+ days past due',
};

export const defaultInvoiceNoticeTemplates: InvoiceNoticeTemplates = {
  'past-due-reminder': {
    subject: 'Past due reminder for {company}',
    body: [
      'Hello {recipientName},',
      '',
      'This is a friendly reminder that {company} has past-due invoices totaling {totalBalance}.',
      'Please review the invoices below and submit payment at your earliest convenience.',
    ].join('\n'),
  },
  'credit-hold': {
    subject: 'Credit hold notice for {company}',
    body: [
      'Hello {recipientName},',
      '',
      'This is a credit hold notice for {company}. The past-due balance is {totalBalance}.',
      'If payment is not received promptly, the account may be placed on credit hold.',
      'Please review the invoices below and contact billing if you have questions.',
    ].join('\n'),
  },
  'service-suspension': {
    subject: 'Service suspension notice for {company}',
    body: [
      'Hello {recipientName},',
      '',
      'This is a service suspension notice for {company}. The past-due balance is {totalBalance}.',
      'If payment is not received promptly, services may be suspended.',
      'Please review the invoices below and contact billing immediately to avoid interruption.',
    ].join('\n'),
  },
};

export const defaultCommunicationSettings: CommunicationSettings = {
  invoiceBccEmails: '',
  invoiceNoticeTemplates: defaultInvoiceNoticeTemplates,
};

export function isInvoiceNoticeType(value: unknown): value is InvoiceNoticeType {
  return (
    value === 'past-due-reminder' ||
    value === 'credit-hold' ||
    value === 'service-suspension'
  );
}

export function noticeTypeForDaysPastDue(daysPastDue: number): InvoiceNoticeType {
  if (daysPastDue >= 61) {
    return 'service-suspension';
  }
  if (daysPastDue >= 31) {
    return 'credit-hold';
  }
  return 'past-due-reminder';
}

/** Maps current and legacy notice-type values onto the 3 production buckets. */
export function normalizeInvoiceNoticeType(
  value: unknown,
  daysPastDue?: number,
): InvoiceNoticeType {
  if (isInvoiceNoticeType(value)) {
    return value;
  }

  if (value === 'reminder' || value === '30-day-notice') {
    return 'past-due-reminder';
  }
  if (value === '60-day-credit-hold') {
    return 'credit-hold';
  }
  if (value === '90-day-cancel-services') {
    return 'service-suspension';
  }

  if (typeof daysPastDue === 'number' && Number.isFinite(daysPastDue)) {
    return noticeTypeForDaysPastDue(daysPastDue);
  }

  return 'past-due-reminder';
}

export function parseEmailList(value: string | undefined | null): string[] {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of value.split(/[;,]/)) {
    const email = part.trim();
    if (!email) {
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

export function formatEmailList(emails: string[]): string {
  return emails.join(', ');
}

export function validateEmailList(value: string): { emails: string[]; invalid: string[] } {
  const emails = parseEmailList(value);
  const invalid = emails.filter((email) => !isValidEmail(email));
  return { emails, invalid };
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function renderTemplate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

export function normalizeInvoiceNoticeTemplates(value: unknown): InvoiceNoticeTemplates {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const templates = { ...defaultInvoiceNoticeTemplates };

  for (const noticeType of invoiceNoticeTypes) {
    const entry = record[noticeType];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const subject = textValue((entry as Record<string, unknown>).subject);
    const body = textValue((entry as Record<string, unknown>).body);
    templates[noticeType] = {
      subject: subject || defaultInvoiceNoticeTemplates[noticeType].subject,
      body: body || defaultInvoiceNoticeTemplates[noticeType].body,
    };
  }

  return templates;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}
