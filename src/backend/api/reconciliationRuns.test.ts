import assert from 'node:assert/strict';
import { reconcileVendorFromDatabase } from './reconciliationRuns';
import type { Queryable } from '../vendor/cove/operations';

const syncRunId = '00000000-0000-0000-0000-000000000001';
const queries: Array<{ sql: string; values?: unknown[] }> = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-1',
            vendor_id: 'cove',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            vendor_product_key: 'cove-server',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            observed_at: new Date('2026-06-15T12:00:00Z'),
            dimensions: {
              protectedSystemType: 'server',
              selectedStorageGb: 1135,
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-server',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120',
            updated_at: new Date('2026-06-15T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  const result = await reconcileVendorFromDatabase(database, 'cove', { syncRunId });
  const addOnLine = result.lines.find((line) => line.productCode === 'COVE-SERVER-STORAGE-ADDON');
  assert.equal(result.syncRunId, syncRunId);
  assert.equal(addOnLine?.status, 'needs-review');
  assert.equal(addOnLine?.writeAction, 'create-addition');
  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_snapshots')), true);
  assert.equal(queries.some((query) => query.sql.includes('approved_product_mappings')), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_overrides')), true);
  assert.equal(queries.some((query) => query.sql.includes('agreement_additions')), true);
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes("agreement_additions.raw_payload->>'additionStatus'") &&
        query.sql.includes("agreement_additions.raw_payload->>'agreementStatus'") &&
        query.sql.includes('inner join agreements'),
    ),
    true,
  );

  const overrideResult = await reconcileVendorFromDatabase(overrideDatabase, 'cove', { syncRunId });
  const serverLine = overrideResult.lines.find((line) => line.productCode === 'COVE-SERVER' && line.lineType === 'base-count');
  assert.equal(serverLine?.status, 'matched');
  assert.equal(serverLine?.sourceQuantity, 1);
  assert.equal(serverLine?.agreementQuantity, 1);

  console.log('database reconciliation tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

const overrideDatabase: Queryable = {
  async query<T = unknown>(sql: string) {
    if (sql.includes('from vendor_usage_snapshots')) {
      return {
        rows: [
          {
            id: 'snapshot-override',
            vendor_id: 'cove',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            vendor_product_key: 'cove-workstation',
            product_code: 'COVE-WORKSTATION',
            product_name: 'Cove Workstation Backup',
            quantity: '1',
            observed_at: new Date('2026-06-15T12:00:00Z'),
            dimensions: {
              protectedSystemType: 'workstation',
              selectedStorageGb: 100,
              hostname: 'server-counted-as-pc',
            },
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return {
        rows: [
          {
            id: 'override-1',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            source_vendor_product_key: 'cove-workstation',
            target_vendor_product_key: 'cove-server',
            target_product_code: null,
            target_product_name: null,
            dimension_filters: {},
            target_dimensions: {},
            reason: 'Count this protected system as a server for billing.',
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [] as T[] };
    }

    if (sql.includes('from agreement_additions')) {
      return {
        rows: [
          {
            id: 'addition-server',
            customer_id: '11111111-1111-1111-1111-111111111111',
            agreement_id: '22222222-2222-2222-2222-222222222222',
            product_code: 'COVE-SERVER',
            product_name: 'Cove Server Backup',
            quantity: '1',
            unit_price: '120',
            updated_at: new Date('2026-06-15T12:00:00Z'),
          },
        ] as T[],
      };
    }

    return { rows: [] as T[] };
  },
};
