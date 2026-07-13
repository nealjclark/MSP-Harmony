import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import { isVendorKey, type VendorKey } from '../../shared/vendorDatapoints';
import {
  applyReconciliationAgreementAdditionUpdates,
  type ReconciliationAgreementAdditionUpdateInput,
} from '../api/reconciliationAgreementUpdates';
import {
  createReconciliationAdjustment,
  deactivateReconciliationAdjustment,
  type CreateReconciliationAdjustmentInput,
} from '../api/reconciliationAdjustments';
import {
  createInvestigationTickets,
  getInvestigationTicketById,
  listInvestigationTickets,
  mapConnectWiseTimeEntries,
  type InvestigationTicketLicenseInput,
} from '../api/investigationTickets';
import { listActiveAgreementAdditions, reconcileVendorFromDatabase } from '../api/reconciliationRuns';
import { deactivateAdditionPin, upsertManualAdditionPin } from '../mapping/additionPinService';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseClient, connectWiseCredentialsFromSettings } from '../connectwise/client';
import { assertConnectWiseReady } from '../connectwise/operations';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, readJsonBody, requireMutatingRequestOrigin } from './runtime';

loadDotEnv({ override: false });

type ReconciliationBody = {
  syncRunId?: string;
};

type ReconciliationAdjustmentBody = CreateReconciliationAdjustmentInput & {
  reviewedBy?: string;
};

type AgreementAdditionUpdatesBody = {
  updates?: ReconciliationAgreementAdditionUpdateInput[];
  discardedUpdates?: ReconciliationAgreementAdditionUpdateInput[];
};

type InvestigationTicketsCreateBody = {
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  companyId?: number | string;
  notes?: string;
  reconciliationMonth?: string;
  tickets?: Array<{
    vendorId?: VendorKey;
    vendorName?: string;
    licenses?: InvestigationTicketLicenseInput[];
  }>;
};

export async function runVendorReconciliationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseReconciliationVendorId(request.params.vendorId);
  if (!vendorId) {
    return jsonResponse(400, {
      error: `Reconciliation is not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Reconciliation needs PostgreSQL settings before it can load mapped snapshots.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const bodyResult = await readJsonBody<ReconciliationBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  try {
    const result = await reconcileVendorFromDatabase(repositoryContext.pool, vendorId, {
      syncRunId: typeof body.syncRunId === 'string' && body.syncRunId.trim().length > 0 ? body.syncRunId : undefined,
    });

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to run reconciliation.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('runVendorReconciliation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/{vendorId}/run',
  handler: runVendorReconciliationHttp,
});

export async function listAgreementAdditionsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const agreementId = request.params.agreementId;

  if (!agreementId || !isUuid(agreementId)) {
    return jsonResponse(400, {
      error: 'Agreement additions require a valid agreementId.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Agreement additions need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(200, {
      agreementId,
      additions: await listActiveAgreementAdditions(repositoryContext.pool, agreementId),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load agreement additions.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('listAgreementAdditions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reconciliation/agreements/{agreementId}/additions',
  handler: listAgreementAdditionsHttp,
});

export async function applyAgreementAdditionUpdatesHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: 'Agreement addition updates need PostgreSQL settings before they can save audit details.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const bodyResult = await readJsonBody<AgreementAdditionUpdatesBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const discardedUpdates = Array.isArray(body.discardedUpdates) ? body.discardedUpdates : [];

  if (updates.length === 0 && discardedUpdates.length === 0) {
    return jsonResponse(400, {
      error: 'At least one update or discarded update is required.',
    });
  }

  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    metadataReader: repositoryContext.repository,
  });

  try {
    const settings = await provider.getIntegrationSettings('connectwise');
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
    const result = await applyReconciliationAgreementAdditionUpdates(repositoryContext.pool, {
      actor: auth.principal.name,
      updates,
      discardedUpdates,
      writer: {
        patchAgreementAddition(connectWiseAgreementId, connectWiseAdditionId, changes) {
          return client.patchAgreementAddition(
            connectWiseAgreementId,
            connectWiseAdditionId,
            [
              { op: 'replace', path: '/quantity', value: changes.quantity },
              ...(changes.lessIncludedChanged
                ? [{ op: 'replace' as const, path: '/lessIncluded', value: changes.lessIncluded ?? 0 }]
                : []),
            ],
          );
        },
      },
    });

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to apply agreement addition updates.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('applyAgreementAdditionUpdates', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/connectwise/agreement-addition-updates',
  handler: applyAgreementAdditionUpdatesHttp,
});

export async function createReconciliationAdjustmentHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
    return jsonResponse(400, {
      error: `Reconciliation adjustments are not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Reconciliation adjustment creation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const bodyResult = await readJsonBody<ReconciliationAdjustmentBody>(request, {
    fallback: {} as ReconciliationAdjustmentBody,
  });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  try {
    return jsonResponse(200, {
      vendorId: integrationId,
      adjustment: await createReconciliationAdjustment(repositoryContext.pool, integrationId, {
        customerId: body.customerId,
        agreementId: body.agreementId,
        productCode: body.productCode,
        productName: body.productName,
        lineType: body.lineType,
        adjustmentType: body.adjustmentType,
        quantity: Number(body.quantity),
        reason: body.reason,
        reviewedBy: auth.principal.name,
      }),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to create reconciliation adjustment.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deactivateReconciliationAdjustmentHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const integrationId = parseIntegrationId(request.params.vendorId);
  const adjustmentId = request.params.adjustmentId;
  if (!integrationId) {
    return jsonResponse(400, {
      error: `Reconciliation adjustments are not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }
  if (!adjustmentId) {
    return jsonResponse(400, { error: 'Reconciliation adjustment deactivation requires adjustmentId.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Reconciliation adjustment deactivation needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    return jsonResponse(
      200,
      await deactivateReconciliationAdjustment(repositoryContext.pool, integrationId, adjustmentId, {
        reviewedBy: auth.principal.name,
      }),
    );
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to deactivate reconciliation adjustment.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('createReconciliationAdjustment', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/{vendorId}/adjustments',
  handler: createReconciliationAdjustmentHttp,
});

app.http('deactivateReconciliationAdjustment', {
  methods: ['DELETE', 'POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/{vendorId}/adjustments/{adjustmentId}/deactivate',
  handler: deactivateReconciliationAdjustmentHttp,
});

type AdditionPinBody = {
  customerId?: string;
  agreementId?: string;
  vendorProductKey?: string;
  connectWiseAdditionId?: string;
  connectwiseProductCode?: string;
  connectwiseProductName?: string;
};

export async function upsertReconciliationAdditionPinHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseReconciliationVendorId(request.params.vendorId);
  if (!vendorId) {
    return jsonResponse(400, {
      error: `Addition pins are not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const bodyResult = await readJsonBody<AdditionPinBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  if (
    !body.customerId ||
    !isUuid(body.customerId) ||
    !body.agreementId ||
    !isUuid(body.agreementId) ||
    !body.vendorProductKey?.trim() ||
    !body.connectWiseAdditionId?.trim() ||
    !body.connectwiseProductCode?.trim() ||
    !body.connectwiseProductName?.trim()
  ) {
    return jsonResponse(400, {
      error:
        'Addition pins require customerId, agreementId, vendorProductKey, connectWiseAdditionId, connectwiseProductCode, and connectwiseProductName.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Addition pins need PostgreSQL settings before they can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const pin = await upsertManualAdditionPin(repositoryContext.pool, {
      vendorId,
      customerId: body.customerId,
      agreementId: body.agreementId,
      vendorProductKey: body.vendorProductKey.trim(),
      connectWiseAdditionId: body.connectWiseAdditionId.trim(),
      connectwiseProductCode: body.connectwiseProductCode.trim(),
      connectwiseProductName: body.connectwiseProductName.trim(),
      mappingSource: 'manual',
    });
    return jsonResponse(200, { pin });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to save addition pin.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function deactivateReconciliationAdditionPinHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const vendorId = parseReconciliationVendorId(request.params.vendorId);
  if (!vendorId) {
    return jsonResponse(400, {
      error: `Addition pins are not available for integration "${request.params.vendorId ?? 'unknown'}".`,
    });
  }

  const bodyResult = await readJsonBody<AdditionPinBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  if (!body.agreementId || !isUuid(body.agreementId) || !body.vendorProductKey?.trim()) {
    return jsonResponse(400, {
      error: 'Addition pin removal requires agreementId and vendorProductKey.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Addition pin removal needs PostgreSQL settings before it can save.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    await deactivateAdditionPin(repositoryContext.pool, {
      vendorId,
      agreementId: body.agreementId,
      vendorProductKey: body.vendorProductKey.trim(),
    });
    return jsonResponse(200, { deactivated: true });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to remove addition pin.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('upsertReconciliationAdditionPin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/{vendorId}/addition-pins',
  handler: upsertReconciliationAdditionPinHttp,
});

app.http('deactivateReconciliationAdditionPin', {
  methods: ['DELETE', 'POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/{vendorId}/addition-pins/deactivate',
  handler: deactivateReconciliationAdditionPinHttp,
});

export async function createInvestigationTicketsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const bodyResult = await readJsonBody<InvestigationTicketsCreateBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const customerName = body.customerName?.trim();
  const companyIdRaw = body.companyId == null || body.companyId === '' ? null : Number(body.companyId);
  const companyId =
    companyIdRaw != null && Number.isFinite(companyIdRaw) && companyIdRaw > 0 ? companyIdRaw : undefined;
  if (!customerName) {
    return jsonResponse(400, { error: 'customerName is required to create investigation tickets.' });
  }
  if (!Array.isArray(body.tickets) || body.tickets.length === 0) {
    return jsonResponse(400, { error: 'Select at least one license to investigate.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Investigation tickets need PostgreSQL settings before they can be created.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const settingsProvider = createIntegrationSettingsProvider({
      loadLocalEnv: true,
      metadataReader: repositoryContext.repository,
    });
    const connectWiseSettings = await settingsProvider.getIntegrationSettings('connectwise');
    assertConnectWiseReady(connectWiseSettings);
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(connectWiseSettings));
    const result = await createInvestigationTickets(repositoryContext.pool, {
      actor: auth.principal.name,
      customerId: body.customerId,
      customerName,
      agreementId: body.agreementId,
      agreementName: body.agreementName,
      companyId,
      notes: body.notes,
      reconciliationMonth: body.reconciliationMonth,
      tickets: body.tickets
        .filter((ticket): ticket is { vendorId: VendorKey; vendorName: string; licenses: InvestigationTicketLicenseInput[] } =>
          Boolean(ticket.vendorId && ticket.vendorName && Array.isArray(ticket.licenses) && ticket.licenses.length > 0),
        )
        .map((ticket) => ({
          vendorId: ticket.vendorId,
          vendorName: ticket.vendorName,
          licenses: ticket.licenses,
        })),
      createServiceTicket: (payload) => client.createServiceTicket(payload),
    });

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to create investigation tickets.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listInvestigationTicketsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const vendorId = parseReconciliationVendorId(request.query.get('vendorId') ?? undefined);
  if (!vendorId) {
    return jsonResponse(400, { error: 'vendorId query parameter is required.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Investigation tickets need PostgreSQL settings before they can load.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const tickets = await listInvestigationTickets(repositoryContext.pool, {
      vendorId,
      customerName: request.query.get('customerName') ?? undefined,
      reconciliationMonth: request.query.get('reconciliationMonth') ?? undefined,
    });
    return jsonResponse(200, { tickets });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load investigation tickets.',
    });
  } finally {
    await repositoryContext.close();
  }
}

export async function listInvestigationTicketTimeEntriesHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const ticketId = request.params.ticketId?.trim();
  if (!ticketId || !isUuid(ticketId)) {
    return jsonResponse(400, { error: 'A valid investigation ticket id is required.' });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return jsonResponse(400, {
      error: 'Investigation tickets need PostgreSQL settings before they can load time entries.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  try {
    const ticket = await getInvestigationTicketById(repositoryContext.pool, ticketId);
    if (!ticket) {
      return jsonResponse(404, { error: 'Investigation ticket not found.' });
    }

    const settingsProvider = createIntegrationSettingsProvider({
      loadLocalEnv: true,
      metadataReader: repositoryContext.repository,
    });
    const connectWiseSettings = await settingsProvider.getIntegrationSettings('connectwise');
    assertConnectWiseReady(connectWiseSettings);
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(connectWiseSettings));
    const entries = await listAllConnectWisePages((page, pageSize) =>
      client.listTimeEntries({
        page,
        pageSize,
        orderBy: 'timeStart desc',
        conditions: `chargeToType="ServiceTicket" and chargeToId=${ticket.connectWiseTicketId}`,
      }),
    );

    return jsonResponse(200, {
      ticket,
      timeEntries: mapConnectWiseTimeEntries(entries),
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : 'Unable to load ticket time entries.',
    });
  } finally {
    await repositoryContext.close();
  }
}

app.http('createInvestigationTickets', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reconciliation/connectwise/investigation-tickets',
  handler: createInvestigationTicketsHttp,
});

app.http('listInvestigationTickets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reconciliation/investigation-tickets',
  handler: listInvestigationTicketsHttp,
});

app.http('listInvestigationTicketTimeEntries', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reconciliation/investigation-tickets/{ticketId}/time-entries',
  handler: listInvestigationTicketTimeEntriesHttp,
});

function parseReconciliationVendorId(value: string | undefined): VendorKey | undefined {
  return value && isVendorKey(value) ? value : undefined;
}

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function listAllConnectWisePages<T>(
  loadPage: (page: number, pageSize: number) => Promise<T[]>,
  pageSize = 100,
) {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const batch = await loadPage(page, pageSize);
    items.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    page += 1;
  }
  return items;
}
