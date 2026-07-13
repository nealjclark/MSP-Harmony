import assert from 'node:assert/strict';
import {
  getAuditBatchDetail,
  getAuditEvent,
  listAuditBatches,
  listAuditEvents,
  listAuditSyncRuns,
} from './auditHistory';

async function run() {
  const database = createMockDatabase();

  const runs = await listAuditSyncRuns(database, { limit: 10 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.integrationName, 'Cove Data Protection');

  const events = await listAuditEvents(database, { limit: 10 });
  assert.equal(events.length, 3);
  assert.equal(events[0]?.eventType, 'reconciliation.connectwise.item.written');
  assert.match(events[0]?.summary.subtitle ?? '', /Qty 10/);
  assert.equal(events[2]?.eventLabel, 'Raw payload viewed');
  assert.equal(events[2]?.summary.subtitle, 'Raw payload viewed for 2 rows');

  const event = await getAuditEvent(database, '22222222-2222-4222-8222-222222222222');
  assert.equal(event?.summary.title, 'Managed M365');

  const batches = await listAuditBatches(database, { limit: 10 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.written, 1);

  const batch = await getAuditBatchDetail(database, '33333333-3333-4333-8333-333333333333');
  assert.equal(batch?.items.length, 1);
  assert.equal(batch?.items[0]?.productCode, 'M365-E3');

  console.log('audit history tests passed');
}

function createMockDatabase() {
  return {
    async query<T>(sql: string, values?: unknown[]) {
      if (sql.includes('from sync_runs')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              integration_id: 'cove',
              started_at: '2026-07-07T12:00:00.000Z',
              completed_at: '2026-07-07T12:05:00.000Z',
              status: 'complete',
              records_read: 120,
              records_written: 118,
              error_message: null,
              metadata: { entity: 'usage-snapshots' },
            },
          ] as T[],
        };
      }

      if (sql.includes("event_type = 'reconciliation.connectwise.batch.created'") && sql.includes('entity_id = $1')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              actor: 'approver@example.com',
              event_type: 'reconciliation.connectwise.batch.created',
              entity_type: 'approval_batch',
              entity_id: String(values?.[0]),
              occurred_at: '2026-07-07T13:00:00.000Z',
              payload: { updateCount: 1, discardedCount: 0 },
            },
          ] as T[],
        };
      }

      if (sql.includes("event_type = 'reconciliation.connectwise.batch.created'") && sql.includes('order by occurred_at desc')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              actor: 'approver@example.com',
              event_type: 'reconciliation.connectwise.batch.created',
              entity_type: 'approval_batch',
              entity_id: '33333333-3333-4333-8333-333333333333',
              occurred_at: '2026-07-07T13:00:00.000Z',
              payload: { updateCount: 1, discardedCount: 0 },
            },
          ] as T[],
        };
      }

      if (sql.includes('from approval_batch_items') && sql.includes('approval_batch_id = $1')) {
        if (sql.includes('select status')) {
          return {
            rows: [{ status: 'written' }] as T[],
          };
        }

        return {
          rows: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              customer_name: 'Northstar Dental Group',
              agreement_name: 'Managed Services - Premium',
              product_code: 'M365-E3',
              product_name: 'Managed M365',
              current_quantity: 10,
              proposed_quantity: 12,
              current_less_included: 0,
              proposed_less_included: null,
              less_included_changed: false,
              status: 'written',
              error_message: null,
              written_at: '2026-07-07T13:01:00.000Z',
            },
          ] as T[],
        };
      }

      if (sql.includes('where id = $1::uuid')) {
        return {
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              actor: 'approver@example.com',
              event_type: 'reconciliation.connectwise.item.written',
              entity_type: 'approval_batch_item',
              entity_id: '55555555-5555-4555-8555-555555555555',
              occurred_at: '2026-07-07T13:01:00.000Z',
              payload: {
                productCode: 'M365-E3',
                productName: 'Managed M365',
                currentQuantity: 10,
                proposedQuantity: 12,
                status: 'written',
              },
            },
          ] as T[],
        };
      }

      if (sql.includes('from audit_events')) {
        return {
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              actor: 'approver@example.com',
              event_type: 'reconciliation.connectwise.item.written',
              entity_type: 'approval_batch_item',
              entity_id: '55555555-5555-4555-8555-555555555555',
              occurred_at: '2026-07-07T13:01:00.000Z',
              payload: {
                productCode: 'M365-E3',
                productName: 'Managed M365',
                currentQuantity: 10,
                proposedQuantity: 12,
                status: 'written',
              },
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              actor: 'approver@example.com',
              event_type: 'reconciliation.connectwise.batch.created',
              entity_type: 'approval_batch',
              entity_id: '33333333-3333-4333-8333-333333333333',
              occurred_at: '2026-07-07T13:00:00.000Z',
              payload: { updateCount: 1, discardedCount: 0 },
            },
            {
              id: '66666666-6666-4666-8666-666666666666',
              actor: 'analyst@example.com',
              event_type: 'reports.raw-sync.raw-payload.viewed',
              entity_type: 'sync_run',
              entity_id: '11111111-1111-4111-8111-111111111111',
              occurred_at: '2026-07-07T12:30:00.000Z',
              payload: {
                integrationId: 'cove',
                rowCount: 2,
              },
            },
          ] as T[],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
