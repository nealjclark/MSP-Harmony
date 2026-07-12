import assert from 'node:assert/strict';
import { buildLaborSection, getProductProfitabilityReport, LABOR_HOURLY_RATE } from './productProfitabilityReports';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });

      if (sql.includes('with mapped_vendors')) {
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
        assert.equal(Array.isArray(values?.[0]), true);
        assert.equal(values?.[1], 12);
        assert.equal(sql.includes('monthly_latest'), true);

        const vendorIds = values?.[0] as string[];
        const allRows = [
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
        ];

        return {
          rows: allRows.filter((row) => vendorIds.includes(row.vendor_id)) as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const report = await getProductProfitabilityReport(database, {
    laborMappings: [
      {
        id: '1',
        vendorId: 'cove',
        label: 'Backup labor',
        boardId: 77,
        boardName: 'Backup',
        typeIds: [1008, 1009],
        typeNames: ['Backup Management', 'Backup Restore'],
        subTypeIds: [],
        subTypeNames: [],
        priority: 10,
        active: true,
        rawPayload: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    laborTickets: [
      {
        ticketId: 1,
        boardId: 77,
        typeId: 1008,
        subTypeId: 4064,
        actualHours: 2.5,
        closedFlag: true,
        closedAt: '2026-06-10T12:00:00Z',
      },
      {
        ticketId: 1,
        boardId: 77,
        typeId: 1008,
        subTypeId: 4064,
        actualHours: 2.5,
        closedFlag: true,
        closedAt: '2026-06-10T12:00:00Z',
      },
      {
        ticketId: 2,
        boardId: 77,
        typeId: 1009,
        actualHours: 1,
        closedFlag: true,
        closedAt: '2026-06-15T12:00:00Z',
      },
    ],
  });

  assert.equal(report.reportType, 'product-profitability');
  assert.equal(report.billingBasis, 'latest-addition-per-month');
  assert.equal(report.laborHourlyRate, LABOR_HOURLY_RATE);
  assert.equal(report.startMonth, '2025-07');
  assert.equal(report.endMonth, '2026-06');
  assert.equal(report.months.length, 12);
  assert.equal(report.summary.integrationCount, 3);
  assert.equal(report.summary.productCount, 2);
  assert.equal(report.summary.totalRevenue, 400);
  assert.equal(report.summary.totalCost, 170);
  assert.equal(report.summary.totalProfit, 230);
  assert.equal(report.summary.totalLaborHours, 3.5);
  assert.equal(report.summary.totalLaborCost, 175);

  const cove = report.integrations.find((integration) => integration.integrationId === 'cove');
  assert.ok(cove);
  assert.equal(cove.integrationName, 'Cove Data Protection');
  assert.equal(cove.totalRevenue, 300);
  assert.equal(cove.totalCost, 130);
  assert.equal(cove.totalProfit, 170);
  assert.equal(cove.totalLaborHours, 3.5);
  assert.equal(cove.totalLaborCost, 175);
  assert.equal(cove.months.find((month) => month.month === '2026-05')?.profit, 60);
  assert.equal(cove.months.find((month) => month.month === '2026-06')?.profit, 110);
  assert.equal(cove.months.find((month) => month.month === '2026-06')?.laborHours, 3.5);
  assert.equal(cove.months.find((month) => month.month === '2026-06')?.laborCost, 175);

  const ncentral = report.integrations.find((integration) => integration.integrationId === 'ncentral');
  assert.ok(ncentral);
  assert.equal(ncentral.totalProfit, 60);

  const sentinelone = report.integrations.find((integration) => integration.integrationId === 'sentinelone');
  assert.ok(sentinelone);
  assert.equal(sentinelone.totalProfit, 0);
  assert.equal(sentinelone.months.every((month) => month.profit === 0), true);
  assert.equal(queries.some((query) => query.sql.includes('vendor_product_bundles')), true);

  const labor = buildLaborSection(
    ['2026-06'],
    [
      {
        id: '1',
        vendorId: 'cove',
        label: 'Backup labor',
        boardId: 77,
        typeIds: [1008],
        typeNames: ['Backup Management'],
        subTypeIds: [],
        subTypeNames: [],
        priority: 10,
        active: true,
        rawPayload: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    [
      {
        ticketId: 9,
        boardId: 77,
        typeId: 1008,
        actualHours: 4,
        closedFlag: true,
        closedAt: '2026-06-01T00:00:00Z',
      },
    ],
  );
  assert.equal(labor.months[0]?.hours, 4);
  assert.equal(labor.months[0]?.cost, 200);
  assert.equal(labor.rows[0]?.totalHours, 4);
  assert.equal(labor.rows[0]?.totalCost, 200);

  const filtered = await getProductProfitabilityReport(database, { vendorIds: ['cove'] });
  assert.equal(filtered.summary.integrationCount, 1);
  assert.equal(filtered.integrations[0]?.integrationId, 'cove');

  console.log('product profitability report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
