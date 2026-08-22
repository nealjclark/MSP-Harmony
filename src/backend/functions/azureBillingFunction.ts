import { app, output, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as XLSX from '@e965/xlsx';
import {
  addAzureBillingClientComment,
  approveAzureBillingResult,
  acceptAzureBillingShadowRun,
  createAzureBillingRun,
  getAzureBillingApprovalSettings,
  getAzureBillingIngramReadiness,
  getAzureBillingRun,
  holdAzureBillingResult,
  ignoreAzureBillingClientSource,
  listAzureBillingClientExclusions,
  listAzureBillingPolicies,
  listAzureBillingSourceCatalog,
  listAzureBillingReleaseHistory,
  listAzureBillingRuns,
  releaseAzureBillingRun,
  restoreAzureBillingClientSource,
  reviseAzureBillingResult,
  updateAzureBillingApprovalSettings,
  upsertAzureBillingPolicy,
  type UpsertAzureBillingPolicyInput,
} from '../azureBilling/azureBillingService';
import { ConnectWiseClient, connectWiseCredentialsFromSettings } from '../connectwise/client';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import {
  getAzureCostMonitorDashboard,
  getAzureCostMonitorSettings,
  listAzureAdvisorRecommendations,
  listAzureCostMonitorRules,
  listAzureCostMonitorRuns,
  listAzureMonthlyCosts,
  saveAzureCostMonitorRules,
  updateAzureCostFinding,
  type SaveAzureCostMonitorRulesInput,
} from '../azureMonitoring/azureCostMonitorService';
import { buildIntegrationSyncQueueMessage } from '../integrations/syncQueue';
import { requireRole } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';

const azureMonitorSyncQueueOutput = output.storageQueue({
  queueName: 'integration-sync-work',
  connection: 'AzureWebJobsStorage',
});

export async function getAzureCostMonitorHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'SalesRequester');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, await getAzureCostMonitorDashboard(database, {
    status: request.query.get('status')?.trim() || undefined,
    subscriptionId: request.query.get('subscriptionId')?.trim() || undefined,
    customerId: request.query.get('customerId')?.trim() || undefined,
  })));
}

export async function listAzureCostMonitorRunsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'SalesRequester');
  if (auth.response) return auth.response;
  const limit = Number.parseInt(request.query.get('limit') ?? '24', 10);
  return withDatabase(context, async (database) =>
    jsonResponse(200, { runs: await listAzureCostMonitorRuns(database, limit) }));
}

export async function queueAzureCostMonitorRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.repository) return jsonResponse(400, { error: 'Azure monitoring requires PostgreSQL settings.' });
  try {
    const queuedAt = new Date().toISOString();
    const requestedBy = auth.principal.email ?? auth.principal.name;
    const jobId = await repository.repository.createSyncJob({
      integrationId: 'microsoft-azure',
      integrationName: 'Azure - Lighthouse',
      operationKey: 'azure-cost-usage',
      operationLabel: 'Azure Cost Monitor',
      requestedBy,
      requestedAt: queuedAt,
    });
    const message = {
      ...buildIntegrationSyncQueueMessage(
        'microsoft-azure',
        { operationKey: 'azure-cost-usage' },
        requestedBy,
        queuedAt,
      ),
      jobId,
    };
    context.extraOutputs.set(azureMonitorSyncQueueOutput, message);
    return jsonResponse(202, { status: 'queued', jobId, queuedAt });
  } catch (error) {
    return domainError(error);
  } finally {
    await repository.close();
  }
}

export async function getAzureCostMonitorRulesHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'SalesRequester');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, {
    settings: await getAzureCostMonitorSettings(database),
    rules: await listAzureCostMonitorRules(database),
  }));
}

export async function saveAzureCostMonitorRulesHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<SaveAzureCostMonitorRulesInput>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      return jsonResponse(200, await saveAzureCostMonitorRules(
        database,
        body.body,
        auth.principal.email ?? auth.principal.name,
      ));
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function updateAzureCostFindingHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{
    action: 'acknowledge' | 'snooze' | 'resolve';
    note?: string;
    snoozedUntil?: string;
  }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      return jsonResponse(200, { finding: await updateAzureCostFinding(
        database,
        requiredParam(request, 'findingId'),
        body.body,
        auth.principal.email ?? auth.principal.name,
      ) });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function listAzureMonthlyCostsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'SalesRequester');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, { months: await listAzureMonthlyCosts(database) }));
}

export async function listAzureAdvisorRecommendationsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'SalesRequester');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, { recommendations: await listAzureAdvisorRecommendations(database) }));
}

export async function listAzureBillingPoliciesHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, { policies: await listAzureBillingPolicies(database) }));
}

export async function getAzureBillingApprovalSettingsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, { settings: await getAzureBillingApprovalSettings(database) }));
}

export async function saveAzureBillingApprovalSettingsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ approverEmails?: string[] }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, {
        settings: await updateAzureBillingApprovalSettings(database, body.body, actor),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function listAzureBillingSourceCatalogHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, await listAzureBillingSourceCatalog(database)));
}

export async function listAzureBillingClientExclusionsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, { exclusions: await listAzureBillingClientExclusions(database) }));
}

export async function ignoreAzureBillingClientSourceHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{
    sourceType: 'ingram' | 'nerdio';
    externalAccountId: string;
    externalAccountName: string;
    reason: string;
  }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, {
        exclusions: await ignoreAzureBillingClientSource(database, body.body, actor),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function restoreAzureBillingClientSourceHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, {
        exclusions: await restoreAzureBillingClientSource(
          database,
          requiredParam(request, 'exclusionId'),
          actor,
        ),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function saveAzureBillingPolicyHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<UpsertAzureBillingPolicyInput>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, { policy: await upsertAzureBillingPolicy(database, body.body, actor) });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function listAzureBillingRunsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => jsonResponse(200, { runs: await listAzureBillingRuns(database) }));
}

export async function getAzureBillingIngramReadinessHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const billingMonth = request.query.get('billingMonth')?.trim() ?? '';
  return withDatabase(context, async (database) => {
    try {
      return jsonResponse(200, {
        readiness: await getAzureBillingIngramReadiness(database, billingMonth),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function listAzureBillingReleaseHistoryHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) =>
    jsonResponse(200, { releases: await listAzureBillingReleaseHistory(database) }));
}

export async function createAzureBillingRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ billingMonth: string; overwriteExisting?: boolean }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(201, await createAzureBillingRun(database, {
        billingMonth: body.body.billingMonth,
        requestedBy: actor,
        overwriteExisting: body.body.overwriteExisting === true,
      }));
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function getAzureBillingRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  return withDatabase(context, async (database) => {
    try {
      return jsonResponse(200, await getAzureBillingRun(database, requiredParam(request, 'runId')));
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function reviseAzureBillingResultHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<Parameters<typeof reviseAzureBillingResult>[2]>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, { result: await reviseAzureBillingResult(database, requiredParam(request, 'resultId'), body.body, actor) });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function addAzureBillingClientCommentHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ comment: string }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const email = auth.principal.email ?? auth.principal.name;
      return jsonResponse(201, {
        comment: await addAzureBillingClientComment(
          database,
          requiredParam(request, 'resultId'),
          body.body.comment,
          { email, name: auth.principal.name || email },
        ),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function approveAzureBillingResultHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ comment?: string }>(request, { fallback: {} });
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const email = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, {
        result: await approveAzureBillingResult(database, requiredParam(request, 'resultId'), {
          email,
          name: auth.principal.name,
          comment: body.body.comment,
        }),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function holdAzureBillingResultHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Approver');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ reason: string }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, {
        result: await holdAzureBillingResult(database, requiredParam(request, 'resultId'), body.body.reason, actor),
      });
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function releaseAzureBillingRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  if (!auth.principal.roles.some((role) => role === 'Admin' || role === 'Billing')) {
    return jsonResponse(403, { error: 'The Billing or Admin role is required to release Azure billing.' });
  }
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) {
    return jsonResponse(400, { error: 'Azure Billing release requires PostgreSQL settings.' });
  }
  try {
    const settings = await createIntegrationSettingsProvider({
      loadLocalEnv: true,
      metadataReader: repository.repository,
    }).getIntegrationSettings('connectwise');
    const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
    const actor = auth.principal.email ?? auth.principal.name;
    const result = await releaseAzureBillingRun(repository.pool, requiredParam(request, 'runId'), actor, {
      async getAgreementAddition(agreementId, additionId) {
        const additions = await client.listAgreementAdditions(agreementId, {
          conditions: `id=${Number(additionId)}`,
          pageSize: 1,
        });
        const addition = additions.find((item) => String(item.id) === String(additionId));
        if (!addition) throw new Error(`ConnectWise addition ${additionId} no longer exists.`);
        return addition;
      },
      patchAgreementAddition(agreementId, additionId, changes) {
        return client.patchAgreementAddition(agreementId, additionId, [
          ...(changes.quantity === undefined
            ? []
            : [{ op: 'replace' as const, path: '/quantity', value: changes.quantity }]),
          ...(changes.unitCost === undefined
            ? []
            : [{ op: 'replace' as const, path: '/unitCost', value: changes.unitCost }]),
          ...(changes.unitPrice === undefined
            ? []
            : [{ op: 'replace' as const, path: '/unitPrice', value: changes.unitPrice }]),
        ]);
      },
    });
    return jsonResponse(200, result);
  } catch (error) {
    return domainError(error);
  } finally {
    await repository.close();
  }
}

export async function acceptAzureBillingShadowRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;
  const origin = requireMutatingRequestOrigin(request);
  if (origin) return origin;
  const body = await readJsonBody<{ note: string }>(request);
  if (!body.ok) return body.response;
  return withDatabase(context, async (database) => {
    try {
      const actor = auth.principal.email ?? auth.principal.name;
      return jsonResponse(200, await acceptAzureBillingShadowRun(
        database,
        requiredParam(request, 'runId'),
        actor,
        body.body.note,
      ));
    } catch (error) {
      return domainError(error);
    }
  });
}

export async function exportAzureBillingRunHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Azure Billing export requires PostgreSQL settings.' });
  try {
    const detail = await getAzureBillingRun(repository.pool, requiredParam(request, 'runId'));
    const workbook = XLSX.utils.book_new();
    const summaryRows = detail.results.map((result) => ({
      Client: result.customerName,
      Agreement: result.agreementName,
      Addition: result.policyDisplayName,
      Policy: result.policyType,
      Status: result.status,
      Revision: result.revision,
      'Ingram cost': result.ingramCost,
      'Nerdio cost': result.nerdioCost,
      'Invoice count': result.invoiceNerdioCount,
      'Live count': result.liveNerdioCount,
      'External pre-tax': result.externalBeforeTax,
      'External pre-tax override': result.externalPreTaxOverride ?? '',
      'Assigned markup %': result.markupRate === undefined ? '' : result.markupRate * 100,
      'Effective markup %': result.effectiveMarkupRate === undefined ? '' : result.effectiveMarkupRate * 100,
      'Selected count source': result.selectedNerdioCountSource ?? '',
      'Current quantity': result.currentQuantity,
      'Proposed quantity': result.proposedQuantity,
      'Current unit price': result.currentUnitPrice ?? '',
      'Proposed unit price': result.proposedUnitPrice ?? '',
      'Current unit cost': result.currentUnitCost ?? '',
      'Proposed unit cost': result.proposedUnitCost ?? '',
      Approvals: result.approvals.filter((approval) => approval.decision === 'approved').length,
      'Hold reason': result.holdReason ?? '',
      Warnings: result.varianceFlags.join('; '),
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Client review');
    const historyRows = detail.results.flatMap((result) =>
      (result.history ?? []).map((month) => ({
        Client: result.customerName,
        Agreement: result.agreementName,
        Addition: result.policyDisplayName,
        Month: month.billingMonth,
        Status: month.status,
        'Invoice users': month.invoiceNerdioCount,
        'Live users': month.liveNerdioCount,
        'Ingram cost': month.ingramCost,
        'Nerdio cost': month.nerdioCost,
        'Total cost': month.combinedCost,
        'External pre-tax': month.projectedRevenue,
        'External pre-tax override': month.externalPreTaxOverride ?? '',
        'Assigned markup %': month.assignedMarkupRate === undefined ? '' : month.assignedMarkupRate * 100,
        'Effective markup %': month.effectiveMarkupRate === undefined ? '' : month.effectiveMarkupRate * 100,
        Margin: month.projectedMargin,
        Quantity: month.quantity,
        'Unit price': month.unitPrice ?? '',
        'Unit cost': month.unitCost ?? '',
      })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(historyRows), '12 Month History');
    const ingramChangeRows = detail.results.flatMap((result) =>
      result.ingramChanges.map((change) => ({
        Client: result.customerName,
        'Current month': detail.run.billingMonth,
        'Previous month': result.ingramComparisonMonth ?? '',
        Change: change.status,
        Product: change.productName,
        SKU: change.productCode,
        'Previous quantity': change.previousQuantity,
        'Current quantity': change.currentQuantity,
        'Quantity change': change.quantityChange,
        'Unit cost': change.unitCost ?? '',
        'Previous cost': change.previousCost,
        'Current cost': change.currentCost,
        'Cost change': change.costChange,
      })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ingramChangeRows), 'Ingram Changes');
    const evidenceRows = detail.results.flatMap((result) => [
      ...asRecords(result.sourceEvidence.ingramLines).map((line) => ({ Client: result.customerName, Source: 'Ingram', ...line })),
      ...asRecords(result.sourceEvidence.nerdioInvoiceItems).map((line) => ({ Client: result.customerName, Source: 'Nerdio', ...line })),
    ]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(evidenceRows), 'Source detail');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return {
      status: 200,
      body: bytes,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="AzureBilling-${detail.run.billingMonth}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    };
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to export the Azure billing run.', 'azure_billing_export_failed');
  } finally {
    await repository.close();
  }
}

async function withDatabase(
  context: InvocationContext,
  handler: (database: NonNullable<Awaited<ReturnType<typeof createOptionalPostgresSettingsRepository>>['pool']>) => Promise<HttpResponseInit>,
) {
  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool) return jsonResponse(400, { error: 'Azure Billing requires PostgreSQL settings.' });
  try {
    return await handler(repository.pool);
  } catch (error) {
    return serverErrorResponse(context, error, 'Azure Billing request failed.', 'azure_billing_failed');
  } finally {
    await repository.close();
  }
}

function domainError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Azure Billing request failed.';
  const status = /not found/i.test(message) ? 404 : /changed|revision|already|ready|approved|held/i.test(message) ? 409 : 400;
  return jsonResponse(status, { error: message });
}

function requiredParam(request: HttpRequest, name: string) {
  const value = request.params[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

app.http('listAzureBillingPolicies', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/policies', handler: listAzureBillingPoliciesHttp });
app.http('getAzureBillingApprovalSettings', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/settings', handler: getAzureBillingApprovalSettingsHttp });
app.http('saveAzureBillingApprovalSettings', { methods: ['PUT'], authLevel: 'anonymous', route: 'azure-billing/settings', handler: saveAzureBillingApprovalSettingsHttp });
app.http('listAzureBillingSourceCatalog', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/sources', handler: listAzureBillingSourceCatalogHttp });
app.http('listAzureBillingClientExclusions', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/exclusions', handler: listAzureBillingClientExclusionsHttp });
app.http('ignoreAzureBillingClientSource', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/exclusions', handler: ignoreAzureBillingClientSourceHttp });
app.http('restoreAzureBillingClientSource', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/exclusions/{exclusionId}/restore', handler: restoreAzureBillingClientSourceHttp });
app.http('saveAzureBillingPolicy', { methods: ['PUT'], authLevel: 'anonymous', route: 'azure-billing/policies', handler: saveAzureBillingPolicyHttp });
app.http('listAzureBillingRuns', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/runs', handler: listAzureBillingRunsHttp });
app.http('getAzureBillingIngramReadiness', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/ingram-readiness', handler: getAzureBillingIngramReadinessHttp });
app.http('listAzureBillingReleaseHistory', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/releases', handler: listAzureBillingReleaseHistoryHttp });
app.http('createAzureBillingRun', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/runs', handler: createAzureBillingRunHttp });
app.http('getAzureBillingRun', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/runs/{runId}', handler: getAzureBillingRunHttp });
app.http('reviseAzureBillingResult', { methods: ['PATCH'], authLevel: 'anonymous', route: 'azure-billing/results/{resultId}', handler: reviseAzureBillingResultHttp });
app.http('addAzureBillingClientComment', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/results/{resultId}/comments', handler: addAzureBillingClientCommentHttp });
app.http('approveAzureBillingResult', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/results/{resultId}/approve', handler: approveAzureBillingResultHttp });
app.http('holdAzureBillingResult', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/results/{resultId}/hold', handler: holdAzureBillingResultHttp });
app.http('releaseAzureBillingRun', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/runs/{runId}/release', handler: releaseAzureBillingRunHttp });
app.http('acceptAzureBillingShadowRun', { methods: ['POST'], authLevel: 'anonymous', route: 'azure-billing/runs/{runId}/accept-shadow', handler: acceptAzureBillingShadowRunHttp });
app.http('exportAzureBillingRun', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/runs/{runId}/export', handler: exportAzureBillingRunHttp });
app.http('getAzureCostMonitor', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/monitor', handler: getAzureCostMonitorHttp });
app.http('listAzureCostMonitorRuns', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/monitor/runs', handler: listAzureCostMonitorRunsHttp });
app.http('queueAzureCostMonitorRun', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'azure-billing/monitor/runs',
  extraOutputs: [azureMonitorSyncQueueOutput],
  handler: queueAzureCostMonitorRunHttp,
});
app.http('getAzureCostMonitorRules', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/monitor/rules', handler: getAzureCostMonitorRulesHttp });
app.http('saveAzureCostMonitorRules', { methods: ['PUT'], authLevel: 'anonymous', route: 'azure-billing/monitor/rules', handler: saveAzureCostMonitorRulesHttp });
app.http('updateAzureCostFinding', { methods: ['PATCH'], authLevel: 'anonymous', route: 'azure-billing/monitor/findings/{findingId}', handler: updateAzureCostFindingHttp });
app.http('listAzureMonthlyCosts', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/monthly-costs', handler: listAzureMonthlyCostsHttp });
app.http('listAzureAdvisorRecommendations', { methods: ['GET'], authLevel: 'anonymous', route: 'azure-billing/advisor-recommendations', handler: listAzureAdvisorRecommendationsHttp });
