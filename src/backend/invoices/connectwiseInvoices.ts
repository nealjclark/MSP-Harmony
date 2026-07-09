import {
  createIntegrationSettingsProvider,
  type IntegrationSettingsProvider,
} from '../config/settingsProvider';
import {
  getCommunicationSettings,
  type Queryable as CommunicationQueryable,
} from '../config/communicationSettingsService';
import {
  ConnectWiseClient,
  connectWiseCredentialsFromSettings,
  type ConnectWiseAgreement,
  type ConnectWiseCompany,
  type ConnectWiseContact,
  type ConnectWiseInvoice,
  type ConnectWiseInvoiceEmailTemplate,
  type ConnectWiseListOptions,
} from '../connectwise/client';
import {
  defaultCommunicationSettings,
  isInvoiceNoticeType,
  noticeTypeForDaysPastDue as sharedNoticeTypeForDaysPastDue,
  parseEmailList,
  renderTemplate,
  type CommunicationSettings,
  type InvoiceNoticeType,
} from '../../shared/communicationSettings';

export type { InvoiceNoticeType } from '../../shared/communicationSettings';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type OverdueInvoiceBucketId = '7-29-days' | '30-59-days' | '60-plus-days';

export type OverdueInvoice = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceType: string;
  invoiceStatus: string;
  invoiceStatusClosed: boolean;
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  agreement?: {
    id?: string;
    name?: string;
    type?: string;
  };
  applyToType?: string;
  applyToId?: string;
  invoiceDate?: string;
  dueDate?: string;
  daysPastDue: number;
  total: number;
  balance: number;
  billingTerms?: string;
  emailTemplateId?: number;
  emailTemplateName?: string;
  bucketId: OverdueInvoiceBucketId;
  lastNotice?: InvoiceNotificationAuditSummary;
};

export type OverdueInvoiceBucket = {
  id: OverdueInvoiceBucketId;
  label: string;
  noticeType: InvoiceNoticeType;
  invoices: OverdueInvoice[];
  invoiceCount: number;
  balanceTotal: number;
};

export type OverdueInvoiceCustomerGroup = {
  customerKey: string;
  company: OverdueInvoice['company'];
  invoices: OverdueInvoice[];
  invoiceCount: number;
  balanceTotal: number;
  oldestDaysPastDue: number;
  noticeType: InvoiceNoticeType;
  bucketCounts: Record<OverdueInvoiceBucketId, number>;
  lastNotice?: InvoiceNotificationAuditSummary;
};

export type OverdueInvoicesResponse = {
  generatedAt: string;
  summary: {
    reviewQueueCount: number;
    reviewQueueBalance: number;
    customerCount: number;
    totalOpenBalanceCount: number;
    totalOpenBalanceAmount: number;
  };
  buckets: OverdueInvoiceBucket[];
  customerGroups: OverdueInvoiceCustomerGroup[];
};

export type AgreementInvoiceReference = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  total: number;
  balance: number;
  emailTemplateId?: number;
  invoiceType: string;
};

export type MonthlyInvoiceCandidate = {
  agreementId: string;
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  agreementName: string;
  agreementType?: string;
  billAmount: number;
  billingTerms?: string;
  nextInvoiceDate?: string;
  invoiceTemplateName?: string;
  lastInvoice?: AgreementInvoiceReference;
  missingFields: string[];
};

export type MonthlyInvoiceCandidatesResponse = {
  generatedAt: string;
  agreementCount: number;
  candidates: MonthlyInvoiceCandidate[];
};

export type MonthlyInvoicePreview = {
  generatedAt: string;
  previewMode: 'stub';
  candidate: MonthlyInvoiceCandidate;
  payload: {
    invoiceType: 'Agreement';
    applyToType: 'Agreement';
    applyToId: string;
    companyName: string;
    agreementName: string;
    nextInvoiceDate?: string;
    billingTerms?: string;
    billAmount: number;
    invoiceTemplateName?: string;
  };
  warnings: string[];
};

export type StandardInvoiceCandidate = {
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  latestInvoice?: AgreementInvoiceReference;
  invoiceTypes: string[];
  openInvoiceCount: number;
  openBalanceAmount: number;
  overdueInvoiceCount: number;
};

export type StandardInvoiceCandidatesResponse = {
  generatedAt: string;
  candidateCount: number;
  candidates: StandardInvoiceCandidate[];
};

export type InvoiceNotificationPreview = {
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceIds: string[];
  invoiceCount: number;
  invoices: InvoiceNotificationPreviewInvoice[];
  companyKey?: string;
  companyName: string;
  recipientName: string;
  recipientEmail?: string;
  ccEmails: string[];
  bccEmails: string[];
  notes?: string;
  billingContact?: InvoiceBillingContact;
  agreementName?: string;
  noticeType: InvoiceNoticeType;
  daysPastDue: number;
  dueDate?: string;
  balance: number;
  totalBalance: number;
  emailTemplateId?: number;
  emailTemplateName?: string;
  emailTemplateNames: string[];
  paymentLink?: string;
  subject: string;
  bodyPreview: string;
  templateBody: string;
};

export type InvoiceBillingContact = {
  id: string;
  name: string;
  email?: string;
};

export type InvoiceNotificationPreviewInvoice = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  daysPastDue: number;
  balance: number;
  total: number;
  invoiceType: string;
  invoiceStatus?: string;
  agreementName?: string;
  paymentLink?: string;
};

export type WisePayPaymentLinkConfig = {
  apiKey?: string;
  endpoint?: string;
};

export type InvoiceNotificationAuditSummary = {
  noticeType: InvoiceNoticeType;
  actor: string;
  occurredAt: string;
  subject: string;
  bodyPreview: string;
};

export type InvoiceNotificationAuditResult = {
  status: 'preview' | 'stubbed' | 'test-stubbed';
  generatedAt: string;
  preview: InvoiceNotificationPreview;
  audit?: InvoiceNotificationAuditSummary;
};

export type ConnectWiseInvoiceReader = {
  listAgreements: (options?: ConnectWiseListOptions) => Promise<ConnectWiseAgreement[]>;
  getAgreement: (agreementId: string | number) => Promise<ConnectWiseAgreement>;
  getCompany?: (companyId: string | number) => Promise<ConnectWiseCompany>;
  listContacts: (options?: ConnectWiseListOptions) => Promise<ConnectWiseContact[]>;
  listInvoices: (options?: ConnectWiseListOptions) => Promise<ConnectWiseInvoice[]>;
  getInvoice: (invoiceId: string | number) => Promise<ConnectWiseInvoice>;
  getInvoiceEmailTemplate: (templateId: string | number) => Promise<ConnectWiseInvoiceEmailTemplate>;
};

type AuditNoticeRow = {
  entity_id: string;
  actor: string;
  occurred_at: Date | string;
  payload: unknown;
};

const overdueBucketLabels: Record<OverdueInvoiceBucketId, string> = {
  '7-29-days': '7 - 29 days overdue',
  '30-59-days': '30 - 59 days overdue',
  '60-plus-days': '60+ days overdue',
};

const wisePayDefaultEndpoint = 'https://secure2.wise-sync.com';

export async function listConnectWiseOverdueInvoices(input: {
  database?: Queryable;
  provider?: IntegrationSettingsProvider;
  today?: string;
} = {}): Promise<OverdueInvoicesResponse> {
  const client = await connectWiseInvoiceClient(input.provider);
  return loadConnectWiseOverdueInvoices(client, input.database, input.today);
}

export async function listConnectWiseMonthlyInvoiceCandidates(input: {
  provider?: IntegrationSettingsProvider;
  today?: string;
} = {}): Promise<MonthlyInvoiceCandidatesResponse> {
  const client = await connectWiseInvoiceClient(input.provider);
  return loadConnectWiseMonthlyInvoiceCandidates(client, input.today);
}

export async function previewConnectWiseMonthlyInvoice(input: {
  agreementId: string;
  provider?: IntegrationSettingsProvider;
  today?: string;
}): Promise<MonthlyInvoicePreview> {
  const client = await connectWiseInvoiceClient(input.provider);
  return buildConnectWiseMonthlyInvoicePreview(client, input.agreementId, input.today);
}

export async function listConnectWiseStandardInvoiceCandidates(input: {
  provider?: IntegrationSettingsProvider;
  today?: string;
} = {}): Promise<StandardInvoiceCandidatesResponse> {
  const client = await connectWiseInvoiceClient(input.provider);
  return loadConnectWiseStandardInvoiceCandidates(client, input.today);
}

export async function previewOrStubInvoiceNotice(input: {
  actor: string;
  database?: Queryable;
  invoiceId?: string;
  invoiceIds?: string[];
  companyKey?: string;
  noticeType: InvoiceNoticeType;
  confirm?: boolean;
  testMode?: boolean;
  testRecipientEmail?: string;
  notes?: string;
  provider?: IntegrationSettingsProvider;
  today?: string;
}): Promise<InvoiceNotificationAuditResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const client = await connectWiseInvoiceClient(provider);
  const paymentLinkConfig = await loadWisePayPaymentLinkConfig(provider);
  return previewOrStubConnectWiseInvoiceNotice(client, {
    ...input,
    paymentLinkConfig,
  });
}

export async function loadConnectWiseOverdueInvoices(
  client: ConnectWiseInvoiceReader,
  database?: Queryable,
  today = currentDateKey(),
): Promise<OverdueInvoicesResponse> {
  const generatedAt = new Date().toISOString();
  const openInvoices = await listAllPages(
    (page) =>
      client.listInvoices({
        page,
        pageSize: 100,
        orderBy: 'dueDate asc',
        conditions: 'balance>0',
      }),
    20,
  );

  const invoices = openInvoices
    .map((invoice) => normalizeOverdueInvoice(invoice, today))
    .filter((invoice): invoice is OverdueInvoice => invoice !== null);
  const templateNames = await resolveInvoiceTemplateNames(client, invoices.map((invoice) => invoice.emailTemplateId));
  const latestNotices = database ? await loadLatestNoticeAudits(database, invoices.map((invoice) => invoice.invoiceId)) : new Map();

  const hydratedInvoices = invoices.map((invoice) => ({
    ...invoice,
    emailTemplateName: invoice.emailTemplateId ? templateNames.get(invoice.emailTemplateId) : undefined,
    lastNotice: latestNotices.get(invoice.invoiceId),
  }));
  const customerGroups = groupOverdueInvoicesByCustomer(hydratedInvoices);

  const bucketOrder: OverdueInvoiceBucketId[] = ['7-29-days', '30-59-days', '60-plus-days'];
  const bucketNoticeType: Record<OverdueInvoiceBucketId, InvoiceNoticeType> = {
    '7-29-days': 'past-due-reminder',
    '30-59-days': 'credit-hold',
    '60-plus-days': 'service-suspension',
  };

  const buckets = bucketOrder.map((bucketId) => {
    const bucketInvoices = hydratedInvoices.filter((invoice) => invoice.bucketId === bucketId);
    return {
      id: bucketId,
      label: overdueBucketLabels[bucketId],
      noticeType: bucketNoticeType[bucketId],
      invoices: bucketInvoices,
      invoiceCount: bucketInvoices.length,
      balanceTotal: sumNumbers(bucketInvoices.map((invoice) => invoice.balance)),
    } satisfies OverdueInvoiceBucket;
  });

  return {
    generatedAt,
    summary: {
      reviewQueueCount: hydratedInvoices.length,
      reviewQueueBalance: sumNumbers(hydratedInvoices.map((invoice) => invoice.balance)),
      customerCount: customerGroups.length,
      totalOpenBalanceCount: openInvoices.filter((invoice) => numberValue(invoice.balance) > 0).length,
      totalOpenBalanceAmount: sumNumbers(openInvoices.map((invoice) => numberValue(invoice.balance))),
    },
    buckets,
    customerGroups,
  };
}

export async function loadConnectWiseMonthlyInvoiceCandidates(
  client: ConnectWiseInvoiceReader,
  _today = currentDateKey(),
): Promise<MonthlyInvoiceCandidatesResponse> {
  const generatedAt = new Date().toISOString();
  const agreements = await listAllPages(
    (page) =>
      client.listAgreements({
        page,
        pageSize: 100,
        orderBy: 'nextInvoiceDate asc',
        conditions: 'agreementStatus="Active" and billingCycle/name="Monthly"',
      }),
    20,
  );
  const targetAgreementIds = new Set(agreements.map((agreement) => String(agreement.id)));
  const latestInvoiceByAgreement = await loadLatestAgreementInvoices(client, targetAgreementIds, 20);
  const candidates = agreements
    .map((agreement) => normalizeMonthlyCandidate(agreement, latestInvoiceByAgreement.get(String(agreement.id))))
    .sort((left, right) => compareCustomerNames(left.company.name, right.company.name));

  return {
    generatedAt,
    agreementCount: candidates.length,
    candidates,
  };
}

export async function buildConnectWiseMonthlyInvoicePreview(
  client: ConnectWiseInvoiceReader,
  agreementId: string,
  _today = currentDateKey(),
): Promise<MonthlyInvoicePreview> {
  const agreement = await client.getAgreement(agreementId);
  const latestInvoice = await latestAgreementInvoice(client, String(agreement.id));
  const candidate = normalizeMonthlyCandidate(agreement, latestInvoice ?? undefined);
  const warnings = [...candidate.missingFields];

  return {
    generatedAt: new Date().toISOString(),
    previewMode: 'stub',
    candidate,
    payload: {
      invoiceType: 'Agreement',
      applyToType: 'Agreement',
      applyToId: String(agreement.id),
      companyName: companyName(agreement.company?.name, agreement.name),
      agreementName: agreement.name,
      nextInvoiceDate: stringField(agreement, 'nextInvoiceDate'),
      billingTerms: agreement.billingTerms?.name,
      billAmount: numberField(agreement, 'billAmount'),
      invoiceTemplateName: agreement.invoiceTemplate?.name,
    },
    warnings,
  };
}

export async function loadConnectWiseStandardInvoiceCandidates(
  client: ConnectWiseInvoiceReader,
  today = currentDateKey(),
): Promise<StandardInvoiceCandidatesResponse> {
  const invoices = await listAllPages(
    (page) =>
      client.listInvoices({
        page,
        pageSize: 100,
        orderBy: 'id desc',
      }),
    10,
  );

  const grouped = new Map<string, StandardInvoiceCandidate>();

  for (const invoice of invoices) {
    if (isAgreementInvoice(invoice)) {
      continue;
    }

    const companyId = String(invoice.company?.id ?? invoice.billToCompany?.id ?? invoice.id);
    const key = `${companyId}|${companyName(invoice.company?.name ?? invoice.billToCompany?.name, 'Unknown company')}`;
    const existing =
      grouped.get(key) ??
      ({
        company: {
          id: invoice.company?.id ? String(invoice.company.id) : invoice.billToCompany?.id ? String(invoice.billToCompany.id) : undefined,
          identifier: invoice.company?.identifier ?? invoice.billToCompany?.identifier,
          name: companyName(invoice.company?.name ?? invoice.billToCompany?.name, 'Unknown company'),
        },
        latestInvoice: undefined,
        invoiceTypes: [],
        openInvoiceCount: 0,
        openBalanceAmount: 0,
        overdueInvoiceCount: 0,
      } satisfies StandardInvoiceCandidate);

    if (!existing.latestInvoice || Number(invoice.id) > Number(existing.latestInvoice.invoiceId)) {
      existing.latestInvoice = invoiceReferenceFromInvoice(invoice);
    }
    if (invoice.type && !existing.invoiceTypes.includes(invoice.type)) {
      existing.invoiceTypes.push(invoice.type);
    }
    const balance = numberValue(invoice.balance);
    if (balance > 0) {
      existing.openInvoiceCount += 1;
      existing.openBalanceAmount += balance;
      const daysPastDue = daysPastDueFromDate(invoice.dueDate, today);
      if (daysPastDue >= 7) {
        existing.overdueInvoiceCount += 1;
      }
    }

    grouped.set(key, existing);
  }

  const candidates = [...grouped.values()].sort((left, right) => compareCustomerNames(left.company.name, right.company.name));

  return {
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
}

export async function previewOrStubConnectWiseInvoiceNotice(
  client: ConnectWiseInvoiceReader,
  input: {
    actor: string;
    database?: Queryable;
    invoiceId?: string;
    invoiceIds?: string[];
    companyKey?: string;
    noticeType: InvoiceNoticeType;
    confirm?: boolean;
    testMode?: boolean;
    testRecipientEmail?: string;
    notes?: string;
    today?: string;
    paymentLinkConfig?: WisePayPaymentLinkConfig;
    communicationSettings?: CommunicationSettings;
  },
): Promise<InvoiceNotificationAuditResult> {
  const today = input.today ?? currentDateKey();
  const invoiceIds = uniqueStrings([input.invoiceId, ...(input.invoiceIds ?? [])]);
  if (invoiceIds.length === 0) {
    throw new Error('Invoice notification preview requires at least one invoice.');
  }

  const invoices = await Promise.all(invoiceIds.map((invoiceId) => client.getInvoice(invoiceId)));
  assertSingleNotificationCustomer(invoices, input.companyKey);
  const templateNames = await resolveInvoiceTemplateNames(client, invoices.map((invoice) => invoice.emailTemplateId));
  const billingContact = await resolveDefaultBillingContact(client, invoices);
  const ccEmails = await resolveBillToCcEmails(client, invoices);
  const communicationSettings =
    input.communicationSettings ??
    (input.database
      ? await getCommunicationSettings(input.database as CommunicationQueryable)
      : defaultCommunicationSettings);
  const bccEmails = parseEmailList(communicationSettings.invoiceBccEmails);
  const notes = textValue(input.notes);
  const testMode = Boolean(input.testMode);
  const testRecipientEmail = textValue(input.testRecipientEmail);

  if (testMode && input.confirm && !testRecipientEmail) {
    throw new Error('Test email requires a recipient address.');
  }

  let preview = buildInvoiceNotificationPreview(
    invoices,
    input.noticeType,
    templateNames,
    today,
    input.paymentLinkConfig,
    billingContact,
    ccEmails,
    bccEmails,
    communicationSettings,
    notes,
  );

  if (testMode) {
    preview = {
      ...preview,
      recipientName: testRecipientEmail ?? preview.recipientName,
      recipientEmail: testRecipientEmail,
      ccEmails: [],
      bccEmails: [],
    };
  }

  if (!input.confirm) {
    return {
      status: 'preview',
      generatedAt: new Date().toISOString(),
      preview,
    };
  }

  if (!input.database) {
    throw new Error('Invoice notification stubs need PostgreSQL settings before audit history can be saved.');
  }

  const occurredAt = new Date().toISOString();
  const eventType = testMode ? 'connectwise.invoice.notice.test-stubbed' : 'connectwise.invoice.notice.stubbed';
  for (const invoice of invoices) {
    const previewInvoice = preview.invoices.find((item) => item.invoiceId === String(invoice.id));
    await input.database.query(
      `insert into audit_events (actor, event_type, entity_type, entity_id, occurred_at, payload)
       values ($1, $2, 'connectwise_invoice', $3, $4::timestamptz, $5::jsonb)`,
      [
        input.actor,
        eventType,
        String(invoice.id),
        occurredAt,
        JSON.stringify({
          invoiceId: String(invoice.id),
          invoiceNumber: invoice.invoiceNumber,
          invoiceIds: preview.invoiceIds,
          noticeType: input.noticeType,
          subject: preview.subject,
          bodyPreview: preview.bodyPreview,
          companyKey: preview.companyKey,
          companyName: preview.companyName,
          recipientName: preview.recipientName,
          recipientEmail: preview.recipientEmail,
          ccEmails: preview.ccEmails,
          bccEmails: preview.bccEmails,
          notes: preview.notes,
          testMode,
          billingContact: preview.billingContact,
          agreementName: previewInvoice?.agreementName,
          dueDate: previewInvoice?.dueDate,
          daysPastDue: previewInvoice?.daysPastDue ?? preview.daysPastDue,
          balance: previewInvoice?.balance ?? numberValue(invoice.balance),
          totalBalance: preview.totalBalance,
          paymentLink: previewInvoice?.paymentLink,
        }),
      ],
    );
  }

  return {
    status: testMode ? 'test-stubbed' : 'stubbed',
    generatedAt: occurredAt,
    preview,
    audit: {
      noticeType: input.noticeType,
      actor: input.actor,
      occurredAt,
      subject: preview.subject,
      bodyPreview: preview.bodyPreview,
    },
  };
}

async function connectWiseInvoiceClient(provider?: IntegrationSettingsProvider) {
  const settingsProvider = provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await settingsProvider.getIntegrationSettings('connectwise');
  return new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
}

async function loadWisePayPaymentLinkConfig(provider: IntegrationSettingsProvider): Promise<WisePayPaymentLinkConfig | undefined> {
  try {
    const settings = await provider.getIntegrationSettings('wisepay');
    return {
      apiKey: settings.secrets.apiKey,
      endpoint: settings.nonSecrets.endpoint ?? wisePayDefaultEndpoint,
    };
  } catch {
    return undefined;
  }
}

async function loadLatestAgreementInvoices(
  client: ConnectWiseInvoiceReader,
  agreementIds: Set<string>,
  maxPages: number,
) {
  const latestByAgreement = new Map<string, AgreementInvoiceReference>();

  for (let page = 1; page <= maxPages; page += 1) {
    const invoices = await client.listInvoices({
      page,
      pageSize: 100,
      orderBy: 'id desc',
      conditions: 'applyToType="Agreement"',
    });
    if (invoices.length === 0) {
      break;
    }

    for (const invoice of invoices) {
      const applyToId = invoice.applyToId ? String(invoice.applyToId) : undefined;
      if (!applyToId || !agreementIds.has(applyToId) || latestByAgreement.has(applyToId)) {
        continue;
      }
      latestByAgreement.set(applyToId, invoiceReferenceFromInvoice(invoice));
    }

    if (latestByAgreement.size >= agreementIds.size) {
      break;
    }
  }

  return latestByAgreement;
}

async function latestAgreementInvoice(client: ConnectWiseInvoiceReader, agreementId: string) {
  const invoices = await client.listInvoices({
    page: 1,
    pageSize: 1,
    orderBy: 'id desc',
    conditions: `applyToType="Agreement" and applyToId=${agreementId}`,
  });
  const invoice = invoices[0];
  return invoice ? invoiceReferenceFromInvoice(invoice) : null;
}

function normalizeOverdueInvoice(invoice: ConnectWiseInvoice, today: string): OverdueInvoice | null {
  const balance = numberValue(invoice.balance);
  if (balance <= 0) {
    return null;
  }

  const daysPastDue = daysPastDueFromDate(invoice.dueDate, today);
  if (daysPastDue < 7) {
    return null;
  }

  return {
    invoiceId: String(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.type ?? 'Unknown',
    invoiceStatus: invoice.status?.name ?? 'Unknown',
    invoiceStatusClosed: Boolean(invoice.status?.isClosed),
    company: {
      id: invoice.company?.id ? String(invoice.company.id) : invoice.billToCompany?.id ? String(invoice.billToCompany.id) : undefined,
      identifier: invoice.company?.identifier ?? invoice.billToCompany?.identifier,
      name: companyName(invoice.company?.name ?? invoice.billToCompany?.name, 'Unknown company'),
    },
    agreement: invoice.agreement
      ? {
          id: invoice.agreement.id ? String(invoice.agreement.id) : invoice.applyToId ? String(invoice.applyToId) : undefined,
          name: invoice.agreement.name,
          type: invoice.agreement.type,
        }
      : undefined,
    applyToType: invoice.applyToType,
    applyToId: invoice.applyToId ? String(invoice.applyToId) : undefined,
    invoiceDate: dateOnly(invoice.date),
    dueDate: dateOnly(invoice.dueDate),
    daysPastDue,
    total: numberValue(invoice.total),
    balance,
    billingTerms: invoice.billingTerms?.name,
    emailTemplateId: invoice.emailTemplateId,
    bucketId: overdueBucketIdForDaysPastDue(daysPastDue),
  };
}

function groupOverdueInvoicesByCustomer(invoices: OverdueInvoice[]): OverdueInvoiceCustomerGroup[] {
  const groups = new Map<string, OverdueInvoiceCustomerGroup>();

  for (const invoice of invoices) {
    const customerKey = customerKeyFromCompany(invoice.company);
    const existing =
      groups.get(customerKey) ??
      ({
        customerKey,
        company: invoice.company,
        invoices: [],
        invoiceCount: 0,
        balanceTotal: 0,
        oldestDaysPastDue: 0,
        noticeType: 'past-due-reminder',
        bucketCounts: {
          '7-29-days': 0,
          '30-59-days': 0,
          '60-plus-days': 0,
        },
      } satisfies OverdueInvoiceCustomerGroup);

    existing.invoices.push(invoice);
    existing.invoiceCount += 1;
    existing.balanceTotal += invoice.balance;
    existing.oldestDaysPastDue = Math.max(existing.oldestDaysPastDue, invoice.daysPastDue);
    existing.noticeType = noticeTypeForDaysPastDue(existing.oldestDaysPastDue);
    existing.bucketCounts[invoice.bucketId] += 1;

    if (
      invoice.lastNotice &&
      (!existing.lastNotice || new Date(invoice.lastNotice.occurredAt).getTime() > new Date(existing.lastNotice.occurredAt).getTime())
    ) {
      existing.lastNotice = invoice.lastNotice;
    }

    groups.set(customerKey, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      invoices: [...group.invoices].sort(
        (left, right) => right.daysPastDue - left.daysPastDue || String(left.dueDate ?? '').localeCompare(String(right.dueDate ?? '')),
      ),
      balanceTotal: roundMoney(group.balanceTotal),
    }))
    .sort(
      (left, right) =>
        right.balanceTotal - left.balanceTotal ||
        right.oldestDaysPastDue - left.oldestDaysPastDue ||
        compareCustomerNames(left.company.name, right.company.name),
    );
}

function normalizeMonthlyCandidate(
  agreement: ConnectWiseAgreement,
  lastInvoice?: AgreementInvoiceReference,
): MonthlyInvoiceCandidate {
  const missingFields: string[] = [];
  const company = {
    id: agreement.company?.id ? String(agreement.company.id) : undefined,
    identifier: agreement.company?.identifier,
    name: companyName(agreement.company?.name, agreement.name),
  };
  const nextInvoiceDate = stringField(agreement, 'nextInvoiceDate');
  if (!nextInvoiceDate) {
    missingFields.push('nextInvoiceDate');
  }

  return {
    agreementId: String(agreement.id),
    company,
    agreementName: agreement.name,
    agreementType: agreement.type?.name,
    billAmount: numberField(agreement, 'billAmount'),
    billingTerms: agreement.billingTerms?.name,
    nextInvoiceDate: dateOnly(nextInvoiceDate),
    invoiceTemplateName: agreement.invoiceTemplate?.name,
    lastInvoice,
    missingFields,
  };
}

function invoiceReferenceFromInvoice(invoice: ConnectWiseInvoice): AgreementInvoiceReference {
  return {
    invoiceId: String(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: dateOnly(invoice.date),
    dueDate: dateOnly(invoice.dueDate),
    total: numberValue(invoice.total),
    balance: numberValue(invoice.balance),
    emailTemplateId: invoice.emailTemplateId,
    invoiceType: invoice.type ?? 'Unknown',
  };
}

function isAgreementInvoice(invoice: ConnectWiseInvoice) {
  return (
    (invoice.type ?? '').toLowerCase() === 'agreement' ||
    (invoice.applyToType ?? '').toLowerCase() === 'agreement' ||
    typeof invoice.agreement?.id === 'number'
  );
}

function buildInvoiceNotificationPreview(
  invoices: ConnectWiseInvoice[],
  noticeType: InvoiceNoticeType,
  templateNames: Map<number, string>,
  today: string,
  paymentLinkConfig?: WisePayPaymentLinkConfig,
  billingContact?: InvoiceBillingContact,
  ccEmails: string[] = [],
  bccEmails: string[] = [],
  communicationSettings: CommunicationSettings = defaultCommunicationSettings,
  notes?: string,
): InvoiceNotificationPreview {
  const [firstInvoice] = invoices;
  if (!firstInvoice) {
    throw new Error('Invoice notification preview requires at least one invoice.');
  }

  const company = companyName(firstInvoice.company?.name ?? firstInvoice.billToCompany?.name, 'Unknown company');
  const previewInvoices = invoices
    .map((invoice) => {
      const paymentLink = buildWisePayPaymentLink(invoice, paymentLinkConfig);
      return {
        invoiceId: String(invoice.id),
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: dateOnly(invoice.date),
        dueDate: dateOnly(invoice.dueDate),
        daysPastDue: Math.max(0, daysPastDueFromDate(invoice.dueDate, today)),
        balance: numberValue(invoice.balance),
        total: numberValue(invoice.total),
        invoiceType: invoice.type ?? 'Unknown',
        invoiceStatus: invoice.status?.name,
        agreementName: invoice.agreement?.name,
        paymentLink,
      } satisfies InvoiceNotificationPreviewInvoice;
    })
    .sort(
      (left, right) => right.daysPastDue - left.daysPastDue || String(left.dueDate ?? '').localeCompare(String(right.dueDate ?? '')),
    );
  const invoiceIds = previewInvoices.map((invoice) => invoice.invoiceId);
  const invoiceCount = previewInvoices.length;
  const totalBalance = roundMoney(sumNumbers(previewInvoices.map((invoice) => invoice.balance)));
  const daysPastDue = Math.max(...previewInvoices.map((invoice) => invoice.daysPastDue));
  const dueDate = previewInvoices.reduce<string | undefined>(
    (oldest, invoice) => (!oldest || (invoice.dueDate && invoice.dueDate < oldest) ? invoice.dueDate : oldest),
    undefined,
  );
  const [firstPreviewInvoice] = previewInvoices;
  const singleInvoice = invoiceCount === 1 ? firstPreviewInvoice : undefined;
  const emailTemplateNames = [
    ...new Set(
      invoices.flatMap((invoice) => {
        const templateName = invoice.emailTemplateId ? templateNames.get(invoice.emailTemplateId) : undefined;
        return templateName ? [templateName] : [];
      }),
    ),
  ];
  const recipientName = billingContact?.name ?? company;
  const templateValues = {
    company,
    recipientName,
    invoiceCount,
    totalBalance: formatUsd(totalBalance),
    invoiceNumber: singleInvoice?.invoiceNumber ?? singleInvoice?.invoiceId,
  };
  const noticeTemplate = communicationSettings.invoiceNoticeTemplates[noticeType];
  const subject = renderTemplate(noticeTemplate.subject, templateValues);
  const templateBody = renderTemplate(noticeTemplate.body, templateValues);
  const bodyPreview = buildNotificationBodyPreview(templateBody, notes, previewInvoices);

  return {
    invoiceId: singleInvoice?.invoiceId,
    invoiceNumber: singleInvoice?.invoiceNumber,
    invoiceIds,
    invoiceCount,
    invoices: previewInvoices,
    companyKey: customerKeyFromInvoice(firstInvoice),
    companyName: company,
    recipientName,
    recipientEmail: billingContact?.email,
    ccEmails,
    bccEmails,
    notes,
    billingContact,
    agreementName: singleInvoice?.agreementName,
    noticeType,
    daysPastDue,
    dueDate,
    balance: totalBalance,
    totalBalance,
    emailTemplateId: invoices.length === 1 ? firstInvoice.emailTemplateId : undefined,
    emailTemplateName: emailTemplateNames.length === 1 ? emailTemplateNames[0] : undefined,
    emailTemplateNames,
    paymentLink: singleInvoice?.paymentLink,
    subject,
    bodyPreview,
    templateBody,
  };
}

function buildNotificationBodyPreview(
  templateBody: string,
  notes: string | undefined,
  invoices: InvoiceNotificationPreviewInvoice[],
) {
  const sections = [templateBody.trim()];
  const trimmedNotes = notes?.trim();
  if (trimmedNotes) {
    sections.push(`NOTE:\n${trimmedNotes}`);
  }

  const invoiceLines = invoices.map((invoice) => {
    const invoiceNumber = invoice.invoiceNumber ?? invoice.invoiceId;
    const dueDate = invoice.dueDate ? `due ${invoice.dueDate}` : 'no due date';
    const paymentLink = invoice.paymentLink ? ` Pay: ${invoice.paymentLink}` : '';
    return `Invoice #${invoiceNumber}: ${dueDate}, ${invoice.daysPastDue} days past due, ${formatUsd(invoice.balance)}.${paymentLink}`;
  });
  sections.push(invoiceLines.join('\n'));

  return sections.filter(Boolean).join('\n\n');
}

async function resolveBillToCcEmails(
  client: ConnectWiseInvoiceReader,
  invoices: ConnectWiseInvoice[],
): Promise<string[]> {
  const [invoice] = invoices;
  const companyId = invoice?.billToCompany?.id ?? invoice?.company?.id;
  if (!companyId || !client.getCompany) {
    return [];
  }

  try {
    const company = await client.getCompany(companyId);
    return parseEmailList(textValue(company.invoiceCCEmailAddress));
  } catch {
    return [];
  }
}

async function resolveDefaultBillingContact(
  client: ConnectWiseInvoiceReader,
  invoices: ConnectWiseInvoice[],
): Promise<InvoiceBillingContact | undefined> {
  const [invoice] = invoices;
  const companyId = invoice?.company?.id ?? invoice?.billToCompany?.id;
  if (!companyId) {
    return undefined;
  }

  const defaultBillingContacts = await safeListContacts(client, {
    page: 1,
    pageSize: 10,
    conditions: `company/id=${companyId} and defaultBillingFlag=true`,
  });
  const companyContacts =
    defaultBillingContacts.length > 0
      ? defaultBillingContacts
      : await safeListContacts(client, {
          page: 1,
          pageSize: 50,
          conditions: `company/id=${companyId}`,
        });
  const contact =
    companyContacts.find((item) => item.defaultBillingFlag && !item.inactiveFlag) ??
    companyContacts.find((item) => item.defaultBillingFlag) ??
    companyContacts.find((item) => item.defaultFlag && !item.inactiveFlag) ??
    companyContacts.find((item) => contactEmail(item) && !item.inactiveFlag) ??
    companyContacts[0];

  return contact ? normalizeBillingContact(contact) : undefined;
}

async function safeListContacts(client: ConnectWiseInvoiceReader, options: ConnectWiseListOptions) {
  try {
    return await client.listContacts(options);
  } catch {
    return [];
  }
}

function normalizeBillingContact(contact: ConnectWiseContact): InvoiceBillingContact | undefined {
  const name = [textValue(contact.firstName), textValue(contact.lastName)].filter(Boolean).join(' ').trim();
  const email = contactEmail(contact);

  if (!name && !email) {
    return undefined;
  }

  return {
    id: String(contact.id),
    name: name || email || `Contact ${contact.id}`,
    email,
  };
}

function contactEmail(contact: ConnectWiseContact) {
  const directEmail = textValue(contact.email);
  if (directEmail) {
    return directEmail;
  }

  const emailItems = (contact.communicationItems ?? []).filter((item) => {
    const typeName = textValue(item.type?.name)?.toLowerCase();
    const communicationType = textValue(item.communicationType)?.toLowerCase();
    return typeName === 'email' || communicationType === 'email' || emailLike(textValue(item.value));
  });
  const preferred = emailItems.find((item) => item.defaultFlag) ?? emailItems[0];
  return textValue(preferred?.value);
}

function buildWisePayPaymentLink(
  invoice: ConnectWiseInvoice,
  config?: WisePayPaymentLinkConfig,
) {
  const apiKey = config?.apiKey?.trim();
  if (!apiKey) {
    return undefined;
  }

  const companyCode = wisePayCompanyCode(invoice);
  if (!companyCode) {
    return undefined;
  }

  const endpoint = normalizeWisePayEndpoint(config?.endpoint);
  const params = new URLSearchParams({
    apiKey,
    invoiceNo: invoice.invoiceNumber ?? String(invoice.id),
    amount: numberValue(invoice.balance).toFixed(2),
    companyCode,
  });

  return `${endpoint}/PaymentProxy/PayNow/Email?${params.toString()}`;
}

function normalizeWisePayEndpoint(endpoint?: string) {
  const trimmed = endpoint?.trim() || wisePayDefaultEndpoint;
  return trimmed.replace(/\/+$/, '');
}

function wisePayCompanyCode(invoice: ConnectWiseInvoice) {
  const value =
    invoice.company?.identifier ??
    invoice.billToCompany?.identifier ??
    (invoice.company?.id ? String(invoice.company.id) : undefined) ??
    (invoice.billToCompany?.id ? String(invoice.billToCompany.id) : undefined);

  return value?.trim() || undefined;
}

function customerKeyFromInvoice(invoice: ConnectWiseInvoice) {
  return customerKeyFromCompany({
    id: invoice.company?.id ? String(invoice.company.id) : invoice.billToCompany?.id ? String(invoice.billToCompany.id) : undefined,
    identifier: invoice.company?.identifier ?? invoice.billToCompany?.identifier,
    name: companyName(invoice.company?.name ?? invoice.billToCompany?.name, 'Unknown company'),
  });
}

function customerKeyFromCompany(company: OverdueInvoice['company']) {
  if (company.id) {
    return `id:${company.id}`;
  }
  if (company.identifier) {
    return `identifier:${company.identifier.trim().toLowerCase()}`;
  }
  return `name:${company.name.trim().toLowerCase()}`;
}

function assertSingleNotificationCustomer(invoices: ConnectWiseInvoice[], expectedCustomerKey?: string) {
  const invoiceCustomerKeys = new Set(invoices.map((invoice) => customerKeyFromInvoice(invoice)));
  if (invoiceCustomerKeys.size > 1) {
    throw new Error('Customer invoice notifications can only include invoices for one customer.');
  }

  const [invoiceCustomerKey] = [...invoiceCustomerKeys];
  if (expectedCustomerKey && invoiceCustomerKey && expectedCustomerKey !== invoiceCustomerKey) {
    throw new Error('Selected invoices no longer match the requested customer.');
  }
}

function noticeTypeForDaysPastDue(daysPastDue: number): InvoiceNoticeType {
  return sharedNoticeTypeForDaysPastDue(daysPastDue);
}

async function resolveInvoiceTemplateNames(
  client: ConnectWiseInvoiceReader,
  templateIds: Array<number | undefined>,
) {
  const names = new Map<number, string>();
  for (const templateId of [...new Set(templateIds.filter((value): value is number => typeof value === 'number'))]) {
    const name = await resolveSingleTemplateName(client, templateId);
    if (name) {
      names.set(templateId, name);
    }
  }
  return names;
}

async function resolveSingleTemplateName(client: ConnectWiseInvoiceReader, templateId: number) {
  try {
    const template = await client.getInvoiceEmailTemplate(templateId);
    return template.name;
  } catch {
    return undefined;
  }
}

async function loadLatestNoticeAudits(database: Queryable, invoiceIds: string[]) {
  if (invoiceIds.length === 0) {
    return new Map<string, InvoiceNotificationAuditSummary>();
  }

  const result = await database.query<AuditNoticeRow>(
    `select distinct on (entity_id)
       entity_id,
       actor,
       occurred_at,
       payload
     from audit_events
     where event_type = 'connectwise.invoice.notice.stubbed'
       and entity_type = 'connectwise_invoice'
       and entity_id = any($1::text[])
     order by entity_id, occurred_at desc`,
    [invoiceIds],
  );

  return new Map(
    result.rows.flatMap((row) => {
      const payload = recordFromJson(row.payload);
      const noticeType = payload.noticeType;
      const subject = payload.subject;
      const bodyPreview = payload.bodyPreview;
      if (!isInvoiceNoticeType(noticeType) || typeof subject !== 'string' || typeof bodyPreview !== 'string') {
        return [];
      }

      return [[
        row.entity_id,
        {
          noticeType,
          actor: row.actor,
          occurredAt: isoDate(row.occurred_at),
          subject,
          bodyPreview,
        } satisfies InvoiceNotificationAuditSummary,
      ]];
    }),
  );
}

async function listAllPages<T>(fetchPage: (page: number) => Promise<T[]>, maxPages: number) {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const pageRows = await fetchPage(page);
    if (pageRows.length === 0) {
      break;
    }
    rows.push(...pageRows);
    if (pageRows.length < 100) {
      break;
    }
  }
  return rows;
}

function overdueBucketIdForDaysPastDue(daysPastDue: number): OverdueInvoiceBucketId {
  if (daysPastDue >= 60) {
    return '60-plus-days';
  }
  if (daysPastDue >= 30) {
    return '30-59-days';
  }
  return '7-29-days';
}

function daysPastDueFromDate(value: string | undefined, today: string) {
  const dueDate = value ? new Date(value) : null;
  const todayDate = new Date(`${today}T00:00:00Z`);
  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    return -1;
  }
  const dueDay = new Date(`${dateOnly(value) ?? today}T00:00:00Z`);
  return Math.floor((todayDate.getTime() - dueDay.getTime()) / 86_400_000);
}

function currentDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const direct = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) {
    return direct;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function stringField(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === 'string' && item.trim().length > 0 ? item.trim() : undefined;
}

function numberField(value: Record<string, unknown>, key: string) {
  return numberValue(value[key]);
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.isFinite(Number.parseFloat(String(value ?? '')))
      ? Number.parseFloat(String(value))
      : 0;
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function emailLike(value: string | undefined) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      return recordFromJson(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sumNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function companyName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function compareCustomerNames(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function uniqueStrings(values: Array<string | number | undefined>) {
  return [...new Set(values.flatMap((value) => {
    const stringified = typeof value === 'number' ? String(value) : value?.trim();
    return stringified ? [stringified] : [];
  }))];
}
