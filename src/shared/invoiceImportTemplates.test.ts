import assert from 'node:assert/strict';
import {
  autoSelectedInvoiceTemplate,
  invoiceHeaderFingerprint,
  matchInvoiceImportTemplates,
  type InvoiceImportTemplate,
} from './invoiceImportTemplates';

const base: InvoiceImportTemplate = {
  id: '11111111-1111-1111-1111-111111111111',
  integrationId: 'pax8',
  name: 'Pax8 monthly invoice',
  sourceType: 'invoice',
  columnMap: { externalAccountId: 'Account ID', productName: 'Product', quantity: 'Qty' },
  knownHeaders: ['Account ID', 'Product', 'Qty', 'Amount'],
  version: 1,
  status: 'active',
  signatures: [{
    id: 'signature-1',
    templateId: '11111111-1111-1111-1111-111111111111',
    headers: ['Account ID', 'Product', 'Qty', 'Amount'],
    normalizedHeaders: ['account id', 'amount', 'product', 'qty'],
    columnMap: { externalAccountId: 'Account ID', productName: 'Product', quantity: 'Qty' },
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
  }],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

assert.equal(invoiceHeaderFingerprint([' Qty ', 'ACCOUNT-ID', 'Product']), 'account id|product|qty');

const exact = matchInvoiceImportTemplates([base], ['Account ID', 'Product', 'Qty', 'Amount', 'New column']);
assert.equal(exact[0]?.coverage, 1);
assert.equal(autoSelectedInvoiceTemplate(exact)?.id, base.id);

const ambiguous = matchInvoiceImportTemplates([
  base,
  { ...base, id: '22222222-2222-2222-2222-222222222222', name: 'Another template' },
], ['Account ID', 'Product', 'Qty', 'Amount']);
assert.equal(autoSelectedInvoiceTemplate(ambiguous), undefined);

assert.equal(matchInvoiceImportTemplates([{ ...base, status: 'archived' }], base.knownHeaders).length, 0);
assert.equal(autoSelectedInvoiceTemplate(matchInvoiceImportTemplates([{ ...base, columnMap: { productName: 'Product' } }], base.knownHeaders)), undefined);

console.log('invoice import template matching tests passed');
