import type { ConnectWiseAgreementAddition } from '../connectwise/client';
import type { Queryable } from '../vendor/cove/operations';

export type ReconciliationCountSelection = 'api' | 'invoice' | 'manual';

export type ReconciliationAgreementAdditionUpdateInput = {
  sourceLineId: string;
  vendorId: string;
  customerId?: string;
  customerName?: string;
  agreementId: string;
  agreementName?: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  currentQuantity?: number;
  currentLessIncluded?: number;
  quantity: number;
  manualQuantity?: number;
  lessIncluded?: number;
  apiQuantity?: number;
  invoiceQuantity?: number;
  selectedSource: ReconciliationCountSelection;
};

export type ConnectWiseAgreementAdditionUpdateWriter = {
  patchAgreementAddition: (
    connectWiseAgreementId: string,
    connectWiseAdditionId: string,
    changes: {
      quantity: number;
      lessIncluded?: number;
      lessIncludedChanged: boolean;
    },
  ) => Promise<ConnectWiseAgreementAddition>;
};

export type ApplyReconciliationAgreementAdditionUpdatesRequest = {
  actor: string;
  updates: ReconciliationAgreementAdditionUpdateInput[];
  discardedUpdates?: ReconciliationAgreementAdditionUpdateInput[];
  writer: ConnectWiseAgreementAdditionUpdateWriter;
  now?: string;
};

export type ReconciliationAgreementAdditionUpdateItemResult = {
  itemId?: string;
  sourceLineId: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  currentLessIncluded: number;
  proposedLessIncluded?: number;
  lessIncludedChanged: boolean;
  status: 'written' | 'failed' | 'discarded';
  error?: string;
};

export type ReconciliationAgreementAdditionUpdateBatchResult = {
  batchId: string;
  status: 'written' | 'partial' | 'discarded';
  summary: {
    written: number;
    failed: number;
    discarded: number;
  };
  items: ReconciliationAgreementAdditionUpdateItemResult[];
};

type ApprovalBatchRow = {
  id: string;
};

type ApprovalBatchItemRow = {
  id: string;
};

type ActiveAdditionRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  agreement_id: string;
  agreement_name: string;
  connectwise_agreement_id: string;
  connectwise_addition_id: string;
  product_code: string;
  product_name: string;
  quantity: string | number;
  raw_payload: unknown;
};

type NormalizedUpdateInput = ReconciliationAgreementAdditionUpdateInput & {
  quantity: number;
  lessIncluded?: number;
  lessIncludedChanged: boolean;
};

const inactiveStatusPattern = 'expired|cancelled|canceled|inactive';

export async function applyReconciliationAgreementAdditionUpdates(
  database: Queryable,
  request: ApplyReconciliationAgreementAdditionUpdatesRequest,
): Promise<ReconciliationAgreementAdditionUpdateBatchResult> {
  const now = request.now ?? new Date().toISOString();
  const updates = request.updates.map(normalizeUpdateInput);
  const discardedUpdates = (request.discardedUpdates ?? []).map(normalizeUpdateInput);
  const batchId = await createApprovalBatch(database, {
    actor: request.actor,
    now,
    updateCount: updates.length,
    discardedCount: discardedUpdates.length,
  });
  const results: ReconciliationAgreementAdditionUpdateItemResult[] = [];

  await insertAuditEvent(database, {
    actor: request.actor,
    eventType: 'reconciliation.connectwise.batch.created',
    entityType: 'approval_batch',
    entityId: batchId,
    payload: {
      updateCount: updates.length,
      discardedCount: discardedUpdates.length,
    },
  });

  for (const input of discardedUpdates) {
    const itemId = await insertApprovalBatchItem(database, batchId, input, {
      status: 'discarded',
      now,
      actor: request.actor,
      currentQuantity: optionalNumber(input.currentQuantity) ?? 0,
      currentLessIncluded: optionalNumber(input.currentLessIncluded) ?? 0,
    });
    const result = itemResultFromInput(itemId, input, 'discarded', {
      currentQuantity: optionalNumber(input.currentQuantity) ?? 0,
      currentLessIncluded: optionalNumber(input.currentLessIncluded) ?? 0,
    });
    results.push(result);
    await insertAuditEvent(database, {
      actor: request.actor,
      eventType: 'reconciliation.connectwise.item.discarded',
      entityType: 'approval_batch_item',
      entityId: itemId,
      payload: result,
    });
  }

  for (const input of updates) {
    results.push(await applySingleUpdate(database, batchId, input, request.writer, request.actor, now));
  }

  const summary = summarizeResults(results);
  const status = summary.failed > 0 ? 'partial' : summary.written > 0 ? 'written' : 'discarded';
  await completeApprovalBatch(database, batchId, request.actor, now, status, summary);

  return {
    batchId,
    status,
    summary,
    items: results,
  };
}

async function applySingleUpdate(
  database: Queryable,
  batchId: string,
  input: NormalizedUpdateInput,
  writer: ConnectWiseAgreementAdditionUpdateWriter,
  actor: string,
  now: string,
): Promise<ReconciliationAgreementAdditionUpdateItemResult> {
  let itemId: string | undefined;

  try {
    const addition = await validateSelectedAddition(database, input);
    const currentQuantity = numericValue(addition.quantity);
    const currentLessIncluded = lessIncludedFromRaw(addition.raw_payload);
    itemId = await insertApprovalBatchItem(database, batchId, input, {
      status: 'approved',
      now,
      actor,
      currentQuantity,
      currentLessIncluded,
      customerId: addition.customer_id,
      customerName: addition.customer_name,
      agreementName: addition.agreement_name,
      productName: addition.product_name,
    });

    const patchedAddition = await writer.patchAgreementAddition(
      addition.connectwise_agreement_id,
      addition.connectwise_addition_id,
      {
        quantity: input.quantity,
        lessIncluded: input.lessIncluded,
        lessIncludedChanged: input.lessIncludedChanged,
      },
    );
    const responsePayload = responsePayloadForUpdate(patchedAddition, input);
    await markApprovalBatchItemWritten(database, itemId, now, responsePayload);
    await updateLocalAgreementAddition(database, addition.id, input.quantity, responsePayload);

    const result = itemResultFromInput(itemId, input, 'written', {
      currentQuantity,
      currentLessIncluded,
      productName: addition.product_name,
    });
    await insertAuditEvent(database, {
      actor,
      eventType: 'reconciliation.connectwise.item.written',
      entityType: 'approval_batch_item',
      entityId: itemId,
      payload: result,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to apply ConnectWise update.';
    if (itemId) {
      await markApprovalBatchItemFailed(database, itemId, now, message);
    } else {
      itemId = await insertApprovalBatchItem(database, batchId, input, {
        status: 'failed',
        now,
        actor,
        currentQuantity: optionalNumber(input.currentQuantity) ?? 0,
        currentLessIncluded: optionalNumber(input.currentLessIncluded) ?? 0,
        errorMessage: message,
      });
    }

    const result = itemResultFromInput(itemId, input, 'failed', {
      currentQuantity: optionalNumber(input.currentQuantity) ?? 0,
      currentLessIncluded: optionalNumber(input.currentLessIncluded) ?? 0,
      error: message,
    });
    await insertAuditEvent(database, {
      actor,
      eventType: 'reconciliation.connectwise.item.failed',
      entityType: 'approval_batch_item',
      entityId: itemId,
      payload: result,
    });
    return result;
  }
}

async function validateSelectedAddition(database: Queryable, input: NormalizedUpdateInput) {
  const additions = await loadActiveMatchingAdditions(database, input.agreementId, input.productCode);

  if (additions.length === 0) {
    throw new Error(`No active ConnectWise addition matched ${input.productCode} on this agreement.`);
  }

  if (additions.length > 1) {
    throw new Error(`Multiple active ConnectWise additions matched ${input.productCode}; clean up the agreement before applying.`);
  }

  const addition = additions[0];
  if (!addition) {
    throw new Error(`No active ConnectWise addition matched ${input.productCode} on this agreement.`);
  }

  if (addition.connectwise_addition_id !== input.connectWiseAdditionId) {
    throw new Error(`Selected ConnectWise addition ${input.connectWiseAdditionId} does not match ${input.productCode}.`);
  }

  return addition;
}

async function loadActiveMatchingAdditions(database: Queryable, agreementId: string, productCode: string) {
  const result = await database.query<ActiveAdditionRow>(
    `select
       agreement_additions.id,
       agreement_additions.customer_id,
       customers.name as customer_name,
       agreement_additions.agreement_id,
       agreements.name as agreement_name,
       agreements.connectwise_agreement_id,
       agreement_additions.connectwise_addition_id,
       agreement_additions.product_code,
       agreement_additions.product_name,
       agreement_additions.quantity,
       agreement_additions.raw_payload
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     inner join customers
       on customers.id = agreement_additions.customer_id
     where agreement_additions.agreement_id = $1::uuid
       and lower(agreement_additions.product_code) = lower($2)
       and coalesce(agreement_additions.addition_status, '') !~* $3
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* $3
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* $3
       and coalesce(agreements.status, '') !~* $3
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* $3
     order by agreement_additions.product_name, agreement_additions.product_code, agreement_additions.connectwise_addition_id`,
    [agreementId, productCode, inactiveStatusPattern],
  );

  return result.rows;
}

async function createApprovalBatch(
  database: Queryable,
  input: { actor: string; now: string; updateCount: number; discardedCount: number },
) {
  const result = await database.query<ApprovalBatchRow>(
    `insert into approval_batches (
       status,
       requested_by,
       approved_by,
       approved_at,
       metadata,
       created_at
     )
     values ('applying', $1, $1, $2::timestamptz, $3::jsonb, $2::timestamptz)
     returning id`,
    [
      input.actor,
      input.now,
      JSON.stringify({
        source: 'reconciliation-connectwise-agreement-addition-updates',
        updateCount: input.updateCount,
        discardedCount: input.discardedCount,
      }),
    ],
  );

  const batchId = result.rows[0]?.id;
  if (!batchId) {
    throw new Error('Unable to create approval batch.');
  }

  return batchId;
}

async function insertApprovalBatchItem(
  database: Queryable,
  batchId: string,
  input: NormalizedUpdateInput,
  details: {
    status: string;
    now: string;
    actor: string;
    currentQuantity: number;
    currentLessIncluded: number;
    customerId?: string;
    customerName?: string;
    agreementName?: string;
    productName?: string;
    errorMessage?: string;
  },
) {
  const result = await database.query<ApprovalBatchItemRow>(
    `insert into approval_batch_items (
       approval_batch_id,
       source_line_id,
       vendor_id,
       customer_id,
       customer_name,
       agreement_id,
       agreement_name,
       connectwise_addition_id,
       product_code,
       product_name,
       current_quantity,
       proposed_quantity,
       current_less_included,
       proposed_less_included,
       less_included_changed,
       source_quantity,
       invoice_quantity,
       selected_source,
       status,
       approved_by,
       approved_at,
       written_at,
       error_message,
       request_payload,
       response_payload,
       write_result,
       created_at
     )
     values (
       $1, $2, $3, $4::uuid, $5, $6::uuid, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::timestamptz,
       case when $19 in ('written', 'discarded', 'failed') then $21::timestamptz else null end,
       $22, $23::jsonb, $24::jsonb, $24::jsonb, $21::timestamptz
     )
     returning id`,
    [
      batchId,
      input.sourceLineId,
      input.vendorId,
      details.customerId ?? input.customerId ?? null,
      details.customerName ?? input.customerName ?? null,
      input.agreementId,
      details.agreementName ?? input.agreementName ?? null,
      input.connectWiseAdditionId,
      input.productCode,
      details.productName ?? input.productName,
      details.currentQuantity,
      input.quantity,
      details.currentLessIncluded,
      input.lessIncludedChanged ? input.lessIncluded ?? 0 : null,
      input.lessIncludedChanged,
      optionalNumber(input.apiQuantity) ?? null,
      optionalNumber(input.invoiceQuantity) ?? null,
      input.selectedSource,
      details.status,
      details.actor,
      details.now,
      details.errorMessage ?? null,
      JSON.stringify(input),
      JSON.stringify({}),
    ],
  );

  const itemId = result.rows[0]?.id;
  if (!itemId) {
    throw new Error('Unable to create approval batch item.');
  }

  return itemId;
}

async function markApprovalBatchItemWritten(
  database: Queryable,
  itemId: string,
  now: string,
  responsePayload: Record<string, unknown>,
) {
  await database.query(
    `update approval_batch_items
     set status = 'written',
         written_at = $2::timestamptz,
         response_payload = $3::jsonb,
         write_result = $3::jsonb
     where id = $1::uuid`,
    [itemId, now, JSON.stringify(responsePayload)],
  );
}

async function markApprovalBatchItemFailed(database: Queryable, itemId: string, now: string, errorMessage: string) {
  await database.query(
    `update approval_batch_items
     set status = 'failed',
         written_at = $2::timestamptz,
         error_message = $3,
         response_payload = $4::jsonb,
         write_result = $4::jsonb
     where id = $1::uuid`,
    [itemId, now, errorMessage, JSON.stringify({ error: errorMessage })],
  );
}

async function completeApprovalBatch(
  database: Queryable,
  batchId: string,
  actor: string,
  now: string,
  status: ReconciliationAgreementAdditionUpdateBatchResult['status'],
  summary: ReconciliationAgreementAdditionUpdateBatchResult['summary'],
) {
  await database.query(
    `update approval_batches
     set status = $2,
         written_by = $3,
         written_at = $4::timestamptz,
         metadata = metadata || $5::jsonb
     where id = $1::uuid`,
    [batchId, status, actor, now, JSON.stringify({ summary })],
  );
}

async function updateLocalAgreementAddition(
  database: Queryable,
  agreementAdditionId: string,
  quantity: number,
  responsePayload: Record<string, unknown>,
) {
  await database.query(
    `update agreement_additions
     set quantity = $2,
         raw_payload = raw_payload || $3::jsonb,
         updated_from_connectwise_at = now(),
         updated_at = now()
     where id = $1::uuid`,
    [agreementAdditionId, quantity, JSON.stringify(responsePayload)],
  );
}

async function insertAuditEvent(
  database: Queryable,
  input: {
    actor: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [input.actor, input.eventType, input.entityType, input.entityId, JSON.stringify(input.payload)],
  );
}

function normalizeUpdateInput(input: ReconciliationAgreementAdditionUpdateInput): NormalizedUpdateInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Update item is required.');
  }

  const lessIncludedChanged = Object.prototype.hasOwnProperty.call(input, 'lessIncluded');
  return {
    ...input,
    sourceLineId: requiredString(input.sourceLineId, 'sourceLineId'),
    vendorId: requiredString(input.vendorId, 'vendorId'),
    agreementId: requiredString(input.agreementId, 'agreementId'),
    connectWiseAdditionId: requiredString(input.connectWiseAdditionId, 'connectWiseAdditionId'),
    productCode: requiredString(input.productCode, 'productCode'),
    productName: requiredString(input.productName, 'productName'),
    selectedSource:
      input.selectedSource === 'invoice' || input.selectedSource === 'manual'
        ? input.selectedSource
        : 'api',
    quantity: requiredNonNegativeNumber(input.quantity, 'quantity'),
    manualQuantity: optionalNumber(input.manualQuantity),
    lessIncluded: lessIncludedChanged
      ? requiredNonNegativeNumber(input.lessIncluded, 'lessIncluded')
      : undefined,
    lessIncludedChanged,
  };
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
}

function requiredNonNegativeNumber(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }

  return parsed;
}

function optionalNumber(value: unknown) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function itemResultFromInput(
  itemId: string,
  input: NormalizedUpdateInput,
  status: ReconciliationAgreementAdditionUpdateItemResult['status'],
  details: {
    currentQuantity: number;
    currentLessIncluded: number;
    productName?: string;
    error?: string;
  },
): ReconciliationAgreementAdditionUpdateItemResult {
  return {
    itemId,
    sourceLineId: input.sourceLineId,
    connectWiseAdditionId: input.connectWiseAdditionId,
    productCode: input.productCode,
    productName: details.productName ?? input.productName,
    currentQuantity: details.currentQuantity,
    proposedQuantity: input.quantity,
    currentLessIncluded: details.currentLessIncluded,
    proposedLessIncluded: input.lessIncludedChanged ? input.lessIncluded ?? 0 : undefined,
    lessIncludedChanged: input.lessIncludedChanged,
    status,
    error: details.error,
  };
}

function summarizeResults(results: ReconciliationAgreementAdditionUpdateItemResult[]) {
  return results.reduce(
    (summary, result) => {
      if (result.status === 'written') summary.written += 1;
      if (result.status === 'failed') summary.failed += 1;
      if (result.status === 'discarded') summary.discarded += 1;
      return summary;
    },
    {
      written: 0,
      failed: 0,
      discarded: 0,
    },
  );
}

function responsePayloadForUpdate(
  patchedAddition: ConnectWiseAgreementAddition,
  input: NormalizedUpdateInput,
): Record<string, unknown> {
  return {
    ...recordFromJson(patchedAddition),
    quantity: input.quantity,
    ...(input.lessIncludedChanged ? { lessIncluded: input.lessIncluded ?? 0 } : {}),
  };
}

function lessIncludedFromRaw(raw: unknown) {
  const value = recordFromJson(raw).lessIncluded;
  return optionalNumber(value) ?? 0;
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

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function numericValue(value: string | number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
