import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import {
  listConnectWiseMonthlyInvoiceCandidates,
  listConnectWiseOverdueInvoices,
  listConnectWiseStandardInvoiceCandidates,
  previewConnectWiseMonthlyInvoice,
  previewOrStubInvoiceNotice,
  type InvoiceNoticeType,
} from '../invoices/connectwiseInvoices';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type InvoiceNotificationBody = {
  invoiceId?: string | number;
  invoiceIds?: Array<string | number>;
  companyKey?: string;
  noticeType?: string;
  confirm?: boolean;
};

type MonthlyPreviewBody = {
  agreementId?: string | number;
};

export async function listOverdueInvoicesHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const runtime = await createInvoiceRuntime();

  try {
    return jsonResponse(
      200,
      await listConnectWiseOverdueInvoices({
        database: runtime.repositoryContext.pool,
        provider: runtime.provider,
      }),
    );
  } catch (error) {
    return invoiceErrorResponse(error, 'Unable to load overdue ConnectWise invoices.');
  } finally {
    await runtime.repositoryContext.close();
  }
}

export async function stubInvoiceNotificationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as InvoiceNotificationBody;
  const invoiceId = stringValue(body.invoiceId);
  const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.flatMap((value) => stringValue(value) ?? []) : [];
  const companyKey = stringValue(body.companyKey);
  const noticeType = parseInvoiceNoticeType(body.noticeType);

  if ((!invoiceId && invoiceIds.length === 0) || !noticeType) {
    return jsonResponse(400, {
      error: 'Invoice notification preview requires invoiceId or invoiceIds and a valid noticeType.',
      noticeTypes: ['reminder', '30-day-notice', '60-day-credit-hold', '90-day-cancel-services'],
    });
  }

  const runtime = await createInvoiceRuntime();

  if (body.confirm && !runtime.repositoryContext.pool) {
    await runtime.repositoryContext.close();
    return jsonResponse(400, {
      error: 'Invoice notification confirmation needs PostgreSQL settings before audit history can be saved.',
      missingDatabaseSettings: runtime.repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await previewOrStubInvoiceNotice({
        actor: auth.principal.email ?? auth.principal.name,
        database: runtime.repositoryContext.pool,
        invoiceId,
        invoiceIds,
        companyKey,
        noticeType,
        confirm: Boolean(body.confirm),
        provider: runtime.provider,
      }),
    );
  } catch (error) {
    return invoiceErrorResponse(error, 'Unable to preview invoice notification.');
  } finally {
    await runtime.repositoryContext.close();
  }
}

export async function listMonthlyAgreementsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const runtime = await createInvoiceRuntime();

  try {
    return jsonResponse(
      200,
      await listConnectWiseMonthlyInvoiceCandidates({
        provider: runtime.provider,
      }),
    );
  } catch (error) {
    return invoiceErrorResponse(error, 'Unable to load monthly ConnectWise agreements.');
  } finally {
    await runtime.repositoryContext.close();
  }
}

export async function previewMonthlyInvoiceHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as MonthlyPreviewBody;
  const agreementId = stringValue(body.agreementId);

  if (!agreementId) {
    return jsonResponse(400, {
      error: 'Monthly invoice preview requires agreementId.',
    });
  }

  const runtime = await createInvoiceRuntime();

  try {
    return jsonResponse(
      200,
      await previewConnectWiseMonthlyInvoice({
        agreementId,
        provider: runtime.provider,
      }),
    );
  } catch (error) {
    return invoiceErrorResponse(error, 'Unable to preview monthly invoice.');
  } finally {
    await runtime.repositoryContext.close();
  }
}

export async function listStandardInvoicesHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const runtime = await createInvoiceRuntime();

  try {
    return jsonResponse(
      200,
      await listConnectWiseStandardInvoiceCandidates({
        provider: runtime.provider,
      }),
    );
  } catch (error) {
    return invoiceErrorResponse(error, 'Unable to load standard ConnectWise invoices.');
  } finally {
    await runtime.repositoryContext.close();
  }
}

app.http('listOverdueInvoices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoices/overdue',
  handler: listOverdueInvoicesHttp,
});

app.http('stubInvoiceNotification', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoices/notifications',
  handler: stubInvoiceNotificationHttp,
});

app.http('listMonthlyAgreements', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoices/monthly-agreements',
  handler: listMonthlyAgreementsHttp,
});

app.http('previewMonthlyInvoice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invoices/monthly-preview',
  handler: previewMonthlyInvoiceHttp,
});

app.http('listStandardInvoices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoices/standard',
  handler: listStandardInvoicesHttp,
});

async function createInvoiceRuntime() {
  const repositoryContext = await createOptionalPostgresSettingsRepository();
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  return {
    provider,
    repositoryContext,
  };
}

function invoiceErrorResponse(error: unknown, fallback: string) {
  return jsonResponse(400, {
    error: error instanceof Error ? error.message : fallback,
  });
}

function parseInvoiceNoticeType(value: string | undefined): InvoiceNoticeType | undefined {
  if (
    value === 'reminder' ||
    value === '30-day-notice' ||
    value === '60-day-credit-hold' ||
    value === '90-day-cancel-services'
  ) {
    return value;
  }

  return undefined;
}

function stringValue(value: string | number | undefined) {
  const stringified = typeof value === 'number' ? String(value) : value?.trim();
  return stringified && stringified.length > 0 ? stringified : undefined;
}
