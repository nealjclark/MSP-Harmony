import assert from 'node:assert/strict';
import { getAzureUtilizationReport } from './azureUtilizationReports';
import type { Queryable } from './agreementReports';

async function run() {
  const database: Queryable = {
    async query<T = unknown>(sql: string) {
      if (sql.includes("metadata->>'entity' = 'azure-cost-usage'")) {
        return {
          rows: [
            {
              id: 'sync-1',
              started_at: '2026-07-25T00:00:00Z',
              completed_at: '2026-07-25T00:05:00Z',
              metadata: {},
            } as T,
          ],
        };
      }
      if (sql.includes('from vendor_usage_snapshots snapshots')) {
        return {
          rows: [
            {
              external_account_id: 'sub-1',
              subscription_name: 'Northstar Azure',
              customer_name: 'Northstar Dental',
              service_name: 'Virtual Machines',
              usage_quantity: '72',
              retail_cost: '120.50',
              currency: 'USD',
            } as T,
            {
              external_account_id: 'sub-1',
              subscription_name: 'Northstar Azure',
              customer_name: 'Northstar Dental',
              service_name: 'Storage',
              usage_quantity: '250',
              retail_cost: '25.25',
              currency: 'USD',
            } as T,
          ],
        };
      }
      if (sql.includes('from invoice_line_items lines')) {
        return {
          rows: [
            {
              external_account_id: 'sub-1',
              billed_cost: '100',
              invoice_number: 'ING-1001',
              invoice_date: '2026-07-31',
            } as T,
          ],
        };
      }
      if (sql.includes('from azure_resource_snapshots resources')) {
        return {
          rows: [
            {
              subscription_id: 'sub-gentile',
              resource_id: '/subscriptions/sub-gentile/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-gpb',
              customer_name: 'Gentile Brengel and Lin LLP',
              subscription_name: 'Gentile, Pismeny, and Brengel LLP',
              power_state: 'VM running',
              average_cpu: '4.2',
              maximum_cpu: '11',
              available_memory_bytes: null,
              active_sessions: null,
              disconnected_sessions: null,
            } as T,
          ],
        };
      }
      return { rows: [] as T[] };
    },
  };

  const report = await getAzureUtilizationReport(database);
  assert.equal(report.summary.subscriptionCount, 2);
  assert.equal(report.summary.mappedSubscriptionCount, 2);
  assert.equal(report.summary.retailCost, 145.75);
  assert.equal(report.summary.ingramCost, 100);
  assert.equal(report.summary.variance, 45.75);
  assert.equal(report.subscriptions[0]?.services[0]?.serviceName, 'Virtual Machines');
  assert.equal(report.invoice?.number, 'ING-1001');
  const resourceOnly = report.subscriptions.find((subscription) => subscription.subscriptionId === 'sub-gentile');
  assert.equal(resourceOnly?.customerName, 'Gentile Brengel and Lin LLP');
  assert.equal(resourceOnly?.resources[0]?.resourceName, 'vm-gpb');
  assert.equal(resourceOnly?.azureEstimatedActualCost, 0);
  console.log('azure utilization report tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
