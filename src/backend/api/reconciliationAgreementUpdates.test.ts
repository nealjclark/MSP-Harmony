import assert from 'node:assert/strict';
import {
  applyReconciliationAgreementAdditionUpdates,
  type ConnectWiseAgreementAdditionUpdateWriter,
  type ReconciliationAgreementAdditionUpdateInput,
} from './reconciliationAgreementUpdates';
import type { Queryable } from '../vendor/cove/operations';

type QueryCall = {
  sql: string;
  values?: unknown[];
};

const baseUpdate: ReconciliationAgreementAdditionUpdateInput = {
  sourceLineId: 'line-1',
  vendorId: 'opentext-appriver',
  customerId: '11111111-1111-1111-1111-111111111111',
  customerName: 'Acme Corp',
  agreementId: '22222222-2222-2222-2222-222222222222',
  agreementName: 'Managed Services',
  connectWiseAdditionId: '3401',
  productCode: 'EMAIL-LICENSE',
  productName: 'Email License',
  currentQuantity: 100,
  currentLessIncluded: 2,
  quantity: 110,
  apiQuantity: 110,
  invoiceQuantity: 108,
  selectedSource: 'api',
};

async function run() {
  const quantityOnly = createHarness({
    'EMAIL-LICENSE': [additionRow({ connectwise_addition_id: '3401', product_code: 'EMAIL-LICENSE', quantity: '100', lessIncluded: 2 })],
  });
  const quantityOnlyResult = await applyReconciliationAgreementAdditionUpdates(quantityOnly.database, {
    actor: 'approver@example.com',
    now: '2026-07-01T14:00:00.000Z',
    updates: [baseUpdate],
    discardedUpdates: [{ ...baseUpdate, sourceLineId: 'line-discarded', connectWiseAdditionId: '3401' }],
    writer: quantityOnly.writer,
  });

  assert.equal(quantityOnlyResult.summary.written, 1);
  assert.equal(quantityOnlyResult.summary.discarded, 1);
  assert.equal(quantityOnly.writes.length, 1);
  assert.deepEqual(quantityOnly.writes[0]?.changes, {
    quantity: 110,
    lessIncluded: undefined,
    lessIncludedChanged: false,
  });
  assert.deepEqual(itemStatuses(quantityOnly.calls), ['discarded', 'approved']);
  assert.equal(auditEventTypes(quantityOnly.calls).includes('reconciliation.connectwise.item.written'), true);
  assert.equal(auditEventTypes(quantityOnly.calls).includes('reconciliation.connectwise.item.discarded'), true);

  const manualOverride = createHarness({
    'EMAIL-LICENSE': [additionRow({ connectwise_addition_id: '3401', product_code: 'EMAIL-LICENSE', quantity: '100', lessIncluded: 2 })],
  });
  await applyReconciliationAgreementAdditionUpdates(manualOverride.database, {
    actor: 'approver@example.com',
    now: '2026-07-01T14:02:00.000Z',
    updates: [{ ...baseUpdate, sourceLineId: 'line-manual', quantity: 117, manualQuantity: 117, selectedSource: 'manual' }],
    writer: manualOverride.writer,
  });
  const manualItem = insertedItemValues(manualOverride.calls).find((values) => values[1] === 'line-manual');
  assert.equal(manualOverride.writes[0]?.changes.quantity, 117);
  assert.equal(manualItem?.[17], 'manual');
  assert.match(String(manualItem?.[22] ?? ''), /"manualQuantity":117/);

  const clearLess = createHarness({
    'EMAIL-LICENSE': [additionRow({ connectwise_addition_id: '3401', product_code: 'EMAIL-LICENSE', quantity: '100', lessIncluded: 5 })],
  });
  const clearLessResult = await applyReconciliationAgreementAdditionUpdates(clearLess.database, {
    actor: 'approver@example.com',
    now: '2026-07-01T14:05:00.000Z',
    updates: [{ ...baseUpdate, lessIncluded: 0 }],
    writer: clearLess.writer,
  });

  assert.equal(clearLessResult.summary.written, 1);
  assert.equal(clearLess.writes[0]?.changes.lessIncludedChanged, true);
  assert.equal(clearLess.writes[0]?.changes.lessIncluded, 0);
  assert.equal(insertedItemValues(clearLess.calls)[0]?.[13], 0);
  assert.equal(insertedItemValues(clearLess.calls)[0]?.[14], true);

  const multiMatch = createHarness({
    'MULTI-LICENSE': [
      additionRow({ connectwise_addition_id: '5001', product_code: 'MULTI-LICENSE', quantity: '4', lessIncluded: 0 }),
      additionRow({ connectwise_addition_id: '5002', product_code: 'MULTI-LICENSE', quantity: '6', lessIncluded: 0 }),
    ],
    'EMAIL-LICENSE': [additionRow({ connectwise_addition_id: '3401', product_code: 'EMAIL-LICENSE', quantity: '100', lessIncluded: 2 })],
  });
  const multiMatchResult = await applyReconciliationAgreementAdditionUpdates(multiMatch.database, {
    actor: 'approver@example.com',
    now: '2026-07-01T14:10:00.000Z',
    updates: [
      {
        ...baseUpdate,
        sourceLineId: 'line-multi',
        connectWiseAdditionId: '5001',
        productCode: 'MULTI-LICENSE',
        productName: 'Multi License',
      },
      baseUpdate,
    ],
    writer: multiMatch.writer,
  });

  assert.equal(multiMatchResult.status, 'partial');
  assert.equal(multiMatchResult.summary.failed, 1);
  assert.equal(multiMatchResult.summary.written, 1);
  assert.equal(multiMatch.writes.length, 1);
  assert.equal(multiMatch.writes[0]?.connectWiseAdditionId, '3401');
  assert.match(multiMatchResult.items.find((item) => item.status === 'failed')?.error ?? '', /Multiple active/);

  console.log('reconciliation agreement update tests passed');
}

function createHarness(additionsByProduct: Record<string, ReturnType<typeof additionRow>[]>) {
  const calls: QueryCall[] = [];
  const writes: Array<{
    connectWiseAgreementId: string;
    connectWiseAdditionId: string;
    changes: Parameters<ConnectWiseAgreementAdditionUpdateWriter['patchAgreementAddition']>[2];
  }> = [];
  let itemId = 0;

  const database: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });

      if (sql.includes('insert into approval_batches')) {
        return { rows: [{ id: 'batch-1' }] as T[] };
      }

      if (sql.includes('insert into approval_batch_items')) {
        itemId += 1;
        return { rows: [{ id: `item-${itemId}` }] as T[] };
      }

      if (sql.includes('from agreement_additions') && sql.includes('lower(agreement_additions.product_code)')) {
        const productCode = String(values?.[1] ?? '');
        return { rows: (additionsByProduct[productCode] ?? []) as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  const writer: ConnectWiseAgreementAdditionUpdateWriter = {
    async patchAgreementAddition(connectWiseAgreementId, connectWiseAdditionId, changes) {
      writes.push({ connectWiseAgreementId, connectWiseAdditionId, changes });
      return {
        id: Number(connectWiseAdditionId),
        agreementId: Number(connectWiseAgreementId),
        quantity: changes.quantity,
        ...(changes.lessIncludedChanged ? { lessIncluded: changes.lessIncluded ?? 0 } : {}),
      };
    },
  };

  return {
    calls,
    database,
    writer,
    writes,
  };
}

function additionRow(input: {
  connectwise_addition_id: string;
  product_code: string;
  quantity: string;
  lessIncluded: number;
}) {
  return {
    id: `local-${input.connectwise_addition_id}`,
    customer_id: '11111111-1111-1111-1111-111111111111',
    customer_name: 'Acme Corp',
    agreement_id: '22222222-2222-2222-2222-222222222222',
    agreement_name: 'Managed Services',
    connectwise_agreement_id: '9900',
    connectwise_addition_id: input.connectwise_addition_id,
    product_code: input.product_code,
    product_name: input.product_code,
    quantity: input.quantity,
    raw_payload: {
      lessIncluded: input.lessIncluded,
    },
  };
}

function insertedItemValues(calls: QueryCall[]) {
  return calls
    .filter((call) => call.sql.includes('insert into approval_batch_items'))
    .map((call) => call.values ?? []);
}

function itemStatuses(calls: QueryCall[]) {
  return insertedItemValues(calls).map((values) => values[18]);
}

function auditEventTypes(calls: QueryCall[]) {
  return calls
    .filter((call) => call.sql.includes('insert into audit_events'))
    .map((call) => call.values?.[1]);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
