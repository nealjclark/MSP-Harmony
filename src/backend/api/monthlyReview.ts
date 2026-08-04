import {
  monthlyReviewSourceDefinitions,
  type MonthlyReviewAdditionSnapshot,
  type MonthlyReviewDisposition,
  type MonthlyReviewFinding,
  type MonthlyReviewReadiness,
  type MonthlyReviewReadinessSource,
  type MonthlyReviewRunDetail,
  type MonthlyReviewRunSummary,
  type MonthlyReviewSourceKind,
  type MonthlyReviewVendorEvidence,
} from '../../shared/monthlyReview';
import type { IntegrationId } from '../../shared/integrationSettings';
import { vendorDatapointVendorId, type VendorKey } from '../../shared/vendorDatapoints';
import { listMonthlyReviewProductExclusions } from '../mapping/monthlyReviewProductExclusions';
import { listNcentralSiteMappings } from '../mapping/ncentralSiteMappings';
import { reconcileVendorFromDatabase, type DatabaseReconciliationLine } from './reconciliationRuns';
import type { ReconciliationAgreementAdditionUpdateInput } from './reconciliationAgreementUpdates';
import type { Queryable } from '../vendor/cove/operations';

type Row = Record<string, unknown>;

type ReadinessInput = {
  now?: string;
};

type CreateRunInput = {
  billingMonth: string;
  actor: string;
  overrideReason?: string;
  allowWarnings?: boolean;
  supersedesRunId?: string;
  restartFromRunId?: string;
  restartReason?: string;
};

type UpdateFindingInput = {
  disposition?: MonthlyReviewDisposition;
  dispositionReason?: string;
  selectedSourceKey?: string;
  selectedQuantity?: number;
  ticketIds?: string[];
};

const liveWindowMs = 48 * 60 * 60 * 1000;
const inactivePattern = 'expired|cancelled|canceled|inactive';
const resolvedDispositions = new Set<MonthlyReviewDisposition>([
  'auto-passed',
  'applied',
  'skipped',
  'ignored',
  'ticketed',
]);

export async function getMonthlyReviewReadiness(
  database: Queryable,
  billingMonth: string,
  input: ReadinessInput = {},
): Promise<MonthlyReviewReadiness> {
  assertBillingMonth(billingMonth);
  const checkedAt = input.now ?? new Date().toISOString();
  const expectedInvoiceMonth = previousMonth(billingMonth);
  const sources: MonthlyReviewReadinessSource[] = [];
  const activeJobs = await loadActiveSyncJobs(database);

  const connectWise = await loadLatestLiveSource(database, {
    id: 'connectwise',
    integrationId: 'connectwise',
    label: 'ConnectWise',
    activeJobs,
  });
  sources.push(connectWise);

  const barracudaVendorId = await resolveBarracudaVendorId(database);
  for (const definition of monthlyReviewSourceDefinitions) {
    if (definition.id === 'barracuda') {
      sources.push(
        barracudaVendorId
          ? await loadLatestInvoiceSource(database, {
              id: definition.id,
              vendorId: barracudaVendorId,
              label: definition.label,
              expectedInvoiceMonth,
            })
          : {
              id: definition.id,
              label: definition.label,
              sourceKind: 'invoice-import',
              state: 'blocked',
              message: 'Create and enable a full-vendor-sync datapoint named Barracuda.',
              canSync: false,
            },
      );
      continue;
    }

    const integrationId = definition.integrationId!;
    if (definition.sourceKind === 'invoice-import') {
      if (integrationId === 'nerdio') {
        sources.push(
          await loadLatestNerdioInvoiceSource(database, {
            id: definition.id,
            vendorId: integrationId,
            label: definition.label,
            expectedInvoiceMonth,
            activeJobs,
          }),
        );
      } else {
        sources.push(
          await loadLatestInvoiceSource(database, {
            id: definition.id,
            vendorId: integrationId,
            label: definition.label,
            expectedInvoiceMonth,
            activeJobs,
          }),
        );
      }
      continue;
    }

    sources.push(
      await loadLatestLiveSource(database, {
        id: definition.id,
        integrationId,
        label: definition.label,
        activeJobs,
      }),
    );
  }

  applyLiveFreshness(sources, checkedAt);
  const blockingReasons = sources
    .filter((source) => source.state === 'blocked')
    .map((source) => `${source.label}: ${source.message}`);
  const warningReasons = sources
    .filter((source) => source.state === 'warning')
    .map((source) => `${source.label}: ${source.message}`);

  return {
    billingMonth,
    expectedInvoiceMonth,
    checkedAt,
    canStart: blockingReasons.length === 0 && warningReasons.length === 0,
    requiresAdminOverride: blockingReasons.length === 0 && warningReasons.length > 0,
    blockingReasons,
    warningReasons,
    sources,
  };
}

export async function createMonthlyReviewRun(
  database: Queryable,
  input: CreateRunInput,
): Promise<MonthlyReviewRunDetail> {
  const readiness = await getMonthlyReviewReadiness(database, input.billingMonth);
  if (readiness.blockingReasons.length > 0) {
    throw new Error(`Monthly Review cannot start: ${readiness.blockingReasons.join(' ')}`);
  }
  if (readiness.warningReasons.length > 0 && !input.allowWarnings) {
    throw new Error('Monthly Review has freshness warnings that require an Admin override.');
  }
  if (readiness.warningReasons.length > 0 && !input.overrideReason?.trim()) {
    throw new Error('An override reason is required when starting with readiness warnings.');
  }
  const freshnessOverrideReason =
    readiness.warningReasons.length > 0 ? input.overrideReason?.trim() : undefined;

  const existingOpen = await database.query<{ id: string }>(
    `select id
       from reconciliation_runs
      where billing_month = $1
        and status = 'in-progress'
        and ($2::uuid is null or id <> $2::uuid)
      limit 1`,
    [input.billingMonth, input.restartFromRunId ?? null],
  );
  if (existingOpen.rows[0]) {
    throw new Error(`An in-progress Monthly Review already exists for ${input.billingMonth}.`);
  }

  const revision = input.supersedesRunId
    ? await nextRevision(database, input.billingMonth, input.supersedesRunId, {
        allowInProgress: input.restartFromRunId === input.supersedesRunId,
      })
    : await nextRevision(database, input.billingMonth);
  const configurationSnapshot = await loadReconciliationConfigurationSnapshot(
    database,
    readiness.sources.map((source) => source.vendorId).filter((vendorId): vendorId is VendorKey => Boolean(vendorId)),
  );
  const runResult = await database.query<{ id: string }>(
    `insert into reconciliation_runs (
       billing_month, status, sync_run_ids, invoice_import_ids, metadata, revision,
       supersedes_run_id, created_by, freshness_override_reason,
       freshness_overridden_by, freshness_overridden_at
     ) values (
       $1, 'in-progress', $2::jsonb, $3::jsonb, $4::jsonb, $5, $6::uuid, $7, $8::text,
       case when $8::text is null then null else $7 end,
       case when $8::text is null then null else now() end
     ) returning id`,
    [
      input.billingMonth,
      JSON.stringify(readiness.sources.map((source) => source.syncRunId).filter(Boolean)),
      JSON.stringify(readiness.sources.map((source) => source.invoiceImportId).filter(Boolean)),
      JSON.stringify({
        readiness,
        expectedInvoiceMonth: readiness.expectedInvoiceMonth,
        configurationSnapshot,
        restartReason: input.restartReason?.trim() || undefined,
      }),
      revision,
      input.supersedesRunId ?? null,
      input.actor,
      freshnessOverrideReason ?? null,
    ],
  );
  const runId = runResult.rows[0]?.id;
  if (!runId) throw new Error('Unable to create the Monthly Review run.');

  try {
    for (const source of readiness.sources) {
      await insertRunSource(database, runId, source);
    }

    const vendorResults: Array<{
      source: MonthlyReviewReadinessSource;
      lines: DatabaseReconciliationLine[];
    }> = [];
    for (const source of readiness.sources.filter((candidate) => candidate.id !== 'connectwise')) {
      if (!source.vendorId) continue;
      const result = await reconcileVendorFromDatabase(database, source.vendorId, {
        syncRunId: source.syncRunId,
      });
      vendorResults.push({ source, lines: result.lines });
    }

    const connectWiseSource = readiness.sources.find((source) => source.id === 'connectwise');
    if (!connectWiseSource?.syncRunId) throw new Error('The frozen ConnectWise agreement sync is missing.');
    const additions = await loadFrozenAgreementAdditions(database, connectWiseSource.syncRunId);
    const grouped = buildMonthlyReviewFindings(vendorResults, additions, {
      cwOnlyExcludedProductCodes: configurationSnapshot.monthlyReviewProductExclusions.map(
        (exclusion) => exclusion.connectWiseProductCode,
      ),
    });
    for (const finding of grouped) {
      await insertFinding(database, runId, finding);
    }

    await insertAuditEvent(database, input.actor, 'reconciliation.monthly.created', 'reconciliation_run', runId, {
      billingMonth: input.billingMonth,
      revision,
      sourceCount: readiness.sources.length,
      findingCount: grouped.length,
      overrideReason: freshnessOverrideReason,
      restartReason: input.restartReason?.trim() || undefined,
    });

    if (input.restartFromRunId) {
      const superseded = await database.query<{ id: string }>(
        `update reconciliation_runs
            set status = 'superseded',
                superseded_reason = $3,
                superseded_by = $2,
                superseded_at = now(),
                locked_at = now()
          where id = $1::uuid
            and status = 'in-progress'
            and locked_at is null
          returning id`,
        [input.restartFromRunId, input.actor, input.restartReason?.trim() || null],
      );
      if (!superseded.rows[0]) {
        throw new Error('The original Monthly Review is no longer open and cannot be restarted.');
      }
      await database.query(
        `update reconciliation_findings
            set locked_at = coalesce(locked_at, now())
          where reconciliation_run_id = $1::uuid`,
        [input.restartFromRunId],
      );
      await insertAuditEvent(
        database,
        input.actor,
        'reconciliation.monthly.restarted',
        'reconciliation_run',
        input.restartFromRunId,
        {
          reason: input.restartReason?.trim(),
          replacementRunId: runId,
          replacementRevision: revision,
        },
      );
    }

    return getMonthlyReviewRun(database, runId);
  } catch (error) {
    await database.query(
      `delete from reconciliation_runs where id = $1::uuid and status = 'in-progress'`,
      [runId],
    );
    throw error;
  }
}

export async function listMonthlyReviewRuns(database: Queryable): Promise<MonthlyReviewRunSummary[]> {
  const result = await database.query<Row>(
    `${runSummarySql()}
     order by billing_month desc, revision desc`,
  );
  return result.rows.map(mapRunSummary);
}

export async function getMonthlyReviewRun(database: Queryable, runId: string): Promise<MonthlyReviewRunDetail> {
  const runResult = await database.query<Row>(`${runSummarySql()} where id = $1::uuid`, [runId]);
  const runRow = runResult.rows[0];
  if (!runRow) throw new Error('Monthly Review run not found.');

  const sourceResult = await database.query<Row>(
    `select vendor_id, display_name, source_kind, sync_run_id, invoice_import_id,
            completed_at, billing_period_start, billing_period_end, readiness_state, readiness_message,
            metadata
       from reconciliation_run_sources
      where reconciliation_run_id = $1::uuid
      order by case when vendor_id = 'connectwise' then 0 else 1 end, display_name`,
    [runId],
  );
  const findingResult = await database.query<Row>(
    `select id, row_key, row_type, customer_id, agreement_id, vendor_id, product_code, product_name,
            source_quantity, agreement_quantity, proposed_quantity, delta, financial_impact, status,
            connectwise_snapshot, selected_source_key, selected_quantity, disposition,
            disposition_reason, reviewed_by, reviewed_at, ticket_ids, write_batch_id
       from reconciliation_findings
      where reconciliation_run_id = $1::uuid
      order by customer_id nulls last, agreement_id nulls last, product_name, id`,
    [runId],
  );
  const sourceEvidenceResult = await database.query<Row>(
    `select sources.*
       from reconciliation_finding_sources sources
       inner join reconciliation_findings findings on findings.id = sources.reconciliation_finding_id
      where findings.reconciliation_run_id = $1::uuid
      order by sources.display_name, sources.product_name`,
    [runId],
  );
  const labels = await loadFindingLabels(database, runId);
  const evidenceByFinding = new Map<string, MonthlyReviewVendorEvidence[]>();
  for (const row of sourceEvidenceResult.rows) {
    const findingId = String(row.reconciliation_finding_id);
    evidenceByFinding.set(findingId, [...(evidenceByFinding.get(findingId) ?? []), mapVendorEvidence(row)]);
  }

  return {
    run: mapRunSummary(runRow),
    sources: sourceResult.rows.map(mapFrozenSource),
    findings: findingResult.rows.map((row) =>
      mapFinding(row, labels.get(String(row.id)), evidenceByFinding.get(String(row.id)) ?? []),
    ),
  };
}

export async function updateMonthlyReviewFinding(
  database: Queryable,
  runId: string,
  findingId: string,
  input: UpdateFindingInput,
  actor: string,
): Promise<MonthlyReviewFinding> {
  await assertRunMutable(database, runId);
  if (input.disposition && !isDisposition(input.disposition)) {
    throw new Error('Unsupported Monthly Review disposition.');
  }
  if (
    input.selectedQuantity !== undefined &&
    (!Number.isFinite(input.selectedQuantity) || input.selectedQuantity < 0)
  ) {
    throw new Error('Selected quantity must be a non-negative number.');
  }
  if (
    input.disposition &&
    ['skipped', 'ignored', 'ticketed'].includes(input.disposition) &&
    !input.dispositionReason?.trim()
  ) {
    throw new Error('A reason is required for this disposition.');
  }

  const result = await database.query<{ id: string }>(
    `update reconciliation_findings
        set disposition = coalesce($3, disposition),
            status = coalesce($3, status),
            disposition_reason = case when $4::text is null then disposition_reason else $4 end,
            selected_source_key = case when $5::text is null then selected_source_key else $5 end,
            selected_quantity = case when $6::numeric is null then selected_quantity else $6 end,
            proposed_quantity = case when $6::numeric is null then proposed_quantity else $6 end,
            delta = case when $6::numeric is null then delta else $6 - agreement_quantity end,
            financial_impact = case
              when $6::numeric is null then financial_impact
              else ($6 - agreement_quantity) * coalesce(
                nullif(connectwise_snapshot->0->>'unitPrice', '')::numeric,
                case when delta <> 0 then financial_impact / delta else 0 end
              )
            end,
            ticket_ids = case when $7::jsonb is null then ticket_ids else $7::jsonb end,
            reviewed_by = $8,
            reviewed_at = now()
      where reconciliation_run_id = $1::uuid and id = $2::uuid
      returning id`,
    [
      runId,
      findingId,
      input.disposition ?? null,
      input.dispositionReason?.trim() ?? null,
      input.selectedSourceKey ?? null,
      input.selectedQuantity ?? null,
      input.ticketIds ? JSON.stringify(input.ticketIds) : null,
      actor,
    ],
  );
  if (!result.rows[0]) throw new Error('Monthly Review finding not found.');
  await insertAuditEvent(database, actor, 'reconciliation.monthly.finding.updated', 'reconciliation_finding', findingId, input);
  const detail = await getMonthlyReviewRun(database, runId);
  return detail.findings.find((finding) => finding.id === findingId)!;
}

export async function completeMonthlyReviewRun(
  database: Queryable,
  runId: string,
  actor: string,
): Promise<MonthlyReviewRunDetail> {
  await assertRunMutable(database, runId);
  const unresolved = await database.query<{ count: string | number }>(
    `select count(*) as count
       from reconciliation_findings
      where reconciliation_run_id = $1::uuid
        and disposition not in ('auto-passed', 'applied', 'skipped', 'ignored', 'ticketed')`,
    [runId],
  );
  const unresolvedCount = Number(unresolved.rows[0]?.count ?? 0);
  if (unresolvedCount > 0) {
    throw new Error(`${unresolvedCount} Monthly Review exception${unresolvedCount === 1 ? '' : 's'} still need resolution.`);
  }

  await database.query(
    `update reconciliation_runs
        set status = 'completed', completed_at = now(), completed_by = $2, locked_at = now()
      where id = $1::uuid`,
    [runId, actor],
  );
  await database.query(
    `update reconciliation_findings set locked_at = now() where reconciliation_run_id = $1::uuid`,
    [runId],
  );
  await insertAuditEvent(database, actor, 'reconciliation.monthly.completed', 'reconciliation_run', runId, {});
  return getMonthlyReviewRun(database, runId);
}

export async function createSupersedingMonthlyReviewRun(
  database: Queryable,
  completedRunId: string,
  input: Omit<CreateRunInput, 'billingMonth' | 'supersedesRunId'>,
) {
  const result = await database.query<{ billing_month: string; status: string }>(
    `select billing_month, status from reconciliation_runs where id = $1::uuid`,
    [completedRunId],
  );
  const original = result.rows[0];
  if (!original || original.status !== 'completed') {
    throw new Error('Only a completed Monthly Review can be superseded.');
  }
  return createMonthlyReviewRun(database, {
    ...input,
    billingMonth: original.billing_month,
    supersedesRunId: completedRunId,
  });
}

export async function restartMonthlyReviewRun(
  database: Queryable,
  openRunId: string,
  input: Omit<CreateRunInput, 'billingMonth' | 'supersedesRunId' | 'restartFromRunId' | 'restartReason'> & {
    reason: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error('Restarting a Monthly Review requires a reason.');
  }
  const result = await database.query<{ billing_month: string; status: string; locked_at: unknown }>(
    `select billing_month, status, locked_at
       from reconciliation_runs
      where id = $1::uuid`,
    [openRunId],
  );
  const original = result.rows[0];
  if (!original || original.status !== 'in-progress' || original.locked_at) {
    throw new Error('Only an open Monthly Review can be restarted.');
  }
  return createMonthlyReviewRun(database, {
    ...input,
    billingMonth: original.billing_month,
    supersedesRunId: openRunId,
    restartFromRunId: openRunId,
    restartReason: reason,
  });
}

export async function loadApprovedMonthlyReviewUpdates(
  database: Queryable,
  runId: string,
): Promise<ReconciliationAgreementAdditionUpdateInput[]> {
  await assertRunMutable(database, runId);
  const detail = await getMonthlyReviewRun(database, runId);
  return detail.findings
    .filter((finding) => finding.disposition === 'approved')
    .map((finding) => {
      const addition = finding.additions[0];
      if (!addition || finding.additions.length !== 1 || finding.selectedQuantity === undefined) {
        throw new Error(`${finding.productName} needs one selected ConnectWise addition and quantity before it can be applied.`);
      }
      const selectedEvidenceKind = monthlyReviewSelectedEvidenceKind(finding.selectedSourceKey);
      const selectedEvidenceId = selectedEvidenceKind
        ? finding.selectedSourceKey!.slice(0, -(selectedEvidenceKind.length + 1))
        : finding.selectedSourceKey;
      const selectedEvidence = finding.vendors.find((vendor) => vendor.id === selectedEvidenceId);
      return {
        sourceLineId: finding.id,
        vendorId: selectedEvidence?.vendorId ?? finding.vendors[0]?.vendorId ?? 'monthly-review',
        customerId: finding.customerId,
        customerName: finding.customerName,
        agreementId: finding.agreementId!,
        agreementName: finding.agreementName,
        connectWiseAdditionId: addition.connectWiseAdditionId,
        productCode: addition.productCode,
        productName: addition.productName,
        currentQuantity: addition.quantity,
        quantity: finding.selectedQuantity,
        manualQuantity: finding.selectedSourceKey === 'manual' ? finding.selectedQuantity : undefined,
        apiQuantity: selectedEvidence?.apiQuantity,
        invoiceQuantity: selectedEvidence?.invoiceQuantity,
        selectedSource:
          finding.selectedSourceKey === 'manual'
            ? 'manual'
            : selectedEvidenceKind
              ? selectedEvidenceKind
              : selectedEvidence?.invoiceQuantity !== undefined
              ? 'invoice'
              : selectedEvidence?.linkedQuantity !== undefined
                ? 'linked'
                : 'api',
      };
    });
}

function monthlyReviewSelectedEvidenceKind(selectedSourceKey: string | undefined) {
  const match = selectedSourceKey?.match(/:(api|invoice|linked)$/);
  return match?.[1] as 'api' | 'invoice' | 'linked' | undefined;
}

export async function recordMonthlyReviewApplyResult(
  database: Queryable,
  runId: string,
  batchId: string,
  items: Array<{ sourceLineId: string; status: 'written' | 'failed' | 'discarded'; error?: string }>,
  actor: string,
) {
  for (const item of items) {
    await database.query(
      `update reconciliation_findings
          set disposition = case when $4 = 'written' then 'applied' else 'needs-action' end,
              status = case when $4 = 'written' then 'applied' else 'needs-action' end,
              disposition_reason = case when $4 = 'written' then disposition_reason else $5 end,
              write_batch_id = $3::uuid,
              reviewed_by = $6,
              reviewed_at = now()
        where reconciliation_run_id = $1::uuid and id = $2::uuid`,
      [runId, item.sourceLineId, batchId, item.status, item.error ?? null, actor],
    );
  }
}

export function buildMonthlyReviewFindings(
  vendorResults: Array<{ source: MonthlyReviewReadinessSource; lines: DatabaseReconciliationLine[] }>,
  additions: Array<MonthlyReviewAdditionSnapshot & { customerId: string; customerName: string; agreementId: string; agreementName: string }>,
  options: { cwOnlyExcludedProductCodes?: string[] } = {},
): MonthlyReviewFinding[] {
  const additionsById = new Map(additions.map((addition) => [addition.connectWiseAdditionId, addition]));
  const groups = new Map<string, MonthlyReviewFinding>();
  const claimedAdditionIds = new Set<string>();
  const cwOnlyExcludedProductCodes = new Set(
    (options.cwOnlyExcludedProductCodes ?? []).map(normalizeProductCode),
  );

  for (const { source, lines } of vendorResults) {
    for (const line of lines) {
      const matchedIds = (line.matchedAgreementAdditions ?? [])
        .map((addition) => addition.connectWiseAdditionId)
        .filter(Boolean)
        .sort();
      const rowKey =
        matchedIds.length > 0
          ? `${line.agreementId}|cw|${matchedIds.join(',')}`
          : `${line.agreementId}|vendor|${normalizeKey(line.productCode)}`;
      const matchedAdditions = matchedIds
        .map((id) => additionsById.get(id))
        .filter((addition): addition is (typeof additions)[number] => Boolean(addition));
      matchedIds.forEach((id) => claimedAdditionIds.add(id));
      const selectedCandidates = [
        line.sourceQuantity,
        line.invoiceQuantity,
        line.linkedCount?.quantity,
      ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const proposedQuantity = line.proposedQuantity;
      const evidence: MonthlyReviewVendorEvidence = {
        id: `${source.vendorId}:${line.id}`,
        vendorId: source.vendorId!,
        label: source.label,
        sourceKind: source.sourceKind,
        syncRunId: source.syncRunId,
        invoiceImportId: source.invoiceImportId ?? line.invoiceImportId,
        vendorProductKey: line.vendorProductKey,
        sourceAccountId: line.sourceAccountId,
        productCode: line.productCode,
        productName: line.productName,
        apiQuantity: line.sourceQuantity,
        invoiceQuantity: line.invoiceQuantity,
        linkedQuantity: line.linkedCount?.quantity,
        proposedQuantity,
        rawRowIds: (line.devices ?? []).map((device) => device.id),
        evidence: line.evidence,
      };
      const existing = groups.get(rowKey);
      if (!existing) {
        const currentQuantity = matchedAdditions.reduce((total, addition) => total + addition.quantity, 0);
        const isPass = line.status === 'matched' && proposedQuantity === currentQuantity;
        groups.set(rowKey, {
          id: '',
          rowKey,
          rowType: matchedAdditions.length > 0 ? 'agreement-addition' : 'vendor-only',
          customerId: line.clientId,
          customerName: line.customerName ?? matchedAdditions[0]?.customerName ?? `Customer ${line.clientId}`,
          agreementId: line.agreementId,
          agreementName: line.agreementName ?? matchedAdditions[0]?.agreementName ?? `Agreement ${line.agreementId}`,
          productCode: matchedAdditions[0]?.productCode ?? line.productCode,
          productName: matchedAdditions[0]?.productName ?? line.productName,
          currentQuantity,
          proposedQuantity,
          selectedQuantity: selectedCandidates.length > 0 ? proposedQuantity : undefined,
          selectedSourceKey: evidence.id,
          delta: proposedQuantity - currentQuantity,
          financialImpact: line.financialImpact.amount,
          disposition: isPass ? 'auto-passed' : line.status === 'unmapped' ? 'needs-action' : 'needs-action',
          ticketIds: [],
          additions: matchedAdditions,
          vendors: [evidence],
        });
        continue;
      }

      existing.vendors.push(evidence);
      const proposedValues = new Set(existing.vendors.map((vendor) => vendor.proposedQuantity));
      if (proposedValues.size > 1) {
        existing.disposition = 'needs-source';
        existing.selectedQuantity = undefined;
        existing.selectedSourceKey = undefined;
        existing.proposedQuantity = existing.currentQuantity;
        existing.delta = 0;
      } else if (existing.vendors.every((vendor) => vendor.proposedQuantity === existing.currentQuantity)) {
        existing.disposition = 'auto-passed';
      }
      existing.financialImpact = Math.abs(line.financialImpact.amount) > Math.abs(existing.financialImpact)
        ? line.financialImpact.amount
        : existing.financialImpact;
    }
  }

  for (const addition of additions) {
    if (claimedAdditionIds.has(addition.connectWiseAdditionId)) continue;
    if (cwOnlyExcludedProductCodes.has(normalizeProductCode(addition.productCode))) continue;
    const rowKey = `${addition.agreementId}|cw-only|${addition.connectWiseAdditionId}`;
    groups.set(rowKey, {
      id: '',
      rowKey,
      rowType: 'cw-only',
      customerId: addition.customerId,
      customerName: addition.customerName,
      agreementId: addition.agreementId,
      agreementName: addition.agreementName,
      productCode: addition.productCode,
      productName: addition.productName,
      currentQuantity: addition.quantity,
      proposedQuantity: addition.quantity,
      selectedQuantity: addition.quantity,
      delta: 0,
      financialImpact: 0,
      disposition: 'needs-action',
      dispositionReason: 'No Monthly Review vendor evidence correlated to this active ConnectWise addition.',
      ticketIds: [],
      additions: [addition],
      vendors: [],
    });
  }

  return [...groups.values()].sort(
    (left, right) =>
      left.customerName.localeCompare(right.customerName) ||
      left.agreementName.localeCompare(right.agreementName) ||
      left.productName.localeCompare(right.productName),
  );
}

async function loadFrozenAgreementAdditions(database: Queryable, syncRunId: string) {
  const result = await database.query<Row>(
    `select addition_history.agreement_addition_id as id,
            agreement_additions.connectwise_addition_id,
            agreements.connectwise_agreement_id,
            addition_history.product_code,
            coalesce(nullif(addition_history.raw_payload->>'description', ''), agreement_additions.product_name) as product_name,
            addition_history.observed_quantity,
            addition_history.unit_price,
            addition_history.addition_status,
            addition_history.raw_payload,
            addition_history.customer_id,
            customers.name as customer_name,
            addition_history.agreement_id,
            agreements.name as agreement_name
       from addition_history
       inner join agreement_additions on agreement_additions.id = addition_history.agreement_addition_id
       inner join customers on customers.id = addition_history.customer_id
       inner join agreements on agreements.id = addition_history.agreement_id
      where addition_history.sync_run_id = $1::uuid
        and coalesce(addition_history.addition_status, '') !~* $2
        and coalesce(addition_history.raw_payload->>'additionStatus', '') !~* $2
        and coalesce(addition_history.raw_payload->>'agreementStatus', '') !~* $2
      order by customers.name, agreements.name, addition_history.product_code`,
    [syncRunId, inactivePattern],
  );
  return result.rows.map((row) => {
    const raw = recordValue(row.raw_payload);
    return {
      id: String(row.id),
      connectWiseAdditionId: String(row.connectwise_addition_id),
      connectWiseAgreementId: String(row.connectwise_agreement_id),
      productCode: String(row.product_code),
      productName: String(row.product_name),
      quantity: numberValue(row.observed_quantity),
      lessIncluded: optionalNumber(raw.lessIncluded),
      billedQuantity: optionalNumber(raw.billedQuantity),
      unitPrice: optionalNumber(row.unit_price),
      additionStatus: String(row.addition_status ?? 'Active'),
      customerId: String(row.customer_id),
      customerName: String(row.customer_name),
      agreementId: String(row.agreement_id),
      agreementName: String(row.agreement_name),
    };
  });
}

async function insertFinding(database: Queryable, runId: string, finding: MonthlyReviewFinding) {
  const primaryVendor = finding.vendors[0]?.vendorId ?? 'connectwise';
  const result = await database.query<{ id: string }>(
    `insert into reconciliation_findings (
       reconciliation_run_id, customer_id, agreement_id, vendor_id, product_code, product_name,
       source_quantity, agreement_quantity, proposed_quantity, delta, financial_impact, status,
       reason, evidence, row_key, row_type, connectwise_addition_ids, connectwise_snapshot,
       selected_source_key, selected_quantity, disposition, disposition_reason, ticket_ids
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23::jsonb
     ) returning id`,
    [
      runId,
      finding.customerId ?? null,
      finding.agreementId ?? null,
      primaryVendor,
      finding.productCode,
      finding.productName,
      finding.vendors[0]?.apiQuantity ?? 0,
      finding.currentQuantity,
      finding.proposedQuantity,
      finding.delta,
      finding.financialImpact,
      finding.disposition,
      finding.dispositionReason ?? '',
      JSON.stringify(finding.vendors.flatMap((vendor) => vendor.evidence)),
      finding.rowKey,
      finding.rowType,
      JSON.stringify(finding.additions.map((addition) => addition.connectWiseAdditionId)),
      JSON.stringify(finding.additions),
      finding.selectedSourceKey ?? null,
      finding.selectedQuantity ?? null,
      finding.disposition,
      finding.dispositionReason ?? null,
      JSON.stringify(finding.ticketIds),
    ],
  );
  const findingId = result.rows[0]?.id;
  if (!findingId) throw new Error('Unable to save a Monthly Review finding.');
  for (const vendor of finding.vendors) {
    await database.query(
      `insert into reconciliation_finding_sources (
         reconciliation_finding_id, source_key, vendor_id, display_name, source_kind, sync_run_id,
         invoice_import_id, vendor_product_key, source_account_id, product_code, product_name,
         source_quantity, invoice_quantity, linked_quantity, proposed_quantity, raw_row_ids, evidence
       ) values (
         $1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11,
         $12, $13, $14, $15, $16::jsonb, $17::jsonb
       )`,
      [
        findingId,
        vendor.id,
        vendor.vendorId,
        vendor.label,
        vendor.sourceKind,
        vendor.syncRunId ?? null,
        vendor.invoiceImportId ?? null,
        vendor.vendorProductKey ?? null,
        vendor.sourceAccountId ?? null,
        vendor.productCode,
        vendor.productName,
        vendor.apiQuantity ?? null,
        vendor.invoiceQuantity ?? null,
        vendor.linkedQuantity ?? null,
        vendor.proposedQuantity,
        JSON.stringify(vendor.rawRowIds),
        JSON.stringify(vendor.evidence),
      ],
    );
  }
}

async function insertRunSource(
  database: Queryable,
  runId: string,
  source: MonthlyReviewReadinessSource,
) {
  await database.query(
    `insert into reconciliation_run_sources (
       reconciliation_run_id, vendor_id, display_name, source_kind, sync_run_id, invoice_import_id,
       completed_at, billing_period_start, billing_period_end, readiness_state, readiness_message, metadata
     ) values (
       $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::timestamptz, $8::date, $9::date, $10, $11, $12::jsonb
     )`,
    [
      runId,
      source.vendorId ?? source.integrationId ?? source.id,
      source.label,
      source.sourceKind,
      source.syncRunId ?? null,
      source.invoiceImportId ?? null,
      source.completedAt ?? null,
      source.billingPeriodStart ?? null,
      source.billingPeriodEnd ?? null,
      source.state,
      source.message,
      JSON.stringify({ sourceId: source.id, canSync: source.canSync }),
    ],
  );
}

async function loadLatestLiveSource(
  database: Queryable,
  input: { id: string; integrationId: string; label: string; activeJobs: Set<string> },
): Promise<MonthlyReviewReadinessSource> {
  const activeJob = input.activeJobs.has(input.integrationId);
  if (activeJob) {
    return {
      id: input.id,
      vendorId: input.integrationId as VendorKey,
      integrationId: input.integrationId as IntegrationId,
      label: input.label,
      sourceKind: 'live-sync',
      state: 'blocked',
      message: 'A required sync is queued or running.',
      canSync: true,
      activeJob: true,
    };
  }
  const result = await database.query<Row>(
    `select id, completed_at
       from sync_runs
      where integration_id = $1 and status = 'complete'
        and coalesce(metadata->>'syncMode', 'full-vendor-sync') <> 'info-only'
      order by completed_at desc nulls last, started_at desc
      limit 1`,
    [input.integrationId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      id: input.id,
      vendorId: input.integrationId as VendorKey,
      integrationId: input.integrationId as IntegrationId,
      label: input.label,
      sourceKind: 'live-sync',
      state: 'blocked',
      message: 'No completed sync is available.',
      canSync: true,
    };
  }
  return {
    id: input.id,
    vendorId: input.integrationId as VendorKey,
    integrationId: input.integrationId as IntegrationId,
    label: input.label,
    sourceKind: 'live-sync',
    state: 'ready',
    message: 'Completed live source is available.',
    syncRunId: String(row.id),
    completedAt: isoDate(row.completed_at),
    canSync: true,
  };
}

async function loadLatestInvoiceSource(
  database: Queryable,
  input: {
    id: string;
    vendorId: VendorKey;
    label: string;
    expectedInvoiceMonth: string;
    activeJobs?: Set<string>;
  },
): Promise<MonthlyReviewReadinessSource> {
  if (input.activeJobs?.has(input.vendorId)) {
    return {
      id: input.id,
      vendorId: input.vendorId,
      integrationId: isBuiltinVendor(input.vendorId) ? input.vendorId : undefined,
      label: input.label,
      sourceKind: 'invoice-import',
      state: 'blocked',
      message: 'A required invoice synchronization is queued or running.',
      canSync: isBuiltinVendor(input.vendorId),
      activeJob: true,
    };
  }
  const result = await database.query<Row>(
    `select id, imported_at, invoice_date, billing_period_start, billing_period_end
       from invoice_imports
      where vendor_id = $1
        and coalesce(raw_summary->>'syncMode', 'full-vendor-sync') <> 'info-only'
      order by invoice_date desc nulls last, imported_at desc
      limit 1`,
    [input.vendorId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      id: input.id,
      vendorId: input.vendorId,
      integrationId: isBuiltinVendor(input.vendorId) ? input.vendorId : undefined,
      label: input.label,
      sourceKind: 'invoice-import',
      state: 'blocked',
      message: 'No completed invoice import is available.',
      canSync: isBuiltinVendor(input.vendorId),
    };
  }
  const invoiceImportId = String(row.id);
  const syncRun = await database.query<Row>(
    `select id, completed_at
       from sync_runs
      where integration_id = $1 and status = 'complete'
        and (
          metadata->>'invoiceImportId' = $2
          or coalesce(metadata->'invoiceImportIds', '[]'::jsonb) ? $2
        )
      order by completed_at desc nulls last
      limit 1`,
    [input.vendorId, invoiceImportId],
  );
  const periodStart = dateOnly(row.billing_period_start ?? row.invoice_date);
  const periodEnd = dateOnly(row.billing_period_end ?? row.invoice_date);
  const matches = periodIncludesMonth(periodStart, periodEnd, input.expectedInvoiceMonth);
  return {
    id: input.id,
    vendorId: input.vendorId,
    integrationId: isBuiltinVendor(input.vendorId) ? input.vendorId : undefined,
    label: input.label,
    sourceKind: 'invoice-import',
    state: matches ? 'ready' : 'warning',
    message: matches
      ? `Invoice evidence covers ${input.expectedInvoiceMonth}.`
      : `Latest invoice evidence does not cover ${input.expectedInvoiceMonth}.`,
    syncRunId: syncRun.rows[0]?.id ? String(syncRun.rows[0].id) : undefined,
    invoiceImportId,
    completedAt: isoDate(syncRun.rows[0]?.completed_at ?? row.imported_at),
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    canSync: isBuiltinVendor(input.vendorId),
  };
}

async function loadLatestNerdioInvoiceSource(
  database: Queryable,
  input: {
    id: string;
    vendorId: VendorKey;
    label: string;
    expectedInvoiceMonth: string;
    activeJobs: Set<string>;
  },
): Promise<MonthlyReviewReadinessSource> {
  if (input.activeJobs.has(input.vendorId)) {
    return {
      id: input.id,
      vendorId: input.vendorId,
      integrationId: 'nerdio',
      label: input.label,
      sourceKind: 'invoice-import',
      state: 'blocked',
      message: 'A required invoice synchronization is queued or running.',
      canSync: true,
      activeJob: true,
    };
  }
  const result = await database.query<Row>(
    `select runs.id, runs.completed_at,
            min(items.billing_period_start) as billing_period_start,
            max(items.billing_period_end) as billing_period_end
       from sync_runs runs
       inner join nerdio_invoice_items items on items.sync_run_id = runs.id
      where runs.integration_id = 'nerdio' and runs.status = 'complete'
      group by runs.id, runs.completed_at
      order by runs.completed_at desc nulls last
      limit 1`,
  );
  const row = result.rows[0];
  if (!row) {
    return {
      id: input.id,
      vendorId: input.vendorId,
      integrationId: 'nerdio',
      label: input.label,
      sourceKind: 'invoice-import',
      state: 'blocked',
      message: 'No completed Nerdio invoice sync is available.',
      canSync: true,
    };
  }
  const periodStart = dateOnly(row.billing_period_start);
  const periodEnd = dateOnly(row.billing_period_end);
  const matches = periodIncludesMonth(periodStart, periodEnd, input.expectedInvoiceMonth);
  return {
    id: input.id,
    vendorId: input.vendorId,
    integrationId: 'nerdio',
    label: input.label,
    sourceKind: 'invoice-import',
    state: matches ? 'ready' : 'warning',
    message: matches
      ? `Invoice evidence covers ${input.expectedInvoiceMonth}.`
      : `Latest invoice evidence does not cover ${input.expectedInvoiceMonth}.`,
    syncRunId: String(row.id),
    completedAt: isoDate(row.completed_at),
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    canSync: true,
  };
}

function applyLiveFreshness(sources: MonthlyReviewReadinessSource[], checkedAt: string) {
  const live = sources.filter(
    (source) => source.sourceKind === 'live-sync' && source.state !== 'blocked' && source.completedAt,
  );
  const checked = Date.parse(checkedAt);
  for (const source of live) {
    const completed = Date.parse(source.completedAt!);
    if (!Number.isFinite(completed) || checked - completed > liveWindowMs) {
      source.state = 'warning';
      source.message = 'The latest completed live sync is more than 48 hours old.';
    }
  }
  const timestamps = live
    .map((source) => Date.parse(source.completedAt!))
    .filter(Number.isFinite);
  if (timestamps.length > 1 && Math.max(...timestamps) - Math.min(...timestamps) > liveWindowMs) {
    for (const source of live) {
      source.state = 'warning';
      source.message = 'Live source timestamps span more than 48 hours.';
    }
  }
}

async function resolveBarracudaVendorId(database: Queryable): Promise<VendorKey | undefined> {
  const result = await database.query<{ id: string }>(
    `select id
       from vendor_datapoints
      where active = true and lower(trim(display_name)) = 'barracuda'
        and sync_mode = 'full-vendor-sync'
      order by updated_at desc
      limit 1`,
  );
  return result.rows[0]?.id ? vendorDatapointVendorId(result.rows[0].id) : undefined;
}

async function loadActiveSyncJobs(database: Queryable) {
  const result = await database.query<{ integration_id: string }>(
    `select distinct integration_id
       from integration_sync_jobs
      where status in ('queued', 'running')`,
  );
  return new Set(result.rows.map((row) => row.integration_id));
}

async function loadReconciliationConfigurationSnapshot(database: Queryable, vendorIds: VendorKey[]) {
  const uniqueVendorIds = [...new Set(vendorIds)];
  const [
    mappings,
    pins,
    adjustments,
    bundles,
    crossVendorBundles,
    monthlyReviewProductExclusions,
    ncentralSiteMappings,
  ] = await Promise.all([
    database.query<Row>(
      `select id, vendor_id, vendor_product_key, target_index, connectwise_product_code,
              connectwise_product_name, mapping_status, reviewed_at, updated_at
         from vendor_product_mappings
        where vendor_id = any($1::text[]) and active = true
        order by vendor_id, vendor_product_key, target_index`,
      [uniqueVendorIds],
    ),
    database.query<Row>(
      `select id, vendor_id, customer_id, agreement_id, vendor_product_key, source_account_id,
              connectwise_addition_id, connectwise_product_code, connectwise_product_name,
              mapping_source, reviewed_at, updated_at
         from vendor_product_addition_pins
        where vendor_id = any($1::text[]) and active = true
        order by vendor_id, agreement_id, vendor_product_key`,
      [uniqueVendorIds],
    ),
    database.query<Row>(
      `select id, vendor_id, customer_id, agreement_id, product_code, product_name, line_type,
              adjustment_type, quantity, reason, reviewed_by, reviewed_at, updated_at
         from vendor_reconciliation_adjustments
        where vendor_id = any($1::text[]) and active = true
        order by vendor_id, agreement_id, product_code`,
      [uniqueVendorIds],
    ),
    database.query<Row>(
      `select id, vendor_id, bundle_key, bundle_name, quantity_strategy, mapping_status, updated_at
         from vendor_product_bundles
        where vendor_id = any($1::text[]) and active = true
        order by vendor_id, bundle_key`,
      [uniqueVendorIds],
    ),
    database.query<Row>(
      `select id, bundle_key, bundle_name, connectwise_product_code, connectwise_product_name,
              count_strategy, default_driver_source_key, sources, add_ons, mapping_status, updated_at
         from cross_vendor_product_bundles
        where active = true
        order by bundle_key`,
    ),
    listMonthlyReviewProductExclusions(database),
    listNcentralSiteMappings(database),
  ]);
  return {
    vendorIds: uniqueVendorIds,
    mappings: mappings.rows,
    pins: pins.rows,
    adjustments: adjustments.rows,
    bundles: bundles.rows,
    crossVendorBundles: crossVendorBundles.rows,
    monthlyReviewProductExclusions,
    ncentralSiteMappings,
  };
}

async function loadFindingLabels(database: Queryable, runId: string) {
  const result = await database.query<Row>(
    `select findings.id, customers.name as customer_name, agreements.name as agreement_name
       from reconciliation_findings findings
       left join customers on customers.id = findings.customer_id
       left join agreements on agreements.id = findings.agreement_id
      where findings.reconciliation_run_id = $1::uuid`,
    [runId],
  );
  return new Map(
    result.rows.map((row) => [
      String(row.id),
      {
        customerName: String(row.customer_name ?? 'Unmapped customer'),
        agreementName: String(row.agreement_name ?? 'Unmapped agreement'),
      },
    ]),
  );
}

function runSummarySql() {
  return `select * from (
          select runs.id, runs.billing_month, runs.revision, runs.status, runs.started_at,
                 runs.completed_at, runs.created_by, runs.completed_by, runs.locked_at,
                 runs.supersedes_run_id, runs.freshness_override_reason,
                 runs.superseded_reason, runs.superseded_by, runs.superseded_at,
                 count(findings.id)::int as finding_count,
                 count(findings.id) filter (
                   where findings.disposition not in ('auto-passed', 'applied', 'skipped', 'ignored', 'ticketed')
                 )::int as unresolved_count,
                 coalesce(sum(findings.financial_impact), 0) as financial_impact
            from reconciliation_runs runs
            left join reconciliation_findings findings on findings.reconciliation_run_id = runs.id
           group by runs.id
         ) monthly_run_summaries`;
}

function mapRunSummary(row: Row): MonthlyReviewRunSummary {
  return {
    id: String(row.id),
    billingMonth: String(row.billing_month),
    revision: numberValue(row.revision),
    status:
      row.status === 'completed'
        ? 'completed'
        : row.status === 'superseded'
          ? 'superseded'
          : 'in-progress',
    startedAt: isoDate(row.started_at)!,
    completedAt: isoDate(row.completed_at),
    createdBy: optionalString(row.created_by),
    completedBy: optionalString(row.completed_by),
    lockedAt: isoDate(row.locked_at),
    supersedesRunId: optionalString(row.supersedes_run_id),
    supersededReason: optionalString(row.superseded_reason),
    supersededBy: optionalString(row.superseded_by),
    supersededAt: isoDate(row.superseded_at),
    freshnessOverrideReason: optionalString(row.freshness_override_reason),
    findingCount: numberValue(row.finding_count),
    unresolvedCount: numberValue(row.unresolved_count),
    financialImpact: numberValue(row.financial_impact),
  };
}

function mapFrozenSource(row: Row): MonthlyReviewReadinessSource {
  const metadata = recordValue(row.metadata);
  const vendorId = String(row.vendor_id) as VendorKey;
  return {
    id: optionalString(metadata.sourceId) ?? vendorId,
    vendorId,
    integrationId: isBuiltinVendor(vendorId) ? vendorId : undefined,
    label: String(row.display_name),
    sourceKind: row.source_kind as MonthlyReviewSourceKind,
    state: row.readiness_state as MonthlyReviewReadinessSource['state'],
    message: String(row.readiness_message ?? ''),
    syncRunId: optionalString(row.sync_run_id),
    invoiceImportId: optionalString(row.invoice_import_id),
    completedAt: isoDate(row.completed_at),
    billingPeriodStart: dateOnly(row.billing_period_start),
    billingPeriodEnd: dateOnly(row.billing_period_end),
    canSync: Boolean(metadata.canSync),
  };
}

function mapFinding(
  row: Row,
  labels: { customerName: string; agreementName: string } | undefined,
  vendors: MonthlyReviewVendorEvidence[],
): MonthlyReviewFinding {
  const additions = arrayValue(row.connectwise_snapshot) as MonthlyReviewAdditionSnapshot[];
  return {
    id: String(row.id),
    rowKey: String(row.row_key),
    rowType: row.row_type as MonthlyReviewFinding['rowType'],
    customerId: optionalString(row.customer_id),
    customerName: labels?.customerName ?? 'Unmapped customer',
    agreementId: optionalString(row.agreement_id),
    agreementName: labels?.agreementName ?? 'Unmapped agreement',
    productCode: String(row.product_code),
    productName: String(row.product_name),
    currentQuantity: numberValue(row.agreement_quantity),
    proposedQuantity: numberValue(row.proposed_quantity),
    selectedQuantity: optionalNumber(row.selected_quantity),
    selectedSourceKey: optionalString(row.selected_source_key),
    delta: numberValue(row.delta),
    financialImpact: numberValue(row.financial_impact),
    disposition: row.disposition as MonthlyReviewDisposition,
    dispositionReason: optionalString(row.disposition_reason),
    reviewedBy: optionalString(row.reviewed_by),
    reviewedAt: isoDate(row.reviewed_at),
    ticketIds: arrayValue(row.ticket_ids).map(String),
    writeBatchId: optionalString(row.write_batch_id),
    additions,
    vendors,
  };
}

function mapVendorEvidence(row: Row): MonthlyReviewVendorEvidence {
  return {
    id: String(row.source_key || row.id),
    vendorId: String(row.vendor_id) as VendorKey,
    label: String(row.display_name),
    sourceKind: row.source_kind as MonthlyReviewSourceKind,
    syncRunId: optionalString(row.sync_run_id),
    invoiceImportId: optionalString(row.invoice_import_id),
    vendorProductKey: optionalString(row.vendor_product_key),
    sourceAccountId: optionalString(row.source_account_id),
    productCode: String(row.product_code),
    productName: String(row.product_name),
    apiQuantity: optionalNumber(row.source_quantity),
    invoiceQuantity: optionalNumber(row.invoice_quantity),
    linkedQuantity: optionalNumber(row.linked_quantity),
    proposedQuantity: numberValue(row.proposed_quantity),
    rawRowIds: arrayValue(row.raw_row_ids).map(String),
    evidence: arrayValue(row.evidence) as MonthlyReviewVendorEvidence['evidence'],
  };
}

async function assertRunMutable(database: Queryable, runId: string) {
  const result = await database.query<{ status: string; locked_at: unknown }>(
    `select status, locked_at from reconciliation_runs where id = $1::uuid`,
    [runId],
  );
  const run = result.rows[0];
  if (!run) throw new Error('Monthly Review run not found.');
  if (run.status !== 'in-progress' || run.locked_at) {
    throw new Error('Completed Monthly Review runs are immutable.');
  }
}

async function nextRevision(
  database: Queryable,
  billingMonth: string,
  supersedesRunId?: string,
  options: { allowInProgress?: boolean } = {},
) {
  if (supersedesRunId) {
    const original = await database.query<{ billing_month: string; status: string }>(
      `select billing_month, status from reconciliation_runs where id = $1::uuid`,
      [supersedesRunId],
    );
    const run = original.rows[0];
    const allowedStatus = run?.status === 'completed' || (options.allowInProgress && run?.status === 'in-progress');
    if (run?.billing_month !== billingMonth || !allowedStatus) {
      throw new Error('The superseded run must be an eligible revision for the same billing month.');
    }
  }
  const result = await database.query<{ revision: string | number }>(
    `select coalesce(max(revision), 0) + 1 as revision from reconciliation_runs where billing_month = $1`,
    [billingMonth],
  );
  return numberValue(result.rows[0]?.revision) || 1;
}

async function insertAuditEvent(
  database: Queryable,
  actor: string,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actor, eventType, entityType, entityId, JSON.stringify(payload)],
  );
}

function previousMonth(billingMonth: string) {
  const [year, month] = billingMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 2, 1));
  return date.toISOString().slice(0, 7);
}

function periodIncludesMonth(start: string | undefined, end: string | undefined, month: string) {
  if (!start && !end) return false;
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
  return (!start || start <= monthEnd) && (!end || end >= monthStart);
}

function assertBillingMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error('billingMonth must use YYYY-MM format.');
  }
}

function isDisposition(value: string): value is MonthlyReviewDisposition {
  return [
    'auto-passed',
    'needs-action',
    'needs-source',
    'approved',
    'applied',
    'skipped',
    'ignored',
    'ticketed',
  ].includes(value);
}

function isBuiltinVendor(value: VendorKey): value is IntegrationId {
  return !String(value).startsWith('datapoint:') && value !== 'cross-vendor-bundles';
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function normalizeProductCode(value: string) {
  return value.trim().toLowerCase();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isoDate(value: unknown) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function dateOnly(value: unknown) {
  const valueAsDate = isoDate(value);
  return valueAsDate?.slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return recordValue(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  if (typeof value === 'string') {
    try {
      return arrayValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

export const monthlyReviewResolvedDispositions = resolvedDispositions;
