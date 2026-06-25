import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import {
  createReconciliationAdjustment,
  deactivateReconciliationAdjustment,
  type CreateReconciliationAdjustmentInput,
} from '../api/reconciliationAdjustments';
import { listActiveAgreementAdditions, reconcileVendorFromDatabase } from '../api/reconciliationRuns';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

type ReconciliationBody = {
  syncRunId?: string;
};

type ReconciliationAdjustmentBody = CreateReconciliationAdjustmentInput & {
  reviewedBy?: string;
};

export async function runVendorReconciliationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const integrationId = parseIntegrationId(request.params.vendorId);
  if (!integrationId) {
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

  const body = (await request.json().catch(() => ({}))) as ReconciliationBody;

  try {
    const result = await reconcileVendorFromDatabase(repositoryContext.pool, integrationId, {
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

export async function createReconciliationAdjustmentHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;

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

  const body = (await request.json().catch(() => ({}))) as ReconciliationAdjustmentBody;

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

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
