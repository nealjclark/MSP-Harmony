import assert from 'node:assert/strict';
import {
  createUsageOverride,
  deactivateUsageOverride,
  listUsageOverrides,
} from './usageOverridesService';
import type { Queryable } from '../vendor/cove/operations';

const queries: Array<{ sql: string; values?: unknown[] }> = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });

    if (sql.includes('insert into vendor_usage_overrides')) {
      return {
        rows: [
          {
            id: 'override-1',
            vendor_id: values?.[0],
            customer_id: values?.[1],
            customer_name: null,
            agreement_id: values?.[2],
            agreement_name: null,
            source_vendor_product_key: values?.[3],
            target_vendor_product_key: values?.[4],
            dimension_filters: JSON.parse(String(values?.[5])),
            target_dimensions: JSON.parse(String(values?.[6])),
            reason: values?.[7],
            active: true,
            reviewed_by: values?.[8],
            reviewed_at: new Date('2026-06-16T12:00:00Z'),
            created_at: new Date('2026-06-16T12:00:00Z'),
            updated_at: new Date('2026-06-16T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('from vendor_usage_overrides')) {
      return {
        rows: [
          {
            id: 'override-1',
            vendor_id: 'cove',
            customer_id: 'customer-1',
            customer_name: 'Customer One',
            agreement_id: 'agreement-1',
            agreement_name: 'Managed Services',
            source_vendor_product_key: 'cove-workstation',
            target_vendor_product_key: 'cove-server',
            dimension_filters: { hostname: 'SERVER-01' },
            target_dimensions: {},
            reason: 'Bill as server.',
            active: true,
            reviewed_by: 'frontend',
            reviewed_at: new Date('2026-06-16T12:00:00Z'),
            created_at: new Date('2026-06-16T12:00:00Z'),
            updated_at: new Date('2026-06-16T12:00:00Z'),
          },
        ] as T[],
      };
    }

    if (sql.includes('update vendor_usage_overrides')) {
      return { rows: [{ id: values?.[1] } as T] };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  const created = await createUsageOverride(database, 'cove', {
    customerId: 'customer-1',
    agreementId: 'agreement-1',
    sourceVendorProductKey: 'cove-workstation',
    targetVendorProductKey: 'cove-server',
    dimensionFilters: { hostname: 'SERVER-01' },
    reason: 'Bill as server.',
    reviewedBy: 'frontend',
  });

  assert.equal(created.sourceVendorProductKey, 'cove-workstation');
  assert.equal(created.targetVendorProductKey, 'cove-server');
  assert.deepEqual(created.dimensionFilters, { hostname: 'SERVER-01' });

  const overrides = await listUsageOverrides(database, 'cove');
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0]?.customerName, 'Customer One');
  assert.equal(overrides[0]?.agreementName, 'Managed Services');

  const deactivated = await deactivateUsageOverride(database, 'cove', 'override-1', {
    reviewedBy: 'frontend',
  });
  assert.equal(deactivated.active, false);

  await assert.rejects(
    () =>
      createUsageOverride(database, 'cove', {
        sourceVendorProductKey: 'cove-server',
        targetVendorProductKey: 'cove-server',
      }),
    /different/,
  );

  assert.equal(queries.some((query) => query.sql.includes('vendor_usage_overrides')), true);
  console.log('usage override service tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
