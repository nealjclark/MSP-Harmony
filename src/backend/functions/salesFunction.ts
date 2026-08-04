import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import { ConnectWiseCpqClient, cpqCredentialsFromSettings, cpqSnapshotHash } from '../sales/cpqClient';
import { SalesQuoteRepository } from '../sales/repository';
import type { SalesQuoteWorkMessage } from '../sales/workflow';
import { hasCapability, requireCapability, type AuthPrincipal } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';

const salesQuoteQueueOutput = output.storageQueue({
  queueName: 'sales-quote-work',
  connection: 'AzureWebJobsStorage',
});

type MutationBody = {
  expectedRevision?: unknown;
  comment?: unknown;
};

export async function listSalesQuoteRequestsHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.read-own');
  if (auth.response) return auth.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requests = await repository.listRequests(accessFor(auth.principal));
    return jsonResponse(200, { requests });
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to load sales quote requests.', 'sales_requests_load_failed');
  }
}

export async function getSalesQuoteRequestHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.read-own');
  if (auth.response) return auth.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const detail = await repository.getRequest(requiredRouteId(request), accessFor(auth.principal));
    return detail ? jsonResponse(200, { request: detail }) : jsonResponse(404, { error: 'Quote request was not found.' });
  } catch (error) {
    return salesError(context, error, 'Unable to load the quote request.');
  }
}

export async function commentSalesQuoteRequestHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.comment');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<MutationBody>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const comment = requiredComment(bodyResult.body.comment);
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requestId = requiredRouteId(request);
    const detail = await repository.getRequest(requestId, accessFor(auth.principal));
    if (!detail) return jsonResponse(404, { error: 'Quote request was not found.' });
    await repository.recordInternalComment(requestId, actor(auth.principal), comment);
    return jsonResponse(201, { request: await repository.getRequest(requestId, accessFor(auth.principal)) });
  } catch (error) {
    return salesError(context, error, 'Unable to add the quote comment.');
  }
}

export async function requestSalesQuoteChangesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.request-changes');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<MutationBody>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requestId = requiredRouteId(request);
    const detail = await repository.getRequest(requestId, accessFor(auth.principal));
    if (!detail) return jsonResponse(404, { error: 'Quote request was not found.' });
    const comment = requiredComment(bodyResult.body.comment);
    await repository.recordInternalComment(requestId, actor(auth.principal), comment);
    const decision = await repository.decide({
      requestId,
      expectedRevision: expectedRevision(bodyResult.body.expectedRevision),
      decision: 'changes-requested',
      actor: actor(auth.principal),
      requesterEmail: detail.requesterEmail,
      idempotencyKey: idempotencyKey(request),
      comment,
    });
    context.extraOutputs.set(salesQuoteQueueOutput, queueMessage(requestId, 'changes-requested'));
    return jsonResponse(200, { decision, request: await repository.getRequest(requestId, accessFor(auth.principal)) });
  } catch (error) {
    return salesError(context, error, 'Unable to request quote changes.');
  }
}

export async function approveSalesQuoteHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.approve');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<MutationBody>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requestId = requiredRouteId(request);
    const detail = await repository.getRequest(requestId);
    if (!detail) return jsonResponse(404, { error: 'Quote request was not found.' });
    const revisionNumber = expectedRevision(bodyResult.body.expectedRevision);
    const revision = detail.revisions.find((candidate) => candidate.revision === revisionNumber);
    if (!revision) return jsonResponse(409, { error: 'The expected quote revision no longer exists.' });
    if (!revision.policy.passed) {
      return jsonResponse(409, {
        error: 'Quote approval is blocked by deterministic policy checks.',
        blockers: revision.policy.blockers,
      });
    }
    if (!detail.cpqQuoteId) return jsonResponse(409, { error: 'The quote request has no CPQ draft.' });
    const cpq = await createCpqClient(database.pool);
    const liveQuote = await cpq.client.getQuote(detail.cpqQuoteId);
    const liveHash = cpqSnapshotHash(liveQuote);
    if (revision.cpqSnapshotHash && revision.cpqSnapshotHash !== liveHash) {
      return jsonResponse(409, {
        error: 'The CPQ quote changed after this revision was created. Retry the request to refresh and revalidate it.',
        code: 'cpq_snapshot_changed',
      });
    }
    const decision = await repository.decide({
      requestId,
      expectedRevision: revisionNumber,
      decision: 'approved',
      actor: actor(auth.principal),
      requesterEmail: detail.requesterEmail,
      idempotencyKey: idempotencyKey(request),
      comment: optionalComment(bodyResult.body.comment),
    });
    let manualTransitionRequired = false;
    let transitionError: string | undefined;
    const settings = await repository.getSettings();
    try {
      const transitioned = await cpq.client.setStatus(detail.cpqQuoteId, settings.cpqReadyStatus);
      await repository.setExternalReferences({
        requestId,
        cpqSnapshotHash: cpqSnapshotHash(transitioned),
        manualTransitionRequired: false,
      });
    } catch (error) {
      manualTransitionRequired = true;
      transitionError = error instanceof Error ? error.message : 'CPQ status transition failed.';
      await repository.setExternalReferences({ requestId, manualTransitionRequired: true });
      await repository.recordInternalComment(
        requestId,
        'MSP Harmony Quote Agent',
        `Approval was recorded, but CPQ must be moved to "${settings.cpqReadyStatus}" manually: ${transitionError}`,
      );
    }
    return jsonResponse(200, {
      decision,
      manualTransitionRequired,
      transitionError,
      request: await repository.getRequest(requestId),
    });
  } catch (error) {
    return salesError(context, error, 'Unable to approve the quote.');
  }
}

export async function rejectSalesQuoteHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.reject');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<MutationBody>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requestId = requiredRouteId(request);
    const detail = await repository.getRequest(requestId);
    if (!detail) return jsonResponse(404, { error: 'Quote request was not found.' });
    const decision = await repository.decide({
      requestId,
      expectedRevision: expectedRevision(bodyResult.body.expectedRevision),
      decision: 'rejected',
      actor: actor(auth.principal),
      requesterEmail: detail.requesterEmail,
      idempotencyKey: idempotencyKey(request),
      comment: requiredComment(bodyResult.body.comment),
    });
    return jsonResponse(200, { decision, request: await repository.getRequest(requestId) });
  } catch (error) {
    return salesError(context, error, 'Unable to reject the quote.');
  }
}

export async function retrySalesQuoteHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.requests.retry');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const repository = new SalesQuoteRepository(database.pool);
    const requestId = requiredRouteId(request);
    const detail = await repository.getRequest(requestId);
    if (!detail) return jsonResponse(404, { error: 'Quote request was not found.' });
    if (!['failed', 'awaiting-clarification', 'changes-requested', 'received'].includes(detail.status)) {
      return jsonResponse(409, { error: `A ${detail.status} request cannot be retried.` });
    }
    context.extraOutputs.set(salesQuoteQueueOutput, queueMessage(requestId, 'retry'));
    return jsonResponse(202, { queued: true, requestId });
  } catch (error) {
    return salesError(context, error, 'Unable to retry the quote request.');
  }
}

export async function getSalesSettingsHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    return jsonResponse(200, { settings: await new SalesQuoteRepository(database.pool).getSettings() });
  } catch (error) {
    return salesError(context, error, 'Unable to load sales settings.');
  }
}

export async function updateSalesSettingsHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<unknown>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const settings = await new SalesQuoteRepository(database.pool).updateSettings(bodyResult.body, actor(auth.principal));
    return jsonResponse(200, { settings });
  } catch (error) {
    return salesError(context, error, 'Unable to update sales settings.');
  }
}

export async function listSalesTemplatesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    return jsonResponse(200, { templates: await new SalesQuoteRepository(database.pool).listTemplates() });
  } catch (error) {
    return salesError(context, error, 'Unable to load governed sales templates.');
  }
}

export async function getSalesTemplateRulesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const template = await new SalesQuoteRepository(database.pool).getActiveTemplate(request.params.templateId);
    return template ? jsonResponse(200, { template }) : jsonResponse(404, { error: 'Template rules were not found.' });
  } catch (error) {
    return salesError(context, error, 'Unable to load template rules.');
  }
}

export async function updateSalesTemplateRulesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const bodyResult = await readJsonBody<Record<string, unknown>>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const payload = {
      ...bodyResult.body,
      cpqTemplateId: bodyResult.body.cpqTemplateId ?? request.params.templateId,
    };
    const template = await new SalesQuoteRepository(database.pool).publishTemplate(payload, actor(auth.principal));
    return jsonResponse(201, { template });
  } catch (error) {
    return salesError(context, error, 'Unable to publish template rules.');
  }
}

export async function syncSalesTemplatesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const cpq = await createCpqClient(database.pool);
    return jsonResponse(200, { templates: await cpq.client.listTemplates() });
  } catch (error) {
    return salesError(context, error, 'Unable to sync CPQ templates.');
  }
}

export async function verifyCpqCapabilitiesHttp(request: HttpRequest, context: InvocationContext) {
  const auth = await requireCapability(request, 'sales.settings.manage');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const database = await createOptionalPostgresSettingsRepository();
  if (!database.pool) return missingDatabase(database.missingDatabaseSettings);
  try {
    const cpq = await createCpqClient(database.pool);
    return jsonResponse(200, { capabilities: await cpq.client.verifyCapabilities() });
  } catch (error) {
    return salesError(context, error, 'Unable to verify CPQ capabilities.');
  }
}

async function createCpqClient(pool: NonNullable<Awaited<ReturnType<typeof createOptionalPostgresSettingsRepository>>['pool']>) {
  const provider = createIntegrationSettingsProvider({
    metadataReader: new PostgresIntegrationSettingsRepository(pool),
  });
  const settings = await provider.getIntegrationSettings('connectwise-cpq');
  if (settings.validation.configuredStatus !== 'connected') {
    throw new Error('ConnectWise CPQ / Sell is not configured.');
  }
  return {
    client: new ConnectWiseCpqClient(cpqCredentialsFromSettings(settings)),
    settings,
  };
}

function accessFor(principal: AuthPrincipal) {
  return {
    requesterEmail: principal.email,
    canReadAll: hasCapability(principal, 'sales.requests.read-all'),
  };
}

function actor(principal: AuthPrincipal) {
  return principal.email ?? principal.name;
}

function requiredRouteId(request: HttpRequest) {
  const value = request.params.requestId?.trim();
  if (!value) throw new Error('Quote request route id is required.');
  return value;
}

function expectedRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error('expectedRevision must be a positive integer.');
  return revision;
}

function requiredComment(value: unknown) {
  const comment = optionalComment(value);
  if (!comment) throw new Error('A comment is required.');
  return comment;
}

function optionalComment(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 5000) : undefined;
}

function idempotencyKey(request: HttpRequest) {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value) throw new Error('Idempotency-Key header is required.');
  return value.slice(0, 200);
}

function queueMessage(requestId: string, reason: SalesQuoteWorkMessage['reason']): SalesQuoteWorkMessage {
  return { requestId, reason, queuedAt: new Date().toISOString() };
}

function missingDatabase(missing: string[]): HttpResponseInit {
  return jsonResponse(500, {
    error: 'PostgreSQL settings are required for Sales.',
    missingDatabaseSettings: missing,
  });
}

function salesError(context: InvocationContext, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/not found/i.test(message)) return jsonResponse(404, { error: message });
  if (/revision changed|cannot be retried|cannot transition|awaiting approval/i.test(message)) {
    return jsonResponse(409, { error: message });
  }
  if (
    /required|must be|invalid|cannot approve|permission|between|only a quote|not configured/i.test(message)
  ) {
    return jsonResponse(400, { error: message });
  }
  return serverErrorResponse(context, error, fallback, 'sales_request_failed');
}

app.http('listSalesQuoteRequests', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests',
  handler: listSalesQuoteRequestsHttp,
});

app.http('getSalesQuoteRequest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}',
  handler: getSalesQuoteRequestHttp,
});

app.http('commentSalesQuoteRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}/comments',
  handler: commentSalesQuoteRequestHttp,
});

app.http('requestSalesQuoteChanges', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}/request-changes',
  extraOutputs: [salesQuoteQueueOutput],
  handler: requestSalesQuoteChangesHttp,
});

app.http('approveSalesQuote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}/approve',
  handler: approveSalesQuoteHttp,
});

app.http('rejectSalesQuote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}/reject',
  handler: rejectSalesQuoteHttp,
});

app.http('retrySalesQuote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/quote-requests/{requestId}/retry',
  extraOutputs: [salesQuoteQueueOutput],
  handler: retrySalesQuoteHttp,
});

app.http('getSalesSettings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'sales/settings',
  handler: getSalesSettingsHttp,
});

app.http('updateSalesSettings', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'sales/settings',
  handler: updateSalesSettingsHttp,
});

app.http('listSalesTemplates', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'sales/templates',
  handler: listSalesTemplatesHttp,
});

app.http('getSalesTemplateRules', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'sales/templates/{templateId}/rules',
  handler: getSalesTemplateRulesHttp,
});

app.http('updateSalesTemplateRules', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'sales/templates/{templateId}/rules',
  handler: updateSalesTemplateRulesHttp,
});

app.http('syncSalesTemplates', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/templates/sync',
  handler: syncSalesTemplatesHttp,
});

app.http('verifyCpqCapabilities', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sales/cpq/capabilities',
  handler: verifyCpqCapabilitiesHttp,
});
