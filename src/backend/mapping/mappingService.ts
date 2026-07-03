import type { IntegrationId } from '../../shared/integrationSettings';
import { defaultCoveProductMappings, type CoveProductMappingKey } from '../vendor/cove/rules';
import { defaultNcentralProductMappings } from '../vendor/ncentral/rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type MappingStatus = 'candidate' | 'approved' | 'needs-review' | 'rejected';
export type MappingConfidence = 'exact' | 'alias' | 'inferred' | 'imported' | 'manual' | 'unmapped';

export type VendorAccountSource = {
  externalAccountId: string;
  externalAccountName: string;
  rowCount: number;
  lastSeenAt?: string;
};

export type AgreementCandidate = {
  agreementId: string;
  agreementName: string;
  status: string;
  additionCount: number;
  productCodes: string[];
};

export type ConnectWiseCustomerCandidate = {
  customerId: string;
  connectWiseCompanyId: string;
  customerName: string;
  aliases: string[];
  agreements: AgreementCandidate[];
};

export type AccountMappingCandidate = {
  vendorId: IntegrationId;
  externalAccountId: string;
  externalAccountName: string;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  status: MappingStatus;
  confidence: MappingConfidence;
  matchScore: number;
  activeRecommended: boolean;
  reason: string;
  evidence: Array<{ label: string; value: string | number | boolean }>;
};

export type AccountMapping = AccountMappingCandidate & {
  id: string;
  mappingSource: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  lastSeenAt?: string;
};

export type ProductMappingTarget = {
  connectwiseProductCode: string;
  connectwiseProductName: string;
  unitPrice?: number;
};

export type ProductBundleQuantityStrategy = 'max-component-quantity';

export type ProductBundleComponent = {
  vendorProductKey: string;
  vendorProductName: string;
};

export type ProductBundle = {
  id: string;
  vendorId: IntegrationId;
  bundleKey: string;
  bundleName: string;
  components: ProductBundleComponent[];
  target: ProductMappingTarget;
  quantityStrategy: ProductBundleQuantityStrategy;
  status: MappingStatus;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ProductCatalogSearchResult = ProductMappingTarget & {
  connectwiseProductId?: string;
  source: 'local' | 'connectwise';
};

export type ProductMappingCandidate = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
  status: MappingStatus;
  confidence: MappingConfidence;
  target: ProductMappingTarget;
  matchScore: number;
  additionCount: number;
  customerCount?: number;
  reason: string;
  evidence: Array<{ label: string; value: string | number | boolean }>;
};

export type ProductMapping = ProductMappingCandidate & {
  id: string;
  targetIndex: number;
  mappingSource: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type MappingState = {
  vendorId: IntegrationId;
  summary: {
    accountMappings: number;
    approvedAccountMappings: number;
    accountCandidates: number;
    accountCandidatesNeedingReview: number;
    productMappings: number;
    approvedProductMappings: number;
    productCandidates: number;
    productBundles: number;
    unmappedSnapshots: number;
  };
  accountMappings: AccountMapping[];
  accountCandidates: AccountMappingCandidate[];
  productMappings: ProductMapping[];
  productCandidates: ProductMappingCandidate[];
  productBundles: ProductBundle[];
  customerOptions: ConnectWiseCustomerCandidate[];
};

export type AutomapResult = {
  vendorId: IntegrationId;
  generatedCandidates: number;
  suggestedMappings: number;
  reviewMappings: number;
  skippedExisting: number;
};

export type ApproveSuggestedMappingsResult = {
  vendorId: IntegrationId;
  approvedAccountMappings: number;
  skippedExisting: number;
};

export type ApplyMappingsResult = {
  vendorId: IntegrationId;
  accountSnapshotsUpdated: number;
  productSnapshotsUpdated: number;
};

export type ProductMappingCustomerAddition = {
  id: string;
  connectWiseAdditionId?: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  additionStatus: string;
  updatedAt?: string;
};

export type ProductMappingCustomer = {
  externalAccountId: string;
  externalAccountName: string;
  vendorQuantity: number;
  observedAt?: string;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  agreementStatus?: string;
  additions: ProductMappingCustomerAddition[];
};

export type ProductMappingCustomerReview = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
  customerCount: number;
  customers: ProductMappingCustomer[];
};

type AccountMappingRow = {
  id: string;
  vendor_id: IntegrationId;
  external_account_id: string;
  external_account_name: string;
  customer_id: string;
  customer_name: string;
  agreement_id: string | null;
  agreement_name: string | null;
  mapping_status: MappingStatus;
  confidence: MappingConfidence;
  match_score: string | number | null;
  mapping_source: string;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  last_seen_at: Date | string | null;
  match_evidence: unknown;
};

type AccountSourceRow = {
  external_account_id: string;
  external_account_name: string | null;
  row_count: number;
  last_seen_at: Date | string | null;
};

type CustomerAgreementRow = {
  customer_id: string;
  connectwise_company_id: string;
  customer_name: string;
  aliases: unknown;
  agreement_id: string | null;
  agreement_name: string | null;
  agreement_status: string | null;
  addition_count: string | number | null;
  product_codes: unknown;
};

type ProductMappingRow = {
  id: string;
  vendor_id: IntegrationId;
  vendor_product_key: string;
  target_index: number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
  addition_count: string | number | null;
  mapping_status: MappingStatus;
  confidence: MappingConfidence;
  match_score: string | number | null;
  mapping_source: string;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  match_evidence: unknown;
  customer_count?: string | number | null;
};

type ProductBundleRow = {
  id: string;
  vendor_id: IntegrationId;
  bundle_key: string;
  bundle_name: string;
  components: unknown;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
  quantity_strategy: ProductBundleQuantityStrategy | string;
  mapping_status: MappingStatus;
  active: boolean;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ConnectWiseProductRow = {
  product_code: string;
  product_name: string;
  addition_count: string | number;
  unit_price: string | number | null;
};

type VendorProductSourceRow = {
  vendor_product_key: string;
  vendor_product_name: string | null;
  row_count: string | number;
  customer_count: string | number;
};

type ProductMappingCustomerReviewRow = {
  external_account_id: string | null;
  external_account_name: string | null;
  vendor_quantity: string | number | null;
  observed_at: Date | string | null;
  vendor_product_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  agreement_status: string | null;
  addition_id: string | null;
  connectwise_addition_id: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: string | number | null;
  unit_price: string | number | null;
  addition_status: string | null;
  addition_updated_at: Date | string | null;
};

type ProductClass = {
  vendorProductKey: string;
  vendorProductName: string;
  searchTerms: string[];
  requiredTerms?: string[];
  excludedTerms?: string[];
  priority: number;
  defaultTarget: ProductMappingTarget;
};

const aggressiveAutoMapThreshold = 70;
const ambiguityMargin = 10;

const coveProductClasses: ProductClass[] = [
  {
    vendorProductKey: 'cove-server',
    vendorProductName: 'Cove Server Backup',
    searchTerms: ['cove server backup svr protection', 'cove backup protection svr'],
    requiredTerms: ['cove'],
    excludedTerms: ['add', '1tb', 'tb', 'storage', 'overage', 'pc', 'workstation', 'offsite', 'endpoint', 'email'],
    priority: 2,
    defaultTarget: {
      connectwiseProductCode: defaultCoveProductMappings['cove-server'].productCode,
      connectwiseProductName: defaultCoveProductMappings['cove-server'].productName,
      unitPrice: defaultCoveProductMappings['cove-server'].unitPrice?.amount,
    },
  },
  {
    vendorProductKey: 'cove-workstation',
    vendorProductName: 'Cove Workstation Backup',
    searchTerms: ['cove workstation pc offsite backup', 'cove offsite backup pc'],
    requiredTerms: ['cove'],
    excludedTerms: ['server', 'svr', 'add', '1tb', 'tb', 'storage', 'overage', 'endpoint', 'email'],
    priority: 1,
    defaultTarget: {
      connectwiseProductCode: defaultCoveProductMappings['cove-workstation'].productCode,
      connectwiseProductName: defaultCoveProductMappings['cove-workstation'].productName,
      unitPrice: defaultCoveProductMappings['cove-workstation'].unitPrice?.amount,
    },
  },
  {
    vendorProductKey: 'cove-server-storage-addon',
    vendorProductName: 'Cove Server Selected Storage Overage',
    searchTerms: [
      'cove server selected storage overage',
      'cove server storage overage add 1tb',
      'cove backup protection svr add 1tb',
      'svr add 1tb',
    ],
    requiredTerms: ['cove'],
    excludedTerms: ['pc', 'workstation', 'offsite', 'endpoint', 'email'],
    priority: 3,
    defaultTarget: {
      connectwiseProductCode: defaultCoveProductMappings['cove-server-storage-addon'].productCode,
      connectwiseProductName: defaultCoveProductMappings['cove-server-storage-addon'].productName,
      unitPrice: defaultCoveProductMappings['cove-server-storage-addon'].unitPrice?.amount,
    },
  },
];

const ncentralProductClasses: ProductClass[] = [
  {
    vendorProductKey: 'ncentral-physical-server',
    vendorProductName: 'N-central Managed Physical Server',
    searchTerms: ['ncentral physical server managed server', 'managed physical server'],
    requiredTerms: ['server'],
    excludedTerms: ['virtual', 'workstation', 'laptop', 'desktop'],
    priority: 3,
    defaultTarget: {
      connectwiseProductCode: defaultNcentralProductMappings['ncentral-physical-server'].productCode,
      connectwiseProductName: defaultNcentralProductMappings['ncentral-physical-server'].productName,
      unitPrice: defaultNcentralProductMappings['ncentral-physical-server'].unitPrice?.amount,
    },
  },
  {
    vendorProductKey: 'ncentral-virtual-server',
    vendorProductName: 'N-central Managed Virtual Server',
    searchTerms: ['ncentral virtual server managed server', 'managed virtual server vm'],
    requiredTerms: ['server'],
    excludedTerms: ['physical', 'workstation', 'laptop', 'desktop'],
    priority: 2,
    defaultTarget: {
      connectwiseProductCode: defaultNcentralProductMappings['ncentral-virtual-server'].productCode,
      connectwiseProductName: defaultNcentralProductMappings['ncentral-virtual-server'].productName,
      unitPrice: defaultNcentralProductMappings['ncentral-virtual-server'].unitPrice?.amount,
    },
  },
  {
    vendorProductKey: 'ncentral-workstation',
    vendorProductName: 'N-central Managed Workstation',
    searchTerms: ['ncentral workstation laptop desktop managed workstation', 'managed workstation'],
    requiredTerms: ['workstation'],
    excludedTerms: ['server', 'virtual', 'physical'],
    priority: 1,
    defaultTarget: {
      connectwiseProductCode: defaultNcentralProductMappings['ncentral-workstation'].productCode,
      connectwiseProductName: defaultNcentralProductMappings['ncentral-workstation'].productName,
      unitPrice: defaultNcentralProductMappings['ncentral-workstation'].unitPrice?.amount,
    },
  },
];

export async function listMappingState(database: Queryable, vendorId: IntegrationId): Promise<MappingState> {
  const [
    accountMappings,
    accountCandidates,
    productMappings,
    productCandidates,
    productBundles,
    unmappedSnapshots,
    customerOptions,
  ] = await Promise.all([
    listAccountMappings(database, vendorId),
    generateAccountMappingCandidates(database, vendorId),
    listProductMappings(database, vendorId),
    generateProductMappingCandidates(database, vendorId),
    listProductBundles(database, vendorId),
    countUnmappedSnapshots(database, vendorId),
    loadConnectWiseCustomers(database),
  ]);

  const mappedAccountIds = new Set(
    accountMappings
      .filter((mapping) => mapping.status === 'approved' && mapping.active)
      .map((mapping) => mapping.externalAccountId),
  );
  const unmappedCandidates = accountCandidates.filter((candidate) => !mappedAccountIds.has(candidate.externalAccountId));
  const mappedProductKeys = new Set(
    productMappings
      .filter((mapping) => mapping.status === 'approved' && mapping.active)
      .map((mapping) => mapping.vendorProductKey),
  );
  const unmappedProductCandidates = productCandidates.filter(
    (candidate) => !mappedProductKeys.has(candidate.vendorProductKey),
  );

  return {
    vendorId,
    summary: {
      accountMappings: accountMappings.length,
      approvedAccountMappings: accountMappings.filter((mapping) => mapping.status === 'approved' && mapping.active).length,
      accountCandidates: unmappedCandidates.length,
      accountCandidatesNeedingReview: unmappedCandidates.filter((candidate) => candidate.status !== 'approved').length,
      productMappings: productMappings.length,
      approvedProductMappings: productMappings.filter((mapping) => mapping.status === 'approved' && mapping.active).length,
      productCandidates: unmappedProductCandidates.length,
      productBundles: productBundles.filter((bundle) => bundle.status === 'approved' && bundle.active).length,
      unmappedSnapshots,
    },
    accountMappings,
    accountCandidates: unmappedCandidates,
    productMappings,
    productCandidates: unmappedProductCandidates,
    productBundles,
    customerOptions,
  };
}

export async function runAccountAutomap(
  database: Queryable,
  vendorId: IntegrationId,
  options: { actor?: string } = {},
): Promise<AutomapResult> {
  const [existingMappings, candidates] = await Promise.all([
    listAccountMappings(database, vendorId),
    generateAccountMappingCandidates(database, vendorId),
  ]);
  const existingByAccount = new Map(existingMappings.map((mapping) => [mapping.externalAccountId, mapping]));
  let suggestedMappings = 0;
  let reviewMappings = 0;
  let skippedExisting = 0;

  for (const candidate of candidates) {
    const existing = existingByAccount.get(candidate.externalAccountId);
    if (existing?.status === 'approved' && existing.active) {
      skippedExisting += 1;
      continue;
    }

    if (candidate.status === 'approved') {
      suggestedMappings += 1;
    } else {
      reviewMappings += 1;
    }
  }

  return {
    vendorId,
    generatedCandidates: candidates.length,
    suggestedMappings,
    reviewMappings,
    skippedExisting,
  };
}

export async function approveSuggestedAccountMappings(
  database: Queryable,
  vendorId: IntegrationId,
  options: { actor?: string } = {},
): Promise<ApproveSuggestedMappingsResult> {
  const [existingMappings, candidates] = await Promise.all([
    listAccountMappings(database, vendorId),
    generateAccountMappingCandidates(database, vendorId),
  ]);
  const existingByAccount = new Map(existingMappings.map((mapping) => [mapping.externalAccountId, mapping]));
  let approvedAccountMappings = 0;
  let skippedExisting = 0;

  for (const candidate of candidates) {
    const existing = existingByAccount.get(candidate.externalAccountId);
    if (existing?.status === 'approved' && existing.active) {
      skippedExisting += 1;
      continue;
    }

    if (candidate.status !== 'approved' || !candidate.customerId) {
      continue;
    }

    await upsertAccountMapping(database, {
      ...candidate,
      status: 'approved',
      activeRecommended: true,
      reason: 'Approved suggested mapping.',
      mappingSource: 'suggested',
      reviewedBy: options.actor ?? 'approve-suggested',
    });
    approvedAccountMappings += 1;
  }

  return {
    vendorId,
    approvedAccountMappings,
    skippedExisting,
  };
}

export async function updateAccountMapping(
  database: Queryable,
  vendorId: IntegrationId,
  externalAccountId: string,
  input: {
    status: MappingStatus;
    customerId?: string;
    agreementId?: string;
    externalAccountName?: string;
    reviewedBy?: string;
  },
) {
  if (input.status === 'rejected') {
    await database.query(
      `update vendor_account_mappings
       set mapping_status = 'rejected',
           active = false,
           reviewed_by = $3,
           reviewed_at = now(),
           updated_at = now()
       where vendor_id = $1
         and external_account_id = $2`,
      [vendorId, externalAccountId, input.reviewedBy ?? 'user'],
    );
    return;
  }

  if (!input.customerId) {
    throw new Error('Approving an account mapping requires customerId.');
  }

  const sourceName = input.externalAccountName ?? (await loadExternalAccountName(database, vendorId, externalAccountId));
  await upsertAccountMapping(database, {
    vendorId,
    externalAccountId,
    externalAccountName: sourceName,
    customerId: input.customerId,
    agreementId: input.agreementId,
    status: input.status,
    confidence: 'manual',
    matchScore: 100,
    activeRecommended: input.status === 'approved',
    reason: 'Manual mapping review.',
    evidence: [{ label: 'Reviewed manually', value: true }],
    mappingSource: 'manual',
    reviewedBy: input.reviewedBy ?? 'user',
  });
}

export async function updateProductMapping(
  database: Queryable,
  vendorId: IntegrationId,
  vendorProductKey: string,
  input: {
    status: MappingStatus;
    targetProducts?: ProductMappingTarget[];
    reviewedBy?: string;
  },
) {
  const canonicalProductKey = canonicalVendorProductKey(vendorProductKey);
  await database.query(
    `update vendor_product_mappings
     set active = false,
         updated_at = now()
     where vendor_id = $1
       and vendor_product_key = any($2::text[])`,
    [vendorId, vendorProductKeyAliases(canonicalProductKey, vendorProductKey)],
  );

  if (input.status === 'rejected') {
    return;
  }

  const targetProducts = input.targetProducts ?? [];
  if (targetProducts.length === 0) {
    throw new Error('Approving a product mapping requires at least one target product.');
  }

  const status: MappingStatus = input.status;
  const active = status === 'approved';

  for (const [index, target] of targetProducts.entries()) {
    await database.query(
      `insert into vendor_product_mappings (
         vendor_id,
         vendor_product_key,
         target_index,
         connectwise_product_code,
         connectwise_product_name,
         unit_price,
         mapping_status,
         confidence,
         match_score,
         mapping_source,
         reviewed_by,
         reviewed_at,
         match_evidence,
         active,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, 'manual', 100, 'manual', $8, now(), $9::jsonb, $10, now())
       on conflict (vendor_id, vendor_product_key, connectwise_product_code)
       do update set
         target_index = excluded.target_index,
         connectwise_product_name = excluded.connectwise_product_name,
         unit_price = excluded.unit_price,
         mapping_status = excluded.mapping_status,
         confidence = excluded.confidence,
         match_score = excluded.match_score,
         mapping_source = excluded.mapping_source,
         reviewed_by = excluded.reviewed_by,
         reviewed_at = excluded.reviewed_at,
         match_evidence = excluded.match_evidence,
         active = excluded.active,
         updated_at = now()`,
      [
        vendorId,
        canonicalProductKey,
        index,
        target.connectwiseProductCode,
        target.connectwiseProductName,
        target.unitPrice ?? null,
        status,
        input.reviewedBy ?? 'user',
        JSON.stringify([
          {
            label: 'Target count',
            value: targetProducts.length,
          },
          {
            label: 'Requires review',
            value: false,
          },
        ]),
        active,
      ],
    );
  }
}

export async function listProductBundles(database: Queryable, vendorId: IntegrationId): Promise<ProductBundle[]> {
  const result = await database.query<ProductBundleRow>(
    `select
       id,
       vendor_id,
       bundle_key,
       bundle_name,
       components,
       connectwise_product_code,
       connectwise_product_name,
       unit_price,
       quantity_strategy,
       mapping_status,
       active,
       reviewed_by,
       reviewed_at,
       created_at,
       updated_at
     from vendor_product_bundles
     where vendor_id = $1
     order by active desc, bundle_name, bundle_key`,
    [vendorId],
  );

  return result.rows.map(mapProductBundleRow);
}

export async function listProductMappingCustomers(
  database: Queryable,
  vendorId: IntegrationId,
  vendorProductKey: string,
): Promise<ProductMappingCustomerReview> {
  const canonicalProductKey = canonicalVendorProductKey(vendorProductKey);
  const result = await database.query<ProductMappingCustomerReviewRow>(
    `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = $1
         and status = 'complete'
       order by completed_at desc nulls last, started_at desc
       limit 1
     ),
     product_customers as (
       select
         coalesce(vendor_usage_snapshots.external_account_id, vendor_usage_snapshots.customer_id::text) as source_account_key,
         max(vendor_usage_snapshots.external_account_id) as external_account_id,
         coalesce(
           max(nullif(vendor_usage_snapshots.dimensions->>'dattoExternalAccountName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'customerName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'appRiverCustomerName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'coveCustomerName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'ncentralCustomerName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'dattoCustomerName', '')),
           max(nullif(vendor_usage_snapshots.dimensions->>'domain', '')),
           max(snapshot_customers.name),
           max(vendor_usage_snapshots.external_account_id),
           max(vendor_usage_snapshots.customer_id::text)
         ) as external_account_name,
         sum(vendor_usage_snapshots.quantity) as vendor_quantity,
         max(vendor_usage_snapshots.observed_at) as observed_at,
         coalesce(
           max(nullif(vendor_usage_snapshots.dimensions->>'productName', '')),
           max(nullif(vendor_usage_snapshots.product_name, '')),
           $2
         ) as vendor_product_name
       from vendor_usage_snapshots
       left join customers snapshot_customers
         on snapshot_customers.id = vendor_usage_snapshots.customer_id
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_usage_snapshots.vendor_product_key = $2
         and vendor_usage_snapshots.sync_run_id = (select id from latest_sync_run)
         and coalesce(vendor_usage_snapshots.external_account_id, vendor_usage_snapshots.customer_id::text) is not null
       group by coalesce(vendor_usage_snapshots.external_account_id, vendor_usage_snapshots.customer_id::text)
     )
     select
       product_customers.external_account_id,
       product_customers.external_account_name,
       product_customers.vendor_quantity,
       product_customers.observed_at,
       product_customers.vendor_product_name,
       vendor_account_mappings.customer_id,
       customers.name as customer_name,
       vendor_account_mappings.agreement_id,
       agreements.name as agreement_name,
       agreements.status as agreement_status,
       agreement_additions.id as addition_id,
       agreement_additions.connectwise_addition_id,
       agreement_additions.product_code,
       agreement_additions.product_name,
       agreement_additions.quantity,
       agreement_additions.unit_price,
       agreement_additions.addition_status,
       agreement_additions.updated_at as addition_updated_at
     from product_customers
     left join vendor_account_mappings
       on vendor_account_mappings.vendor_id = $1
      and vendor_account_mappings.external_account_id = product_customers.external_account_id
      and vendor_account_mappings.active = true
      and vendor_account_mappings.mapping_status = 'approved'
     left join customers
       on customers.id = vendor_account_mappings.customer_id
     left join agreements
       on agreements.id = vendor_account_mappings.agreement_id
     left join agreement_additions
       on agreement_additions.agreement_id = vendor_account_mappings.agreement_id
      and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     order by
       product_customers.external_account_name,
       product_customers.external_account_id,
       agreement_additions.product_name,
       agreement_additions.product_code,
       agreement_additions.connectwise_addition_id`,
    [vendorId, canonicalProductKey],
  );

  return mapProductMappingCustomerReview(vendorId, canonicalProductKey, result.rows);
}

export async function upsertProductBundle(
  database: Queryable,
  vendorId: IntegrationId,
  input: {
    bundleKey?: string;
    bundleName?: string;
    components?: ProductBundleComponent[];
    targetProduct?: ProductMappingTarget;
    quantityStrategy?: ProductBundleQuantityStrategy;
    active?: boolean;
    reviewedBy?: string;
  },
): Promise<ProductBundle> {
  const bundleName = input.bundleName?.trim();
  if (!bundleName) {
    throw new Error('Bundle mapping requires a bundle name.');
  }

  const bundleKey = normalizeBundleKey(input.bundleKey || bundleName);
  if (!bundleKey) {
    throw new Error('Bundle mapping requires a bundle key.');
  }

  const components = normalizeBundleComponents(input.components ?? []);
  if (components.length < 2) {
    throw new Error('Bundle mapping requires at least two vendor products.');
  }

  const target = input.targetProduct;
  if (!target?.connectwiseProductCode?.trim() || !target.connectwiseProductName?.trim()) {
    throw new Error('Bundle mapping requires a ConnectWise product target.');
  }
  const existingTarget = await loadExistingConnectWiseProductTarget(database, target);
  if (!existingTarget) {
    throw new Error(
      'Bundle mappings can only target an existing ConnectWise product. Search and select an existing ConnectWise catalog product before saving.',
    );
  }

  const result = await database.query<ProductBundleRow>(
    `insert into vendor_product_bundles (
       vendor_id,
       bundle_key,
       bundle_name,
       components,
       connectwise_product_code,
       connectwise_product_name,
       unit_price,
       quantity_strategy,
       mapping_status,
       active,
       reviewed_by,
       reviewed_at,
       updated_at
     )
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 'approved', $9, $10, now(), now())
     on conflict (vendor_id, bundle_key)
     do update set
       bundle_name = excluded.bundle_name,
       components = excluded.components,
       connectwise_product_code = excluded.connectwise_product_code,
       connectwise_product_name = excluded.connectwise_product_name,
       unit_price = excluded.unit_price,
       quantity_strategy = excluded.quantity_strategy,
       mapping_status = excluded.mapping_status,
       active = excluded.active,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = excluded.reviewed_at,
       updated_at = now()
     returning
       id,
       vendor_id,
       bundle_key,
       bundle_name,
       components,
       connectwise_product_code,
       connectwise_product_name,
       unit_price,
       quantity_strategy,
       mapping_status,
       active,
       reviewed_by,
       reviewed_at,
       created_at,
       updated_at`,
    [
      vendorId,
      bundleKey,
      bundleName,
      JSON.stringify(components),
      existingTarget.connectwiseProductCode,
      existingTarget.connectwiseProductName,
      existingTarget.unitPrice ?? null,
      input.quantityStrategy ?? 'max-component-quantity',
      input.active ?? true,
      input.reviewedBy ?? 'user',
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to save product bundle mapping.');
  }

  return mapProductBundleRow(row);
}

export async function deactivateProductBundle(
  database: Queryable,
  vendorId: IntegrationId,
  bundleKey: string,
  options: { reviewedBy?: string } = {},
): Promise<{ vendorId: IntegrationId; bundleKey: string; active: false }> {
  await database.query(
    `update vendor_product_bundles
     set active = false,
         reviewed_by = $3,
         reviewed_at = now(),
         updated_at = now()
     where vendor_id = $1
       and bundle_key = $2`,
    [vendorId, bundleKey, options.reviewedBy ?? 'user'],
  );

  return {
    vendorId,
    bundleKey,
    active: false,
  };
}

export async function searchConnectWiseProductCatalog(
  database: Queryable,
  options: { query?: string; limit?: number } = {},
): Promise<ProductCatalogSearchResult[]> {
  const query = options.query?.trim() ?? '';
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const result = await database.query<{
    connectwise_product_id: string | null;
    connectwise_product_code: string;
    display_name: string;
  }>(
    `select
       connectwise_product_id,
       connectwise_product_code,
       display_name
     from products
     where vendor_id = 'connectwise'
       and active = true
       and (
         $1 = ''
         or connectwise_product_code ilike '%' || $1 || '%'
         or display_name ilike '%' || $1 || '%'
         or vendor_sku ilike '%' || $1 || '%'
       )
     order by
       case
         when $1 <> '' and connectwise_product_code ilike $1 || '%' then 0
         when $1 <> '' and display_name ilike $1 || '%' then 1
         else 2
       end,
       display_name,
       connectwise_product_code
     limit $2`,
    [query, limit],
  );

  return result.rows.map((row) => ({
    connectwiseProductId: row.connectwise_product_id ?? undefined,
    connectwiseProductCode: row.connectwise_product_code,
    connectwiseProductName: row.display_name,
    source: 'local',
  }));
}

export async function upsertConnectWiseCatalogProducts(
  database: Queryable,
  products: Array<ProductCatalogSearchResult & { rawPayload?: unknown }>,
) {
  for (const product of products) {
    await database.query(
      `insert into products (
         vendor_id,
         display_name,
         connectwise_product_id,
         connectwise_product_code,
         billing_basis,
         raw_payload,
         updated_at
       )
       values ('connectwise', $1, $2, $3, 'catalog', $4::jsonb, now())
       on conflict (vendor_id, connectwise_product_code)
       do update set
         display_name = excluded.display_name,
         connectwise_product_id = coalesce(excluded.connectwise_product_id, products.connectwise_product_id),
         billing_basis = excluded.billing_basis,
         raw_payload = excluded.raw_payload,
         active = true,
         updated_at = now()`,
      [
        product.connectwiseProductName,
        product.connectwiseProductId ?? null,
        product.connectwiseProductCode,
        JSON.stringify(product.rawPayload ?? {}),
      ],
    );
  }
}

export async function applyApprovedMappings(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<ApplyMappingsResult> {
  await setMissingVendorProductKeys(database, vendorId);

  const accountResult = await database.query<{ updated_count: string | number }>(
    `with updated as (
       update vendor_usage_snapshots
       set customer_id = vendor_account_mappings.customer_id,
           agreement_id = vendor_account_mappings.agreement_id
       from vendor_account_mappings
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_account_mappings.vendor_id = $1
         and vendor_usage_snapshots.external_account_id = vendor_account_mappings.external_account_id
         and vendor_account_mappings.active = true
         and vendor_account_mappings.mapping_status = 'approved'
         and (vendor_usage_snapshots.customer_id is distinct from vendor_account_mappings.customer_id
           or vendor_usage_snapshots.agreement_id is distinct from vendor_account_mappings.agreement_id)
       returning vendor_usage_snapshots.id
     )
     select count(*) as updated_count from updated`,
    [vendorId],
  );

  const productResult = await database.query<{ updated_count: string | number }>(
    `with approved_product_mappings as (
       select vendor_id,
              replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
              min(connectwise_product_code) as connectwise_product_code,
              min(connectwise_product_name) as connectwise_product_name,
              count(distinct connectwise_product_code) as target_count
       from vendor_product_mappings
       where vendor_id = $1
         and active = true
         and mapping_status = 'approved'
       group by vendor_id, replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/')
       having count(distinct connectwise_product_code) = 1
     ),
     updated as (
       update vendor_usage_snapshots
       set product_code = approved_product_mappings.connectwise_product_code,
           product_name = approved_product_mappings.connectwise_product_name
       from approved_product_mappings
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_usage_snapshots.vendor_product_key = approved_product_mappings.vendor_product_key
         and (vendor_usage_snapshots.product_code is distinct from approved_product_mappings.connectwise_product_code
           or vendor_usage_snapshots.product_name is distinct from approved_product_mappings.connectwise_product_name)
       returning vendor_usage_snapshots.id
     )
     select count(*) as updated_count from updated`,
    [vendorId],
  );

  await database.query(
    `update vendor_account_mappings
     set last_seen_at = latest_seen.last_seen_at,
         updated_at = now()
     from (
       select external_account_id, max(observed_at) as last_seen_at
       from vendor_usage_snapshots
       where vendor_id = $1
         and external_account_id is not null
       group by external_account_id
     ) latest_seen
     where vendor_account_mappings.vendor_id = $1
       and vendor_account_mappings.external_account_id = latest_seen.external_account_id`,
    [vendorId],
  );

  return {
    vendorId,
    accountSnapshotsUpdated: integerValue(accountResult.rows[0]?.updated_count),
    productSnapshotsUpdated: integerValue(productResult.rows[0]?.updated_count),
  };
}

export async function generateAccountMappingCandidates(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<AccountMappingCandidate[]> {
  const [sources, customers, preferredProductCodes] = await Promise.all([
    loadVendorAccountSources(database, vendorId),
    loadConnectWiseCustomers(database),
    loadPreferredProductCodes(database, vendorId),
  ]);

  return buildAccountMappingCandidates(vendorId, sources, customers, preferredProductCodes);
}

export function buildAccountMappingCandidates(
  vendorId: IntegrationId,
  sources: VendorAccountSource[],
  customers: ConnectWiseCustomerCandidate[],
  preferredProductCodes: string[] = [],
): AccountMappingCandidate[] {
  return sources.map((source) => {
    const rankedCustomers = customers
      .map((customer) => {
        const nameScore = scoreAgainstCustomer(source.externalAccountName, customer, source.externalAccountId);
        return {
          customer,
          score: nameScore.score,
          confidence: nameScore.confidence,
          evidence: nameScore.evidence,
        };
      })
      .sort((left, right) => right.score - left.score || left.customer.customerName.localeCompare(right.customer.customerName));

    const best = rankedCustomers[0];
    if (!best) {
      return {
        vendorId,
        externalAccountId: source.externalAccountId,
        externalAccountName: source.externalAccountName,
        status: 'needs-review',
        confidence: 'unmapped',
        matchScore: 0,
        activeRecommended: false,
        reason: 'No ConnectWise customer candidates are available.',
        evidence: [{ label: 'Vendor rows', value: source.rowCount }],
      };
    }

    const secondDistinct = rankedCustomers.find((candidate) => candidate.customer.customerId !== best.customer.customerId);
    const agreementChoice = chooseAgreement(best.customer.agreements, preferredProductCodes);
    const activeRecommended =
      best.score >= aggressiveAutoMapThreshold &&
      (!secondDistinct || best.score - secondDistinct.score >= ambiguityMargin) &&
      agreementChoice.status === 'selected';
    const status: MappingStatus = activeRecommended ? 'approved' : 'needs-review';

    return {
      vendorId,
      externalAccountId: source.externalAccountId,
      externalAccountName: source.externalAccountName,
      customerId: best.customer.customerId,
      customerName: best.customer.customerName,
      agreementId: agreementChoice.agreement?.agreementId,
      agreementName: agreementChoice.agreement?.agreementName,
      status,
      confidence: best.confidence,
      matchScore: best.score,
      activeRecommended,
      reason: activeRecommended
        ? 'Aggressive automap found a unique customer and agreement match.'
        : agreementChoice.reason,
      evidence: [
        { label: 'Vendor rows', value: source.rowCount },
        { label: 'Best customer score', value: best.score },
        { label: 'Second customer score', value: secondDistinct?.score ?? 0 },
        { label: 'Agreement choice', value: agreementChoice.reason },
        ...best.evidence,
      ],
    };
  });
}

export async function generateProductMappingCandidates(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<ProductMappingCandidate[]> {
  const classes = productClassesForVendor(vendorId);
  if (classes.length === 0) {
    return generateDynamicProductMappingCandidates(database, vendorId);
  }

  const [products, sources] = await Promise.all([
    loadConnectWiseProducts(database),
    loadVendorProductSources(database, vendorId),
  ]);
  const customerCountsByProductKey = new Map(
    sources.map((source) => [source.vendorProductKey, source.customerCount] as const),
  );
  const winnersByProductCode = new Map<string, ProductMappingCandidate>();

  for (const product of products) {
    const best = classes
      .map((productClass) =>
        productMappingCandidate(vendorId, productClass, product, customerCountsByProductKey.get(productClass.vendorProductKey) ?? 0),
      )
      .sort(compareProductCandidates)[0];

    if (best && best.matchScore >= 30) {
      winnersByProductCode.set(best.target.connectwiseProductCode, best);
    }
  }

  const candidates = [...winnersByProductCode.values()];

  for (const productClass of classes) {
    if (candidates.some((candidate) => candidate.vendorProductKey === productClass.vendorProductKey)) {
      continue;
    }

    candidates.push({
      vendorId,
      vendorProductKey: productClass.vendorProductKey,
      vendorProductName: productClass.vendorProductName,
      status: 'candidate',
      confidence: 'inferred',
      target: productClass.defaultTarget,
      matchScore: 50,
      additionCount: 0,
      customerCount: customerCountsByProductKey.get(productClass.vendorProductKey) ?? 0,
      reason: 'Default product mapping is available until a ConnectWise catalog target is reviewed.',
      evidence: [{ label: 'Default target', value: true }],
    });
  }

  return candidates.sort(
    (left, right) =>
      left.vendorProductKey.localeCompare(right.vendorProductKey) ||
      compareProductCandidates(left, right),
  );
}

async function generateDynamicProductMappingCandidates(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<ProductMappingCandidate[]> {
  const [sources, products] = await Promise.all([
    loadVendorProductSources(database, vendorId),
    loadConnectWiseProducts(database),
  ]);

  return sources.map((source) => dynamicProductMappingCandidate(vendorId, source, products));
}

function dynamicProductMappingCandidate(
  vendorId: IntegrationId,
  source: {
    vendorProductKey: string;
    vendorProductName: string;
    rowCount: number;
    customerCount: number;
  },
  products: ConnectWiseProductRow[],
): ProductMappingCandidate {
  const rankedProducts = products
    .map((product) => {
      const searchable = `${product.product_code} ${product.product_name}`;
      return {
        product,
        score: Math.max(
          scoreEntityName(source.vendorProductName, searchable),
          scoreEntityName(source.vendorProductKey, searchable),
        ),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        integerValue(right.product.addition_count) - integerValue(left.product.addition_count) ||
        left.product.product_code.localeCompare(right.product.product_code),
    );
  const best = rankedProducts[0];
  const defaultTarget = defaultDynamicProductTarget(source);
  const useBest = Boolean(best && best.score >= 30);
  const targetProduct = useBest ? best?.product : undefined;
  const matchScore = useBest ? best?.score ?? 0 : 50;

  return {
    vendorId,
    vendorProductKey: source.vendorProductKey,
    vendorProductName: source.vendorProductName,
    status: 'candidate',
    confidence: useBest ? confidenceForScore(matchScore, 'name') : 'inferred',
    target: targetProduct
      ? {
          connectwiseProductCode: targetProduct.product_code,
          connectwiseProductName: targetProduct.product_name,
          unitPrice: nullableNumber(targetProduct.unit_price),
        }
      : defaultTarget,
    matchScore,
    additionCount: targetProduct ? integerValue(targetProduct.addition_count) : 0,
    customerCount: source.customerCount,
    reason: useBest
      ? 'Candidate generated by comparing synced vendor product keys to ConnectWise additions.'
      : 'Synced vendor product key is available for manual product mapping review.',
    evidence: [
      { label: 'Synced rows', value: source.rowCount },
      { label: 'Dynamic vendor product', value: true },
      { label: 'Best score', value: matchScore },
    ],
  };
}

function defaultDynamicProductTarget(source: { vendorProductKey: string; vendorProductName: string }): ProductMappingTarget {
  const connectwiseProductCode = source.vendorProductKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return {
    connectwiseProductCode: connectwiseProductCode || 'VENDOR-PRODUCT',
    connectwiseProductName: source.vendorProductName,
  };
}

function compareProductCandidates(left: ProductMappingCandidate, right: ProductMappingCandidate) {
  return (
    right.matchScore - left.matchScore ||
    productClassPriority(right.vendorProductKey) - productClassPriority(left.vendorProductKey) ||
    right.additionCount - left.additionCount ||
    left.target.connectwiseProductCode.localeCompare(right.target.connectwiseProductCode)
  );
}

function productClassPriority(vendorProductKey: string) {
  return productClassesForVendorProductKey(vendorProductKey)?.priority ?? 0;
}

export function normalizeEntityName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(csp|incorporated|inc|llc|l\.l\.c|corp|corporation|company|co|pc|p\.c|pllc|llp|ltd|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function scoreEntityName(left: string, right: string) {
  const normalizedLeft = normalizeEntityName(left);
  const normalizedRight = normalizeEntityName(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 100;
  if (hasSafeContainmentMatch(normalizedLeft, normalizedRight)) return 92;

  const leftTokens = new Set(normalizedLeft.split(' ').filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(' ').filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

function hasSafeContainmentMatch(left: string, right: string) {
  return isContainedPhrase(left, right) || isContainedPhrase(right, left);
}

function isContainedPhrase(longer: string, shorter: string) {
  if (shorter.length < 8) return false;

  const index = longer.indexOf(shorter);
  if (index === -1) return false;

  const startsOnWordBoundary = index === 0 || longer[index - 1] === ' ';
  if (!startsOnWordBoundary) return false;

  const endIndex = index + shorter.length;
  const endsOnWordBoundary = endIndex === longer.length || longer[endIndex] === ' ';
  if (endsOnWordBoundary) return true;

  const shorterTokens = shorter.split(' ').filter(Boolean);
  const longerTokens = longer.split(' ').filter(Boolean);
  const minTokenCount = Math.min(shorterTokens.length, longerTokens.length);
  if (minTokenCount < 2) return false;

  const sharedPrefixTokens = shorterTokens
    .slice(0, minTokenCount - 1)
    .every((token, tokenIndex) => token === longerTokens[tokenIndex]);
  const shorterLastToken = shorterTokens[minTokenCount - 1];
  const longerLastToken = longerTokens[minTokenCount - 1];

  return sharedPrefixTokens && Boolean(shorterLastToken) && longerLastToken.startsWith(shorterLastToken);
}

async function listAccountMappings(database: Queryable, vendorId: IntegrationId): Promise<AccountMapping[]> {
  const result = await database.query<AccountMappingRow>(
    `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = $1
         and status = 'complete'
       order by completed_at desc nulls last, started_at desc
       limit 1
     ),
     source_account_names as (
       select
         external_account_id,
         coalesce(
           max(nullif(dimensions->>'dattoExternalAccountName', '')),
           max(nullif(dimensions->>'coveCustomerName', '')),
           max(nullif(dimensions->>'ncentralCustomerName', '')),
           max(nullif(dimensions->>'customerName', '')),
           max(nullif(dimensions->>'dattoCustomerName', '')),
           max(nullif(dimensions->>'domain', '')),
           external_account_id
         ) as external_account_name,
         max(observed_at) as last_seen_at
       from vendor_usage_snapshots
       where vendor_id = $1
         and external_account_id is not null
         and sync_run_id = (select id from latest_sync_run)
       group by external_account_id
     )
     select
       vendor_account_mappings.id,
       vendor_account_mappings.vendor_id,
       vendor_account_mappings.external_account_id,
       coalesce(source_account_names.external_account_name, vendor_account_mappings.external_account_name) as external_account_name,
       vendor_account_mappings.customer_id,
       customers.name as customer_name,
       vendor_account_mappings.agreement_id,
       agreements.name as agreement_name,
       vendor_account_mappings.mapping_status,
       vendor_account_mappings.confidence,
       vendor_account_mappings.match_score,
       vendor_account_mappings.mapping_source,
       vendor_account_mappings.active,
       vendor_account_mappings.reviewed_by,
       vendor_account_mappings.reviewed_at,
       coalesce(source_account_names.last_seen_at, vendor_account_mappings.last_seen_at) as last_seen_at,
       vendor_account_mappings.match_evidence
     from vendor_account_mappings
     inner join customers on customers.id = vendor_account_mappings.customer_id
     left join agreements on agreements.id = vendor_account_mappings.agreement_id
     left join source_account_names
       on source_account_names.external_account_id = vendor_account_mappings.external_account_id
     where vendor_account_mappings.vendor_id = $1
       and ($1 <> 'datto' or source_account_names.external_account_id is not null)
     order by vendor_account_mappings.mapping_status, coalesce(source_account_names.external_account_name, vendor_account_mappings.external_account_name)`,
    [vendorId],
  );

  return result.rows.map(mapAccountMappingRow);
}

async function listProductMappings(database: Queryable, vendorId: IntegrationId): Promise<ProductMapping[]> {
  const result = await database.query<ProductMappingRow>(
    `select
       vendor_product_mappings.id,
       vendor_product_mappings.vendor_id,
       vendor_product_mappings.vendor_product_key,
       vendor_product_mappings.target_index,
       vendor_product_mappings.connectwise_product_code,
       vendor_product_mappings.connectwise_product_name,
       vendor_product_mappings.unit_price,
       count(agreement_additions.id)::int as addition_count,
       vendor_product_mappings.mapping_status,
       vendor_product_mappings.confidence,
       vendor_product_mappings.match_score,
       vendor_product_mappings.mapping_source,
       vendor_product_mappings.active,
       vendor_product_mappings.reviewed_by,
       vendor_product_mappings.reviewed_at,
       vendor_product_mappings.match_evidence,
       max(vendor_product_usage_counts.customer_count) as customer_count
     from vendor_product_mappings
     left join agreement_additions
       on agreement_additions.product_code = vendor_product_mappings.connectwise_product_code
      and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and exists (
        select 1
        from agreements
        where agreements.id = agreement_additions.agreement_id
          and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
          and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
      )
     left join (
       with latest_sync_run as (
         select id
         from sync_runs
         where integration_id = $1
           and status = 'complete'
         order by completed_at desc nulls last, started_at desc
         limit 1
       )
       select vendor_id,
              vendor_product_key,
              count(distinct coalesce(external_account_id, customer_id::text))::int as customer_count
       from vendor_usage_snapshots
       where vendor_id = $1
         and vendor_product_key is not null
         and sync_run_id = (select id from latest_sync_run)
       group by vendor_id, vendor_product_key
     ) vendor_product_usage_counts
       on vendor_product_usage_counts.vendor_id = vendor_product_mappings.vendor_id
      and vendor_product_usage_counts.vendor_product_key = replace(
        replace(vendor_product_mappings.vendor_product_key, '%2F', '/'),
        '%2f',
        '/'
      )
     where vendor_product_mappings.vendor_id = $1
     group by
       vendor_product_mappings.id,
       vendor_product_mappings.vendor_id,
       vendor_product_mappings.vendor_product_key,
       vendor_product_mappings.target_index,
       vendor_product_mappings.connectwise_product_code,
       vendor_product_mappings.connectwise_product_name,
       vendor_product_mappings.unit_price,
       vendor_product_mappings.mapping_status,
       vendor_product_mappings.confidence,
       vendor_product_mappings.match_score,
       vendor_product_mappings.mapping_source,
       vendor_product_mappings.active,
       vendor_product_mappings.reviewed_by,
       vendor_product_mappings.reviewed_at,
       vendor_product_mappings.match_evidence
     order by vendor_product_mappings.vendor_product_key, vendor_product_mappings.target_index, vendor_product_mappings.connectwise_product_code`,
    [vendorId],
  );

  return result.rows.map(mapProductMappingRow);
}

async function loadVendorAccountSources(database: Queryable, vendorId: IntegrationId): Promise<VendorAccountSource[]> {
  const result = await database.query<AccountSourceRow>(
    `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = $1
         and status = 'complete'
       order by completed_at desc nulls last, started_at desc
       limit 1
     )
     select
       external_account_id,
       coalesce(
         max(nullif(dimensions->>'dattoExternalAccountName', '')),
         max(nullif(dimensions->>'coveCustomerName', '')),
         max(nullif(dimensions->>'ncentralCustomerName', '')),
         max(nullif(dimensions->>'customerName', '')),
         max(nullif(dimensions->>'dattoCustomerName', '')),
         max(nullif(dimensions->>'domain', '')),
         external_account_id
       ) as external_account_name,
       count(*)::int as row_count,
       max(observed_at) as last_seen_at
     from vendor_usage_snapshots
     where vendor_id = $1
       and external_account_id is not null
       and sync_run_id = (select id from latest_sync_run)
     group by external_account_id
     order by external_account_name`,
    [vendorId],
  );

  return result.rows.map((row) => ({
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name ?? row.external_account_id,
    rowCount: integerValue(row.row_count),
    lastSeenAt: isoDate(row.last_seen_at),
  }));
}

async function loadVendorProductSources(
  database: Queryable,
  vendorId: IntegrationId,
): Promise<Array<{ vendorProductKey: string; vendorProductName: string; rowCount: number; customerCount: number }>> {
  const result = await database.query<VendorProductSourceRow>(
    `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = $1
         and status = 'complete'
       order by completed_at desc nulls last, started_at desc
       limit 1
     )
     select
       vendor_product_key,
       coalesce(
         max(nullif(dimensions->>'productName', '')),
         max(nullif(product_name, '')),
         vendor_product_key
       ) as vendor_product_name,
       count(*)::int as row_count,
       count(distinct coalesce(external_account_id, customer_id::text))::int as customer_count
     from vendor_usage_snapshots
     where vendor_id = $1
       and vendor_product_key is not null
       and sync_run_id = (select id from latest_sync_run)
     group by vendor_product_key
     order by vendor_product_name`,
    [vendorId],
  );

  return result.rows.map((row) => ({
    vendorProductKey: row.vendor_product_key,
    vendorProductName: row.vendor_product_name ?? row.vendor_product_key,
    rowCount: integerValue(row.row_count),
    customerCount: integerValue(row.customer_count),
  }));
}

async function loadConnectWiseCustomers(database: Queryable): Promise<ConnectWiseCustomerCandidate[]> {
  const result = await database.query<CustomerAgreementRow>(
    `select
       customers.id as customer_id,
       customers.connectwise_company_id,
       customers.name as customer_name,
       customers.aliases,
       agreements.id as agreement_id,
       agreements.name as agreement_name,
       agreements.status as agreement_status,
       count(agreement_additions.id)::int as addition_count,
       coalesce(
         jsonb_agg(distinct agreement_additions.product_code) filter (where agreement_additions.product_code is not null),
         '[]'::jsonb
       ) as product_codes
     from customers
     left join agreements
       on agreements.customer_id = customers.id
      and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     left join agreement_additions
       on agreement_additions.agreement_id = agreements.id
      and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
      and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
     group by customers.id, customers.connectwise_company_id, customers.name, customers.aliases, agreements.id, agreements.name, agreements.status
     order by customers.name, agreements.name`,
  );

  const customersById = new Map<string, ConnectWiseCustomerCandidate>();
  for (const row of result.rows) {
    const customer =
      customersById.get(row.customer_id) ??
      {
        customerId: row.customer_id,
        connectWiseCompanyId: row.connectwise_company_id,
        customerName: row.customer_name,
        aliases: stringArray(row.aliases),
        agreements: [],
      };

    if (row.agreement_id && row.agreement_name) {
      customer.agreements.push({
        agreementId: row.agreement_id,
        agreementName: row.agreement_name,
        status: row.agreement_status ?? 'active',
        additionCount: integerValue(row.addition_count),
        productCodes: stringArray(row.product_codes),
      });
    }

    customersById.set(row.customer_id, customer);
  }

  return [...customersById.values()];
}

async function loadPreferredProductCodes(database: Queryable, vendorId: IntegrationId) {
  const result = await database.query<{ connectwise_product_code: string }>(
    `select connectwise_product_code
     from vendor_product_mappings
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'
     union
     select connectwise_product_code
     from vendor_product_bundles
     where vendor_id = $1
       and active = true
       and mapping_status = 'approved'`,
    [vendorId],
  );

  return result.rows.map((row) => row.connectwise_product_code);
}

async function loadConnectWiseProducts(database: Queryable): Promise<ConnectWiseProductRow[]> {
  const result = await database.query<ConnectWiseProductRow>(
    `select
       product_code,
       product_name,
       count(*)::int as addition_count,
       max(unit_price) as unit_price
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     group by product_code, product_name
     order by addition_count desc, product_code`,
  );

  return result.rows;
}

async function loadExistingConnectWiseProductTarget(
  database: Queryable,
  target: ProductMappingTarget,
): Promise<ProductMappingTarget | undefined> {
  const result = await database.query<{
    connectwise_product_code: string;
    connectwise_product_name: string;
    unit_price: string | number | null;
  }>(
    `select connectwise_product_code,
            display_name as connectwise_product_name,
            null::numeric as unit_price
     from products
     where vendor_id = 'connectwise'
       and active = true
       and connectwise_product_code = $1
     union all
     select agreement_additions.product_code as connectwise_product_code,
            max(agreement_additions.product_name) as connectwise_product_name,
            max(agreement_additions.unit_price) as unit_price
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where agreement_additions.product_code = $1
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     group by agreement_additions.product_code
     limit 1`,
    [target.connectwiseProductCode.trim()],
  );
  const row = result.rows[0];

  if (!row) {
    return undefined;
  }

  return {
    connectwiseProductCode: row.connectwise_product_code,
    connectwiseProductName: row.connectwise_product_name,
    unitPrice: nullableNumber(row.unit_price) ?? target.unitPrice,
  };
}

async function countUnmappedSnapshots(database: Queryable, vendorId: IntegrationId) {
  const result = await database.query<{ count: string | number }>(
    `select count(*) as count
     from vendor_usage_snapshots
     where vendor_id = $1
       and (customer_id is null or agreement_id is null)`,
    [vendorId],
  );

  return integerValue(result.rows[0]?.count);
}

async function upsertAccountMapping(
  database: Queryable,
  input: AccountMappingCandidate & {
    mappingSource: string;
    reviewedBy?: string;
  },
) {
  if (!input.customerId) {
    throw new Error('Account mapping requires customerId.');
  }

  await database.query(
    `insert into vendor_account_mappings (
       vendor_id,
       external_account_id,
       external_account_name,
       customer_id,
       agreement_id,
       mapping_status,
       confidence,
       match_score,
       mapping_source,
       reviewed_by,
       reviewed_at,
       last_seen_at,
       match_evidence,
       active,
       updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, case when $10::text is null then null else now() end, now(), $11::jsonb, $12, now())
     on conflict (vendor_id, external_account_id)
     do update set
       external_account_name = excluded.external_account_name,
       customer_id = excluded.customer_id,
       agreement_id = excluded.agreement_id,
       mapping_status = excluded.mapping_status,
       confidence = excluded.confidence,
       match_score = excluded.match_score,
       mapping_source = excluded.mapping_source,
       reviewed_by = coalesce(excluded.reviewed_by, vendor_account_mappings.reviewed_by),
       reviewed_at = coalesce(excluded.reviewed_at, vendor_account_mappings.reviewed_at),
       last_seen_at = excluded.last_seen_at,
       match_evidence = excluded.match_evidence,
       active = excluded.active,
       updated_at = now()`,
    [
      input.vendorId,
      input.externalAccountId,
      input.externalAccountName,
      input.customerId,
      input.agreementId ?? null,
      input.status,
      input.confidence,
      input.matchScore,
      input.mappingSource,
      input.reviewedBy ?? null,
      JSON.stringify(input.evidence),
      input.status === 'approved',
    ],
  );
}

async function loadExternalAccountName(database: Queryable, vendorId: IntegrationId, externalAccountId: string) {
  const result = await database.query<{ external_account_name: string | null }>(
     `select coalesce(
       max(nullif(dimensions->>'dattoExternalAccountName', '')),
       max(nullif(dimensions->>'coveCustomerName', '')),
       max(nullif(dimensions->>'ncentralCustomerName', '')),
       max(nullif(dimensions->>'customerName', '')),
       max(nullif(dimensions->>'dattoCustomerName', '')),
       max(nullif(dimensions->>'domain', '')),
       external_account_id
     ) as external_account_name
     from vendor_usage_snapshots
     where vendor_id = $1
       and external_account_id = $2
     group by external_account_id`,
    [vendorId, externalAccountId],
  );

  return result.rows[0]?.external_account_name ?? externalAccountId;
}

async function setMissingVendorProductKeys(database: Queryable, vendorId: IntegrationId) {
  if (vendorId !== 'cove') {
    if (vendorId !== 'ncentral') {
      return;
    }

    await database.query(
      `update vendor_usage_snapshots
       set vendor_product_key = case
         when dimensions->>'ncentralProductType' = 'physical-server' then 'ncentral-physical-server'
         when dimensions->>'ncentralProductType' = 'virtual-server' then 'ncentral-virtual-server'
         when dimensions->>'ncentralProductType' = 'workstation' then 'ncentral-workstation'
         else vendor_product_key
       end
       where vendor_id = 'ncentral'
         and vendor_product_key is null`,
    );
    return;
  }

  await database.query(
    `update vendor_usage_snapshots
     set vendor_product_key = case
       when dimensions->>'protectedSystemType' = 'server' then 'cove-server'
       when dimensions->>'protectedSystemType' = 'workstation' then 'cove-workstation'
       else vendor_product_key
     end
     where vendor_id = 'cove'
       and vendor_product_key is null`,
  );
}

function scoreAgainstCustomer(sourceName: string, customer: ConnectWiseCustomerCandidate, externalAccountId?: string) {
  if (externalAccountId && externalAccountId === customer.connectWiseCompanyId) {
    return {
      score: 100,
      confidence: 'exact' as MappingConfidence,
      evidence: [
        { label: 'Matched on', value: 'ConnectWise company ID' },
        { label: 'ConnectWise company ID', value: customer.connectWiseCompanyId },
        { label: 'Customer aliases', value: customer.aliases.length },
      ],
    };
  }

  const names = [customer.customerName, ...customer.aliases];
  const scoredNames = names
    .map((name) => ({
      name,
      score: scoreEntityName(sourceName, name),
    }))
    .sort((left, right) => right.score - left.score);
  const bestName = scoredNames[0];
  const score = bestName?.score ?? 0;

  return {
    score,
    confidence: confidenceForScore(score, bestName?.name === customer.customerName ? 'name' : 'alias'),
    evidence: [
      { label: 'Matched on', value: bestName?.name ?? customer.customerName },
      { label: 'ConnectWise company ID', value: customer.connectWiseCompanyId },
      { label: 'Customer aliases', value: customer.aliases.length },
    ],
  };
}

function chooseAgreement(agreements: AgreementCandidate[], preferredProductCodes: string[]) {
  const activeAgreements = agreements.filter((agreement) => !/expired|cancelled|inactive/i.test(agreement.status));
  const candidates = activeAgreements.length > 0 ? activeAgreements : agreements;

  if (candidates.length === 0) {
    return {
      status: 'missing' as const,
      agreement: undefined,
      reason: 'No agreement exists for this customer.',
    };
  }

  const withPreferredProducts = preferredProductCodes.length
    ? candidates.filter((agreement) => agreement.productCodes.some((code) => preferredProductCodes.includes(code)))
    : [];

  const selectable = withPreferredProducts.length > 0 ? withPreferredProducts : candidates;
  const ranked = [...selectable].sort(
    (left, right) =>
      Number(isMonthlyServiceAgreement(right)) - Number(isMonthlyServiceAgreement(left)) ||
      right.additionCount - left.additionCount ||
      left.agreementName.localeCompare(right.agreementName),
  );
  const best = ranked[0];
  const second = ranked[1];

  if (!best) {
    return {
      status: 'missing' as const,
      agreement: undefined,
      reason: 'No agreement candidate could be selected.',
    };
  }

  if (
    second &&
    isMonthlyServiceAgreement(second) === isMonthlyServiceAgreement(best) &&
    second.additionCount === best.additionCount &&
    withPreferredProducts.length !== 1
  ) {
    return {
      status: 'ambiguous' as const,
      agreement: best,
      reason: 'Multiple agreements have equal mapping strength.',
    };
  }

  return {
    status: 'selected' as const,
    agreement: best,
    reason: withPreferredProducts.length > 0
      ? 'Selected active agreement containing a mapped product.'
      : 'Selected active agreement with the most additions.',
  };
}

function isMonthlyServiceAgreement(agreement: AgreementCandidate) {
  return /monthly\s+services?/i.test(agreement.agreementName);
}

function productMappingCandidate(
  vendorId: IntegrationId,
  productClass: ProductClass,
  product: ConnectWiseProductRow,
  customerCount = 0,
): ProductMappingCandidate {
  const searchable = `${product.product_code} ${product.product_name}`;
  const normalized = normalizeEntityName(searchable);
  const baseScore = Math.max(
    scoreEntityName(productClass.vendorProductName, searchable),
    ...productClass.searchTerms.map((term) => scoreEntityName(term, searchable)),
  );
  const requiredHit =
    !productClass.requiredTerms || productClass.requiredTerms.every((term) => normalized.includes(normalizeEntityName(term)));
  const excludedHit = productClass.excludedTerms?.some((term) => normalized.includes(normalizeEntityName(term))) ?? false;
  const heuristicBonus = requiredHit ? 20 : 0;
  const exclusionPenalty = excludedHit ? 35 : 0;
  const score = Math.max(0, Math.min(100, baseScore + heuristicBonus - exclusionPenalty));

  return {
    vendorId,
    vendorProductKey: productClass.vendorProductKey,
    vendorProductName: productClass.vendorProductName,
    status: 'candidate',
    confidence: confidenceForScore(score, 'name'),
    target: {
      connectwiseProductCode: product.product_code,
      connectwiseProductName: product.product_name,
      unitPrice: nullableNumber(product.unit_price),
    },
    matchScore: score,
    additionCount: integerValue(product.addition_count),
    customerCount,
    reason: 'Candidate generated from ConnectWise agreement additions.',
    evidence: [
      { label: 'Addition count', value: integerValue(product.addition_count) },
      { label: 'Required term matched', value: requiredHit },
      { label: 'Excluded term matched', value: excludedHit },
    ],
  };
}

function productClassesForVendor(vendorId: IntegrationId): ProductClass[] {
  if (vendorId === 'cove') {
    return coveProductClasses;
  }

  if (vendorId === 'ncentral') {
    return ncentralProductClasses;
  }

  return [];
}

function productClassesForVendorProductKey(vendorProductKey: string) {
  return [...coveProductClasses, ...ncentralProductClasses].find(
    (productClass) => productClass.vendorProductKey === vendorProductKey,
  );
}

export function canonicalVendorProductKey(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function vendorProductKeyAliases(canonicalProductKey: string, originalProductKey: string) {
  return [
    originalProductKey,
    canonicalProductKey,
    canonicalProductKey.replace(/\//g, '%2F'),
    canonicalProductKey.replace(/\//g, '%2f'),
    encodeURIComponent(canonicalProductKey),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function mapAccountMappingRow(row: AccountMappingRow): AccountMapping {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    agreementId: row.agreement_id ?? undefined,
    agreementName: row.agreement_name ?? undefined,
    status: row.mapping_status,
    confidence: row.confidence,
    matchScore: nullableNumber(row.match_score) ?? 0,
    activeRecommended: row.mapping_status === 'approved' && row.active,
    reason: 'Persisted mapping.',
    evidence: evidenceArray(row.match_evidence),
    mappingSource: row.mapping_source,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
    lastSeenAt: isoDate(row.last_seen_at),
  };
}

function mapProductMappingRow(row: ProductMappingRow): ProductMapping {
  const vendorProductKey = canonicalVendorProductKey(row.vendor_product_key);
  const productClass = productClassesForVendor(row.vendor_id).find(
    (item) => item.vendorProductKey === vendorProductKey,
  );

  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorProductKey,
    vendorProductName: productClass?.vendorProductName ?? vendorProductKey,
    status: row.mapping_status,
    confidence: row.confidence,
    target: {
      connectwiseProductCode: row.connectwise_product_code,
      connectwiseProductName: row.connectwise_product_name,
      unitPrice: nullableNumber(row.unit_price),
    },
    matchScore: nullableNumber(row.match_score) ?? 0,
    additionCount: integerValue(row.addition_count),
    customerCount: integerValue(row.customer_count),
    reason: 'Persisted product mapping.',
    evidence: evidenceArray(row.match_evidence),
    targetIndex: row.target_index,
    mappingSource: row.mapping_source,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
  };
}

function mapProductBundleRow(row: ProductBundleRow): ProductBundle {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    bundleKey: row.bundle_key,
    bundleName: row.bundle_name,
    components: normalizeBundleComponents(componentArray(row.components)),
    target: {
      connectwiseProductCode: row.connectwise_product_code,
      connectwiseProductName: row.connectwise_product_name,
      unitPrice: nullableNumber(row.unit_price),
    },
    quantityStrategy: row.quantity_strategy === 'max-component-quantity' ? row.quantity_strategy : 'max-component-quantity',
    status: row.mapping_status,
    active: row.active,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: isoDate(row.reviewed_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function mapProductMappingCustomerReview(
  vendorId: IntegrationId,
  vendorProductKey: string,
  rows: ProductMappingCustomerReviewRow[],
): ProductMappingCustomerReview {
  const customersByKey = new Map<string, ProductMappingCustomer>();
  const additionIdsByCustomer = new Map<string, Set<string>>();
  let vendorProductName = vendorProductKey;

  for (const row of rows) {
    vendorProductName = row.vendor_product_name ?? vendorProductName;
    const externalAccountId = row.external_account_id ?? row.customer_id ?? row.external_account_name ?? 'unknown-account';
    const customer =
      customersByKey.get(externalAccountId) ??
      {
        externalAccountId,
        externalAccountName: row.external_account_name ?? externalAccountId,
        vendorQuantity: nullableNumber(row.vendor_quantity) ?? 0,
        observedAt: isoDate(row.observed_at),
        customerId: row.customer_id ?? undefined,
        customerName: row.customer_name ?? undefined,
        agreementId: row.agreement_id ?? undefined,
        agreementName: row.agreement_name ?? undefined,
        agreementStatus: row.agreement_status ?? undefined,
        additions: [],
      };

    if (row.addition_id) {
      const seenAdditionIds = additionIdsByCustomer.get(externalAccountId) ?? new Set<string>();
      if (!seenAdditionIds.has(row.addition_id)) {
        customer.additions.push({
          id: row.addition_id,
          connectWiseAdditionId: row.connectwise_addition_id ?? undefined,
          productCode: row.product_code ?? '',
          productName: row.product_name ?? '',
          quantity: nullableNumber(row.quantity) ?? 0,
          unitPrice: nullableNumber(row.unit_price),
          additionStatus: row.addition_status ?? 'Active',
          updatedAt: isoDate(row.addition_updated_at),
        });
        seenAdditionIds.add(row.addition_id);
        additionIdsByCustomer.set(externalAccountId, seenAdditionIds);
      }
    }

    customersByKey.set(externalAccountId, customer);
  }

  const customers = [...customersByKey.values()].sort(
    (left, right) =>
      left.externalAccountName.localeCompare(right.externalAccountName) ||
      left.externalAccountId.localeCompare(right.externalAccountId),
  );

  return {
    vendorId,
    vendorProductKey,
    vendorProductName,
    customerCount: customers.length,
    customers,
  };
}

function normalizeBundleKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeBundleComponents(components: ProductBundleComponent[]) {
  const byKey = new Map<string, ProductBundleComponent>();
  for (const component of components) {
    const vendorProductKey = component.vendorProductKey?.trim();
    if (!vendorProductKey) {
      continue;
    }

    byKey.set(vendorProductKey, {
      vendorProductKey,
      vendorProductName: component.vendorProductName?.trim() || vendorProductKey,
    });
  }

  return [...byKey.values()].sort((left, right) =>
    left.vendorProductName.localeCompare(right.vendorProductName) ||
    left.vendorProductKey.localeCompare(right.vendorProductKey),
  );
}

function componentArray(value: unknown): ProductBundleComponent[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const vendorProductKey = typeof record.vendorProductKey === 'string' ? record.vendorProductKey : undefined;
    const vendorProductName = typeof record.vendorProductName === 'string' ? record.vendorProductName : vendorProductKey;
    return vendorProductKey ? [{ vendorProductKey, vendorProductName: vendorProductName ?? vendorProductKey }] : [];
  });
}

function confidenceForScore(score: number, matchedOn: 'name' | 'alias'): MappingConfidence {
  if (score >= 98) return matchedOn === 'alias' ? 'alias' : 'exact';
  if (score >= aggressiveAutoMapThreshold) return 'inferred';
  return 'unmapped';
}

function stringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function evidenceArray(value: unknown): Array<{ label: string; value: string | number | boolean }> {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label : undefined;
    const evidenceValue = record.value;
    if (!label || !isPrimitiveEvidence(evidenceValue)) {
      return [];
    }

    return [{ label, value: evidenceValue }];
  });
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

function isPrimitiveEvidence(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function integerValue(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function nullableNumber(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function productKeyForCoveSnapshotDimensions(dimensions: Record<string, unknown>): CoveProductMappingKey | undefined {
  if (dimensions.protectedSystemType === 'server') return 'cove-server';
  if (dimensions.protectedSystemType === 'workstation') return 'cove-workstation';
  return undefined;
}
