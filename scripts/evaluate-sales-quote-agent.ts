import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { AzureQuotePlanner, type QuotePlannerDellResult } from '../src/backend/sales/azureQuotePlanner';
import type { QuotePlan, SalesTemplateRule } from '../src/shared/sales';

type Expected = {
  clarification: boolean;
  externalWritesAllowed: boolean;
  included?: string[];
  excluded?: string[];
  quantities?: Record<string, number>;
  dell?: { number: string; version?: string; locale?: string };
  retryable?: boolean;
};

type EvaluationRow = {
  id: string;
  category: string;
  request: string;
  expected: Expected;
};

const endpoint = process.argv[2]?.trim();
const deployment = process.argv[3]?.trim();
const requestedLimit = Number(process.argv[4] ?? 40);
if (!endpoint || !deployment) {
  throw new Error('Usage: tsx scripts/evaluate-sales-quote-agent.ts <endpoint> <deployment> [limit]');
}

const template: SalesTemplateRule = {
  id: 'evaluation-template-v1',
  cpqTemplateId: 'cpq-evaluation',
  name: 'Managed Services Pilot',
  version: 1,
  active: true,
  requiredFacts: ['customer', 'contact', 'managed users'],
  lines: [
    {
      templateLineId: 'managed-seat',
      sku: 'MSP-SEAT',
      label: 'Managed user',
      aliases: ['managed user', 'managed seat', 'core managed service'],
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
      aliases: ['backup', 'cloud backup'],
      selection: 'optional',
      quantityFact: 'backup users',
      minimumQuantity: 0,
      maximumQuantity: 5000,
      defaultIncluded: false,
    },
  ],
};

const rows = readFileSync('evals/sales-quote-agent-v1.jsonl', 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line) as EvaluationRow)
  .slice(0, Math.min(Math.max(requestedLimit, 1), 40));

const planner = new AzureQuotePlanner(endpoint, deployment, {
  searchCompanies: async (query) => {
    if (/test company/i.test(query)) return [{ id: 42, name: 'Test Company', identifier: 'TESTCO' }];
    if (/acme/i.test(query)) {
      return [
        { id: 51, name: 'Acme Holdings', identifier: 'ACME-H' },
        { id: 52, name: 'Acme Services', identifier: 'ACME-S' },
      ];
    }
    if (/northstar/i.test(query)) {
      return [
        { id: 61, name: 'Northstar Dental', identifier: 'NORTH-D' },
        { id: 62, name: 'Northstar Logistics', identifier: 'NORTH-L' },
      ];
    }
    return [];
  },
  listContacts: async (companyId) => [
    { id: 81, companyId, name: 'Alex Requester', email: 'alex@example.test' },
    { id: 82, companyId, name: 'Pat One', email: 'pat.one@example.test' },
    { id: 83, companyId, name: 'Pat Two', email: 'pat.two@example.test' },
  ],
  getDellEquote: async (reference) => dellResult(reference.equoteNumber, reference.version, reference.locale),
});

const results: Array<{
  id: string;
  passed: boolean;
  clarification?: boolean;
  externalWritesAllowed?: boolean;
  error?: string;
}> = [];

for (const [index, row] of rows.entries()) {
  let plan: QuotePlan | undefined;
  let error: string | undefined;
  try {
    plan = await planner.createPlan({
      requestId: row.id,
      subject: `Evaluation ${row.id}`,
      requesterEmail: 'alex@example.test',
      messages: [{ id: `${row.id}-message`, bodyText: row.request }],
      attachments: [],
      template,
      promptVersion: 'sales-quote-eval-v1',
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const clarification = error
    ? true
    : Boolean(
        plan &&
          (plan.missingFacts.length > 0 ||
            plan.clarificationQuestions.length > 0 ||
            !plan.customer.companyId ||
            !plan.customer.contactId ||
            !plan.templateId ||
            !plan.opportunity.name),
      );
  const externalWritesAllowed = !error && !clarification;
  const passed =
    clarification === row.expected.clarification &&
    externalWritesAllowed === row.expected.externalWritesAllowed &&
    (!plan || expectationsMatch(plan, row.expected));
  results.push({ id: row.id, passed, clarification, externalWritesAllowed, error });
  console.log(`${index + 1}/${rows.length} ${passed ? 'PASS' : 'FAIL'} ${row.id}${error ? ` — ${error}` : ''}`);
}

const passedCount = results.filter((result) => result.passed).length;
const accuracy = Math.round((passedCount / results.length) * 1000) / 10;
console.log(
  JSON.stringify(
    {
      deployment,
      evaluated: results.length,
      passed: passedCount,
      accuracy,
      releaseGatePassed: results.length === 40 && accuracy >= 95,
      failures: results.filter((result) => !result.passed),
    },
    null,
    2,
  ),
);
if (accuracy < 95) process.exitCode = 2;

function expectationsMatch(plan: QuotePlan, expected: Expected) {
  const selected = new Map(plan.lineSelections.map((line) => [line.templateLineId, line]));
  if (expected.included?.some((id) => selected.get(id)?.action !== 'include')) return false;
  if (expected.excluded?.some((id) => selected.get(id)?.action !== 'exclude')) return false;
  if (
    expected.quantities &&
    Object.entries(expected.quantities).some(([id, quantity]) => selected.get(id)?.quantity !== quantity)
  ) {
    return false;
  }
  if (expected.dell) {
    if (plan.dellEquote?.equoteNumber !== expected.dell.number) return false;
    if (expected.dell.version && plan.dellEquote.version !== expected.dell.version) return false;
    if (expected.dell.locale && plan.dellEquote.locale?.toLowerCase() !== expected.dell.locale.toLowerCase()) {
      return false;
    }
  }
  return true;
}

function dellResult(number: string, version?: string, locale = 'en-us'): QuotePlannerDellResult {
  if (number === '300012350') throw new Error('Dell Quote API throttled the evaluation request.');
  return {
    number,
    version,
    locale,
    customerName: number === '300012348' ? 'Another Company' : 'Test Company',
    currency: number === '300012349' ? 'CAD' : 'USD',
    expiresAt: number === '300012347' ? '2025-01-01T00:00:00Z' : '2027-12-31T00:00:00Z',
    lines: [
      {
        lineId: `${number}-1`,
        sku: 'DELL-EVAL',
        description: 'Dell evaluation workstation',
        quantity: 1,
        unitCost: 1000,
        unitPrice: 1200,
      },
    ],
  };
}
