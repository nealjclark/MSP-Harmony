import assert from 'node:assert/strict';
import { buildInvestigationTicketDescription } from './investigationTickets';

const description = buildInvestigationTicketDescription({
  customerName: 'Acme Corp',
  agreementName: 'Managed Services',
  vendorName: 'Cove',
  notes: 'Please review seat drift.',
  licenses: [
    {
      sourceLineId: 'line-1',
      productCode: 'COVE-SERVER',
      productName: 'Cove Server Backup',
      vendorProductKey: 'server-backup',
      unit: 'devices',
      apiCount: 12,
      linkedCount: 10,
      linkedCountDetail: {
        quantity: 10,
        ruleName: 'Linked servers',
        sources: [{ label: 'Endpoint filter', quantity: 10 }],
      },
      vendorInvoiceCount: 11,
      invoiceNumber: 'INV-9',
      invoiceDate: '2026-07-01',
      connectWiseCount: 8,
      proposedCount: 12,
      selectedCountSource: 'api',
      selectedCount: 12,
      delta: 4,
      financialImpact: 120,
      reason: 'API count exceeds ConnectWise',
      recommendation: 'Update the ConnectWise agreement addition after review.',
      status: 'needs-review',
      connectWiseAdditionId: '4455',
      matchedAgreementAdditions: [
        {
          connectWiseAdditionId: '4455',
          productCode: 'COVE-SERVER',
          productName: 'Cove Server Backup',
          quantity: 8,
          lessIncluded: 0,
          billedQuantity: 8,
        },
      ],
      adjustments: [{ quantity: 1, reason: 'Courtesy seat' }],
      audit: ['Cove API quantity: 12 devices.'],
    },
  ],
});

assert.match(description, /Company: Acme Corp/);
assert.match(description, /Customer: Acme Corp/);
assert.match(description, /Integration: Cove/);
assert.match(description, /Vendor API count: 12 devices/);
assert.match(description, /Linked count: 10 devices/);
assert.match(description, /Imported invoice count: 11 devices \(invoice INV-9, 2026-07-01\)/);
assert.match(description, /ConnectWise agreement count: 8 devices/);
assert.match(description, /Please review seat drift\./);
assert.match(description, /Matched ConnectWise additions:/);

const withOverride = buildInvestigationTicketDescription({
  customerName: 'Acme Corp',
  companyId: 12345,
  agreementName: 'Managed Services',
  vendorName: 'Cove',
  companyOverride: { id: 99, name: 'Internal Billing' },
  licenses: [
    {
      sourceLineId: 'line-1',
      productCode: 'COVE-SERVER',
      productName: 'Cove Server Backup',
      apiCount: 12,
      connectWiseCount: 8,
    },
  ],
});

assert.match(withOverride, /Company: Acme Corp \(CW company 12345\)/);
assert.match(withOverride, /Ticket company override: Internal Billing \(#99\)/);
assert.match(withOverride, /--- License 1: Cove Server Backup \(COVE-SERVER\) ---\nCompany: Acme Corp \(CW company 12345\)/);

console.log('investigationTickets description builder tests passed');
