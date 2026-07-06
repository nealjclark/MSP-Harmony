import assert from 'node:assert/strict';
import {
  approveSuggestedAccountMappings,
  buildAccountMappingCandidates,
  deleteProductLinkRule,
  deactivateProductLinkRule,
  generateProductMappingCandidates,
  listProductLinkRules,
  listProductMappingCustomers,
  listMappingState,
  normalizeEntityName,
  runAccountAutomap,
  searchConnectWiseProductCatalog,
  scoreEntityName,
  setProductLinkRuleActive,
  testProductLinkRule,
  updateAccountMapping,
  updateProductMapping,
  upsertProductLinkRule,
  upsertProductBundle,
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

const annualProductAgreement = buildAccountMappingCandidates(
  'cove',
  [
    {
      externalAccountId: '606',
      externalAccountName: 'Annual Product LLC',
      rowCount: 1,
      productCodes: ['CW-ANNUAL-BACKUP'],
    },
  ],
  [
    customer('customer-7', 'Annual Product LLC', [
      agreement('agreement-8', 'Monthly Services Agreement', 12, []),
      agreement('agreement-9', 'Annual Backup Agreement', 2, ['CW-ANNUAL-BACKUP']),
    ]),
  ],
)[0];
assert.equal(annualProductAgreement?.status, 'approved');
assert.equal(annualProductAgreement?.agreementId, 'agreement-9');
assert.match(annualProductAgreement?.reason ?? '', /mapped source product/);

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
  const mappingSourceSql = workflow.queries.find((query) => query.sql.includes('source_account_names'))?.sql ?? '';
  const accountSourceSql = workflow.queries.find((query) => query.sql.includes('source_rows'))?.sql ?? '';
  assert.equal(mappingSourceSql.includes("coalesce(metadata->>'source', '') <> 'invoice-table'"), true);
  assert.equal(mappingSourceSql.includes("dimensions->>'externalCustomerAccountNumber'"), true);
  assert.equal(mappingSourceSql.includes("dimensions->>'tenantName'"), true);
  assert.equal(mappingSourceSql.includes("dimensions->>'tenantDefaultDomainName'"), true);
  assert.equal(mappingSourceSql.includes('app_river_account_aliases'), true);
  assert.equal(accountSourceSql.includes("coalesce(metadata->>'source', '') <> 'invoice-table'"), true);
  assert.equal(accountSourceSql.includes("dimensions->>'appRiverCustomerName'"), true);
  assert.equal(accountSourceSql.includes("dimensions->>'externalCustomerAccountNumber'"), true);
  assert.equal(accountSourceSql.includes("dimensions->>'tenantName'"), true);
  assert.equal(accountSourceSql.includes("dimensions->>'tenantDefaultDomainName'"), true);
  assert.equal(accountSourceSql.includes("array['m365-users', 'license-snapshots']"), true);
  assert.equal(accountSourceSql.includes('microsoft365_subscription_account_names'), true);
  assert.equal(accountSourceSql.includes('app_river_account_aliases'), true);
  assert.equal(accountSourceSql.includes('having count(distinct external_account_id) = 1'), true);

  const approveSuggestedResult = await approveSuggestedAccountMappings(workflow.database, 'cove', {
    actor: 'bulk-reviewer@example.com',
  });
  const accountInsertQueries = workflow.queries.filter((query) => query.sql.includes('insert into vendor_account_mappings'));
  assert.equal(approveSuggestedResult.approvedAccountMappings, 1);
  assert.equal(approveSuggestedResult.skippedExisting, 1);
  assert.equal(accountInsertQueries.length, 1);
  assert.equal(accountInsertQueries[0]?.values?.[1], '303');
  assert.equal(accountInsertQueries[0]?.values?.[9], 'bulk-reviewer@example.com');

  const appRiverAccountQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const appRiverAccountDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      appRiverAccountQueries.push({ sql, values });
      if (sql.includes('alias_inputs')) {
        return {
          rows: [
            {
              external_account_id: 'app-river-api-customer-119793',
              external_account_name: 'Absolute Electric, Inc.',
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  await updateAccountMapping(appRiverAccountDatabase, 'opentext-appriver', '119793', {
    status: 'approved',
    customerId: 'customer-absolute-electric',
    agreementId: 'agreement-absolute-electric',
    externalAccountName: 'Absolute Electric, Inc.',
    reviewedBy: 'reviewer@example.com',
  });
  const appRiverAccountInsert = appRiverAccountQueries.find((query) =>
    query.sql.includes('insert into vendor_account_mappings'),
  );
  const appRiverAliasDeactivate = appRiverAccountQueries.find((query) =>
    query.sql.includes('set active = false') && query.sql.includes('external_account_id = $2'),
  );
  assert.equal(appRiverAccountInsert?.values?.[1], 'app-river-api-customer-119793');
  assert.equal(appRiverAccountInsert?.values?.[2], 'Absolute Electric, Inc.');
  assert.equal(appRiverAliasDeactivate?.values?.[1], '119793');

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
  assert.equal(crossProductDeactivate, undefined);

  const insertQueries = queries.filter((query) => query.sql.includes('insert into vendor_product_mappings'));
  assert.equal(insertQueries.length, 2);
  assert.equal(insertQueries[0]?.values?.[6], 'approved');
  assert.equal(insertQueries[0]?.values?.[9], true);
  assert.equal(insertQueries[1]?.values?.[6], 'approved');
  assert.equal(insertQueries[1]?.values?.[9], true);

  const encodedAppRiverProductKey =
    'Microsoft Teams Audio Conferencing with dial-out to USA%2FCAN (Add-on)|Monthly|Monthly';
  const decodedAppRiverProductKey =
    'Microsoft Teams Audio Conferencing with dial-out to USA/CAN (Add-on)|Monthly|Monthly';
  const encodedProductQueryStart = queries.length;
  await updateProductMapping(database, 'opentext-appriver', encodedAppRiverProductKey, {
    status: 'approved',
    reviewedBy: 'reviewer@example.com',
    targetProducts: [
      {
        connectwiseProductCode: 'CW-TEAMS-AUDIO',
        connectwiseProductName: 'Teams Audio Conferencing',
      },
    ],
  });
  const encodedProductQueries = queries.slice(encodedProductQueryStart);
  const encodedDeactivateAliases = encodedProductQueries[0]?.values?.[1] as string[] | undefined;
  assert.equal(encodedProductQueries[0]?.sql.includes('vendor_product_key = any'), true);
  assert.equal(encodedDeactivateAliases?.includes(encodedAppRiverProductKey), true);
  assert.equal(encodedDeactivateAliases?.includes(decodedAppRiverProductKey), true);
  assert.equal(encodedDeactivateAliases?.includes(decodedAppRiverProductKey.replace(/\//g, '%2f')), true);
  assert.equal(encodedDeactivateAliases?.includes(encodeURIComponent(decodedAppRiverProductKey)), true);
  const encodedProductInsert = encodedProductQueries.find((query) =>
    query.sql.includes('insert into vendor_product_mappings'),
  );
  assert.equal(encodedProductInsert?.values?.[1], decodedAppRiverProductKey);

  const bundleQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const bundleDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      bundleQueries.push({ sql, values });
      if (sql.includes('from products') && sql.includes('agreement_additions.product_code')) {
        return {
          rows: [
            {
              connectwise_product_code: values?.[0],
              connectwise_product_name: 'Zix Advanced Email Suite',
              unit_price: '7.5',
            },
          ] as T[],
        };
      }

      if (sql.includes('insert into vendor_product_bundles')) {
        return {
          rows: [
            {
              id: 'bundle-1',
              vendor_id: values?.[0],
              bundle_key: values?.[1],
              bundle_name: values?.[2],
              components: JSON.parse(String(values?.[3])),
              connectwise_product_code: values?.[4],
              connectwise_product_name: values?.[5],
              unit_price: values?.[6],
              quantity_strategy: values?.[7],
              mapping_status: 'approved',
              active: values?.[8],
              reviewed_by: values?.[9],
              reviewed_at: '2026-06-24T12:00:00.000Z',
              created_at: '2026-06-24T12:00:00.000Z',
              updated_at: '2026-06-24T12:00:00.000Z',
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  const bundle = await upsertProductBundle(bundleDatabase, 'opentext-appriver', {
    bundleName: 'Zix Advanced Email Suite',
    reviewedBy: 'reviewer@example.com',
    components: [
      {
        vendorProductKey: 'Email Archiving|Monthly|Monthly',
        vendorProductName: 'Email Archiving',
      },
      {
        vendorProductKey: 'Email Threat Protection|Monthly|Monthly',
        vendorProductName: 'Email Threat Protection',
      },
    ],
    targetProduct: {
      connectwiseProductCode: 'CW-ZIX-ADVANCED',
      connectwiseProductName: 'Zix Advanced Email Suite',
    },
  });

  assert.equal(bundle.bundleKey, 'zix-advanced-email-suite');
  assert.equal(bundle.components.length, 2);
  assert.equal(bundle.target.connectwiseProductCode, 'CW-ZIX-ADVANCED');
  const bundleInsertQuery = bundleQueries.find((query) => query.sql.includes('insert into vendor_product_bundles'));
  assert.equal(bundleInsertQuery?.values?.[8], true);
  assert.equal(bundleInsertQuery?.values?.[9], 'reviewer@example.com');

  const linkRuleQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const linkRuleRows: unknown[] = [];
  const linkRuleDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      linkRuleQueries.push({ sql, values });

      if (sql.includes('update vendor_product_link_rules') && sql.includes('returning')) {
        const row = {
          id: values?.[1],
          vendor_id: values?.[0],
          source_vendor_product_key: values?.[2],
          rule_name: values?.[3],
          sources: values?.[4],
          mapping_status: 'approved',
          active: values?.[5],
          reviewed_by: values?.[6],
          reviewed_at: '2026-06-24T12:00:00.000Z',
          created_at: '2026-06-24T12:00:00.000Z',
          updated_at: '2026-06-24T12:00:00.000Z',
        };
        linkRuleRows.splice(0, linkRuleRows.length, row);
        return { rows: [row] as T[] };
      }

      if (sql.includes('insert into vendor_product_link_rules')) {
        const row = {
          id: 'link-rule-1',
          vendor_id: values?.[0],
          source_vendor_product_key: values?.[1],
          rule_name: values?.[2],
          sources: values?.[3],
          mapping_status: 'approved',
          active: values?.[4],
          reviewed_by: values?.[5],
          reviewed_at: '2026-06-24T12:00:00.000Z',
          created_at: '2026-06-24T12:00:00.000Z',
          updated_at: '2026-06-24T12:00:00.000Z',
        };
        linkRuleRows.splice(0, linkRuleRows.length, row);
        return { rows: [row] as T[] };
      }

      if (sql.includes('update vendor_product_link_rules')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('delete from vendor_product_link_rules')) {
        const deletedId = values?.[1];
        const deleteIndex = linkRuleRows.findIndex((row) =>
          typeof row === 'object' && row !== null && 'id' in row && row.id === deletedId,
        );
        if (deleteIndex >= 0) {
          linkRuleRows.splice(deleteIndex, 1);
        }
        return { rows: deletedId ? [{ id: deletedId }] as T[] : [] as T[] };
      }

      if (sql.includes('from vendor_product_link_rules')) {
        return { rows: linkRuleRows as T[] };
      }

      if (sql.includes('from customers') && sql.includes('left join agreements')) {
        return {
          rows: [
            {
              customer_name: 'Mapped Legal, LLP',
              agreement_name: values?.[1] ? 'Mapped Legal Monthly Agreement' : null,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('filtered_rows')) {
        return {
          rows: [
            {
              row_id: 'exchange-standard-row',
              customer_id: 'customer-1',
              agreement_id: 'agreement-1',
              external_account_id: 'mapped-m365-tenant',
              product_key: 'O365_BUSINESS_PREMIUM',
              product_code: 'O365-BUSINESS-PREMIUM',
              product_name: 'O365_BUSINESS_PREMIUM',
              row_label: 'O365_BUSINESS_PREMIUM',
              quantity: '1',
              observed_at: '2026-06-24T12:15:00.000Z',
              details: {
                userPrincipalName: 'licensed.user@example.test',
                userId: 'm365-user-1',
                Product: 'O365_BUSINESS_PREMIUM',
              },
            },
            {
              row_id: 'exchange-enterprise-row',
              customer_id: 'customer-1',
              agreement_id: 'agreement-1',
              external_account_id: 'mapped-m365-tenant',
              product_key: 'EXCHANGEENTERPRISE',
              product_code: 'EXCHANGEENTERPRISE',
              product_name: 'EXCHANGEENTERPRISE',
              row_label: 'EXCHANGEENTERPRISE',
              quantity: '1',
              observed_at: '2026-06-24T12:15:00.000Z',
              details: {
                userPrincipalName: 'licensed.user@example.test',
                userId: 'm365-user-1',
                Product: 'EXCHANGEENTERPRISE',
              },
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('mapped_snapshots.effective_customer_id')) {
        return {
          rows: [
            {
              row_id: `${values?.[1]}-row`,
              customer_id: values?.[2],
              agreement_id: values?.[3] ?? 'agreement-1',
              external_account_id: 'mapped-m365-tenant',
              product_key: values?.[1],
              product_code: 'M365-SYNC',
              product_name: String(values?.[1]),
              row_label: String(values?.[1]),
              quantity: values?.[1] === 'exchange-online-plan-1' ? '3' : '2',
              observed_at: '2026-06-24T12:15:00.000Z',
              details: {
                'External account': 'mapped-m365-tenant',
                Quantity: values?.[1] === 'exchange-online-plan-1' ? 3 : 2,
              },
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  const linkedRule = await upsertProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    sourceVendorProductKey: 'Email Threat Protection|Monthly|Monthly',
    ruleName: 'Email Threat Protection follows Exchange licenses',
    reviewedBy: 'reviewer@example.com',
    sources: [
      {
        sourceType: 'vendor-product',
        vendorId: 'microsoft-365',
        vendorProductKey: 'exchange-online-plan-1',
        vendorProductName: 'Exchange Online Plan 1',
      },
      {
        sourceType: 'vendor-product',
        vendorId: 'microsoft-365',
        vendorProductKey: 'microsoft-365-business-standard',
        vendorProductName: 'Microsoft 365 Business Standard',
      },
    ],
  });
  assert.equal(linkedRule.sourceVendorProductKey, 'Email Threat Protection|Monthly|Monthly');
  assert.equal(linkedRule.sources.length, 2);
  assert.equal(
    linkRuleQueries.some((query) => query.sql.includes('insert into vendor_product_link_rules')),
    true,
  );

  const listedLinkRules = await listProductLinkRules(linkRuleDatabase, 'opentext-appriver');
  assert.equal(listedLinkRules[0]?.id, 'link-rule-1');
  assert.equal(listedLinkRules[0]?.sources[0]?.sourceType, 'vendor-product');

  const linkRuleTest = await testProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    ruleId: linkedRule.id,
    customerId: 'customer-1',
  });
  assert.equal(linkRuleTest.total, 5);
  assert.equal(linkRuleTest.rows.length, 2);
  assert.equal(linkRuleTest.sourceTotals.length, 2);
  assert.equal(linkRuleTest.customerName, 'Mapped Legal, LLP');

  const dedupedFilteredLinkedRule = await upsertProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    sourceVendorProductKey: 'Email Threat Protection|Monthly|Monthly',
    ruleName: 'Email Threat Protection follows deduped Microsoft users',
    reviewedBy: 'reviewer@example.com',
    sources: [
      {
        sourceType: 'filtered-dataset',
        vendorId: 'microsoft-365',
        dataset: 'users',
        aggregation: { type: 'row-count' },
        filter: {
          nodeType: 'condition',
          field: 'ProductName',
          operator: 'contains',
          value: 'Exchange',
        },
      },
    ],
  });
  const dedupedLinkRuleTest = await testProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    ruleId: dedupedFilteredLinkedRule.id,
    customerId: 'customer-1',
  });
  assert.equal(dedupedLinkRuleTest.rows.length, 2);
  assert.equal(dedupedLinkRuleTest.total, 1);
  assert.equal(dedupedLinkRuleTest.sourceTotals[0]?.quantity, 1);
  assert.equal(dedupedLinkRuleTest.sourceTotals[0]?.rowCount, 2);

  const filteredLinkedRule = await upsertProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    sourceVendorProductKey: 'Email Threat Protection|Monthly|Monthly',
    ruleName: 'Email Threat Protection follows Microsoft Business licenses',
    reviewedBy: 'reviewer@example.com',
    sources: [
      {
        sourceType: 'filtered-dataset',
        vendorId: 'microsoft-365',
        dataset: 'licenses',
        label: 'Microsoft Business licenses',
        aggregation: { type: 'row-count' },
        filter: {
          nodeType: 'group',
          operator: 'or',
          children: [
            {
              nodeType: 'condition',
              field: 'LicenseName',
              operator: 'contains',
              value: 'Microsoft 365 Business',
            },
            {
              nodeType: 'condition',
              field: 'LicenseName',
              operator: 'contains',
              value: 'Office 365',
            },
          ],
        },
      },
    ],
  });
  assert.equal(filteredLinkedRule.sources[0]?.sourceType, 'filtered-dataset');
  if (filteredLinkedRule.sources[0]?.sourceType === 'filtered-dataset') {
    assert.equal(filteredLinkedRule.sources[0].aggregation.type, 'row-count');
    assert.equal(filteredLinkedRule.sources[0].filter.nodeType, 'group');
  }

  const missingLinkRuleTableRules = await listProductLinkRules(
    {
      async query<T = unknown>() {
        const error = new Error('relation "vendor_product_link_rules" does not exist') as Error & { code: string };
        error.code = '42P01';
        throw error;
      },
    },
    'opentext-appriver',
  );
  assert.equal(missingLinkRuleTableRules.length, 0);

  const editedLinkRule = await upsertProductLinkRule(linkRuleDatabase, 'opentext-appriver', {
    id: linkedRule.id,
    sourceVendorProductKey: linkedRule.sourceVendorProductKey,
    ruleName: 'Email Threat Protection follows sync product',
    reviewedBy: 'reviewer@example.com',
    sources: [
      {
        sourceType: 'connectwise-addition',
        productCode: 'HUNTRESS-SYNC',
        productName: 'Huntress Sync',
      },
    ],
  });
  assert.equal(editedLinkRule.sources[0]?.sourceType, 'connectwise-addition');
  assert.equal(editedLinkRule.ruleName, 'Email Threat Protection follows sync product');

  const deactivated = await deactivateProductLinkRule(linkRuleDatabase, 'opentext-appriver', linkedRule.id, {
    reviewedBy: 'reviewer@example.com',
  });
  assert.equal(deactivated.active, false);
  assert.equal(
    linkRuleQueries.some(
      (query) => query.sql.includes('id = $2::uuid') && query.values?.[1] === linkedRule.id,
    ),
    true,
  );

  const reenabled = await setProductLinkRuleActive(linkRuleDatabase, 'opentext-appriver', linkedRule.id, true, {
    reviewedBy: 'reviewer@example.com',
  });
  assert.equal(reenabled.active, true);
  assert.equal(
    linkRuleQueries.some(
      (query) => query.sql.includes('set active = $3') && query.values?.[2] === true,
    ),
    true,
  );

  const deletedLinkRule = await deleteProductLinkRule(linkRuleDatabase, 'opentext-appriver', linkedRule.id);
  assert.equal(deletedLinkRule.deleted, true);

  const productCandidateDatabase: Queryable = {
    async query<T = unknown>(sql: string) {
      if (sql.includes('from vendor_usage_snapshots')) {
        return {
          rows: [
            {
              vendor_product_key: 'cove-server-storage-addon',
              vendor_product_name: 'Cove Backup Protection - Svr - Add 1TB',
              row_count: 2,
              customer_count: 2,
            },
          ] as T[],
        };
      }

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

  const appRiverProductCandidateDatabase: Queryable = {
    async query<T = unknown>(sql: string) {
      if (sql.includes('from vendor_usage_snapshots')) {
        return {
          rows: [
          {
            vendor_product_key: 'Microsoft 365 Business Premium|Annual|Monthly',
            vendor_product_name: 'Microsoft 365 Business Premium',
            row_count: 3,
            customer_count: 3,
          },
        ] as T[],
      };
      }

      if (sql.includes('from agreement_additions')) {
        return {
          rows: [
            {
              product_code: 'CW-M365-BUSINESS-PREMIUM',
              product_name: 'Microsoft 365 Business Premium',
              addition_count: 12,
              unit_price: '22',
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
  const appRiverProductCandidates = await generateProductMappingCandidates(
    appRiverProductCandidateDatabase,
    'opentext-appriver',
  );
  assert.equal(appRiverProductCandidates[0]?.vendorProductKey, 'Microsoft 365 Business Premium|Annual|Monthly');
  assert.equal(appRiverProductCandidates[0]?.target.connectwiseProductCode, 'CW-M365-BUSINESS-PREMIUM');
  assert.equal(appRiverProductCandidates[0]?.additionCount, 12);
  assert.equal(appRiverProductCandidates[0]?.customerCount, 3);

  const appRiverCopilotMappingState = await listMappingState(appRiverCopilotMappingStateDatabase(), 'opentext-appriver');
  assert.equal(
    appRiverCopilotMappingState.productMappings.some(
      (mapping) =>
        mapping.vendorProductKey === 'Microsoft 365 Copilot (Annual term required) (Add-on)|Annual|Annual' &&
        mapping.target.connectwiseProductCode === 'MS Copilot for Microsoft 365 - AM -Add-On',
    ),
    true,
  );
  assert.equal(
    appRiverCopilotMappingState.productCandidates.some(
      (candidate) =>
        candidate.vendorProductKey === 'Microsoft 365 Copilot (Annual term required) (Add-on)|Annual|Monthly' &&
        candidate.target.connectwiseProductCode === 'MS Copilot for Microsoft 365 - AM -Add-On',
    ),
    true,
  );

  const appRiverProductCustomers = await listProductMappingCustomers(
    appRiverProductCustomerReviewDatabase(),
    'opentext-appriver',
    'Microsoft 365 Copilot (Annual term required) (Add-on)|Annual|Monthly',
  );
  assert.equal(appRiverProductCustomers.customerCount, 2);
  assert.equal(appRiverProductCustomers.customers[0]?.externalAccountName, 'Mapped Legal');
  assert.equal(appRiverProductCustomers.customers[0]?.agreementName, 'Mapped Legal Monthly Service Agreement');
  assert.equal(appRiverProductCustomers.customers[0]?.additions.length, 2);
  assert.equal(appRiverProductCustomers.customers[0]?.additions[0]?.productCode, 'MS Copilot for Microsoft 365 - AM -Add-On');
  assert.equal(appRiverProductCustomers.customers[1]?.externalAccountName, 'Unmapped Legal');
  assert.equal(appRiverProductCustomers.customers[1]?.additions.length, 0);

  const invoiceProductCustomerQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const invoiceProductCustomers = await listProductMappingCustomers(
    invoiceProductCustomerReviewDatabase(invoiceProductCustomerQueries),
    'opentext-appriver',
    'Microsoft 365 E5 (no Teams)|Monthly|Monthly',
  );
  assert.equal(invoiceProductCustomerQueries[0]?.sql.includes('from invoice_line_items'), true);
  assert.equal(invoiceProductCustomerQueries[0]?.sql.includes("raw_summary->>'sourceType'"), true);
  assert.equal(invoiceProductCustomerQueries[0]?.values?.[1], 'Microsoft 365 E5 (no Teams)|Monthly|Monthly');
  assert.equal(invoiceProductCustomers.customerCount, 1);
  assert.equal(invoiceProductCustomers.customers[0]?.externalAccountName, 'Invoice Legal');
  assert.equal(invoiceProductCustomers.vendorProductName, 'Microsoft 365 E5 (no Teams)');

  const annualCallingPlanQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const annualCallingPlanCustomers = await listProductMappingCustomers(
    invoiceProductCustomerReviewDatabase(
      annualCallingPlanQueries,
      'Microsoft Teams Domestic Calling Plan (customers in US/UK/CA) (Add-on)',
      'Payroll Dynamics',
    ),
    'opentext-appriver',
    'O365CSP-354|Annual|Annual',
  );
  assert.equal(annualCallingPlanQueries[0]?.sql.includes('from invoice_line_items'), true);
  assert.equal(annualCallingPlanQueries[0]?.values?.[1], 'O365CSP-354|Annual|Annual');
  assert.equal(annualCallingPlanCustomers.customerCount, 1);
  assert.equal(annualCallingPlanCustomers.customers[0]?.externalAccountName, 'Payroll Dynamics');
  assert.equal(
    annualCallingPlanCustomers.vendorProductName,
    'Microsoft Teams Domestic Calling Plan (customers in US/UK/CA) (Add-on)',
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

  const microsoft365MappingQueries: Array<{ sql: string; values?: unknown[] }> = [];
  const microsoft365MappingDatabase: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      microsoft365MappingQueries.push({ sql, values });
      if (sql.includes('update vendor_account_mappings') && sql.includes('resolved_names')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_account_mappings') && sql.includes('inner join customers')) {
        return {
          rows: [
            {
              id: 'mapping-1',
              vendor_id: 'microsoft-365',
              external_account_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              external_account_name: 'Contoso Ltd',
              customer_id: 'customer-1',
              customer_name: 'Contoso LLC',
              agreement_id: 'agreement-1',
              agreement_name: 'Managed Services',
              mapping_status: 'approved',
              confidence: 'manual',
              match_score: 100,
              mapping_source: 'manual',
              active: true,
              reviewed_by: 'reviewer',
              reviewed_at: '2026-07-06T00:00:00.000Z',
              last_seen_at: '2026-07-06T00:00:00.000Z',
              match_evidence: [],
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  await listMappingState(microsoft365MappingDatabase, 'microsoft-365');
  const microsoft365AccountMappingSql =
    microsoft365MappingQueries.find(
      (query) => query.sql.includes('from vendor_account_mappings') && query.sql.includes('inner join customers'),
    )?.sql ?? '';
  assert.equal(microsoft365AccountMappingSql.includes("array['m365-users', 'license-snapshots']"), true);
  assert.equal(microsoft365AccountMappingSql.includes('microsoft365_subscription_account_names'), true);
  assert.equal(microsoft365AccountMappingSql.includes('latest_m365_license_sync_run'), true);
  assert.equal(
    microsoft365MappingQueries.some(
      (query) => query.sql.includes('update vendor_account_mappings') && query.sql.includes('resolved_names'),
    ),
    true,
  );

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
            product_codes: source.productCodes ?? [],
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

function appRiverCopilotMappingStateDatabase(): Queryable {
  return {
    async query<T = unknown>(sql: string) {
      if (sql.includes('from vendor_account_mappings')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_product_mappings') && sql.includes('left join agreement_additions')) {
        return {
          rows: [
            {
              id: 'copilot-annual-annual-mapping',
              vendor_id: 'opentext-appriver',
              vendor_product_key: 'Microsoft 365 Copilot (Annual term required) (Add-on)|Annual|Annual',
              target_index: 0,
              connectwise_product_code: 'MS Copilot for Microsoft 365 - AM -Add-On',
              connectwise_product_name: 'MS Copilot for Microsoft 365 - AM -Add-On',
              unit_price: null,
              addition_count: 6,
              mapping_status: 'approved',
              confidence: 'manual',
              match_score: 100,
              mapping_source: 'manual',
              active: true,
              reviewed_by: 'reviewer@example.com',
              reviewed_at: '2026-06-24T16:01:16.992Z',
              match_evidence: [],
              customer_count: 1,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('group by external_account_id')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from vendor_usage_snapshots') && sql.includes('group by vendor_product_key')) {
        return {
          rows: [
            {
              vendor_product_key: 'Microsoft 365 Copilot (Annual term required) (Add-on)|Annual|Monthly',
              vendor_product_name: 'Microsoft 365 Copilot (Annual term required) (Add-on)',
              row_count: 5,
              customer_count: 5,
            },
          ] as T[],
        };
      }

      if (sql.includes('select count(*) as count') && sql.includes('from vendor_usage_snapshots')) {
        return { rows: [{ count: 0 }] as T[] };
      }

      if (sql.includes('from agreement_additions') && sql.includes('group by product_code, product_name')) {
        return {
          rows: [
            {
              product_code: 'MS Copilot for Microsoft 365 - AM -Add-On',
              product_name: 'MS Copilot for Microsoft 365 - AM -Add-On',
              addition_count: 6,
              unit_price: null,
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };
}

function appRiverProductCustomerReviewDatabase(): Queryable {
  return {
    async query<T = unknown>() {
      return {
        rows: [
          {
            external_account_id: 'mapped-appriver-customer',
            external_account_name: 'Mapped Legal',
            vendor_quantity: '1',
            observed_at: '2026-06-24T14:06:53.439Z',
            vendor_product_name: 'Microsoft 365 Copilot (Annual term required) (Add-on)',
            customer_id: 'mapped-customer',
            customer_name: 'Mapped Legal, LLP',
            agreement_id: 'mapped-agreement',
            agreement_name: 'Mapped Legal Monthly Service Agreement',
            agreement_status: 'Active',
            addition_id: 'copilot-addition',
            connectwise_addition_id: '5001',
            product_code: 'MS Copilot for Microsoft 365 - AM -Add-On',
            product_name: 'MS Copilot for Microsoft 365 - AM -Add-On',
            quantity: '1',
            unit_price: '30',
            addition_status: 'Active',
            addition_updated_at: '2026-06-24T16:03:39.000Z',
          },
          {
            external_account_id: 'mapped-appriver-customer',
            external_account_name: 'Mapped Legal',
            vendor_quantity: '1',
            observed_at: '2026-06-24T14:06:53.439Z',
            vendor_product_name: 'Microsoft 365 Copilot (Annual term required) (Add-on)',
            customer_id: 'mapped-customer',
            customer_name: 'Mapped Legal, LLP',
            agreement_id: 'mapped-agreement',
            agreement_name: 'Mapped Legal Monthly Service Agreement',
            agreement_status: 'Active',
            addition_id: 'business-standard-addition',
            connectwise_addition_id: '5002',
            product_code: 'Microsoft 365 Business Standard-M',
            product_name: 'Microsoft 365 Business Standard-M',
            quantity: '7',
            unit_price: '12.5',
            addition_status: 'Active',
            addition_updated_at: '2026-06-18T19:40:47.000Z',
          },
          {
            external_account_id: 'unmapped-appriver-customer',
            external_account_name: 'Unmapped Legal',
            vendor_quantity: '2',
            observed_at: '2026-06-24T14:23:43.523Z',
            vendor_product_name: 'Microsoft 365 Copilot (Annual term required) (Add-on)',
            customer_id: null,
            customer_name: null,
            agreement_id: null,
            agreement_name: null,
            agreement_status: null,
            addition_id: null,
            connectwise_addition_id: null,
            product_code: null,
            product_name: null,
            quantity: null,
            unit_price: null,
            addition_status: null,
            addition_updated_at: null,
          },
        ] as T[],
      };
    },
  };
}

function invoiceProductCustomerReviewDatabase(
  queries: Array<{ sql: string; values?: unknown[] }>,
  productName = 'Microsoft 365 E5 (no Teams)',
  externalAccountName = 'Invoice Legal',
): Queryable {
  return {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return {
        rows: [
          {
            external_account_id: 'invoice-account-1',
            external_account_name: externalAccountName,
            vendor_quantity: '1',
            observed_at: '2026-06-30T00:00:00.000Z',
            vendor_product_name: productName,
            customer_id: 'invoice-customer',
            customer_name: `${externalAccountName}, LLP`,
            agreement_id: null,
            agreement_name: null,
            agreement_status: null,
            addition_id: null,
            connectwise_addition_id: null,
            product_code: null,
            product_name: null,
            quantity: null,
            unit_price: null,
            addition_status: null,
            addition_updated_at: null,
          },
        ] as T[],
      };
    },
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
