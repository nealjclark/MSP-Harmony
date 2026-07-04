import { reconcileVendorUsage } from '../shared/reconciliation';
import type {
  AgreementAddition,
  DimensionMap,
  DimensionValue,
  MoneyAmount,
  QuantityRule,
  ReconciliationLine,
  ReconciliationResult,
  UsageSnapshot,
  VendorRuleSet,
} from '../shared/types';
import type { ReconciliationAdjustment } from './reconciliationAdjustments';
import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import { getVendorRuleSet } from './reconciliation';
import { loadCoveRuleSet, type Queryable } from '../vendor/cove/operations';
import { loadDattoRuleSet } from '../vendor/datto/operations';
import { loadNcentralRuleSet } from '../vendor/ncentral/operations';
import { loadMicrosoft365RuleSet } from '../vendor/microsoft365/operations';
import { loadAppRiverRuleSet } from '../vendor/appriver/operations';
import { listProductBundles, type ProductBundle } from '../mapping/mappingService';
import {
  invoiceQuantityKey,
  loadLatestInvoiceQuantitiesForLines,
  type InvoiceImportSummary,
  type InvoiceQuantity,
} from '../invoices/appriverInvoiceImports';

export type ReconcileVendorFromDatabaseOptions = {
  syncRunId?: string;
};

type SyncRunRow = {
  id: string;
};

type SnapshotRow = {
  id: string;
  vendor_id: string;
  customer_id: string;
  agreement_id: string;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
};

type AdditionRow = {
  id: string;
  customer_id: string;
  agreement_id: string;
  source_agreement_name?: string | null;
  source_connectwise_agreement_id?: string | null;
  connectwise_addition_id?: string;
  product_code: string;
  product_name: string;
  quantity: string | number;
  unit_price: string | number | null;
  addition_status?: string;
  updated_at: Date | string | null;
  raw_payload?: unknown;
};

type LineLabelRow = {
  customer_id: string;
  customer_name: string;
  connectwise_company_id: string;
  agreement_id: string;
  agreement_name: string;
  connectwise_agreement_id: string;
};

type UsageOverrideRow = {
  id: string;
  customer_id: string | null;
  agreement_id: string | null;
  source_vendor_product_key: string;
  target_vendor_product_key: string;
  target_product_code: string | null;
  target_product_name: string | null;
  dimension_filters: unknown;
  target_dimensions: unknown;
  reason: string | null;
};

type GenericRuleMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

type UsageOverride = {
  id: string;
  customerId?: string;
  agreementId?: string;
  sourceVendorProductKey: string;
  targetVendorProductKey: string;
  targetProductCode?: string;
  targetProductName?: string;
  dimensionFilters: DimensionMap;
  targetDimensions: DimensionMap;
  reason?: string;
};

export type DatabaseReconciliationLine = ReconciliationLine & {
  customerName?: string;
  agreementName?: string;
  connectWiseCompanyId?: string;
  connectWiseAgreementId?: string;
  invoiceQuantity?: number;
  invoiceLineCount?: number;
  invoiceImportId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  matchedAgreementAdditions: ReconciliationLineAgreementAddition[];
  devices: DatabaseReconciliationDevice[];
  adjustments?: ReconciliationAdjustment[];
};

export type ReconciliationLineAgreementAddition = {
  id: string;
  agreementId?: string;
  agreementName?: string;
  connectWiseAgreementId?: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: MoneyAmount;
  lessIncluded?: number;
  billedQuantity?: number;
  additionStatus?: string;
  updatedAt?: string;
};

type LoadedAgreementAddition = AgreementAddition & ReconciliationLineAgreementAddition;

export type DatabaseReconciliationDevice = {
  id: string;
  vendorProductKey?: string;
  productCode: string;
  productName: string;
  quantity: number;
  observedAt: string;
  dimensions: DimensionMap;
};

export type ReconciliationProductOption = {
  vendorProductKey: string;
  productCode: string;
  productName: string;
};

export type DatabaseReconciliationResult = Omit<ReconciliationResult, 'lines'> & {
  lines: DatabaseReconciliationLine[];
  syncRunId?: string;
  snapshotCount: number;
  agreementAdditionCount: number;
  latestInvoice?: InvoiceImportSummary;
  productOptions: ReconciliationProductOption[];
};

export type ActiveAgreementAddition = {
  id: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: MoneyAmount;
  unitCost?: number;
  lessIncluded?: number;
  billedQuantity?: number;
  billCustomer?: string;
  effectiveDate?: string;
  taxableFlag?: string;
  invoiceDescription?: string;
  purchaseItemFlag?: string;
  specialOrderFlag?: string;
  uom?: string;
  extPrice?: number;
  extCost?: number;
  sequenceNumber?: number;
  margin?: number;
  prorateCost?: number;
  proratePrice?: number;
  extendedProrateCost?: number;
  extendedProratePrice?: number;
  prorateCurrentPeriodFlag?: string;
  description?: string;
  additionStatus: string;
  updatedAt?: string;
};

export async function reconcileVendorFromDatabase(
  database: Queryable,
  vendorId: string,
  options: ReconcileVendorFromDatabaseOptions = {},
): Promise<DatabaseReconciliationResult> {
  const syncRunId = options.syncRunId ?? (await loadLatestSyncRunId(database, vendorId));
  const ruleSet = await loadRuleSet(database, vendorId);

  if (!syncRunId) {
    const emptyResult = reconcileVendorUsage({
      vendorId,
      rules: ruleSet.rules,
      snapshots: [],
      agreementAdditions: [],
    });
    const invoiceState = await loadLatestInvoiceQuantitiesForLines(database, vendorId as IntegrationId, []);

    return {
      ...emptyResult,
      lines: [],
      syncRunId,
      snapshotCount: 0,
      agreementAdditionCount: 0,
      latestInvoice: invoiceState.latestInvoice,
      productOptions: productOptionsForRuleSet(ruleSet),
    };
  }

  const loadedSnapshots = await loadUsageSnapshots(database, vendorId, syncRunId);
  const overriddenSnapshots = applyUsageOverrides(
    loadedSnapshots,
    await loadUsageOverrides(database, vendorId, loadedSnapshots),
    ruleSet,
  );
  const agreementAdditions = await loadAgreementAdditions(database, overriddenSnapshots);
  const snapshots = applyProductBundles(
    overriddenSnapshots,
    await listProductBundles(database, vendorId as IntegrationId),
    agreementAdditions,
  );
  const result = reconcileVendorUsage({
    vendorId,
    rules: ruleSet.rules,
    snapshots,
    agreementAdditions,
  });
  const invoiceState = await loadLatestInvoiceQuantitiesForLines(database, vendorId as IntegrationId, result.lines);

  return {
    ...result,
    totals: totalsForLines(result.lines),
    lines: await withLineDetails(database, result.lines, snapshots, agreementAdditions, ruleSet, invoiceState.quantities),
    syncRunId,
    snapshotCount: snapshots.length,
    agreementAdditionCount: agreementAdditions.length,
    latestInvoice: invoiceState.latestInvoice,
    productOptions: productOptionsForRuleSet(ruleSet),
  };
}

export async function listActiveAgreementAdditions(
  database: Queryable,
  agreementId: string,
): Promise<ActiveAgreementAddition[]> {
  const result = await database.query<AdditionRow>(
    `select
       agreement_additions.id,
       agreement_additions.connectwise_addition_id,
       agreement_additions.product_code,
       agreement_additions.product_name,
       agreement_additions.quantity,
       agreement_additions.unit_price,
       agreement_additions.addition_status,
       agreement_additions.updated_at,
       agreement_additions.raw_payload
      from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where agreement_additions.agreement_id = $1::uuid
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     order by agreement_additions.product_name, agreement_additions.product_code, agreement_additions.connectwise_addition_id`,
    [agreementId],
  );

  return result.rows.map(mapActiveAgreementAdditionRow);
}

function totalsForLines(lines: ReconciliationLine[]) {
  return lines.reduce(
    (summary, line) => {
      if (line.status === 'matched') summary.matched += 1;
      if (line.status === 'needs-review') summary.needsReview += 1;
      if (line.status === 'not-billable') summary.notBillable += 1;
      if (line.status === 'unmapped') summary.unmapped += 1;
      summary.financialImpact.amount += line.financialImpact.amount;
      return summary;
    },
    {
      matched: 0,
      needsReview: 0,
      notBillable: 0,
      unmapped: 0,
      financialImpact: {
        amount: 0,
        currency: 'USD' as const,
      },
    },
  );
}

async function loadRuleSet(database: Queryable, vendorId: string): Promise<VendorRuleSet> {
  if (vendorId === 'cove') {
    return loadCoveRuleSet(database);
  }

  if (vendorId === 'ncentral') {
    return loadNcentralRuleSet(database);
  }

  if (vendorId === 'datto') {
    return loadDattoRuleSet(database);
  }

  if (vendorId === 'microsoft-365') {
    return loadMicrosoft365RuleSet(database);
  }

  if (vendorId === 'opentext-appriver') {
    return loadAppRiverRuleSet(database);
  }

  const ruleSet = getVendorRuleSet(vendorId);
  if (!ruleSet) {
    return loadMappedInvoiceRuleSet(database, vendorId);
  }

  return ruleSet;
}

async function loadMappedInvoiceRuleSet(database: Queryable, vendorId: string): Promise<VendorRuleSet> {
  const result = await database.query<GenericRuleMappingRow>(
    `select vendor_product_key,
            target_index,
            connectwise_product_code,
            connectwise_product_name,
            unit_price
       from vendor_product_mappings
      where vendor_id = $1
        and active = true
        and mapping_status = 'approved'
      order by vendor_product_key, target_index, connectwise_product_code`,
    [vendorId],
  );
  const displayName = getIntegrationSettingsDefinition(vendorId as IntegrationId)?.displayName ?? vendorId;
  const rules = result.rows.map((row) => ({
    id: `${vendorId}:${row.vendor_product_key}:${row.connectwise_product_code}:invoice-count`,
    vendorId,
    vendorProductKey: row.vendor_product_key,
    productCode: row.connectwise_product_code,
    productName: row.connectwise_product_name,
    sourceMetric: 'snapshot-count' as const,
    billableUnit: 'license' as const,
    unitPrice:
      row.unit_price === null
        ? undefined
        : {
            amount: numericValue(row.unit_price),
            currency: 'USD' as const,
          },
    notes: `${displayName} invoice table quantity for ${row.connectwise_product_name}.`,
  }));

  return {
    vendorId,
    vendorName: displayName,
    rules,
  };
}

async function loadLatestSyncRunId(database: Queryable, vendorId: string) {
  const result = await database.query<SyncRunRow>(
    `select id
     from sync_runs
     where integration_id = $1
       and status = 'complete'
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [vendorId],
  );

  return result.rows[0]?.id;
}

async function loadUsageSnapshots(database: Queryable, vendorId: string, syncRunId: string | undefined) {
  const result = await database.query<SnapshotRow>(
    `with approved_account_mappings as (
       select vendor_id,
              external_account_id,
              customer_id,
              agreement_id
       from vendor_account_mappings
       where vendor_id = $1
         and active = true
         and mapping_status = 'approved'
     ),
     approved_product_mappings as (
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
     )
     select
       vendor_usage_snapshots.id,
       vendor_usage_snapshots.vendor_id,
       case
         when approved_account_mappings.external_account_id is not null then approved_account_mappings.customer_id
         else vendor_usage_snapshots.customer_id
       end as customer_id,
       case
         when approved_account_mappings.external_account_id is not null then approved_account_mappings.agreement_id
       else vendor_usage_snapshots.agreement_id
       end as agreement_id,
       vendor_usage_snapshots.external_account_id,
       vendor_usage_snapshots.vendor_product_key,
       coalesce(approved_product_mappings.connectwise_product_code, vendor_usage_snapshots.product_code) as product_code,
       coalesce(approved_product_mappings.connectwise_product_name, vendor_usage_snapshots.product_name) as product_name,
       vendor_usage_snapshots.quantity,
       vendor_usage_snapshots.observed_at,
       vendor_usage_snapshots.dimensions
     from vendor_usage_snapshots
     left join approved_account_mappings
       on approved_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
      and approved_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
     left join approved_product_mappings
       on approved_product_mappings.vendor_id = vendor_usage_snapshots.vendor_id
      and approved_product_mappings.vendor_product_key = vendor_usage_snapshots.vendor_product_key
     where vendor_usage_snapshots.vendor_id = $1
       and case
         when approved_account_mappings.external_account_id is not null then approved_account_mappings.customer_id
         else vendor_usage_snapshots.customer_id
       end is not null
       and case
         when approved_account_mappings.external_account_id is not null then approved_account_mappings.agreement_id
         else vendor_usage_snapshots.agreement_id
       end is not null
       and ($2::uuid is null or vendor_usage_snapshots.sync_run_id = $2::uuid)
     order by customer_id, agreement_id, product_code, vendor_usage_snapshots.observed_at`,
    [vendorId, syncRunId ?? null],
  );

  return result.rows.map(mapSnapshotRow);
}

async function loadUsageOverrides(database: Queryable, vendorId: string, snapshots: UsageSnapshot[]) {
  if (snapshots.length === 0) {
    return [];
  }

  const customerIds = [...new Set(snapshots.map((snapshot) => snapshot.clientId))];
  const agreementIds = [...new Set(snapshots.map((snapshot) => snapshot.agreementId))];
  const result = await database.query<UsageOverrideRow>(
    `select
       id,
       customer_id,
       agreement_id,
       source_vendor_product_key,
       target_vendor_product_key,
       target_product_code,
       target_product_name,
       dimension_filters,
       target_dimensions,
       reason
     from vendor_usage_overrides
     where vendor_id = $1
       and active = true
       and (customer_id is null or customer_id = any($2::uuid[]))
       and (agreement_id is null or agreement_id = any($3::uuid[]))
     order by customer_id nulls last, agreement_id nulls last, created_at, id`,
    [vendorId, customerIds, agreementIds],
  );

  return result.rows.map(mapUsageOverrideRow);
}

function applyUsageOverrides(
  snapshots: UsageSnapshot[],
  overrides: UsageOverride[],
  ruleSet: VendorRuleSet,
): UsageSnapshot[] {
  if (overrides.length === 0) {
    return snapshots;
  }

  const rulesByVendorProductKey = new Map(
    ruleSet.rules
      .filter((rule): rule is QuantityRule & { vendorProductKey: string } => Boolean(rule.vendorProductKey))
      .map((rule) => [rule.vendorProductKey, rule]),
  );

  return snapshots.map((snapshot) => {
    const override = overrides.find((candidate) => usageOverrideMatches(snapshot, candidate));
    if (!override) {
      return snapshot;
    }

    const targetRule = rulesByVendorProductKey.get(override.targetVendorProductKey);
    const targetDimensions = {
      ...(targetRule?.dimensions ?? {}),
      ...override.targetDimensions,
    };

    return {
      ...snapshot,
      vendorProductKey: override.targetVendorProductKey,
      productCode: override.targetProductCode ?? targetRule?.productCode ?? snapshot.productCode,
      productName: override.targetProductName ?? targetRule?.productName ?? snapshot.productName,
      dimensions: {
        ...snapshot.dimensions,
        ...targetDimensions,
        usageOverrideId: override.id,
        usageOverrideReason: override.reason,
        originalVendorProductKey: snapshot.vendorProductKey,
        originalProductCode: snapshot.productCode,
      },
    };
  });
}

function applyProductBundles(
  snapshots: UsageSnapshot[],
  bundles: ProductBundle[],
  agreementAdditions: AgreementAddition[],
): UsageSnapshot[] {
  const activeBundles = bundles.filter(
    (bundle) => bundle.active && bundle.status === 'approved' && bundle.components.length > 0,
  );
  if (activeBundles.length === 0 || snapshots.length === 0) {
    return snapshots;
  }

  const bundledSnapshots: UsageSnapshot[] = [];
  const bundledSourceSnapshotIds = new Set<string>();

  for (const bundle of activeBundles) {
    const componentKeys = new Set(bundle.components.map((component) => component.vendorProductKey));
    const groups = new Map<
      string,
      {
        clientId: string;
        agreementId: string;
        externalAccountId: string;
        observedAt: string;
        componentTotals: Map<string, number>;
        sourceSnapshotIds: string[];
      }
    >();

    for (const snapshot of snapshots) {
      if (!snapshot.vendorProductKey || !componentKeys.has(snapshot.vendorProductKey)) {
        continue;
      }

      const externalAccountId = snapshotExternalAccountId(snapshot);
      const groupKey = `${snapshot.clientId}|${snapshot.agreementId}|${externalAccountId}`;
      const group =
        groups.get(groupKey) ??
        {
          clientId: snapshot.clientId,
          agreementId: snapshot.agreementId,
          externalAccountId,
          observedAt: snapshot.observedAt,
          componentTotals: new Map<string, number>(),
          sourceSnapshotIds: [],
        };
      group.componentTotals.set(
        snapshot.vendorProductKey,
        (group.componentTotals.get(snapshot.vendorProductKey) ?? 0) + snapshot.quantity,
      );
      group.sourceSnapshotIds.push(snapshot.id);
      if (snapshot.observedAt > group.observedAt) {
        group.observedAt = snapshot.observedAt;
      }
      groups.set(groupKey, group);
    }

    for (const [groupKey, group] of groups.entries()) {
      if (!hasAgreementAddition(agreementAdditions, group.clientId, group.agreementId, bundle.target.connectwiseProductCode)) {
        continue;
      }

      const quantity = Math.max(...group.componentTotals.values(), 0);
      bundledSnapshots.push({
        id: `${bundle.id}:${groupKey}`,
        vendorId: bundle.vendorId,
        clientId: group.clientId,
        agreementId: group.agreementId,
        vendorProductKey: bundle.bundleKey,
        productCode: bundle.target.connectwiseProductCode,
        productName: bundle.target.connectwiseProductName,
        quantity,
        observedAt: group.observedAt,
        dimensions: {
          subscriptionSource: 'appriver-securecloud-subscription',
          appRiverBundle: true,
          appRiverBundleKey: bundle.bundleKey,
          appRiverBundleName: bundle.bundleName,
          appRiverBundleQuantityStrategy: bundle.quantityStrategy,
          appRiverBundleComponentCount: bundle.components.length,
          appRiverBundleComponentQuantities: componentQuantitySummary(group.componentTotals),
          appRiverBundleSourceSnapshotIds: group.sourceSnapshotIds.join(','),
          appRiverCustomerId: group.externalAccountId,
        },
      });
      group.sourceSnapshotIds.forEach((snapshotId) => bundledSourceSnapshotIds.add(snapshotId));
    }
  }

  return [
    ...snapshots.filter((snapshot) => !bundledSourceSnapshotIds.has(snapshot.id)),
    ...bundledSnapshots,
  ];
}

async function loadAgreementAdditions(database: Queryable, snapshots: UsageSnapshot[]) {
  const customerIds = [...new Set(snapshots.map((snapshot) => snapshot.clientId))];
  if (customerIds.length === 0) {
    return [];
  }

  const result = await database.query<AdditionRow>(
    `select
       agreement_additions.id,
       agreement_additions.customer_id,
       agreement_additions.agreement_id,
       agreements.name as source_agreement_name,
       agreements.connectwise_agreement_id as source_connectwise_agreement_id,
       agreement_additions.connectwise_addition_id,
       agreement_additions.product_code,
       agreement_additions.product_name,
       agreement_additions.quantity,
       agreement_additions.unit_price,
       agreement_additions.addition_status,
       agreement_additions.updated_at,
       agreement_additions.raw_payload
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where agreement_additions.customer_id = any($1::uuid[])
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'`,
    [customerIds],
  );

  return result.rows.map(mapAdditionRow);
}

async function withLineDetails(
  database: Queryable,
  lines: ReconciliationLine[],
  snapshots: UsageSnapshot[],
  agreementAdditions: LoadedAgreementAddition[],
  ruleSet: VendorRuleSet,
  invoiceQuantities: Map<string, InvoiceQuantity>,
): Promise<DatabaseReconciliationLine[]> {
  if (lines.length === 0) {
    return [];
  }

  const customerIds = [...new Set(lines.map((line) => line.clientId))];
  const agreementIds = [...new Set(lines.map((line) => line.agreementId))];
  const result = await database.query<LineLabelRow>(
    `select
       customers.id as customer_id,
       customers.name as customer_name,
       customers.connectwise_company_id,
       agreements.id as agreement_id,
       agreements.name as agreement_name,
       agreements.connectwise_agreement_id
     from agreements
     inner join customers
       on customers.id = agreements.customer_id
     where customers.id = any($1::uuid[])
        or agreements.id = any($2::uuid[])`,
    [customerIds, agreementIds],
  );

  const labelsByLineKey = new Map(
    result.rows.map((row) => [
      `${row.customer_id}|${row.agreement_id}`,
      {
        customerName: row.customer_name,
        agreementName: row.agreement_name,
        connectWiseCompanyId: row.connectwise_company_id,
        connectWiseAgreementId: row.connectwise_agreement_id,
      },
    ]),
  );
  return lines.map((line) => ({
    ...line,
    ...labelsByLineKey.get(`${line.clientId}|${line.agreementId}`),
    ...invoiceDetailsForLine(invoiceQuantities, line),
    matchedAgreementAdditions: matchedAgreementAdditionsForLine(line, agreementAdditions, snapshots, ruleSet),
    devices: devicesForLine(line, snapshots, ruleSet),
  }));
}

function invoiceDetailsForLine(quantities: Map<string, InvoiceQuantity>, line: ReconciliationLine) {
  const quantity = quantities.get(invoiceQuantityKey(line.clientId, line.agreementId, line.productCode));
  if (!quantity) {
    return {};
  }

  return {
    invoiceQuantity: quantity.invoiceQuantity,
    invoiceLineCount: quantity.invoiceLineCount,
    invoiceImportId: quantity.invoiceImportId,
    invoiceNumber: quantity.invoiceNumber,
    invoiceDate: quantity.invoiceDate,
  };
}

function devicesForLine(line: ReconciliationLine, snapshots: UsageSnapshot[], ruleSet: VendorRuleSet) {
  const rule = ruleSet.rules.find((candidate) => candidate.id === line.ruleId);

  return snapshots
    .filter(
      (snapshot) =>
        snapshot.clientId === line.clientId &&
        snapshot.agreementId === line.agreementId &&
        (line.lineType === 'unmapped-vendor'
          ? snapshotMatchesUnmappedLine(snapshot, line)
          : !rule || snapshotMatchesRule(snapshot, rule)),
    )
    .map((snapshot) => ({
      id: snapshot.id,
      vendorProductKey: snapshot.vendorProductKey,
      productCode: snapshot.productCode,
      productName: snapshot.productName,
      quantity: snapshot.quantity,
      observedAt: snapshot.observedAt,
      dimensions: snapshot.dimensions,
    }));
}

function matchedAgreementAdditionsForLine(
  line: ReconciliationLine,
  agreementAdditions: LoadedAgreementAddition[],
  snapshots: UsageSnapshot[],
  ruleSet: VendorRuleSet,
): ReconciliationLineAgreementAddition[] {
  if (line.lineType === 'unmapped-vendor') {
    return [];
  }

  const shouldUseCustomerAgreementScope = hasSingleMappedRuleAgreement(line, snapshots, ruleSet);
  return agreementAdditions
    .filter(
      (addition) =>
        addition.clientId === line.clientId &&
        (shouldUseCustomerAgreementScope || addition.agreementId === line.agreementId) &&
        addition.productCode.trim().toLowerCase() === line.productCode.trim().toLowerCase(),
    )
    .map((addition) => ({
      id: addition.id,
      agreementId: addition.sourceAgreementId ?? addition.agreementId,
      agreementName: addition.sourceAgreementName,
      connectWiseAgreementId: addition.sourceConnectWiseAgreementId,
      connectWiseAdditionId: addition.connectWiseAdditionId,
      productCode: addition.productCode,
      productName: addition.productName,
      quantity: addition.quantity,
      unitPrice: addition.unitPrice,
      lessIncluded: addition.lessIncluded,
      billedQuantity: addition.billedQuantity,
      additionStatus: addition.additionStatus,
      updatedAt: addition.updatedAt,
    }));
}

function hasSingleMappedRuleAgreement(line: ReconciliationLine, snapshots: UsageSnapshot[], ruleSet: VendorRuleSet) {
  const rule = ruleSet.rules.find((candidate) => candidate.id === line.ruleId);
  if (!rule) {
    return false;
  }

  const agreementIds = new Set(
    snapshots
      .filter(
        (snapshot) =>
          snapshot.clientId === line.clientId &&
          snapshot.vendorId === line.vendorId &&
          snapshotMatchesRule(snapshot, rule),
      )
      .map((snapshot) => snapshot.agreementId),
  );

  return agreementIds.size === 1 && agreementIds.has(line.agreementId);
}

function snapshotMatchesUnmappedLine(snapshot: UsageSnapshot, line: ReconciliationLine) {
  return snapshot.productCode === line.productCode && snapshot.productName === line.productName;
}

function productOptionsForRuleSet(ruleSet: VendorRuleSet): ReconciliationProductOption[] {
  return ruleSet.rules
    .flatMap((rule) => ruleVendorProductKeys(rule).map((vendorProductKey) => ({
      vendorProductKey,
      productCode: rule.productCode,
      productName: rule.productName,
    })));
}

function snapshotMatchesRule(snapshot: UsageSnapshot, rule: QuantityRule) {
  const vendorProductKeys = ruleVendorProductKeys(rule);
  if (vendorProductKeys.length > 0 && snapshot.vendorProductKey) {
    return vendorProductKeys.includes(snapshot.vendorProductKey);
  }

  return targetProductCodes(rule).includes(snapshot.productCode);
}

function ruleVendorProductKeys(rule: QuantityRule) {
  return [
    ...new Set([rule.vendorProductKey, ...(rule.vendorProductKeys ?? [])].filter((key): key is string => Boolean(key))),
  ];
}

function targetProductCodes(target: { productCode: string; targetProductCodes?: string[] }) {
  return [...new Set([target.productCode, ...(target.targetProductCodes ?? [])])];
}

function mapSnapshotRow(row: SnapshotRow): UsageSnapshot {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    clientId: row.customer_id,
    agreementId: row.agreement_id,
    vendorProductKey: row.vendor_product_key ?? undefined,
    productCode: row.product_code,
    productName: row.product_name,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at) ?? new Date(0).toISOString(),
    dimensions: {
      ...recordFromJson(row.dimensions),
      snapshotId: row.id,
      externalAccountId: row.external_account_id ?? undefined,
    },
  };
}

function mapUsageOverrideRow(row: UsageOverrideRow): UsageOverride {
  return {
    id: row.id,
    customerId: row.customer_id ?? undefined,
    agreementId: row.agreement_id ?? undefined,
    sourceVendorProductKey: row.source_vendor_product_key,
    targetVendorProductKey: row.target_vendor_product_key,
    targetProductCode: row.target_product_code ?? undefined,
    targetProductName: row.target_product_name ?? undefined,
    dimensionFilters: recordFromJson(row.dimension_filters),
    targetDimensions: recordFromJson(row.target_dimensions),
    reason: row.reason ?? undefined,
  };
}

function mapAdditionRow(row: AdditionRow): LoadedAgreementAddition {
  const raw = recordFromJson(row.raw_payload);

  return {
    id: row.id,
    clientId: row.customer_id,
    agreementId: row.agreement_id,
    connectWiseAdditionId: row.connectwise_addition_id ?? row.id,
    productCode: row.product_code,
    productName: row.product_name,
    quantity: numericValue(row.quantity),
    unitPrice:
      row.unit_price === null
        ? undefined
        : {
            amount: numericValue(row.unit_price),
            currency: 'USD',
          },
    updatedAt: isoDate(row.updated_at),
    sourceAgreementId: row.agreement_id,
    sourceAgreementName: row.source_agreement_name ?? undefined,
    sourceConnectWiseAgreementId: row.source_connectwise_agreement_id ?? undefined,
    lessIncluded: optionalNumericValue(raw.lessIncluded),
    billedQuantity: optionalNumericValue(raw.billedQuantity),
    additionStatus: row.addition_status,
  };
}

function mapActiveAgreementAdditionRow(row: AdditionRow): ActiveAgreementAddition {
  const raw = recordFromJson(row.raw_payload);

  return {
    id: row.id,
    connectWiseAdditionId: row.connectwise_addition_id ?? row.id,
    productCode: row.product_code,
    productName: row.product_name,
    quantity: numericValue(row.quantity),
    unitPrice:
      row.unit_price === null
        ? undefined
        : {
            amount: numericValue(row.unit_price),
            currency: 'USD',
          },
    unitCost: optionalNumericValue(raw.unitCost),
    lessIncluded: optionalNumericValue(raw.lessIncluded),
    billedQuantity: optionalNumericValue(raw.billedQuantity),
    billCustomer: optionalStringValue(raw.billCustomer),
    effectiveDate: optionalStringValue(raw.effectiveDate),
    taxableFlag: optionalStringValue(raw.taxableFlag),
    invoiceDescription: optionalStringValue(raw.invoiceDescription),
    purchaseItemFlag: optionalStringValue(raw.purchaseItemFlag),
    specialOrderFlag: optionalStringValue(raw.specialOrderFlag),
    uom: optionalStringValue(raw.uom),
    extPrice: optionalNumericValue(raw.extPrice),
    extCost: optionalNumericValue(raw.extCost),
    sequenceNumber: optionalNumericValue(raw.sequenceNumber),
    margin: optionalNumericValue(raw.margin),
    prorateCost: optionalNumericValue(raw.prorateCost),
    proratePrice: optionalNumericValue(raw.proratePrice),
    extendedProrateCost: optionalNumericValue(raw.extendedProrateCost),
    extendedProratePrice: optionalNumericValue(raw.extendedProratePrice),
    prorateCurrentPeriodFlag: optionalStringValue(raw.prorateCurrentPeriodFlag),
    description: optionalStringValue(raw.description),
    additionStatus: row.addition_status ?? 'Active',
    updatedAt: isoDate(row.updated_at),
  };
}

function usageOverrideMatches(snapshot: UsageSnapshot, override: UsageOverride) {
  if (override.customerId && override.customerId !== snapshot.clientId) {
    return false;
  }

  if (override.agreementId && override.agreementId !== snapshot.agreementId) {
    return false;
  }

  if (override.sourceVendorProductKey !== snapshot.vendorProductKey) {
    return false;
  }

  return matchesDimensionFilters(snapshot.dimensions, override.dimensionFilters);
}

function matchesDimensionFilters(dimensions: DimensionMap, filters: DimensionMap) {
  return Object.entries(filters).every(([key, expected]) => dimensionValuesEqual(dimensions[key], expected));
}

function dimensionValuesEqual(left: DimensionValue, right: DimensionValue) {
  if (typeof left === 'number' || typeof right === 'number') {
    return Number(left) === Number(right);
  }

  return left === right;
}

function snapshotExternalAccountId(snapshot: UsageSnapshot) {
  const externalAccountId =
    snapshot.dimensions.appRiverCustomerId ??
    snapshot.dimensions.externalAccountId ??
    snapshot.dimensions.accountId ??
    snapshot.clientId;

  return typeof externalAccountId === 'string' || typeof externalAccountId === 'number'
    ? String(externalAccountId)
    : snapshot.clientId;
}

function hasAgreementAddition(
  additions: AgreementAddition[],
  clientId: string,
  agreementId: string,
  productCode: string,
) {
  return additions.some(
    (addition) =>
      addition.clientId === clientId &&
      addition.agreementId === agreementId &&
      addition.productCode === productCode,
  );
}

function componentQuantitySummary(componentTotals: Map<string, number>) {
  return [...componentTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([vendorProductKey, quantity]) => `${vendorProductKey}:${quantity}`)
    .join('; ');
}

function recordFromJson(value: unknown) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return recordFromJson(parsed);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, string | number | boolean | null | undefined>;
}

function numericValue(value: string | number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumericValue(value: string | number | boolean | null | undefined) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return undefined;
  }

  const parsed = numericValue(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalStringValue(value: string | number | boolean | null | undefined) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }

  return String(value);
}

function isoDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
