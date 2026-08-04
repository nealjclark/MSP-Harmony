import 'dotenv/config';
import {
  doNotSuggestNewAdditionsSettingKey,
  integrationSettingsRegistry,
  psaAgreementReconcileModeSettingKey,
  type IntegrationId,
} from '../src/shared/integrationSettings';
import { createResolvedDatabasePool } from '../src/backend/database/pool';
import { sqlLatestReconcilableSyncRunIdExpression } from '../src/backend/shared/reconcilableSyncRuns';
import { coveRuleSet } from '../src/backend/vendor/cove/rules';
import { dattoRuleSet } from '../src/backend/vendor/datto/rules';
import { huntressRuleSet } from '../src/backend/vendor/huntress/rules';
import { ncentralRuleSet } from '../src/backend/vendor/ncentral/rules';
import { sentinelOneRuleSet } from '../src/backend/vendor/sentinelone/rules';
import type { QuantityRule, VendorRuleSet } from '../src/backend/shared/types';

type JsonRecord = Record<string, unknown>;

type IntegrationRow = {
  integration_id: string;
  display_name: string;
  configured_status: string;
  last_test_result: string;
  last_tested_at: Date | string | null;
  non_secret_settings: JsonRecord | string | null;
};

type SyncRunRow = {
  id: string;
  integration_id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number | string;
  records_written: number | string;
  error_message: string | null;
  metadata: JsonRecord | string | null;
};

type ProductMappingRow = {
  vendor_id: string;
  vendor_product_key: string;
  connectwise_product_code: string;
  connectwise_product_name: string;
  target_index: number | string;
  mapping_status: string;
  active: boolean;
  confidence: string;
  mapping_source: string;
};

type AccountMappingRow = {
  vendor_id: string;
  external_account_id: string;
  external_account_name: string;
  customer_id: string;
  customer_name: string | null;
  customer_status: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  agreement_status: string | null;
  agreement_customer_id: string | null;
  mapping_status: string;
  active: boolean;
  confidence: string;
  mapping_source: string;
};

type SourceRow = {
  id: string;
  vendor_id: string;
  sync_run_id: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: number | string;
  observed_at: Date | string;
  dimensions: JsonRecord | string | null;
  stored_customer_id: string | null;
  stored_agreement_id: string | null;
  mapped_customer_id: string | null;
  mapped_agreement_id: string | null;
  effective_customer_id: string | null;
  effective_agreement_id: string | null;
  customer_name: string | null;
  customer_status: string | null;
  agreement_name: string | null;
  agreement_status: string | null;
};

type AdditionRow = {
  id: string;
  connectwise_addition_id: string;
  customer_id: string;
  customer_name: string;
  agreement_id: string;
  agreement_name: string;
  product_code: string;
  product_name: string;
  quantity: number | string;
  addition_status: string;
};

type ProductRow = {
  connectwise_product_code: string;
  display_name: string;
  active: boolean;
};

type PinRow = {
  id: string;
  vendor_id: string;
  customer_id: string;
  agreement_id: string;
  vendor_product_key: string;
  source_account_id: string;
  connectwise_addition_id: string;
  connectwise_product_code: string;
  active: boolean;
};

type OverrideRow = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  agreement_id: string | null;
  source_vendor_product_key: string;
  target_vendor_product_key: string;
  target_product_code: string | null;
  active: boolean;
};

type AuditException = {
  severity: 'critical' | 'high' | 'medium' | 'low';
  issueType: string;
  vendorId: string;
  customerName?: string;
  customerId?: string;
  agreementName?: string;
  agreementId?: string;
  externalAccountId?: string;
  vendorAccountName?: string;
  vendorProductKey?: string;
  vendorProductName?: string;
  quantity?: number;
  targetProductCodes?: string[];
  connectWiseAdditionIds?: string[];
  connectWiseProductCodes?: string[];
  suggestedCandidate?: string;
  detail: string;
};

const mappingIntegrationIds = integrationSettingsRegistry
  .filter((definition) => definition.capabilities.includes('mapping'))
  .map((definition) => definition.integrationId);

const fallbackRuleSets = new Map<string, VendorRuleSet>([
  [coveRuleSet.vendorId, coveRuleSet],
  [dattoRuleSet.vendorId, dattoRuleSet],
  [huntressRuleSet.vendorId, huntressRuleSet],
  [ncentralRuleSet.vendorId, ncentralRuleSet],
  [sentinelOneRuleSet.vendorId, sentinelOneRuleSet],
]);

async function main() {
  const pool = await createResolvedDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('begin isolation level repeatable read read only');

    const integrations = (
      await client.query<IntegrationRow>(
        `select integration_id,
                display_name,
                configured_status,
                last_test_result,
                last_tested_at,
                non_secret_settings
         from integration_settings
         where integration_id = any($1::text[])
         order by display_name`,
        [mappingIntegrationIds],
      )
    ).rows;

    const configuredIntegrations = integrations.filter((row) => row.configured_status !== 'not-configured');
    const configuredIds = configuredIntegrations.map((row) => row.integration_id);

    const productMappings = (
      await client.query<ProductMappingRow>(
        `select vendor_id,
                replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
                connectwise_product_code,
                connectwise_product_name,
                target_index,
                mapping_status,
                active,
                confidence,
                mapping_source
         from vendor_product_mappings
         where vendor_id = any($1::text[])
         order by vendor_id, vendor_product_key, target_index, connectwise_product_code`,
        [configuredIds],
      )
    ).rows;

    const accountMappings = (
      await client.query<AccountMappingRow>(
        `select vendor_account_mappings.vendor_id,
                vendor_account_mappings.external_account_id,
                vendor_account_mappings.external_account_name,
                vendor_account_mappings.customer_id,
                customers.name as customer_name,
                customers.status as customer_status,
                vendor_account_mappings.agreement_id,
                agreements.name as agreement_name,
                agreements.status as agreement_status,
                agreements.customer_id as agreement_customer_id,
                vendor_account_mappings.mapping_status,
                vendor_account_mappings.active,
                vendor_account_mappings.confidence,
                vendor_account_mappings.mapping_source
         from vendor_account_mappings
         left join customers on customers.id = vendor_account_mappings.customer_id
         left join agreements on agreements.id = vendor_account_mappings.agreement_id
         where vendor_account_mappings.vendor_id = any($1::text[])
         order by vendor_account_mappings.vendor_id,
                  vendor_account_mappings.external_account_name,
                  vendor_account_mappings.external_account_id`,
        [configuredIds],
      )
    ).rows;

    const additions = (
      await client.query<AdditionRow>(
        `select agreement_additions.id,
                agreement_additions.connectwise_addition_id,
                agreement_additions.customer_id,
                customers.name as customer_name,
                agreement_additions.agreement_id,
                agreements.name as agreement_name,
                agreement_additions.product_code,
                agreement_additions.product_name,
                agreement_additions.quantity,
                agreement_additions.addition_status
         from agreement_additions
         inner join customers on customers.id = agreement_additions.customer_id
         inner join agreements on agreements.id = agreement_additions.agreement_id
         where coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
           and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
           and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
           and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
           and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
         order by customers.name, agreements.name, agreement_additions.product_name`,
      )
    ).rows;

    const products = (
      await client.query<ProductRow>(
        `select connectwise_product_code, max(display_name) as display_name, bool_or(active) as active
         from products
         group by connectwise_product_code
         order by connectwise_product_code`,
      )
    ).rows;

    const pins = (
      await client.query<PinRow>(
        `select id,
                vendor_id,
                customer_id,
                agreement_id,
                replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
                source_account_id,
                connectwise_addition_id,
                connectwise_product_code,
                active
         from vendor_product_addition_pins
         where vendor_id = any($1::text[])
         order by vendor_id, agreement_id, vendor_product_key, source_account_id`,
        [configuredIds],
      )
    ).rows;

    const overrides = (
      await client.query<OverrideRow>(
        `select id,
                vendor_id,
                customer_id,
                agreement_id,
                replace(replace(source_vendor_product_key, '%2F', '/'), '%2f', '/') as source_vendor_product_key,
                replace(replace(target_vendor_product_key, '%2F', '/'), '%2f', '/') as target_vendor_product_key,
                target_product_code,
                active
         from vendor_usage_overrides
         where vendor_id = any($1::text[])
         order by vendor_id, source_vendor_product_key, target_vendor_product_key`,
        [configuredIds],
      )
    ).rows;

    const latestRuns: Record<string, SyncRunRow | undefined> = {};
    const latestAnyRuns: Record<string, SyncRunRow | undefined> = {};
    const recentRuns: Record<string, SyncRunRow[]> = {};
    const sourceRows: SourceRow[] = [];

    for (const vendorId of configuredIds) {
      const selectedResult = await client.query<SyncRunRow>(
        `select id,
                integration_id,
                started_at,
                completed_at,
                status,
                records_read,
                records_written,
                error_message,
                metadata
         from sync_runs
         where id = (${sqlLatestReconcilableSyncRunIdExpression('$1')})`,
        [vendorId],
      );
      latestRuns[vendorId] = selectedResult.rows[0];

      const latestAnyResult = await client.query<SyncRunRow>(
        `select id,
                integration_id,
                started_at,
                completed_at,
                status,
                records_read,
                records_written,
                error_message,
                metadata
         from sync_runs
         where integration_id = $1
         order by started_at desc
         limit 1`,
        [vendorId],
      );
      latestAnyRuns[vendorId] = latestAnyResult.rows[0];

      const recentResult = await client.query<SyncRunRow>(
        `select id,
                integration_id,
                started_at,
                completed_at,
                status,
                records_read,
                records_written,
                error_message,
                metadata
         from sync_runs
         where integration_id = $1
           and started_at >= now() - interval '45 days'
         order by started_at desc
         limit 20`,
        [vendorId],
      );
      recentRuns[vendorId] = recentResult.rows;

      const selectedRunId = selectedResult.rows[0]?.id;
      if (!selectedRunId) continue;

      const rows = await client.query<SourceRow>(
        `with approved_account_mappings as (
           select vendor_id,
                  external_account_id,
                  customer_id,
                  agreement_id
           from vendor_account_mappings
           where vendor_id = $1
             and active = true
             and mapping_status = 'approved'
             and agreement_id is not null
         )
         select vendor_usage_snapshots.id,
                vendor_usage_snapshots.vendor_id,
                vendor_usage_snapshots.sync_run_id,
                vendor_usage_snapshots.external_account_id,
                replace(replace(vendor_usage_snapshots.vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
                vendor_usage_snapshots.product_code,
                vendor_usage_snapshots.product_name,
                vendor_usage_snapshots.quantity,
                vendor_usage_snapshots.observed_at,
                vendor_usage_snapshots.dimensions,
                vendor_usage_snapshots.customer_id as stored_customer_id,
                vendor_usage_snapshots.agreement_id as stored_agreement_id,
                approved_account_mappings.customer_id as mapped_customer_id,
                approved_account_mappings.agreement_id as mapped_agreement_id,
                coalesce(vendor_usage_snapshots.customer_id, approved_account_mappings.customer_id) as effective_customer_id,
                coalesce(vendor_usage_snapshots.agreement_id, approved_account_mappings.agreement_id) as effective_agreement_id,
                customers.name as customer_name,
                customers.status as customer_status,
                agreements.name as agreement_name,
                agreements.status as agreement_status
         from vendor_usage_snapshots
         left join approved_account_mappings
           on approved_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
          and approved_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
          and vendor_usage_snapshots.customer_id is null
         left join customers
           on customers.id = coalesce(vendor_usage_snapshots.customer_id, approved_account_mappings.customer_id)
         left join agreements
           on agreements.id = coalesce(vendor_usage_snapshots.agreement_id, approved_account_mappings.agreement_id)
         where vendor_usage_snapshots.vendor_id = $1
           and vendor_usage_snapshots.sync_run_id = $2::uuid
         order by customer_name nulls last,
                  agreement_name nulls last,
                  vendor_product_key nulls last,
                  vendor_usage_snapshots.external_account_id`,
        [vendorId, selectedRunId],
      );
      sourceRows.push(...rows.rows);
    }

    const appRiverProgress = await loadAppRiverProgress(client);
    const result = buildAudit({
      collectedAt: new Date().toISOString(),
      integrations: configuredIntegrations,
      latestRuns,
      latestAnyRuns,
      recentRuns,
      productMappings,
      accountMappings,
      additions,
      products,
      pins,
      overrides,
      sourceRows,
      appRiverProgress,
    });

    await client.query('commit');
    writeResult(result);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function buildAudit(input: {
  collectedAt: string;
  integrations: IntegrationRow[];
  latestRuns: Record<string, SyncRunRow | undefined>;
  latestAnyRuns: Record<string, SyncRunRow | undefined>;
  recentRuns: Record<string, SyncRunRow[]>;
  productMappings: ProductMappingRow[];
  accountMappings: AccountMappingRow[];
  additions: AdditionRow[];
  products: ProductRow[];
  pins: PinRow[];
  overrides: OverrideRow[];
  sourceRows: SourceRow[];
  appRiverProgress: unknown;
}) {
  const exceptions: AuditException[] = [];
  const activeApprovedProductMappings = input.productMappings.filter(
    (row) => row.active && row.mapping_status === 'approved',
  );
  const mappingTargets = groupBy(
    activeApprovedProductMappings,
    (row) => `${row.vendor_id}\u0001${canonicalProductKey(row.vendor_product_key)}`,
  );
  const activeApprovedAccountMappings = input.accountMappings.filter(
    (row) => row.active && row.mapping_status === 'approved',
  );
  const accountMappingByKey = new Map(
    activeApprovedAccountMappings.map((row) => [`${row.vendor_id}\u0001${row.external_account_id}`, row]),
  );
  const additionsByAgreement = groupBy(input.additions, (row) => row.agreement_id);
  const activeProductCodes = new Set(
    input.products.filter((row) => row.active).map((row) => normalize(row.connectwise_product_code)),
  );
  const settingsByVendor = new Map(
    input.integrations.map((row) => [row.integration_id, recordFromJson(row.non_secret_settings)]),
  );
  const sourceGroups = groupBy(input.sourceRows, (row) =>
    [
      row.vendor_id,
      row.external_account_id ?? '',
      row.effective_customer_id ?? '',
      row.effective_agreement_id ?? '',
      canonicalProductKey(row.vendor_product_key ?? ''),
      row.product_code,
      row.product_name,
    ].join('\u0001'),
  );
  const observedKeysByVendor = new Map<string, Set<string>>();
  const observedTargetCodesByScope = new Map<string, Set<string>>();

  for (const rows of sourceGroups.values()) {
    const first = rows[0]!;
    const vendorId = first.vendor_id;
    const vendorProductKey = canonicalProductKey(first.vendor_product_key ?? '');
    const quantity = rows.reduce((total, row) => total + numberValue(row.quantity), 0);
    const customerId = first.effective_customer_id ?? undefined;
    const agreementId = first.effective_agreement_id ?? undefined;
    const customerName = first.customer_name ?? undefined;
    const agreementName = first.agreement_name ?? undefined;
    const externalAccountId = first.external_account_id ?? undefined;
    const dimensions = rows.map((row) => recordFromJson(row.dimensions));
    const vendorAccountName = sourceAccountName(dimensions);
    const isDetailOnly = dimensions.some((row) => booleanValue(row.detailOnlySync));

    if (vendorProductKey) {
      const keys = observedKeysByVendor.get(vendorId) ?? new Set<string>();
      keys.add(vendorProductKey);
      observedKeysByVendor.set(vendorId, keys);
    }

    if (!customerId) {
      exceptions.push({
        severity: 'critical',
        issueType: 'customer-unmapped',
        vendorId,
        externalAccountId,
        vendorAccountName,
        vendorProductKey: vendorProductKey || undefined,
        vendorProductName: first.product_name,
        quantity,
        detail:
          'The selected source run has no effective ConnectWise customer. Runtime reconciliation filters this row out before producing a finding.',
      });
      continue;
    }

    if (!agreementId) {
      const approvedMapping = externalAccountId
        ? accountMappingByKey.get(`${vendorId}\u0001${externalAccountId}`)
        : undefined;
      exceptions.push({
        severity: 'critical',
        issueType: first.stored_customer_id && approvedMapping?.agreement_id
          ? 'agreement-mapping-shadowed-by-stored-customer'
          : 'agreement-unmapped',
        vendorId,
        customerId,
        customerName,
        externalAccountId,
        vendorAccountName,
        vendorProductKey: vendorProductKey || undefined,
        vendorProductName: first.product_name,
        quantity,
        detail:
          first.stored_customer_id && approvedMapping?.agreement_id
            ? 'The snapshot stores a customer but no agreement. The reconciliation join only applies the approved account mapping when the stored customer is null, so the mapped agreement is ignored and this row is filtered out.'
            : 'The selected source run has no effective ConnectWise agreement. Runtime reconciliation filters this row out before producing a finding.',
      });
      continue;
    }

    const directMapping = externalAccountId
      ? accountMappingByKey.get(`${vendorId}\u0001${externalAccountId}`)
      : undefined;
    if (
      directMapping &&
      ((first.stored_customer_id && first.stored_customer_id !== directMapping.customer_id) ||
        (first.stored_agreement_id && first.stored_agreement_id !== directMapping.agreement_id))
    ) {
      exceptions.push({
        severity: 'high',
        issueType: 'stored-scope-conflicts-with-approved-account-mapping',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey: vendorProductKey || undefined,
        quantity,
        detail:
          'The snapshot carries a customer/agreement different from the approved account mapping. Runtime reconciliation prefers the stored scope, so the approved mapping does not repair it.',
      });
    }

    const mappingRows = mappingTargets.get(`${vendorId}\u0001${vendorProductKey}`) ?? [];
    const fallbackRule = findFallbackRule(vendorId, vendorProductKey);
    const targetProductCodes = unique(
      mappingRows.length > 0
        ? mappingRows.map((row) => row.connectwise_product_code)
        : fallbackRule
          ? [fallbackRule.productCode, ...(fallbackRule.targetProductCodes ?? [])]
          : [],
    );

    if (!vendorProductKey) {
      exceptions.push({
        severity: 'high',
        issueType: 'vendor-product-key-missing',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductName: first.product_name,
        quantity,
        detail: 'The vendor row has no stable vendor product key, so it cannot be mapped reliably.',
      });
      continue;
    }

    if (mappingRows.length === 0 && !fallbackRule) {
      exceptions.push({
        severity: isDetailOnly ? 'high' : 'critical',
        issueType: isDetailOnly ? 'detail-only-unmapped-hidden' : 'vendor-product-unmapped',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        detail: isDetailOnly
          ? 'This detail-only row has no approved product mapping and is filtered out before reconciliation, so no unmapped-product finding is produced.'
          : 'No approved product mapping or built-in fallback rule exists for this observed vendor product.',
      });
      continue;
    }

    if (mappingRows.length === 0 && fallbackRule) {
      exceptions.push({
        severity: 'low',
        issueType: 'implicit-default-product-rule',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes,
        detail:
          'The product reconciles through a built-in default rule rather than an approved database mapping. Confirm the default ConnectWise product is intentional.',
      });
    }

    if (targetProductCodes.length > 1) {
      exceptions.push({
        severity: 'high',
        issueType: 'vendor-product-maps-to-multiple-connectwise-products',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes,
        detail:
          'One vendor product has multiple approved ConnectWise targets. This is valid only when the customer has intentionally separate additions and stable pins.',
      });
    }

    const missingCatalogCodes = targetProductCodes.filter((code) => !activeProductCodes.has(normalize(code)));
    if (targetProductCodes.length > 0 && missingCatalogCodes.length === targetProductCodes.length) {
      exceptions.push({
        severity: 'high',
        issueType: 'mapped-connectwise-product-missing-from-catalog',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes,
        detail:
          'Every approved/fallback ConnectWise target for this vendor product is absent or inactive in the locally synced product catalog.',
      });
    }

    const agreementAdditions = additionsByAgreement.get(agreementId) ?? [];
    const matchingAdditions = agreementAdditions.filter((addition) =>
      targetProductCodes.some((code) => normalize(code) === normalize(addition.product_code)),
    );
    const doNotSuggestNewAdditions = booleanValue(
      settingsByVendor.get(vendorId)?.[doNotSuggestNewAdditionsSettingKey],
    );

    if (targetProductCodes.length > 0) {
      const scopeKey = `${vendorId}\u0001${customerId}\u0001${agreementId}`;
      const observedCodes = observedTargetCodesByScope.get(scopeKey) ?? new Set<string>();
      targetProductCodes.forEach((code) => observedCodes.add(normalize(code)));
      observedTargetCodesByScope.set(scopeKey, observedCodes);
    }

    if (targetProductCodes.length > 0 && matchingAdditions.length === 0 && quantity > 0) {
      const suggestion = closestAddition(first.product_name, targetProductCodes, agreementAdditions);
      exceptions.push({
        severity: 'critical',
        issueType: doNotSuggestNewAdditions
          ? 'missing-connectwise-addition-suppressed'
          : 'missing-connectwise-addition',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes,
        suggestedCandidate: suggestion,
        detail: doNotSuggestNewAdditions
          ? 'Vendor usage exists but the mapped ConnectWise addition is missing. The integration setting suppresses create-addition lines, so the normal reconciliation hides this exception.'
          : 'Vendor usage exists but no active addition with any mapped ConnectWise product code exists on the selected agreement.',
      });
    }

    const additionsByCode = groupBy(matchingAdditions, (addition) => normalize(addition.product_code));
    for (const duplicates of additionsByCode.values()) {
      if (duplicates.length < 2) continue;
      exceptions.push({
        severity: 'critical',
        issueType: 'duplicate-connectwise-additions-for-product',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes: [duplicates[0]!.product_code],
        connectWiseAdditionIds: duplicates.map((addition) => addition.connectwise_addition_id),
        connectWiseProductCodes: duplicates.map((addition) => addition.product_code),
        detail:
          'The agreement contains multiple active additions with the same mapped product code. Reconciliation selects one and emits the others as unassigned additions, requiring ConnectWise repair.',
      });
    }

    const distinctMatchingAdditionCodes = unique(
      matchingAdditions.map((addition) => normalize(addition.product_code)),
    );
    if (targetProductCodes.length > 1 && distinctMatchingAdditionCodes.length > 1) {
      exceptions.push({
        severity: 'high',
        issueType: 'multiple-mapped-connectwise-products-present',
        vendorId,
        customerId,
        customerName,
        agreementId,
        agreementName,
        externalAccountId,
        vendorProductKey,
        vendorProductName: first.product_name,
        quantity,
        targetProductCodes,
        connectWiseAdditionIds: matchingAdditions.map((addition) => addition.connectwise_addition_id),
        connectWiseProductCodes: matchingAdditions.map((addition) => addition.product_code),
        detail:
          'Multiple mapped product variants are simultaneously active on this agreement. Confirm whether they are distinct licensed products or a ConnectWise-side duplication/wrong-product condition.',
      });
    }
  }

  const sourceByTargetScope = new Map<string, Array<{ vendorProductKey: string; quantity: number }>>();
  for (const rows of sourceGroups.values()) {
    const first = rows[0]!;
    if (!first.effective_customer_id || !first.effective_agreement_id || !first.vendor_product_key) continue;
    const vendorProductKey = canonicalProductKey(first.vendor_product_key);
    const targets = mappingTargets.get(`${first.vendor_id}\u0001${vendorProductKey}`) ?? [];
    for (const targetCode of unique(targets.map((row) => row.connectwise_product_code))) {
      const key = [
        first.vendor_id,
        first.effective_customer_id,
        first.effective_agreement_id,
        normalize(targetCode),
      ].join('\u0001');
      const values = sourceByTargetScope.get(key) ?? [];
      values.push({
        vendorProductKey,
        quantity: rows.reduce((total, row) => total + numberValue(row.quantity), 0),
      });
      sourceByTargetScope.set(key, values);
    }
  }

  for (const [key, values] of sourceByTargetScope.entries()) {
    const distinctProductKeys = unique(values.map((value) => value.vendorProductKey));
    if (distinctProductKeys.length < 2) continue;
    const [vendorId, customerId, agreementId, targetProductCode] = key.split('\u0001');
    const account = activeApprovedAccountMappings.find(
      (mapping) =>
        mapping.vendor_id === vendorId &&
        mapping.customer_id === customerId &&
        mapping.agreement_id === agreementId,
    );
    const settings = settingsByVendor.get(vendorId) ?? {};
    const reconcileMode =
      stringValue(settings[psaAgreementReconcileModeSettingKey]) || 'merge-multiple-products';
    exceptions.push({
      severity: reconcileMode === 'separate-multiple-products' ? 'critical' : 'high',
      issueType: 'multiple-vendor-products-collapse-to-one-connectwise-product',
      vendorId,
      customerId,
      customerName: account?.customer_name ?? undefined,
      agreementId,
      agreementName: account?.agreement_name ?? undefined,
      vendorProductKey: distinctProductKeys.join(', '),
      quantity: values.reduce((total, value) => total + value.quantity, 0),
      targetProductCodes: [targetProductCode],
      detail:
        `Multiple observed vendor products map to the same ConnectWise product code. Current reconcile mode is ${reconcileMode}; confirm whether quantities should merge or remain separate.`,
    });
  }

  const reportedConnectWiseOnlyAdditions = new Set<string>();
  for (const mapping of activeApprovedAccountMappings) {
    if (!mapping.customer_name) {
      exceptions.push({
        severity: 'critical',
        issueType: 'account-mapping-customer-missing',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        externalAccountId: mapping.external_account_id,
        detail: 'An approved active vendor account mapping points to a missing ConnectWise customer row.',
      });
      continue;
    }
    if (inactiveStatus(mapping.customer_status)) {
      exceptions.push({
        severity: 'high',
        issueType: 'account-mapping-customer-inactive',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        customerName: mapping.customer_name,
        externalAccountId: mapping.external_account_id,
        detail: `The approved mapping points to a customer with status "${mapping.customer_status}".`,
      });
    }
    if (!mapping.agreement_id) {
      exceptions.push({
        severity: 'critical',
        issueType: 'approved-account-mapping-has-no-agreement',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        customerName: mapping.customer_name,
        externalAccountId: mapping.external_account_id,
        detail:
          'The approved active account mapping has no agreement. It cannot provide an effective scope to runtime reconciliation.',
      });
      continue;
    }
    if (!mapping.agreement_name) {
      exceptions.push({
        severity: 'critical',
        issueType: 'account-mapping-agreement-missing',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        customerName: mapping.customer_name,
        agreementId: mapping.agreement_id,
        externalAccountId: mapping.external_account_id,
        detail: 'The approved active account mapping points to a missing ConnectWise agreement row.',
      });
    } else if (inactiveStatus(mapping.agreement_status)) {
      exceptions.push({
        severity: 'high',
        issueType: 'account-mapping-agreement-inactive',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        customerName: mapping.customer_name,
        agreementId: mapping.agreement_id,
        agreementName: mapping.agreement_name,
        externalAccountId: mapping.external_account_id,
        detail: `The approved mapping points to an agreement with status "${mapping.agreement_status}".`,
      });
    }
    if (mapping.agreement_customer_id && mapping.agreement_customer_id !== mapping.customer_id) {
      exceptions.push({
        severity: 'critical',
        issueType: 'account-mapping-customer-agreement-mismatch',
        vendorId: mapping.vendor_id,
        customerId: mapping.customer_id,
        customerName: mapping.customer_name,
        agreementId: mapping.agreement_id,
        agreementName: mapping.agreement_name ?? undefined,
        externalAccountId: mapping.external_account_id,
        detail: 'The mapped agreement belongs to a different ConnectWise customer than the mapped customer.',
      });
    }
  }

  for (const pin of input.pins.filter((row) => row.active)) {
    const addition = input.additions.find(
      (candidate) =>
        candidate.connectwise_addition_id === pin.connectwise_addition_id ||
        candidate.id === pin.connectwise_addition_id,
    );
    if (
      !addition ||
      addition.customer_id !== pin.customer_id ||
      addition.agreement_id !== pin.agreement_id ||
      normalize(addition.product_code) !== normalize(pin.connectwise_product_code)
    ) {
      exceptions.push({
        severity: 'critical',
        issueType: 'stale-or-invalid-addition-pin',
        vendorId: pin.vendor_id,
        customerId: pin.customer_id,
        agreementId: pin.agreement_id,
        externalAccountId: pin.source_account_id || undefined,
        vendorProductKey: pin.vendor_product_key,
        targetProductCodes: [pin.connectwise_product_code],
        connectWiseAdditionIds: [pin.connectwise_addition_id],
        detail:
          'An active vendor-product pin points to a missing/inactive addition or to an addition outside the pinned customer, agreement, or product code.',
      });
    }
  }

  for (const override of input.overrides.filter((row) => row.active)) {
    const targetMappings =
      mappingTargets.get(`${override.vendor_id}\u0001${canonicalProductKey(override.target_vendor_product_key)}`) ?? [];
    const fallbackRule = findFallbackRule(override.vendor_id, canonicalProductKey(override.target_vendor_product_key));
    if (targetMappings.length === 0 && !fallbackRule && !override.target_product_code) {
      exceptions.push({
        severity: 'high',
        issueType: 'usage-override-target-unmapped',
        vendorId: override.vendor_id,
        customerId: override.customer_id ?? undefined,
        agreementId: override.agreement_id ?? undefined,
        vendorProductKey: override.source_vendor_product_key,
        detail:
          `The active usage override redirects to "${override.target_vendor_product_key}", which has no approved mapping, fallback rule, or explicit target product code.`,
      });
    }
  }

  for (const mapping of activeApprovedAccountMappings) {
    if (!mapping.agreement_id) continue;
    const observedCodes =
      observedTargetCodesByScope.get(
        `${mapping.vendor_id}\u0001${mapping.customer_id}\u0001${mapping.agreement_id}`,
      ) ?? new Set<string>();
    const vendorTargetCodes = new Set(
      activeApprovedProductMappings
        .filter((productMapping) => productMapping.vendor_id === mapping.vendor_id)
        .map((productMapping) => normalize(productMapping.connectwise_product_code)),
    );
    for (const addition of additionsByAgreement.get(mapping.agreement_id) ?? []) {
      const additionCode = normalize(addition.product_code);
      if (
        numberValue(addition.quantity) > 0 &&
        vendorTargetCodes.has(additionCode) &&
        !observedCodes.has(additionCode)
      ) {
        const reportKey = `${mapping.vendor_id}\u0001${mapping.agreement_id}\u0001${addition.connectwise_addition_id}`;
        if (reportedConnectWiseOnlyAdditions.has(reportKey)) continue;
        reportedConnectWiseOnlyAdditions.add(reportKey);
        exceptions.push({
          severity: 'high',
          issueType: 'connectwise-addition-has-no-vendor-product',
          vendorId: mapping.vendor_id,
          customerId: mapping.customer_id,
          customerName: mapping.customer_name ?? undefined,
          agreementId: mapping.agreement_id,
          agreementName: mapping.agreement_name ?? undefined,
          externalAccountId: mapping.external_account_id,
          quantity: numberValue(addition.quantity),
          targetProductCodes: [addition.product_code],
          connectWiseAdditionIds: [addition.connectwise_addition_id],
          detail:
            'An active ConnectWise addition uses a product mapped to this vendor, but the selected vendor source has no corresponding product for the customer/agreement.',
        });
      }
    }
  }

  const integrationSummaries = input.integrations.map((integration) => {
    const vendorId = integration.integration_id;
    const selectedRun = input.latestRuns[vendorId];
    const latestAnyRun = input.latestAnyRuns[vendorId];
    const vendorRows = input.sourceRows.filter((row) => row.vendor_id === vendorId);
    const vendorExceptions = exceptions.filter((row) => row.vendorId === vendorId);
    const settings = recordFromJson(integration.non_secret_settings);
    return {
      vendorId,
      displayName: integration.display_name,
      configuredStatus: integration.configured_status,
      lastTestResult: integration.last_test_result,
      lastTestedAt: isoDate(integration.last_tested_at),
      enableApiSync: booleanValue(settings.enableApiSync),
      reconcileMode:
        stringValue(settings[psaAgreementReconcileModeSettingKey]) || 'merge-multiple-products',
      doNotSuggestNewAdditions: booleanValue(settings[doNotSuggestNewAdditionsSettingKey]),
      selectedRun: selectedRun ? summarizeRun(selectedRun) : null,
      latestRun: latestAnyRun ? summarizeRun(latestAnyRun) : null,
      selectedRows: vendorRows.length,
      selectedAccounts: unique(vendorRows.map((row) => row.external_account_id).filter(isString)).length,
      selectedCustomers: unique(vendorRows.map((row) => row.effective_customer_id).filter(isString)).length,
      observedProductKeys: [...(observedKeysByVendor.get(vendorId) ?? new Set<string>())].sort(),
      approvedProductMappings: activeApprovedProductMappings.filter((row) => row.vendor_id === vendorId).length,
      approvedAccountMappings: activeApprovedAccountMappings.filter((row) => row.vendor_id === vendorId).length,
      exceptions: severityCounts(vendorExceptions),
      recentRunOperations: input.recentRuns[vendorId]
        .filter((run) => run.status === 'complete')
        .map((run) => ({
          id: run.id,
          completedAt: isoDate(run.completed_at),
          discriminator: runDiscriminator(run),
          recordsWritten: numberValue(run.records_written),
        })),
    };
  });

  for (const integration of integrationSummaries) {
    if (integration.configuredStatus === 'degraded') {
      exceptions.push({
        severity: 'high',
        issueType: 'configured-integration-degraded',
        vendorId: integration.vendorId,
        detail:
          `The integration is configured but degraded (last test result: ${integration.lastTestResult}). Structural conclusions may be incomplete until connectivity is healthy.`,
      });
    }
    if (!integration.selectedRun || integration.selectedRows === 0) {
      exceptions.push({
        severity: 'high',
        issueType: 'no-reconcilable-vendor-source',
        vendorId: integration.vendorId,
        detail:
          integration.selectedRun
            ? `The source selector chose a completed "${integration.selectedRun.discriminator}" run, but it contains no vendor_usage_snapshots. Its specialized data is not available to the generic ConnectWise agreement-addition reconciliation flow.`
            : 'The integration is configured for mapping but the reconciliation source selector found no completed reconcilable sync run. Its customer products cannot currently be compared with ConnectWise additions in the generic reconciliation flow.',
      });
    }
    integration.exceptions = severityCounts(
      exceptions.filter((row) => row.vendorId === integration.vendorId),
    );
  }

  const sortedExceptions = exceptions.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.vendorId.localeCompare(right.vendorId) ||
      (left.customerName ?? '').localeCompare(right.customerName ?? '') ||
      left.issueType.localeCompare(right.issueType),
  );

  const productMappingDefinitions = [...mappingTargets.entries()]
    .map(([key, rows]) => {
      const [vendorId, vendorProductKey] = key.split('\u0001');
      return {
        vendorId,
        vendorProductKey,
        targetProductCodes: unique(rows.map((row) => row.connectwise_product_code)),
        targetProductNames: unique(rows.map((row) => row.connectwise_product_name)),
        mappingSources: unique(rows.map((row) => row.mapping_source)),
        confidences: unique(rows.map((row) => row.confidence)),
        observedCustomerCount: unique(
          input.sourceRows
            .filter(
              (row) =>
                row.vendor_id === vendorId &&
                canonicalProductKey(row.vendor_product_key ?? '') === vendorProductKey,
            )
            .map((row) => row.effective_customer_id)
            .filter(isString),
        ).length,
      };
    })
    .sort(
      (left, right) =>
        left.vendorId.localeCompare(right.vendorId) ||
        left.vendorProductKey.localeCompare(right.vendorProductKey),
    );

  return {
    collectedAt: input.collectedAt,
    auditMode: 'PostgreSQL repeatable-read, read-only transaction',
    appRiverProgress: input.appRiverProgress,
    summary: {
      configuredIntegrationCount: input.integrations.length,
      sourceRowCount: input.sourceRows.length,
      customerExceptionCount: unique(
        sortedExceptions
          .filter((row) => row.customerId || row.externalAccountId)
          .map((row) => `${row.vendorId}|${row.customerId ?? row.externalAccountId}`),
      ).length,
      exceptionCount: sortedExceptions.length,
      severities: severityCounts(sortedExceptions),
      issueTypes: countBy(sortedExceptions, (row) => row.issueType),
    },
    integrations: integrationSummaries,
    productMappingDefinitions,
    exceptions: sortedExceptions,
  };
}

function writeResult(result: ReturnType<typeof buildAudit>) {
  const args = parseArgs(process.argv.slice(2));
  const exceptions = result.exceptions.filter(
    (row) =>
      (!args.vendor || row.vendorId === args.vendor) &&
      (!args.issue || row.issueType === args.issue) &&
      (!args.severity || row.severity === args.severity),
  );

  if (args.format === 'csv') {
    const columns: Array<keyof AuditException> = [
      'severity',
      'issueType',
      'vendorId',
      'customerName',
      'customerId',
      'agreementName',
      'agreementId',
      'externalAccountId',
      'vendorAccountName',
      'vendorProductKey',
      'vendorProductName',
      'quantity',
      'targetProductCodes',
      'connectWiseAdditionIds',
      'connectWiseProductCodes',
      'suggestedCandidate',
      'detail',
    ];
    process.stdout.write(`${columns.join(',')}\n`);
    for (const row of exceptions) {
      process.stdout.write(
        `${columns
          .map((column) => {
            const value = row[column];
            return csvValue(Array.isArray(value) ? value.join(' | ') : value);
          })
          .join(',')}\n`,
      );
    }
    return;
  }

  if (args.format === 'summary') {
    process.stdout.write(
      `${JSON.stringify(
        {
          collectedAt: result.collectedAt,
          auditMode: result.auditMode,
          appRiverProgress: result.appRiverProgress,
          summary: {
            ...result.summary,
            filteredExceptionCount: exceptions.length,
          },
          integrations: result.integrations,
          productMappingDefinitions: result.productMappingDefinitions,
          exceptionGroups: Object.entries(countBy(exceptions, (row) => `${row.vendorId}|${row.issueType}`)).map(
            ([key, count]) => {
              const [vendorId, issueType] = key.split('|');
              return { vendorId, issueType, count };
            },
          ),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      args.vendor || args.issue || args.severity
        ? {
            collectedAt: result.collectedAt,
            filters: args,
            exceptionCount: exceptions.length,
            exceptions,
          }
        : result,
      null,
      2,
    )}\n`,
  );
}

function parseArgs(args: string[]) {
  const values = new Map(
    args.flatMap((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return key ? [[key, rest.join('=')]] : [];
    }),
  );
  const format = values.get('format');
  const severity = values.get('severity');
  return {
    format: format === 'csv' || format === 'summary' ? format : 'json',
    vendor: values.get('vendor') || undefined,
    issue: values.get('issue') || undefined,
    severity:
      severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low'
        ? severity
        : undefined,
  };
}

function csvValue(value: unknown) {
  if (value === null || typeof value === 'undefined') return '';
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function loadAppRiverProgress(client: {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}) {
  const runResult = await client.query<SyncRunRow>(
    `select id,
            integration_id,
            started_at,
            completed_at,
            status,
            records_read,
            records_written,
            error_message,
            metadata
     from sync_runs
     where integration_id = 'opentext-appriver'
     order by started_at desc
     limit 1`,
  );
  const run = runResult.rows[0];
  if (!run) return null;

  const workResult = await client.query<{
    status: string;
    count: number | string;
    mapped_snapshots: number | string;
    unmapped_snapshots: number | string;
    failed_subscriptions: number | string;
  }>(
    `select status,
            count(*)::int as count,
            coalesce(sum(mapped_snapshots), 0)::int as mapped_snapshots,
            coalesce(sum(unmapped_snapshots), 0)::int as unmapped_snapshots,
            coalesce(sum(failed_subscriptions), 0)::int as failed_subscriptions
     from appriver_sync_work_items
     where sync_run_id = $1::uuid
     group by status
     order by status`,
    [run.id],
  );
  const failedResult = await client.query<{
    external_customer_id: string;
    customer_name: string | null;
    error_message: string | null;
  }>(
    `select external_customer_id, customer_name, error_message
     from appriver_sync_work_items
     where sync_run_id = $1::uuid
       and status = 'failed'
     order by customer_name nulls last, external_customer_id`,
    [run.id],
  );
  return {
    run: summarizeRun(run),
    workItems: workResult.rows.map((row) => ({
      status: row.status,
      count: numberValue(row.count),
      mappedSnapshots: numberValue(row.mapped_snapshots),
      unmappedSnapshots: numberValue(row.unmapped_snapshots),
      failedSubscriptions: numberValue(row.failed_subscriptions),
    })),
    failedItems: failedResult.rows.map((row) => ({
      externalCustomerId: row.external_customer_id,
      customerName: row.customer_name ?? undefined,
      error: row.error_message ?? undefined,
    })),
  };
}

function findFallbackRule(vendorId: string, vendorProductKey: string): QuantityRule | undefined {
  const ruleSet = fallbackRuleSets.get(vendorId);
  return ruleSet?.rules.find((rule) => {
    const keys = [rule.vendorProductKey, ...(rule.vendorProductKeys ?? [])]
      .filter(isString)
      .map(canonicalProductKey);
    return keys.includes(canonicalProductKey(vendorProductKey));
  });
}

function closestAddition(productName: string, targetCodes: string[], additions: AdditionRow[]) {
  const candidates = additions
    .map((addition) => ({
      addition,
      score: Math.max(
        tokenSimilarity(productName, addition.product_name),
        ...targetCodes.map((code) => tokenSimilarity(code, addition.product_code)),
      ),
    }))
    .filter((candidate) => candidate.score >= 0.25)
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return best
    ? `${best.addition.product_name} [${best.addition.product_code}] (similarity ${best.score.toFixed(2)})`
    : undefined;
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeTokens(left));
  const rightTokens = new Set(normalizeTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : overlap / union;
}

function normalizeTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function groupBy<T>(values: T[], keyFor: (value: T) => string) {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function countBy<T>(values: T[], keyFor: (value: T) => string) {
  return Object.fromEntries(
    [...groupBy(values, keyFor).entries()]
      .map(([key, rows]) => [key, rows.length] as const)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function severityCounts(values: AuditException[]) {
  return {
    critical: values.filter((row) => row.severity === 'critical').length,
    high: values.filter((row) => row.severity === 'high').length,
    medium: values.filter((row) => row.severity === 'medium').length,
    low: values.filter((row) => row.severity === 'low').length,
  };
}

function severityRank(value: AuditException['severity']) {
  return value === 'critical' ? 0 : value === 'high' ? 1 : value === 'medium' ? 2 : 3;
}

function summarizeRun(run: SyncRunRow) {
  return {
    id: run.id,
    status: run.status,
    startedAt: isoDate(run.started_at),
    completedAt: isoDate(run.completed_at),
    recordsRead: numberValue(run.records_read),
    recordsWritten: numberValue(run.records_written),
    error: run.error_message ?? undefined,
    discriminator: runDiscriminator(run),
  };
}

function runDiscriminator(run: SyncRunRow) {
  const metadata = recordFromJson(run.metadata);
  return (
    stringValue(metadata.operationKey) ||
    stringValue(metadata.dataset) ||
    stringValue(metadata.entity) ||
    stringValue(metadata.sourceType) ||
    stringValue(metadata.source) ||
    'unspecified'
  );
}

function recordFromJson(value: JsonRecord | string | null | undefined): JsonRecord {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

function sourceAccountName(dimensions: JsonRecord[]) {
  const candidateKeys = [
    'customerName',
    'appRiverCustomerName',
    'externalAccountName',
    'organizationName',
    'siteName',
    'tenantName',
    'companyName',
    'clientName',
    'domain',
  ];
  for (const key of candidateKeys) {
    for (const row of dimensions) {
      const value = stringValue(row[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function booleanValue(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalProductKey(value: string) {
  return value.trim().replace(/%2f/gi, '/');
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function inactiveStatus(value: string | null) {
  return /expired|cancelled|canceled|inactive|deleted/i.test(value ?? '');
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
