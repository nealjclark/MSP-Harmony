import assert from 'node:assert/strict';
import {
  createMonthlyReviewProductExclusion,
  listMonthlyReviewProductExclusions,
  restoreMonthlyReviewProductExclusion,
} from './monthlyReviewProductExclusions';

const queries: Array<{ sql: string; values?: unknown[] }> = [];
const database = {
  async query<T>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });
    if (sql.includes('insert into monthly_review_product_exclusions')) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          connectwise_product_id: '987',
          connectwise_product_code: 'PROOFPOINT-SYNC',
          connectwise_product_name: 'Proofpoint Sync',
          active: true,
          excluded_by: 'admin@example.com',
          excluded_at: '2026-08-03T12:00:00.000Z',
          restored_by: null,
          restored_at: null,
        }] as T[],
      };
    }
    if (sql.includes('update monthly_review_product_exclusions')) {
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] as T[] };
    }
    return {
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        connectwise_product_id: '987',
        connectwise_product_code: 'PROOFPOINT-SYNC',
        connectwise_product_name: 'Proofpoint Sync',
        active: true,
        excluded_by: 'admin@example.com',
        excluded_at: '2026-08-03T12:00:00.000Z',
        restored_by: null,
        restored_at: null,
      }] as T[],
    };
  },
};

async function run() {
  const created = await createMonthlyReviewProductExclusion(database, {
    connectWiseProductId: '987',
    connectWiseProductCode: ' PROOFPOINT-SYNC ',
    connectWiseProductName: ' Proofpoint Sync ',
    excludedBy: 'admin@example.com',
  });
  assert.equal(created.connectWiseProductCode, 'PROOFPOINT-SYNC');
  assert.equal(queries[0]?.values?.[1], 'PROOFPOINT-SYNC');

  const exclusions = await listMonthlyReviewProductExclusions(database);
  assert.equal(exclusions.length, 1);
  assert.equal(exclusions[0]?.connectWiseProductId, '987');
  assert.equal(queries[1]?.values?.[0], false);

  await restoreMonthlyReviewProductExclusion(
    database,
    '11111111-1111-4111-8111-111111111111',
    'admin@example.com',
  );
  assert.equal(queries[2]?.values?.[1], 'admin@example.com');

  await assert.rejects(
    () => createMonthlyReviewProductExclusion(database, {
      connectWiseProductCode: '',
      connectWiseProductName: '',
      excludedBy: 'admin@example.com',
    }),
    /Choose a ConnectWise catalog product/,
  );

  console.log('monthly review product exclusion tests passed');
}

void run();
