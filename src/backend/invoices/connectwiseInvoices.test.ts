import assert from 'node:assert/strict';
import type {
  ConnectWiseAgreement,
  ConnectWiseCompany,
  ConnectWiseContact,
  ConnectWiseInvoice,
  ConnectWiseInvoiceEmailTemplate,
  ConnectWiseListOptions,
} from '../connectwise/client';
import {
  buildConnectWiseMonthlyInvoicePreview,
  loadConnectWiseMonthlyInvoiceCandidates,
  loadConnectWiseOverdueInvoices,
  loadConnectWiseStandardInvoiceCandidates,
  previewOrStubConnectWiseInvoiceNotice,
  type ConnectWiseInvoiceReader,
  type Queryable,
} from './connectwiseInvoices';
import { defaultCommunicationSettings } from '../../shared/communicationSettings';

type FakeClientInput = {
  agreements?: ConnectWiseAgreement[];
  contacts?: ConnectWiseContact[];
  companies?: ConnectWiseCompany[];
  invoices?: ConnectWiseInvoice[];
  templates?: ConnectWiseInvoiceEmailTemplate[];
};

type FakeClient = ConnectWiseInvoiceReader & {
  calls: {
    listAgreements: ConnectWiseListOptions[];
    listContacts: ConnectWiseListOptions[];
    listInvoices: ConnectWiseListOptions[];
  };
};

async function run() {
  await testOverdueBoundariesAndFiltering();
  await testOverdueCustomerGrouping();
  await testMonthlyAgreementInvoiceMatching();
  await testMonthlyPreviewShape();
  await testStandardInvoiceCandidateShape();
  await testInvoiceNotificationStubAudit();
  await testCustomerInvoiceNoticePreview();
  await testInvoiceNoticeSendsViaGraphWhenConfigured();

  console.log('connectwise invoice tests passed');
}

async function testOverdueBoundariesAndFiltering() {
  const client = fakeClient({
    invoices: [
      invoice({ id: 1, date: '2026-05-01', dueDate: '2026-07-06', balance: 100 }),
      invoice({ id: 6, dueDate: '2026-07-01', balance: 600 }),
      invoice({ id: 7, dueDate: '2026-06-30', balance: 700 }),
      invoice({ id: 29, dueDate: '2026-06-08', balance: 290 }),
      invoice({ id: 30, dueDate: '2026-06-07', balance: 300 }),
      invoice({ id: 59, dueDate: '2026-05-09', balance: 590 }),
      invoice({ id: 60, dueDate: '2026-05-08', balance: 600 }),
      invoice({ id: 70, dueDate: '2026-05-01', balance: 0 }),
      invoice({ id: 80, date: '2026-05-08', dueDate: '2026-07-07', balance: 800 }),
      invoice({ id: 90, balance: 900 }),
    ],
  });

  const response = await loadConnectWiseOverdueInvoices(client, undefined, '2026-07-07');

  assert.deepEqual(
    response.buckets.find((bucket) => bucket.id === '7-29-days')?.invoices.map((item) => item.invoiceId),
    ['29', '7'],
  );
  assert.deepEqual(
    response.buckets.find((bucket) => bucket.id === '30-59-days')?.invoices.map((item) => item.invoiceId),
    ['59', '30'],
  );
  assert.deepEqual(
    response.buckets.find((bucket) => bucket.id === '60-plus-days')?.invoices.map((item) => item.invoiceId),
    ['60'],
  );
  assert.equal(response.summary.reviewQueueCount, 5);
  assert.equal(response.summary.reviewQueueBalance, 2480);
  assert.equal(client.calls.listInvoices[0]?.conditions, 'balance>0');
}

async function testOverdueCustomerGrouping() {
  const client = fakeClient({
    invoices: [
      invoice({ id: 601, companyId: 42, companyName: 'Acme', dueDate: '2026-04-01', balance: 100 }),
      invoice({ id: 602, companyId: 42, companyName: 'Acme', dueDate: '2026-06-01', balance: 250 }),
      invoice({ id: 603, companyId: 84, companyName: 'Bravo', dueDate: '2026-06-30', balance: 75 }),
    ],
  });

  const response = await loadConnectWiseOverdueInvoices(client, undefined, '2026-07-07');
  const acme = response.customerGroups.find((group) => group.company.name === 'Acme');
  const bravo = response.customerGroups.find((group) => group.company.name === 'Bravo');

  assert.equal(response.summary.customerCount, 2);
  assert.equal(acme?.customerKey, 'id:42');
  assert.equal(acme?.invoiceCount, 2);
  assert.equal(acme?.balanceTotal, 350);
  assert.equal(acme?.oldestDaysPastDue, 97);
  assert.equal(acme?.noticeType, 'service-suspension');
  assert.deepEqual(acme?.invoices.map((item) => item.invoiceId), ['601', '602']);
  assert.equal(acme?.bucketCounts['60-plus-days'], 1);
  assert.equal(acme?.bucketCounts['30-59-days'], 1);
  assert.equal(bravo?.noticeType, 'past-due-reminder');
}

async function testMonthlyAgreementInvoiceMatching() {
  const client = fakeClient({
    agreements: [
      agreement({ id: 1, name: 'Acme Monthly', companyName: 'Acme' }),
      agreement({ id: 2, name: 'Bravo Monthly', companyName: 'Bravo' }),
    ],
    invoices: [
      invoice({ id: 40, applyToType: 'Agreement', applyToId: 2, date: '2026-07-01', total: 402 }),
      invoice({ id: 39, agreementId: 1, date: '2026-07-02', total: 999 }),
      invoice({ id: 38, applyToType: 'Agreement', applyToId: 1, date: '2026-06-25', total: 381 }),
    ],
  });

  const response = await loadConnectWiseMonthlyInvoiceCandidates(client, '2026-07-07');
  const acme = response.candidates.find((candidate) => candidate.agreementId === '1');
  const bravo = response.candidates.find((candidate) => candidate.agreementId === '2');

  assert.equal(response.agreementCount, 2);
  assert.equal(acme?.lastInvoice?.invoiceId, '38');
  assert.equal(bravo?.lastInvoice?.invoiceId, '40');
  assert.match(client.calls.listAgreements[0]?.conditions ?? '', /billingCycle\/name="Monthly"/);
  assert.equal(client.calls.listInvoices[0]?.conditions, 'applyToType="Agreement"');
}

async function testMonthlyPreviewShape() {
  const client = fakeClient({
    agreements: [
      agreement({
        id: 12,
        name: 'Acme Managed Services',
        companyName: 'Acme Labs',
        billAmount: 1250,
        nextInvoiceDate: '2026-08-01T00:00:00Z',
        billingTerms: 'Net 30',
        invoiceTemplate: 'WisePay Monthly',
      }),
    ],
    invoices: [
      invoice({ id: 71, applyToType: 'Agreement', applyToId: 12, date: '2026-07-01', total: 1250 }),
      invoice({ id: 72, applyToType: 'Agreement', applyToId: 99, date: '2026-07-02', total: 999 }),
    ],
  });

  const preview = await buildConnectWiseMonthlyInvoicePreview(client, '12', '2026-07-07');

  assert.equal(preview.previewMode, 'stub');
  assert.equal(preview.payload.invoiceType, 'Agreement');
  assert.equal(preview.payload.applyToType, 'Agreement');
  assert.equal(preview.payload.applyToId, '12');
  assert.equal(preview.payload.companyName, 'Acme Labs');
  assert.equal(preview.payload.billAmount, 1250);
  assert.equal(preview.payload.billingTerms, 'Net 30');
  assert.equal(preview.payload.invoiceTemplateName, 'WisePay Monthly');
  assert.equal(preview.candidate.lastInvoice?.invoiceId, '71');
  assert.deepEqual(preview.warnings, []);
  assert.equal(
    client.calls.listInvoices[client.calls.listInvoices.length - 1]?.conditions,
    'applyToType="Agreement" and applyToId=12',
  );
}

async function testStandardInvoiceCandidateShape() {
  const client = fakeClient({
    invoices: [
      invoice({ id: 100, type: 'Standard', companyId: 10, companyName: 'Acme', dueDate: '2026-06-30', balance: 80 }),
      invoice({ id: 101, type: 'Agreement', companyId: 10, companyName: 'Acme', dueDate: '2026-06-01', balance: 100 }),
      invoice({ id: 102, type: 'Misc', applyToType: 'Agreement', companyId: 20, companyName: 'Bravo', balance: 50 }),
      invoice({ id: 103, type: 'Project', companyId: 10, companyName: 'Acme', dueDate: '2026-06-01', balance: 0 }),
      invoice({ id: 104, type: 'Standard', billToCompanyId: 30, billToCompanyName: 'Cedar', dueDate: '2026-07-06', balance: 20 }),
    ],
  });

  const response = await loadConnectWiseStandardInvoiceCandidates(client, '2026-07-07');
  const acme = response.candidates.find((candidate) => candidate.company.name === 'Acme');
  const cedar = response.candidates.find((candidate) => candidate.company.name === 'Cedar');

  assert.equal(response.candidateCount, 2);
  assert.deepEqual(acme?.invoiceTypes, ['Project', 'Standard']);
  assert.equal(acme?.latestInvoice?.invoiceId, '103');
  assert.equal(acme?.openInvoiceCount, 1);
  assert.equal(acme?.openBalanceAmount, 80);
  assert.equal(acme?.overdueInvoiceCount, 1);
  assert.equal(cedar?.openInvoiceCount, 1);
  assert.equal(cedar?.overdueInvoiceCount, 0);
}

async function testInvoiceNotificationStubAudit() {
  const client = fakeClient({
    invoices: [
      invoice({
        id: 501,
        invoiceNumber: 'INV-501',
        companyId: 42,
        companyName: 'Acme',
        dueDate: '2026-06-01',
        balance: 250,
        emailTemplateId: 2,
      }),
    ],
    contacts: [
      contact({
        id: 901,
        companyId: 42,
        firstName: 'Avery',
        lastName: 'Billing',
        email: 'avery.billing@example.com',
        defaultBillingFlag: true,
      }),
    ],
    templates: [{ id: 2, name: 'WisePay reminder' }],
  });
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return { rows: [] as T[] };
    },
  };

  const preview = await previewOrStubConnectWiseInvoiceNotice(client, {
    actor: 'analyst@example.com',
    invoiceId: '501',
    noticeType: 'credit-hold',
    communicationSettings: defaultCommunicationSettings,
    paymentLinkConfig: {
      apiKey: 'wise-key',
    },
    today: '2026-07-07',
  });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.preview.fromEmail, 'tconnover@bmbsolutions.com');
  assert.equal(preview.preview.emailTemplateName, 'WisePay reminder');
  assert.equal(preview.preview.recipientName, 'Avery Billing');
  assert.equal(preview.preview.recipientEmail, 'avery.billing@example.com');
  assert.match(preview.preview.bodyPreview, /^Hello Avery Billing,/);
  assert.equal(
    preview.preview.paymentLink,
    'https://secure2.wise-sync.com/PaymentProxy/PayNow/Email?apiKey=wise-key&invoiceNo=INV-501&amount=250.00&companyCode=company-42',
  );
  assert.equal(queries.length, 0);

  const confirmed = await previewOrStubConnectWiseInvoiceNotice(client, {
    actor: 'analyst@example.com',
    database,
    invoiceId: '501',
    noticeType: 'credit-hold',
    confirm: true,
    communicationSettings: defaultCommunicationSettings,
    paymentLinkConfig: {
      apiKey: 'wise-key',
    },
    today: '2026-07-07',
  });
  assert.equal(confirmed.status, 'stubbed');
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /insert into audit_events/);
  assert.equal(queries[0]?.values?.[0], 'analyst@example.com');
  assert.equal(queries[0]?.values?.[1], 'connectwise.invoice.notice.stubbed');
  assert.equal(queries[0]?.values?.[2], '501');
  const auditPayload = JSON.parse(String(queries[0]?.values?.[4] ?? '{}')) as {
    paymentLink?: string;
    fromEmail?: string;
  };
  assert.equal(auditPayload.paymentLink, preview.preview.paymentLink);
  assert.equal(auditPayload.fromEmail, 'tconnover@bmbsolutions.com');
}

async function testCustomerInvoiceNoticePreview() {
  const client = fakeClient({
    invoices: [
      invoice({
        id: 701,
        invoiceNumber: 'INV-701',
        companyId: 42,
        companyName: 'Acme',
        dueDate: '2026-05-01',
        balance: 125,
      }),
      invoice({
        id: 702,
        invoiceNumber: 'INV-702',
        companyId: 42,
        companyName: 'Acme',
        dueDate: '2026-06-01',
        balance: 275,
      }),
    ],
    contacts: [
      contact({
        id: 902,
        companyId: 42,
        firstName: 'Morgan',
        lastName: 'Ledger',
        email: 'morgan.ledger@example.com',
        defaultBillingFlag: true,
      }),
    ],
  });
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return { rows: [] as T[] };
    },
  };

  const preview = await previewOrStubConnectWiseInvoiceNotice(client, {
    actor: 'analyst@example.com',
    invoiceIds: ['702', '701'],
    companyKey: 'id:42',
    noticeType: 'credit-hold',
    communicationSettings: defaultCommunicationSettings,
    paymentLinkConfig: {
      apiKey: 'wise-key',
    },
    today: '2026-07-07',
  });

  assert.equal(preview.status, 'preview');
  assert.equal(preview.preview.invoiceCount, 2);
  assert.equal(preview.preview.companyKey, 'id:42');
  assert.equal(preview.preview.recipientName, 'Morgan Ledger');
  assert.equal(preview.preview.recipientEmail, 'morgan.ledger@example.com');
  assert.equal(preview.preview.totalBalance, 400);
  assert.deepEqual(preview.preview.invoiceIds, ['701', '702']);
  assert.deepEqual(preview.preview.invoices.map((item) => item.invoiceNumber), ['INV-701', 'INV-702']);
  assert.match(preview.preview.subject, /Credit hold notice for Acme/);
  assert.match(preview.preview.bodyPreview, /^Hello Morgan Ledger,/);
  assert.match(preview.preview.bodyPreview, /INV-701/);
  assert.match(preview.preview.bodyPreview, /INV-702/);
  assert.equal(
    preview.preview.invoices[0]?.paymentLink,
    'https://secure2.wise-sync.com/PaymentProxy/PayNow/Email?apiKey=wise-key&invoiceNo=INV-701&amount=125.00&companyCode=company-42',
  );
  assert.equal(
    preview.preview.invoices[1]?.paymentLink,
    'https://secure2.wise-sync.com/PaymentProxy/PayNow/Email?apiKey=wise-key&invoiceNo=INV-702&amount=275.00&companyCode=company-42',
  );

  const confirmed = await previewOrStubConnectWiseInvoiceNotice(client, {
    actor: 'analyst@example.com',
    database,
    invoiceIds: ['702', '701'],
    companyKey: 'id:42',
    noticeType: 'credit-hold',
    confirm: true,
    notes: 'Please call AP today.',
    communicationSettings: defaultCommunicationSettings,
    paymentLinkConfig: {
      apiKey: 'wise-key',
    },
    today: '2026-07-07',
  });

  assert.equal(confirmed.status, 'stubbed');
  assert.match(confirmed.preview.bodyPreview, /NOTE:\nPlease call AP today\./);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries.map((query) => query.values?.[2]), ['702', '701']);
  const auditPayload = JSON.parse(String(queries[0]?.values?.[4] ?? '{}')) as {
    invoiceIds?: string[];
    totalBalance?: number;
    notes?: string;
  };
  assert.deepEqual(auditPayload.invoiceIds, ['701', '702']);
  assert.equal(auditPayload.totalBalance, 400);
  assert.equal(auditPayload.notes, 'Please call AP today.');
}

async function testInvoiceNoticeSendsViaGraphWhenConfigured() {
  const client = fakeClient({
    invoices: [
      invoice({
        id: 801,
        invoiceNumber: 'INV-801',
        companyId: 42,
        companyName: 'Acme',
        dueDate: '2026-05-01',
        balance: 90,
      }),
    ],
    contacts: [
      contact({
        id: 903,
        companyId: 42,
        firstName: 'Avery',
        lastName: 'Billing',
        email: 'avery.billing@example.com',
        defaultBillingFlag: true,
      }),
    ],
  });
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return { rows: [] as T[] };
    },
  };
  const sent: Array<{ subject: string; to: string; body: string; bodyContentType?: string }> = [];

  const confirmed = await previewOrStubConnectWiseInvoiceNotice(client, {
    actor: 'analyst@example.com',
    database,
    invoiceId: '801',
    noticeType: 'past-due-reminder',
    confirm: true,
    communicationSettings: {
      ...defaultCommunicationSettings,
      deliveryConfigured: true,
      graphTenantId: 'tenant',
      graphClientId: 'client',
      sendAsMailbox: 'billing@bmbsolutions.com',
      graphClientSecretPresent: true,
    },
    graphCredentials: {
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      sendAsMailbox: 'billing@bmbsolutions.com',
    },
    emailSender: {
      async send(_credentials, message) {
        sent.push({
          subject: message.subject,
          to: message.to[0]?.address ?? '',
          body: message.body,
          bodyContentType: message.bodyContentType,
        });
        return {
          sendAsMailbox: 'billing@bmbsolutions.com',
          recipientCount: 1,
        };
      },
    },
    today: '2026-07-07',
  });

  assert.equal(confirmed.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, 'avery.billing@example.com');
  assert.match(sent[0]?.body ?? '', /<!DOCTYPE html>/);
  assert.match(sent[0]?.body ?? '', /INV-801/);
  assert.match(sent[0]?.body ?? '', /min-width:420px/);
  assert.match(sent[0]?.body ?? '', /Pay now|N\/A/);
  assert.equal(sent[0]?.bodyContentType, 'HTML');
  assert.equal(queries[0]?.values?.[1], 'connectwise.invoice.notice.sent');
  assert.equal(confirmed.preview.fromEmail, 'billing@bmbsolutions.com');
}

function fakeClient(input: FakeClientInput): FakeClient {
  const agreements = input.agreements ?? [];
  const contacts = input.contacts ?? [];
  const companies = input.companies ?? [];
  const invoices = input.invoices ?? [];
  const templates = input.templates ?? [];
  const calls: FakeClient['calls'] = {
    listAgreements: [],
    listContacts: [],
    listInvoices: [],
  };

  return {
    calls,
    async listAgreements(options: ConnectWiseListOptions = {}) {
      calls.listAgreements.push(options);
      return pageRows(agreements, options);
    },
    async getAgreement(agreementId: string | number) {
      const found = agreements.find((item) => String(item.id) === String(agreementId));
      if (!found) throw new Error(`Agreement ${agreementId} not found.`);
      return found;
    },
    async getCompany(companyId: string | number) {
      const found = companies.find((item) => String(item.id) === String(companyId));
      if (!found) {
        return {
          id: Number(companyId),
          name: `Company ${companyId}`,
        };
      }
      return found;
    },
    async listContacts(options: ConnectWiseListOptions = {}) {
      calls.listContacts.push(options);
      return pageRows(filterContacts(contacts, options), options);
    },
    async listInvoices(options: ConnectWiseListOptions = {}) {
      calls.listInvoices.push(options);
      return pageRows(filterInvoices(invoices, options), options);
    },
    async getInvoice(invoiceId: string | number) {
      const found = invoices.find((item) => String(item.id) === String(invoiceId));
      if (!found) throw new Error(`Invoice ${invoiceId} not found.`);
      return found;
    },
    async getInvoiceEmailTemplate(templateId: string | number) {
      const found = templates.find((item) => String(item.id) === String(templateId));
      if (!found) throw new Error(`Template ${templateId} not found.`);
      return found;
    },
  };
}

function filterContacts(contacts: ConnectWiseContact[], options: ConnectWiseListOptions) {
  let rows = [...contacts];
  const conditions = options.conditions ?? '';
  const companyIdMatch = conditions.match(/company\/id=(\d+)/);

  if (companyIdMatch) {
    rows = rows.filter((item) => String(item.company?.id) === companyIdMatch[1]);
  }
  if (conditions.includes('defaultBillingFlag=true')) {
    rows = rows.filter((item) => item.defaultBillingFlag === true);
  }

  return rows;
}

function filterInvoices(invoices: ConnectWiseInvoice[], options: ConnectWiseListOptions) {
  let rows = [...invoices];
  const conditions = options.conditions ?? '';
  const applyToIdMatch = conditions.match(/applyToId=(\d+)/);

  if (conditions.includes('balance>0')) {
    rows = rows.filter((item) => Number(item.balance ?? 0) > 0);
  }
  if (conditions.includes('applyToType="Agreement"')) {
    rows = rows.filter((item) => item.applyToType === 'Agreement');
  }
  if (applyToIdMatch) {
    rows = rows.filter((item) => String(item.applyToId) === applyToIdMatch[1]);
  }
  if (options.orderBy === 'id desc') {
    rows.sort((left, right) => right.id - left.id);
  }
  if (options.orderBy === 'dueDate asc') {
    rows.sort((left, right) => String(left.dueDate ?? '').localeCompare(String(right.dueDate ?? '')));
  }

  return rows;
}

function pageRows<T>(rows: T[], options: ConnectWiseListOptions) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function agreement(input: {
  id: number;
  name: string;
  companyName: string;
  billAmount?: number;
  nextInvoiceDate?: string;
  billingTerms?: string;
  invoiceTemplate?: string;
}): ConnectWiseAgreement {
  return {
    id: input.id,
    name: input.name,
    company: {
      id: input.id * 10,
      identifier: `company-${input.id}`,
      name: input.companyName,
    },
    type: {
      id: 1,
      name: 'Managed Services',
    },
    agreementStatus: 'Active',
    billingCycle: {
      id: 1,
      name: 'Monthly',
    },
    billingTerms: input.billingTerms
      ? {
          id: 1,
          name: input.billingTerms,
        }
      : undefined,
    invoiceTemplate: input.invoiceTemplate
      ? {
          id: 2,
          name: input.invoiceTemplate,
        }
      : undefined,
    billAmount: input.billAmount ?? 100,
    nextInvoiceDate: input.nextInvoiceDate ?? '2026-08-01',
  };
}

function invoice(input: {
  id: number;
  invoiceNumber?: string;
  type?: string;
  companyId?: number;
  companyName?: string;
  billToCompanyId?: number;
  billToCompanyName?: string;
  agreementId?: number;
  applyToType?: string;
  applyToId?: number;
  date?: string;
  dueDate?: string;
  total?: number;
  balance?: number;
  emailTemplateId?: number;
}): ConnectWiseInvoice {
  return {
    id: input.id,
    invoiceNumber: input.invoiceNumber ?? `INV-${input.id}`,
    type: input.type ?? (input.applyToType === 'Agreement' || input.agreementId ? 'Agreement' : 'Standard'),
    company: input.companyName
      ? {
          id: input.companyId,
          identifier: input.companyId ? `company-${input.companyId}` : undefined,
          name: input.companyName,
        }
      : undefined,
    billToCompany: input.billToCompanyName
      ? {
          id: input.billToCompanyId,
          identifier: input.billToCompanyId ? `bill-to-${input.billToCompanyId}` : undefined,
          name: input.billToCompanyName,
        }
      : undefined,
    agreement: input.agreementId
      ? {
          id: input.agreementId,
          name: `Agreement ${input.agreementId}`,
        }
      : undefined,
    applyToType: input.applyToType,
    applyToId: input.applyToId,
    date: input.date,
    dueDate: input.dueDate,
    total: input.total ?? input.balance ?? 0,
    balance: input.balance ?? input.total ?? 0,
    emailTemplateId: input.emailTemplateId,
  };
}

function contact(input: {
  id: number;
  companyId: number;
  firstName: string;
  lastName: string;
  email?: string;
  defaultBillingFlag?: boolean;
  defaultFlag?: boolean;
}): ConnectWiseContact {
  return {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    company: {
      id: input.companyId,
      identifier: `company-${input.companyId}`,
      name: `Company ${input.companyId}`,
    },
    defaultBillingFlag: input.defaultBillingFlag,
    defaultFlag: input.defaultFlag,
    communicationItems: input.email
      ? [
          {
            type: {
              id: 1,
              name: 'Email',
            },
            value: input.email,
            defaultFlag: true,
          },
        ]
      : undefined,
  };
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
