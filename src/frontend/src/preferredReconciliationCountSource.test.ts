import assert from 'node:assert/strict';
import { preferredReconciliationCountSource } from './preferredReconciliationCountSource';

assert.equal(preferredReconciliationCountSource(5, undefined, undefined), 'api');
assert.equal(preferredReconciliationCountSource(5, undefined, 3), 'api');
assert.equal(preferredReconciliationCountSource(5, undefined, 7), 'linked');
assert.equal(preferredReconciliationCountSource(5, 8, 7), 'invoice');
assert.equal(preferredReconciliationCountSource(5, 5, 5), 'api');
assert.equal(preferredReconciliationCountSource(5, 5, 6), 'linked');
assert.equal(preferredReconciliationCountSource(0, undefined, 12), 'linked');
assert.equal(preferredReconciliationCountSource(0, 4, 3), 'invoice');

console.log('preferred reconciliation count source tests passed');
