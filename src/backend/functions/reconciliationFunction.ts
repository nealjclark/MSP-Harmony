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
import { listActiveAgreementAdditions, reconcileVendorFromDatabase } from '../api/reconciliationRuns';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseClient, connectWiseCredentialsFromSettings } from '../connectwise/client';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

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

export async function runVendorReconciliationHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

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

  const body = (await request.json().catch(() => ({}))) as ReconciliationBody;

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

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool || !repositoryContext.repository) {
    return jsonResponse(400, {
      error: 'Agreement addition updates need PostgreSQL settings before they can save audit details.',
      missingDatabaseSettings: repositoryContext.missingDatabaseSettings,
    });
  }

  const body = (await request.json().catch(() => ({}))) as AgreementAdditionUpdatesBody;
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

function parseReconciliationVendorId(value: string | undefined): VendorKey | undefined {
  return value && isVendorKey(value) ? value : undefined;
}

function parseIntegrationId(value: string | undefined): IntegrationId | undefined {
  return value && getIntegrationSettingsDefinition(value as IntegrationId) ? (value as IntegrationId) : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
