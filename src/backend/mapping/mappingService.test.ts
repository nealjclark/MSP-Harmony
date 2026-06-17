import assert from 'node:assert/strict';
import {
  approveSuggestedAccountMappings,
  buildAccountMappingCandidates,
  generateProductMappingCandidates,
  normalizeEntityName,
  runAccountAutomap,
  searchConnectWiseProductCatalog,
  scoreEntityName,
  updateAccountMapping,
  updateProductMapping,
  type ConnectWiseCustomerCandidate,
  type Queryable,
  type VendorAccountSource,
} from './mappingService';

assert.equal(normalizeEntityName('The Property Development Group, LLC'), 'property development group');
assert.equal(scoreEntityName('Absolutely Knits', 'Absolutely Knits Inc'), 100);
assert.equal(scoreEntityName('Siler Ingber LLP', 'Siler & Ingber, LLP'), 67);
assert.equal(scoreEntityName('Creative Construction Services Corp', 'ATI'), 0);
assert.equal(scoreEntityName('Creative Construction Services Corp', 'Creative Construction Ser'), 92);

const sources: VendorAccountSource[] = [
  {
    externalAccountId: '101',
    externalAccountName: 'Absolutely Knits',
    rowCount: 3,
  },
  {
    externalAccountId: '202',
    externalAccountName: 'Collins Gann McCloskey',
    rowCount: 1,
  },
  {
    externalAccountId: '303',
    externalAccountName: 'Creative Solutions',
    rowCount: 2,
  },
];

const customers: ConnectWiseCustomerCandidate[] = [
  customer('customer-1', 'Absolutely Knits Inc', [
    agreement('agreement-1', 'Monthly Services', 6, ['Cove Backup Protection - Svr']),
  ]),
  customer('customer-2', 'Collins McCloskey & Gann PLLC', [
    agreement('agreement-2', 'Managed Services', 7, []),
    agreement('agreement-3', 'Security Services', 7, []),
  ]),
  customer('customer-3', 'Creative Solutions Inc.', [
    agreement('agreement-4', 'Monthly Services', 2, []),
  ]),
];

const candidates = buildAccountMappingCandidates('cove', sources, customers, ['Cove Backup Protection - Svr']);
const exact = candidates.find((candidate) => candidate.externalAccountId === '101');
assert.equal(exact?.status, 'approved');
assert.equal(exact?.activeRecommended, true);
assert.equal(exact?.agreementId, 'agreement-1');

const ambiguous = candidates.find((candidate) => candidate.externalAccountId === '202');
assert.equal(ambiguous?.status, 'needs-review');
assert.equal(ambiguous?.activeRecommended, false);
assert.match(ambiguous?.reason ?? '', /Multiple agreements/);

const secondExact = candidates.find((candidate) => candidate.externalAccountId === '303');
assert.equal(secondExact?.status, 'approved');

const monthlyAgreement = buildAccountMappingCandidates(
  'cove',
  [
    {
      externalAccountId: '505',
      externalAccountName: 'Monthly Preference LLC',
      rowCount: 1,
    },
  ],
  [
    customer('customer-6', 'Monthly Preference LLC', [
      agreement('agreement-6', 'Hourly Service Agreement', 12, []),
      agreement('agreement-7', 'Monthly Services Agreement', 2, []),
    ]),
  ],
)[0];
assert.equal(monthlyAgreement?.status, 'approved');
assert.equal(monthlyAgreement?.agreementId, 'agreement-7');

const creativeCandidates = buildAccountMappingCandidates(
  'cove',
  [
    {
      externalAccountId: '404',
      externalAccountName: 'Creative Construction Services Corp',
      rowCount: 1,
    },
  ],
  [
    customer('customer-4', 'Creative Construction Services Corp', [
      agreement('agreement-5', 'Creative Construction Services Corp Monthly Services', 6, ['Cove Backup Protection - Svr']),
    ]),
    customer('customer-5', 'Alternative Parts, Inc.', [], ['ATI']),
  ],
  ['Cove Backup Protection - Svr'],
);
const creative = creativeCandidates.find((candidate) => candidate.externalAccountId === '404');
assert.equal(creative?.status, 'approved');
assert.equal(creative?.activeRecommended, true);

const queries: Array<{ sql: string; values?: unknown[] }> = [];
const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });
    return { rows: [] as T[] };
  },
};

async function run() {
  const accountQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const accountDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      accountQueries.push({ sql, values });
      return { rows: [] as T[] };
    },
  };

  await updateAccountMapping(accountDatabase, 'cove', '2379363', {
    status: 'approved',
    customerId: 'customer-1',
    agreementId: 'agreement-1',
    externalAccountName: 'Absolutely Knits',
    reviewedBy: 'reviewer@example.com',
  });

  assert.equal(accountQueries.length, 1);
  assert.match(accountQueries[0]?.sql ?? '', /case when \$10::text is null/);
  assert.equal(accountQueries[0]?.values?.[9], 'reviewer@example.com');
  assert.equal(accountQueries[0]?.values?.[11], true);

  await updateAccountMapping(accountDatabase, 'cove', '2379364', {
    status: 'approved',
    customerId: 'customer-2',
    externalAccountName: 'Ticket Only Customer',
    reviewedBy: 'reviewer@example.com',
  });

  assert.equal(accountQueries.length, 2);
  assert.equal(accountQueries[1]?.values?.[3], 'customer-2');
  assert.equal(accountQueries[1]?.values?.[4], null);
  assert.equal(accountQueries[1]?.values?.[11], true);

  const workflow = mappingWorkflowDatabase([
    {
      id: 'mapping-101',
      vendor_id: 'cove',
      external_account_id: '101',
      external_account_name: 'Absolutely Knits',
      customer_id: 'customer-1',
      customer_name: 'Absolutely Knits Inc',
      agreement_id: 'agreement-1',
      agreement_name: 'Monthly Services',
      mapping_status: 'approved',
      confidence: 'manual',
      match_score: 100,
      mapping_source: 'manual',
      active: true,
      reviewed_by: 'reviewer@example.com',
      reviewed_at: '2026-06-15T00:00:00.000Z',
      last_seen_at: '2026-06-15T00:00:00.000Z',
      match_evidence: [],
    },
  ]);

  const automapResult = await runAccountAutomap(workflow.database, 'cove');
  assert.equal(automapResult.suggestedMappings, 1);
  assert.equal(automapResult.reviewMappings, 1);
  assert.equal(automapResult.skippedExisting, 1);
  assert.equal(workflow.queries.some((query) => query.sql.includes('insert into vendor_account_mappings')), false);

  const approveSuggestedResult = await approveSuggestedAccountMappings(workflow.database, 'cove', {
    actor: 'bulk-reviewer@example.com',
  });
  const accountInsertQueries = workflow.queries.filter((query) => query.sql.includes('insert into vendor_account_mappings'));
  assert.equal(approveSuggestedResult.approvedAccountMappings, 1);
  assert.equal(approveSuggestedResult.skippedExisting, 1);
  assert.equal(accountInsertQueries.length, 1);
  assert.equal(accountInsertQueries[0]?.values?.[1], '303');
  assert.equal(accountInsertQueries[0]?.values?.[9], 'bulk-reviewer@example.com');

  await updateProductMapping(database, 'cove', 'cove-server', {
    status: 'approved',
    reviewedBy: 'reviewer@example.com',
    targetProducts: [
      {
        connectwiseProductCode: 'CW-SERVER',
        connectwiseProductName: 'CW Server',
      },
      {
        connectwiseProductCode: 'CW-SECONDARY',
        connectwiseProductName: 'CW Secondary',
      },
    ],
  });

  const crossProductDeactivate = queries.find(
    (query) => query.sql.includes('vendor_product_key <> $2') && query.sql.includes('connectwise_product_code = any'),
  );
  assert.deepEqual(crossProductDeactivate?.values?.[2], ['CW-SERVER', 'CW-SECONDARY']);

  const insertQueries = queries.filter((query) => query.sql.includes('insert into vendor_product_mappings'));
  assert.equal(insertQueries.length, 2);
  assert.equal(insertQueries[0]?.values?.[6], 'approved');
  assert.equal(insertQueries[0]?.values?.[9], true);
  assert.equal(insertQueries[1]?.values?.[6], 'approved');
  assert.equal(insertQueries[1]?.values?.[9], true);

  const productCandidateDatabase: Queryable = {
    async query<T = unknown>() {
      return {
        rows: [
          {
            product_code: 'COVE-SVR',
            product_name: 'Cove Backup Protection - Svr',
            addition_count: 118,
            unit_price: null,
          },
          {
            product_code: 'COVE-SVR-ADD-1TB',
            product_name: 'Cove Backup Protection - Svr - Add 1TB',
            addition_count: 3,
            unit_price: null,
          },
          {
            product_code: 'COVE-PC',
            product_name: 'Cove Offsite Backup - PC',
            addition_count: 30,
            unit_price: null,
          },
        ] as T[],
      };
    },
  };
  const productCandidates = await generateProductMappingCandidates(productCandidateDatabase, 'cove');
  const addOneTb = productCandidates.find(
    (candidate) => candidate.target.connectwiseProductCode === 'COVE-SVR-ADD-1TB',
  );
  assert.equal(addOneTb?.vendorProductKey, 'cove-server-storage-addon');
  assert.equal(
    new Set(productCandidates.map((candidate) => candidate.target.connectwiseProductCode)).size,
    productCandidates.length,
  );

  const catalogSearchQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const catalogSearchDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      catalogSearchQueries.push({ sql, values });
      return {
        rows: [
          {
            connectwise_product_id: 'catalog-1',
            connectwise_product_code: 'RENAMED-COVE-SERVER',
            display_name: 'Renamed Cove Server Backup',
          },
        ] as T[],
      };
    },
  };
  const catalogTargets = await searchConnectWiseProductCatalog(catalogSearchDatabase, {
    query: 'renamed',
    limit: 10,
  });
  assert.equal(catalogTargets[0]?.connectwiseProductCode, 'RENAMED-COVE-SERVER');
  assert.equal(catalogTargets[0]?.source, 'local');
  assert.match(catalogSearchQueries[0]?.sql ?? '', /from products/);

  console.log('mapping service tests passed');
}

function mappingWorkflowDatabase(existingMappings: unknown[]) {
  const workflowQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const workflowDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      workflowQueries.push({ sql, values });

      if (sql.includes('from vendor_account_mappings') && sql.includes('inner join customers')) {
        return { rows: existingMappings as T[] };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('group by external_account_id')) {
        return {
          rows: sources.map((source) => ({
            external_account_id: source.externalAccountId,
            external_account_name: source.externalAccountName,
            row_count: source.rowCount,
            last_seen_at: '2026-06-15T00:00:00.000Z',
          })) as T[],
        };
      }

      if (sql.includes('from customers')) {
        return {
          rows: customers.flatMap((mappedCustomer) =>
            mappedCustomer.agreements.map((mappedAgreement) => ({
              customer_id: mappedCustomer.customerId,
              connectwise_company_id: mappedCustomer.connectWiseCompanyId,
              customer_name: mappedCustomer.customerName,
              aliases: mappedCustomer.aliases,
              agreement_id: mappedAgreement.agreementId,
              agreement_name: mappedAgreement.agreementName,
              agreement_status: mappedAgreement.status,
              addition_count: mappedAgreement.additionCount,
              product_codes: mappedAgreement.productCodes,
            })),
          ) as T[],
        };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return { rows: [] as T[] };
      }

      return { rows: [] as T[] };
    },
  };

  return {
    database: workflowDatabase,
    queries: workflowQueries,
  };
}

function customer(
  customerId: string,
  customerName: string,
  agreements: ConnectWiseCustomerCandidate['agreements'],
  aliases: string[] = [],
): ConnectWiseCustomerCandidate {
  return {
    customerId,
    connectWiseCompanyId: customerId,
    customerName,
    aliases,
    agreements,
  };
}

function agreement(
  agreementId: string,
  agreementName: string,
  additionCount: number,
  productCodes: string[],
): ConnectWiseCustomerCandidate['agreements'][number] {
  return {
    agreementId,
    agreementName,
    status: 'Active',
    additionCount,
    productCodes,
  };
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
