import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseApiError, ConnectWiseClient, connectWiseCredentialsFromSettings } from '../connectwise/client';
import {
  listConnectWiseMonthlyInvoiceCandidates,
  listConnectWiseOverdueInvoices,
  listConnectWiseStandardInvoiceCandidates,
  previewConnectWiseMonthlyInvoice,
  previewOrStubInvoiceNotice,
  type InvoiceNoticeType,
} from '../invoices/connectwiseInvoices';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, readJsonBody, requireMutatingRequestOrigin } from './runtime';

loadDotEnv({ override: false });

type InvoiceNotificationBody = {
  invoiceId?: string | number;
  invoiceIds?: Array<string | number>;
  companyKey?: string;
  noticeType?: string;
  confirm?: boolean;
  testMode?: boolean;
  testRecipientEmail?: string;
  notes?: string;
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

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const bodyResult = await readJsonBody<InvoiceNotificationBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const invoiceId = stringValue(body.invoiceId);
  const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.flatMap((value) => stringValue(value) ?? []) : [];
  const companyKey = stringValue(body.companyKey);
  const noticeType = parseInvoiceNoticeType(body.noticeType);

  if ((!invoiceId && invoiceIds.length === 0) || !noticeType) {
    return jsonResponse(400, {
      error: 'Invoice notification preview requires invoiceId or invoiceIds and a valid noticeType.',
      noticeTypes: ['past-due-reminder', 'credit-hold', 'service-suspension'],
    });
  }

  const runtime = await createInvoiceRuntime();
  const testMode = Boolean(body.testMode);
  const testRecipientEmail = stringValue(body.testRecipientEmail);
  const notes = stringValue(body.notes);

  if (body.confirm && !runtime.repositoryContext.pool) {
    await runtime.repositoryContext.close();
    return jsonResponse(400, {
      error: 'Invoice notification confirmation needs PostgreSQL settings before audit history can be saved.',
      missingDatabaseSettings: runtime.repositoryContext.missingDatabaseSettings,
    });
  }

  if (testMode && body.confirm && !testRecipientEmail) {
    await runtime.repositoryContext.close();
    return jsonResponse(400, {
      error: 'Test email requires testRecipientEmail.',
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
        testMode,
        testRecipientEmail,
        notes,
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

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const bodyResult = await readJsonBody<MonthlyPreviewBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
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

export async function downloadInvoicePdfHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const invoiceId = stringValue(request.params.invoiceId);
  if (!invoiceId) {
    return jsonResponse(400, {
      error: 'Invoice PDF download requires invoiceId.',
    });
  }

  const runtime = await createInvoiceRuntime();

  try {
    const settings = await runtime.provider.getIntegrationSettings('connectwise');
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
    const pdf = await client.getInvoicePdf(invoiceId);
    const filename = `invoice-${invoiceId}.pdf`;

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
      body: pdf,
    };
  } catch (error) {
    if (error instanceof ConnectWiseApiError) {
      return jsonResponse(error.status >= 400 && error.status < 600 ? error.status : 400, {
        error: error.message,
      });
    }

    return invoiceErrorResponse(error, 'Unable to download ConnectWise invoice PDF.');
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

app.http('downloadInvoicePdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoices/{invoiceId}/pdf',
  handler: downloadInvoicePdfHttp,
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
  if (value === 'past-due-reminder' || value === 'credit-hold' || value === 'service-suspension') {
    return value;
  }

  return undefined;
}

function stringValue(value: string | number | undefined) {
  const stringified = typeof value === 'number' ? String(value) : value?.trim();
  return stringified && stringified.length > 0 ? stringified : undefined;
}
