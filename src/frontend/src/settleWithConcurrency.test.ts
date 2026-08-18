import assert from 'node:assert/strict';
import { settleWithConcurrency } from './settleWithConcurrency';

async function run() {
  let active = 0;
  let maximumActive = 0;
  const progress: number[] = [];
  const results = await settleWithConcurrency(
    [1, 2, 3, 4, 5],
    2,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (value === 3) throw new Error('expected failure');
      return value * 10;
    },
    ({ completed }) => {
      progress.push(completed);
    },
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(results.map((result) => result.input), [1, 2, 3, 4, 5]);
  assert.deepEqual(results.map((result) => result.status), [
    'fulfilled',
    'fulfilled',
    'rejected',
    'fulfilled',
    'fulfilled',
  ]);
  assert.equal(results[0]?.status === 'fulfilled' ? results[0].value : undefined, 10);
  assert.equal(results[2]?.status === 'rejected' ? (results[2].reason as Error).message : undefined, 'expected failure');
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);

  console.log('settleWithConcurrency tests passed');
}

void run();
