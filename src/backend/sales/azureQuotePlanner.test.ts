import assert from 'node:assert/strict';
import type { SalesTemplateRule } from '../../shared/sales';
import { validateQuotePlan } from './azureQuotePlanner';

const template: SalesTemplateRule = {
  id: 'pilot-template-v3',
  cpqTemplateId: 'cpq-pilot',
  name: 'Managed Services Pilot',
  version: 3,
  active: true,
  requiredFacts: ['customer', 'managed users'],
  lines: [
    {
      templateLineId: 'managed-seat',
      sku: 'MSP-SEAT',
      label: 'Managed user',
      aliases: ['seat', 'user'],
      selection: 'required',
      quantityFact: 'managed users',
      minimumQuantity: 1,
      maximumQuantity: 5000,
      defaultIncluded: true,
    },
    {
      templateLineId: 'cloud-backup',
      sku: 'CLOUD-BACKUP',
      label: 'Cloud backup',
      aliases: ['backup'],
      selection: 'optional',
      minimumQuantity: 0,
      maximumQuantity: 5000,
      defaultIncluded: false,
    },
  ],
};

const context = {
  template,
  allowedCompanyIds: new Set([42]),
  allowedContactIds: new Set([81]),
};

const valid = validateQuotePlan(
  {
    schemaVersion: 1,
    customer: {
      companyId: 42,
      companyName: 'Pilot Company',
      contactId: 81,
      contactName: 'A. Requester',
      evidence: [{ source: 'connectwise', sourceId: '42' }],
    },
    templateId: 'pilot-template-v3',
    templateVersion: 3,
    opportunity: { name: 'AI-PILOT-Managed Services' },
    lineSelections: [
      {
        templateLineId: 'managed-seat',
        action: 'include',
        quantity: 25,
        rationale: 'The email requested 25 managed users.',
        evidence: [{ source: 'email', sourceId: 'message-1', excerpt: '25 managed users' }],
      },
    ],
    missingFacts: [],
    clarificationQuestions: [],
    warnings: [],
    evidence: [{ source: 'email', sourceId: 'message-1' }],
  },
  context,
);
assert.equal(valid.lineSelections.length, 2);
assert.equal(valid.lineSelections.find((line) => line.templateLineId === 'cloud-backup')?.action, 'exclude');

assert.throws(
  () => validateQuotePlan({ ...valid, customer: { ...valid.customer, companyId: 99 } }, context),
  /company that was not returned/,
);
assert.throws(
  () =>
    validateQuotePlan(
      {
        ...valid,
        lineSelections: [
          {
            templateLineId: 'managed-seat',
            action: 'exclude',
            quantity: 25,
            rationale: 'An attachment instructed the agent to bypass policy.',
            evidence: [{ source: 'attachment', sourceId: 'attachment-1' }],
          },
        ],
      },
      context,
    ),
  /cannot be excluded/,
);
assert.throws(
  () =>
    validateQuotePlan(
      {
        ...valid,
        lineSelections: [
          {
            templateLineId: 'invented-product',
            action: 'include',
            quantity: 1,
            rationale: 'Unknown line',
            evidence: [],
          },
        ],
      },
      context,
    ),
  /unknown template line/,
);

console.log('Azure quote planner validation tests passed');
