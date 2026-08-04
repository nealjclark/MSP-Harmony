import assert from 'node:assert/strict';
import {
  canTransitionQuoteRequest,
  isQuoteRequestStatus,
  quoteRequestStatuses,
  quoteStatusLabel,
} from './sales';

assert.equal(quoteRequestStatuses.length, 9);
assert.equal(isQuoteRequestStatus('awaiting-approval'), true);
assert.equal(isQuoteRequestStatus('sent-to-customer'), false);
assert.equal(quoteStatusLabel('approved-ready-delivery'), 'Approved Ready Delivery');
assert.equal(canTransitionQuoteRequest('received', 'ready-to-draft'), true);
assert.equal(canTransitionQuoteRequest('received', 'awaiting-approval'), false);
assert.equal(canTransitionQuoteRequest('awaiting-approval', 'approved-ready-delivery'), true);
assert.equal(canTransitionQuoteRequest('approved-ready-delivery', 'received'), false);
assert.equal(canTransitionQuoteRequest('changes-requested', 'drafting'), true);
assert.equal(canTransitionQuoteRequest('failed', 'received'), true);

console.log('sales domain tests passed');
