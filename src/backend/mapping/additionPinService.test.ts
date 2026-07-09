import assert from 'node:assert/strict';
import { loadAdditionPins, upsertAdditionPins } from './additionPinService';

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    query: async <T>(sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('from vendor_product_addition_pins')) {
        return {
          rows: [
            {
              vendor_id: 'sentinelone',
              customer_id: 'client-1',
              agreement_id: 'agreement-1',
              vendor_product_key: 'sentinelone-server',
              connectwise_addition_id: '101',
              connectwise_product_code: 'S1-ENDPOINT',
              connectwise_product_name: 'SentinelOne Endpoint',
              mapping_source: 'auto-reconcile',
            },
          ],
        } as { rows: T[] };
      }

      return { rows: [] as T[] };
    },
  };

  const pins = await loadAdditionPins(database, 'sentinelone', ['agreement-1']);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.connectWiseAdditionId, '101');

  await upsertAdditionPins(database, [
    {
      vendorId: 'sentinelone',
      customerId: 'client-1',
      agreementId: 'agreement-1',
      vendorProductKey: 'sentinelone-workstation',
      connectWiseAdditionId: '102',
      connectwiseProductCode: 'S1-ENDPOINT',
      connectwiseProductName: 'SentinelOne Endpoint',
      mappingSource: 'auto-reconcile',
    },
  ]);
  assert.equal(queries.some((query) => query.sql.includes('insert into vendor_product_addition_pins')), true);

  console.log('addition pin service tests passed');
}

void run();
