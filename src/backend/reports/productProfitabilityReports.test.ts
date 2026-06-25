import assert from 'node:assert/strict';
import { getProductProfitabilityReport } from './productProfitabilityReports';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('from integration_settings')) {
        return {
          rows: [
            {
              integration_id: 'cove',
              display_name: 'Cove Data Protection',
            },
            {
              integration_id: 'ncentral',
              display_name: 'N-able N-central',
            },
            {
              integration_id: 'sentinelone',
              display_name: 'SentinelOne',
            },
          ] as T[],
        };
      }

      if (sql.includes('with mapped_products')) {
        assert.deepEqual(values?.[0], ['cove', 'ncentral', 'sentinelone']);
        assert.equal(values?.[1], 12);

        return {
          rows: [
            {
              vendor_id: 'cove',
              observed_month: new Date('2026-05-01T00:00:00Z'),
              product_code: 'COVE-SERVER',
              observed_quantity: '2',
              unit_price: '50',
              raw_payload: {
                unitCost: 20,
              },
            },
            {
              vendor_id: 'cove',
              observed_month: new Date('2026-06-01T00:00:00Z'),
              product_code: 'COVE-SERVER',
              observed_quantity: '4',
              unit_price: '55',
              raw_payload: {
                extPrice: 200,
                extCost: 90,
              },
            },
            {
              vendor_id: 'ncentral',
              observed_month: new Date('2026-06-01T00:00:00Z'),
              product_code: 'NC-MANAGED-SERVER',
              observed_quantity: '1',
              unit_price: '100',
              raw_payload: {
                unitCost: 40,
              },
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const report = await getProductProfitabilityReport(database);

  assert.equal(report.reportType, 'product-profitability');
  assert.equal(report.startMonth, '2025-07');
  assert.equal(report.endMonth, '2026-06');
  assert.equal(report.months.length, 12);
  assert.equal(report.summary.integrationCount, 3);
  assert.equal(report.summary.productCount, 2);
  assert.equal(report.summary.totalRevenue, 400);
  assert.equal(report.summary.totalCost, 170);
  assert.equal(report.summary.totalProfit, 230);

  const cove = report.integrations.find((integration) => integration.integrationId === 'cove');
  assert.ok(cove);
  assert.equal(cove.integrationName, 'Cove Data Protection');
  assert.equal(cove.totalRevenue, 300);
  assert.equal(cove.totalCost, 130);
  assert.equal(cove.totalProfit, 170);
  assert.equal(cove.months.find((month) => month.month === '2026-05')?.profit, 60);
  assert.equal(cove.months.find((month) => month.month === '2026-06')?.profit, 110);

  const ncentral = report.integrations.find((integration) => integration.integrationId === 'ncentral');
  assert.ok(ncentral);
  assert.equal(ncentral.totalProfit, 60);

  const sentinelone = report.integrations.find((integration) => integration.integrationId === 'sentinelone');
  assert.ok(sentinelone);
  assert.equal(sentinelone.totalProfit, 0);
  assert.equal(sentinelone.months.every((month) => month.profit === 0), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_product_bundles')), true);

  console.log('product profitability report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
