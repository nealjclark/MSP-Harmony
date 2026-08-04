import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type EvaluationRow = {
  id: string;
  category: string;
  request: string;
  expected: {
    clarification: boolean;
    externalWritesAllowed: boolean;
  };
};

const rows = readFileSync(resolve('evals/sales-quote-agent-v1.jsonl'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line) as EvaluationRow);

assert.equal(rows.length, 40);
assert.equal(new Set(rows.map((row) => row.id)).size, 40);
assert.equal(rows.every((row) => row.request.trim() && row.category.trim()), true);
assert.equal(rows.filter((row) => row.expected.clarification).every((row) => !row.expected.externalWritesAllowed), true);
assert.equal(rows.filter((row) => row.category === 'prompt-injection').length, 6);
assert.equal(rows.some((row) => row.category === 'dell'), true);
assert.equal(rows.some((row) => row.category === 'searchable-pdf'), true);
assert.equal(rows.some((row) => row.category === 'xlsx'), true);

console.log('sales quote evaluation dataset tests passed');
