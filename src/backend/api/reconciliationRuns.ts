import { reconcileVendorUsage } from '../shared/reconciliation';
import type {
  AgreementAddition,
  DimensionMap,
  DimensionValue,
  MoneyAmount,
  QuantityRule,
  ReconciliationLinkedCount,
  ReconciliationLinkedCountSource,
  ReconciliationLine,
  ReconciliationResult,
  UsageSnapshot,
  VendorRuleSet,
} from '../shared/types';
import type { ReconciliationAdjustment } from './reconciliationAdjustments';
import { getIntegrationSettingsDefinition, integrationDoNotSuggestNewAdditions, integrationPsaAgreementReconcileMode, type IntegrationId } from '../../shared/integrationSettings';
import { crossVendorBundlesVendorId, isVendorDatapointId, isVendorKey, type VendorKey } from '../../shared/vendorDatapoints';
import { getVendorRuleSet } from './reconciliation';
import { loadAdditionPins, upsertAdditionPins } from '../mapping/additionPinService';
import { loadCoveRuleSet, type Queryable } from '../vendor/cove/operations';
import { loadDattoRuleSet } from '../vendor/datto/operations';
import { loadNcentralRuleSet } from '../vendor/ncentral/operations';
import { loadMicrosoft365RuleSet } from '../vendor/microsoft365/operations';
import { loadAppRiverRuleSet } from '../vendor/appriver/operations';
import { loadSentinelOneRuleSet } from '../vendor/sentinelone/operations';
import { loadHuntressRuleSet } from '../vendor/huntress/operations';
import {
  listProductBundles,
  listCrossVendorProductBundles,
  listProductLinkRules,
  type CrossVendorProductBundle,
  type CrossVendorBundleSource,
  type ProductBundle,
  type ProductLinkRuleAggregation,
  type ProductLinkRuleFilterNode,
  type ProductLinkRule,
  type ProductLinkRuleSource,
} from '../mapping/mappingService';
import {
  invoiceQuantityKey,
  loadLatestInvoiceQuantitiesForLines,
  type InvoiceImportSummary,
  type InvoiceQuantity,
} from '../invoices/appriverInvoiceImports';
import {
  sqlLatestReconcilableSyncRunCte,
  sqlLatestReconcilableSyncRunIdExpression,
} from '../shared/reconcilableSyncRuns';
import { billableUnitForVendorProductKey } from '../shared/vendorProductUnits';
import { normalizeProductCode } from '../shared/reconciliationProductMatching';

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

type LinkedSourceQuantityRow = {
  customer_id: string;
  agreement_id: string;
  quantity: string | number;
  row_count: string | number;
  observed_at: Date | string | null;
  dedupe_key?: string | null;
};

type LinkedTargetAdditionScopeRow = {
  customer_id: string;
  agreement_id: string;
};

type LinkedDatasetQuery = {
  values: unknown[];
  sql: string;
  fieldSet: 'vendor-usage' | 'microsoft-365-licenses';
  label: string;
};

type LinkedSqlContext = {
  fieldSet: LinkedDatasetQuery['fieldSet'];
  tableAlias: string;
  values: unknown[];
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
  if (vendorId === crossVendorBundlesVendorId) {
    return reconcileCrossVendorBundlesFromDatabase(database);
  }

  const syncRunId = options.syncRunId ?? (await loadLatestSyncRunId(database, vendorId));
  const ruleSet = await loadRuleSet(database, vendorId);
  const doNotSuggestNewAdditions = await loadDoNotSuggestNewAdditions(database, vendorId);
  const rules = doNotSuggestNewAdditions
    ? ruleSet.rules.map((rule) => ({
        ...rule,
        requiresExistingAgreementProduct: true,
      }))
    : ruleSet.rules;
  const linkedContext = await loadLinkedCountContext(
    database,
    vendorId as IntegrationId,
    { ...ruleSet, rules },
    await listProductLinkRules(database, vendorId as IntegrationId),
  );

  if (!syncRunId && linkedContext.anchorSnapshots.length === 0) {
    const emptyResult = reconcileVendorUsage({
      vendorId,
      rules,
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

  const loadedSnapshots = syncRunId ? await loadUsageSnapshots(database, vendorId, syncRunId) : [];
  const overriddenSnapshots = applyUsageOverrides(
    loadedSnapshots,
    await loadUsageOverrides(database, vendorId, loadedSnapshots),
    { ...ruleSet, rules },
  );
  const billableSnapshots = await suppressCrossVendorBundleCoveredSnapshots(database, vendorId, overriddenSnapshots);
  const agreementAdditions = await loadAgreementAdditions(database, [
    ...billableSnapshots,
    ...linkedContext.anchorSnapshots,
  ]);
  const agreementIds = [
    ...new Set(
      [...billableSnapshots, ...linkedContext.anchorSnapshots].map((snapshot) => snapshot.agreementId),
    ),
  ];
  const reconcileMode = await loadVendorReconcileMode(database, vendorId);
  const additionPins =
    reconcileMode === 'separate-multiple-products'
      ? await loadAdditionPins(database, vendorId, agreementIds)
      : [];
  const snapshots = [
    ...applyProductBundles(
      billableSnapshots,
      await listProductBundles(database, vendorId as IntegrationId),
      agreementAdditions,
    ),
    ...linkedContext.anchorSnapshots,
  ];
  const result = reconcileVendorUsage({
    vendorId,
    rules,
    snapshots,
    agreementAdditions,
    reconcileMode,
    additionPins,
  });
  if (result.pinAssignments?.length) {
    await upsertAdditionPins(database, result.pinAssignments);
  }
  const linkedLines = applyLinkedCountsToLines(result.lines, linkedContext.countsByLineKey);
  const visibleLines = doNotSuggestNewAdditions
    ? linkedLines.filter((line) => line.writeAction !== 'create-addition')
    : linkedLines;
  const invoiceState = await loadLatestInvoiceQuantitiesForLines(database, vendorId as IntegrationId, visibleLines);

  return {
    ...result,
    totals: totalsForLines(visibleLines),
    lines: await withLineDetails(database, visibleLines, snapshots, agreementAdditions, { ...ruleSet, rules }, invoiceState.quantities),
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

export async function reconcileCrossVendorBundlesFromDatabase(
  database: Queryable,
): Promise<DatabaseReconciliationResult> {
  const bundles = (await listCrossVendorProductBundles(database)).filter(
    (bundle) => bundle.active && bundle.status === 'approved' && bundle.sources.length > 0,
  );
  const generatedAt = new Date().toISOString();
  if (bundles.length === 0) {
    return {
      vendorId: crossVendorBundlesVendorId,
      generatedAt,
      lines: [],
      totals: {
        matched: 0,
        needsReview: 0,
        notBillable: 0,
        unmapped: 0,
        financialImpact: { amount: 0, currency: 'USD' },
      },
      snapshotCount: 0,
      agreementAdditionCount: 0,
      productOptions: [],
    };
  }

  const bundleProductCodes = [
    ...new Set(
      bundles.flatMap((bundle) => [
        bundle.target.connectwiseProductCode,
        ...bundle.addOns.map((addOn) => addOn.connectwiseProductCode),
      ]),
    ),
  ];
  const agreementAdditions = await loadAgreementAdditionsForProductCodes(database, bundleProductCodes);
  const rules: QuantityRule[] = [];
  const snapshots: UsageSnapshot[] = [];

  for (const bundle of bundles) {
    const baseVendorProductKey = crossVendorBundleBaseProductKey(bundle.bundleKey);
    rules.push({
      id: `${baseVendorProductKey}-count`,
      vendorId: crossVendorBundlesVendorId,
      vendorProductKey: baseVendorProductKey,
      productCode: bundle.target.connectwiseProductCode,
      productName: bundle.target.connectwiseProductName,
      sourceMetric: 'snapshot-count',
      billableUnit: 'license',
      unitPrice: moneyFromNumber(bundle.target.unitPrice),
      notes: `${bundle.bundleName} base count uses the configured cross-vendor bundle strategy.`,
    });

    for (const addOn of bundle.addOns) {
      const addOnVendorProductKey = crossVendorBundleAddOnProductKey(bundle.bundleKey, addOn.addOnKey);
      rules.push({
        id: `${addOnVendorProductKey}-count`,
        vendorId: crossVendorBundlesVendorId,
        vendorProductKey: addOnVendorProductKey,
        productCode: addOn.connectwiseProductCode,
        productName: addOn.connectwiseProductName,
        sourceMetric: 'snapshot-count',
        billableUnit: 'license',
        unitPrice: moneyFromNumber(addOn.unitPrice),
        notes: `${addOn.connectwiseProductName} is the overage add-on for ${bundle.bundleName}.`,
      });
    }

    const eligibleScopes = bundleEligibleScopes(bundle, agreementAdditions);
    if (eligibleScopes.length === 0) {
      continue;
    }

    const sourceTotals = await loadCrossVendorBundleSourceTotals(database, bundle.sources);
    for (const scope of eligibleScopes) {
      const sourceCounts = sourceCountsForScope(bundle.sources, sourceTotals, scope.scopeKey);
      const baseSelection = selectCrossVendorBundleBaseQuantity(bundle, sourceCounts);
      const observedAt = latestSourceObservedAt(sourceCounts) ?? new Date(0).toISOString();

      snapshots.push({
        id: `cross-bundle:${bundle.bundleKey}:${scope.scopeKey}:base`,
        vendorId: crossVendorBundlesVendorId,
        clientId: scope.customerId,
        agreementId: scope.agreementId,
        vendorProductKey: baseVendorProductKey,
        productCode: bundle.target.connectwiseProductCode,
        productName: bundle.target.connectwiseProductName,
        quantity: baseSelection.quantity,
        observedAt,
        dimensions: {
          crossVendorBundle: true,
          crossVendorBundleKey: bundle.bundleKey,
          crossVendorBundleName: bundle.bundleName,
          crossVendorBundleLineType: 'base',
          crossVendorBundleCountStrategy: bundle.countStrategy,
          crossVendorBundleDriverSourceKey: baseSelection.driverSourceKey,
          crossVendorBundleDriverSourceName: baseSelection.driverSourceName,
          crossVendorBundleSourceCounts: crossVendorSourceCountSummary(sourceCounts),
        },
      });

      for (const addOn of bundle.addOns) {
        const addOnSourceCount = sourceCounts.get(addOn.sourceKey)?.quantity ?? 0;
        const includedQuantity = baseSelection.quantity * addOn.includedPerBaseQuantity;
        const overageQuantity = Math.max(0, addOnSourceCount - includedQuantity);
        const hasExistingAddOn = agreementAdditions.some(
          (addition) =>
            addition.clientId === scope.customerId &&
            addition.agreementId === scope.agreementId &&
            normalizeProductCode(addition.productCode) === normalizeProductCode(addOn.connectwiseProductCode),
        );
        if (overageQuantity === 0 && !hasExistingAddOn) {
          continue;
        }

        snapshots.push({
          id: `cross-bundle:${bundle.bundleKey}:${scope.scopeKey}:addon:${addOn.addOnKey}`,
          vendorId: crossVendorBundlesVendorId,
          clientId: scope.customerId,
          agreementId: scope.agreementId,
          vendorProductKey: crossVendorBundleAddOnProductKey(bundle.bundleKey, addOn.addOnKey),
          productCode: addOn.connectwiseProductCode,
          productName: addOn.connectwiseProductName,
          quantity: overageQuantity,
          observedAt,
          dimensions: {
            crossVendorBundle: true,
            crossVendorBundleKey: bundle.bundleKey,
            crossVendorBundleName: bundle.bundleName,
            crossVendorBundleLineType: 'add-on',
            crossVendorBundleSourceKey: addOn.sourceKey,
            crossVendorBundleSourceCount: addOnSourceCount,
            crossVendorBundleIncludedQuantity: includedQuantity,
            crossVendorBundleIncludedPerBaseQuantity: addOn.includedPerBaseQuantity,
            crossVendorBundleBaseQuantity: baseSelection.quantity,
          },
        });
      }
    }
  }

  const ruleSet: VendorRuleSet = {
    vendorId: crossVendorBundlesVendorId,
    vendorName: 'Cross-vendor bundles',
    rules,
  };
  const result = reconcileVendorUsage({
    vendorId: crossVendorBundlesVendorId,
    rules,
    snapshots,
    agreementAdditions,
  });
  const lines = decorateCrossVendorBundleLines(result.lines, snapshots);

  return {
    ...result,
    totals: totalsForLines(lines),
    lines: await withLineDetails(database, lines, snapshots, agreementAdditions, ruleSet, new Map()),
    snapshotCount: snapshots.length,
    agreementAdditionCount: agreementAdditions.length,
    productOptions: productOptionsForRuleSet(ruleSet),
  };
}

type CrossVendorBundleScope = {
  scopeKey: string;
  customerId: string;
  agreementId: string;
};

type CrossVendorSourceScopeTotal = {
  sourceKey: string;
  sourceName: string;
  customerId: string;
  agreementId: string;
  quantity: number;
  observedAt?: string;
  sources: ReconciliationLinkedCountSource[];
};

async function suppressCrossVendorBundleCoveredSnapshots(
  database: Queryable,
  vendorId: string,
  snapshots: UsageSnapshot[],
): Promise<UsageSnapshot[]> {
  if (snapshots.length === 0 || !isVendorKey(vendorId)) {
    return snapshots;
  }

  const bundles = (await listCrossVendorProductBundles(database)).filter(
    (bundle) => bundle.active && bundle.status === 'approved',
  );
  const relevantBundles = bundles.flatMap((bundle) => {
    const vendorProductKeys = bundle.sources.flatMap((source) =>
      source.source.sourceType === 'vendor-product' && source.source.vendorId === vendorId
        ? [canonicalVendorProductKey(source.source.vendorProductKey)]
        : [],
    );
    return vendorProductKeys.length > 0
      ? [
          {
            bundle,
            vendorProductKeys: new Set(vendorProductKeys.map((key) => key.trim().toLowerCase())),
          },
        ]
      : [];
  });
  if (relevantBundles.length === 0) {
    return snapshots;
  }

  const baseProductCodes = [...new Set(relevantBundles.map(({ bundle }) => bundle.target.connectwiseProductCode))];
  const baseAdditions = await loadAgreementAdditionsForProductCodes(database, baseProductCodes);
  const coveredScopesByProductCode = new Map<string, Set<string>>();
  for (const addition of baseAdditions) {
    const productCode = normalizeProductCode(addition.productCode);
    const scopes = coveredScopesByProductCode.get(productCode) ?? new Set<string>();
    scopes.add(`${addition.clientId}|${addition.agreementId}`);
    coveredScopesByProductCode.set(productCode, scopes);
  }

  return snapshots.filter((snapshot) => {
    const vendorProductKey = snapshot.vendorProductKey
      ? canonicalVendorProductKey(snapshot.vendorProductKey).trim().toLowerCase()
      : undefined;
    if (!vendorProductKey) {
      return true;
    }

    return !relevantBundles.some(({ bundle, vendorProductKeys }) => {
      if (!vendorProductKeys.has(vendorProductKey)) {
        return false;
      }

      return coveredScopesByProductCode
        .get(normalizeProductCode(bundle.target.connectwiseProductCode))
        ?.has(`${snapshot.clientId}|${snapshot.agreementId}`) ?? false;
    });
  });
}

function bundleEligibleScopes(
  bundle: CrossVendorProductBundle,
  agreementAdditions: LoadedAgreementAddition[],
): CrossVendorBundleScope[] {
  const scopes = new Map<string, CrossVendorBundleScope>();
  for (const addition of agreementAdditions) {
    if (normalizeProductCode(addition.productCode) !== normalizeProductCode(bundle.target.connectwiseProductCode)) {
      continue;
    }

    const scopeKey = `${addition.clientId}|${addition.agreementId}`;
    scopes.set(scopeKey, {
      scopeKey,
      customerId: addition.clientId,
      agreementId: addition.agreementId,
    });
  }

  return [...scopes.values()].sort(
    (left, right) => left.customerId.localeCompare(right.customerId) || left.agreementId.localeCompare(right.agreementId),
  );
}

async function loadCrossVendorBundleSourceTotals(
  database: Queryable,
  sources: CrossVendorBundleSource[],
): Promise<Map<string, Map<string, CrossVendorSourceScopeTotal>>> {
  const totalsBySource = new Map<string, Map<string, CrossVendorSourceScopeTotal>>();

  for (const source of sources) {
    const totalsByScope = new Map<string, CrossVendorSourceScopeTotal>();
    const dedupedQuantities = new Map<string, Map<string, number>>();
    const linkedTotals = await loadLinkedSourceTotals(database, source.source);
    for (const linkedTotal of linkedTotals) {
      const scopeKey = `${linkedTotal.customerId}|${linkedTotal.agreementId}`;
      const total =
        totalsByScope.get(scopeKey) ?? {
          sourceKey: source.sourceKey,
          sourceName: source.sourceName,
          customerId: linkedTotal.customerId,
          agreementId: linkedTotal.agreementId,
          quantity: 0,
          observedAt: linkedTotal.observedAt,
          sources: [],
        };
      const sourceSummary = total.sources.find((candidate) => candidate.label === linkedTotal.source.label);
      if (sourceSummary) {
        sourceSummary.quantity += linkedTotal.source.quantity;
        sourceSummary.rowCount += linkedTotal.source.rowCount;
      } else {
        total.sources.push({ ...linkedTotal.source });
      }

      const dedupeKey = 'dedupeKey' in linkedTotal ? linkedTotal.dedupeKey : undefined;
      if (dedupeKey) {
        const sourceDedupe = dedupedQuantities.get(scopeKey) ?? new Map<string, number>();
        const previousQuantity = sourceDedupe.get(dedupeKey) ?? 0;
        if (linkedTotal.quantity > previousQuantity) {
          total.quantity += linkedTotal.quantity - previousQuantity;
          sourceDedupe.set(dedupeKey, linkedTotal.quantity);
        }
        dedupedQuantities.set(scopeKey, sourceDedupe);
      } else {
        total.quantity += linkedTotal.quantity;
      }
      if (linkedTotal.observedAt && (!total.observedAt || linkedTotal.observedAt > total.observedAt)) {
        total.observedAt = linkedTotal.observedAt;
      }
      totalsByScope.set(scopeKey, total);
    }

    totalsBySource.set(source.sourceKey, totalsByScope);
  }

  return totalsBySource;
}

function sourceCountsForScope(
  sources: CrossVendorBundleSource[],
  sourceTotals: Map<string, Map<string, CrossVendorSourceScopeTotal>>,
  scopeKey: string,
) {
  const counts = new Map<string, CrossVendorSourceScopeTotal>();
  const [customerId, agreementId] = scopeKey.split('|');
  for (const source of sources) {
    counts.set(
      source.sourceKey,
      sourceTotals.get(source.sourceKey)?.get(scopeKey) ?? {
        sourceKey: source.sourceKey,
        sourceName: source.sourceName,
        customerId,
        agreementId,
        quantity: 0,
        sources: [],
      },
    );
  }

  return counts;
}

function selectCrossVendorBundleBaseQuantity(
  bundle: CrossVendorProductBundle,
  sourceCounts: Map<string, CrossVendorSourceScopeTotal>,
) {
  const counts = [...sourceCounts.values()];
  if (bundle.countStrategy === 'highest-component') {
    const selected = [...counts].sort((left, right) => right.quantity - left.quantity)[0];
    return {
      quantity: selected?.quantity ?? 0,
      driverSourceKey: selected?.sourceKey,
      driverSourceName: selected?.sourceName,
    };
  }

  if (bundle.countStrategy === 'lowest-component') {
    const selected = [...counts].sort((left, right) => left.quantity - right.quantity)[0];
    return {
      quantity: selected?.quantity ?? 0,
      driverSourceKey: selected?.sourceKey,
      driverSourceName: selected?.sourceName,
    };
  }

  const selected = bundle.defaultDriverSourceKey ? sourceCounts.get(bundle.defaultDriverSourceKey) : undefined;
  return {
    quantity: selected?.quantity ?? 0,
    driverSourceKey: selected?.sourceKey ?? bundle.defaultDriverSourceKey,
    driverSourceName: selected?.sourceName,
  };
}

function latestSourceObservedAt(sourceCounts: Map<string, CrossVendorSourceScopeTotal>) {
  const observedAtValues = [...sourceCounts.values()]
    .map((source) => source.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return observedAtValues[observedAtValues.length - 1];
}

function crossVendorSourceCountSummary(sourceCounts: Map<string, CrossVendorSourceScopeTotal>) {
  return [...sourceCounts.values()]
    .map((source) => `${source.sourceName}:${source.quantity}`)
    .sort()
    .join('; ');
}

function decorateCrossVendorBundleLines(lines: ReconciliationLine[], snapshots: UsageSnapshot[]) {
  const snapshotsByRuleScope = new Map<string, UsageSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.clientId}|${snapshot.agreementId}|${snapshot.productCode}`;
    snapshotsByRuleScope.set(key, [...(snapshotsByRuleScope.get(key) ?? []), snapshot]);
  }

  return lines.map((line) => {
    const lineSnapshots = snapshotsByRuleScope.get(`${line.clientId}|${line.agreementId}|${line.productCode}`) ?? [];
    const firstSnapshot = lineSnapshots[0];
    if (!firstSnapshot?.dimensions.crossVendorBundle) {
      return line;
    }

    const extraEvidence = [
      optionalEvidence('Bundle', firstSnapshot.dimensions.crossVendorBundleName),
      optionalEvidence('Bundle strategy', firstSnapshot.dimensions.crossVendorBundleCountStrategy),
      optionalEvidence('Driver source', firstSnapshot.dimensions.crossVendorBundleDriverSourceName),
      optionalEvidence('Source counts', firstSnapshot.dimensions.crossVendorBundleSourceCounts),
      optionalEvidence('Source count', firstSnapshot.dimensions.crossVendorBundleSourceCount),
      optionalEvidence('Included quantity', firstSnapshot.dimensions.crossVendorBundleIncludedQuantity),
      optionalEvidence('Included per base', firstSnapshot.dimensions.crossVendorBundleIncludedPerBaseQuantity),
    ].filter((entry): entry is { label: string; value: string | number } => Boolean(entry));

    return {
      ...line,
      reason:
        firstSnapshot.dimensions.crossVendorBundleLineType === 'add-on'
          ? `${line.productName} overage is calculated inside the cross-vendor bundle.`
          : `${line.productName} base count is calculated from the cross-vendor bundle strategy.`,
      evidence: [...line.evidence, ...extraEvidence],
    };
  });
}

function optionalEvidence(label: string, value: DimensionValue) {
  return typeof value === 'string' || typeof value === 'number' ? { label, value } : undefined;
}

function crossVendorBundleBaseProductKey(bundleKey: string) {
  return `bundle:${bundleKey}:base`;
}

function crossVendorBundleAddOnProductKey(bundleKey: string, addOnKey: string) {
  return `bundle:${bundleKey}:addon:${addOnKey}`;
}

function moneyFromNumber(value: number | undefined): MoneyAmount | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? {
        amount: value,
        currency: 'USD',
      }
    : undefined;
}

async function loadAgreementAdditionsForProductCodes(
  database: Queryable,
  productCodes: string[],
): Promise<LoadedAgreementAddition[]> {
  const normalizedProductCodes = [...new Set(productCodes.map(normalizeProductCode).filter(Boolean))];
  if (normalizedProductCodes.length === 0) {
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
     where lower(agreement_additions.product_code) = any($1::text[])
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'`,
    [normalizedProductCodes],
  );

  return result.rows.map(mapAdditionRow);
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
  if (isVendorDatapointId(vendorId)) {
    return loadMappedInvoiceRuleSet(database, vendorId);
  }

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

  if (vendorId === 'sentinelone') {
    return loadSentinelOneRuleSet(database);
  }

  if (vendorId === 'huntress') {
    return loadHuntressRuleSet(database);
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
    billableUnit: billableUnitForVendorProductKey(row.vendor_product_key),
    unitPrice:
      row.unit_price === null
        ? undefined
        : {
            amount: numericValue(row.unit_price),
            currency: 'USD' as const,
          },
    notes: `${displayName} mapped quantity for ${row.connectwise_product_name}.`,
  }));

  return {
    vendorId,
    vendorName: displayName,
    rules,
  };
}

async function loadLatestSyncRunId(database: Queryable, vendorId: string) {
  const result = await database.query<SyncRunRow>(
    `select ${sqlLatestReconcilableSyncRunIdExpression('$1')} as id`,
    [vendorId],
  );

  return result.rows[0]?.id;
}

async function loadUsageSnapshots(database: Queryable, vendorId: string, syncRunId: string | undefined) {
  const result = await database.query<SnapshotRow>(
    `with approved_product_mappings as (
       select vendor_id,
              replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/') as vendor_product_key,
              min(connectwise_product_code) as connectwise_product_code,
              min(connectwise_product_name) as connectwise_product_name
       from vendor_product_mappings
       where vendor_id = $1
         and active = true
         and mapping_status = 'approved'
       group by vendor_id, replace(replace(vendor_product_key, '%2F', '/'), '%2f', '/')
       having count(distinct connectwise_product_code) = 1
     ),
     approved_account_mappings as (
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
     select
       vendor_usage_snapshots.id,
       vendor_usage_snapshots.vendor_id,
       coalesce(vendor_usage_snapshots.customer_id, approved_account_mappings.customer_id) as customer_id,
       coalesce(vendor_usage_snapshots.agreement_id, approved_account_mappings.agreement_id) as agreement_id,
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
      and vendor_usage_snapshots.customer_id is null
     left join approved_product_mappings
       on approved_product_mappings.vendor_id = vendor_usage_snapshots.vendor_id
      and approved_product_mappings.vendor_product_key = vendor_usage_snapshots.vendor_product_key
     where vendor_usage_snapshots.vendor_id = $1
       and coalesce(vendor_usage_snapshots.customer_id, approved_account_mappings.customer_id) is not null
       and coalesce(vendor_usage_snapshots.agreement_id, approved_account_mappings.agreement_id) is not null
       and (
         lower(coalesce(vendor_usage_snapshots.dimensions->>'detailOnlySync', 'false')) <> 'true'
         or approved_product_mappings.vendor_product_key is not null
       )
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

async function loadLinkedCountContext(
  database: Queryable,
  vendorId: IntegrationId,
  ruleSet: VendorRuleSet,
  rules: ProductLinkRule[],
) {
  const activeRules = rules.filter((rule) => rule.active && rule.status === 'approved' && rule.sources.length > 0);
  const anchorSnapshots: UsageSnapshot[] = [];
  const countsByLineKey = new Map<string, ReconciliationLinkedCount>();

  for (const rule of activeRules) {
    const sourceVendorProductKey = canonicalVendorProductKey(rule.sourceVendorProductKey);
    const targetRule = ruleSet.rules.find((candidate) =>
      ruleVendorProductKeys(candidate).map(canonicalVendorProductKey).includes(sourceVendorProductKey),
    );
    if (!targetRule) {
      continue;
    }

    const totalsByScope = new Map<
      string,
      {
        customerId: string;
        agreementId: string;
        quantity: number;
        observedAt?: string;
        dedupedQuantities: Map<string, number>;
        sourcesByKey: Map<string, ReconciliationLinkedCountSource>;
      }
    >();

    for (const source of rule.sources) {
      const sourceTotals = await loadLinkedSourceTotals(database, source);
      for (const sourceTotal of sourceTotals) {
        const scopeKey = `${sourceTotal.customerId}|${sourceTotal.agreementId}`;
        const total =
          totalsByScope.get(scopeKey) ??
          {
            customerId: sourceTotal.customerId,
            agreementId: sourceTotal.agreementId,
            quantity: 0,
            observedAt: sourceTotal.observedAt,
            dedupedQuantities: new Map<string, number>(),
            sourcesByKey: new Map<string, ReconciliationLinkedCountSource>(),
          };
        const sourceKey = `${sourceTotal.source.sourceType}:${sourceTotal.source.label}`;
        const sourceSummary =
          total.sourcesByKey.get(sourceKey) ??
          {
            ...sourceTotal.source,
            quantity: 0,
            rowCount: 0,
          };
        sourceSummary.quantity += sourceTotal.source.quantity;
        sourceSummary.rowCount += sourceTotal.source.rowCount;
        total.sourcesByKey.set(sourceKey, sourceSummary);
        const dedupeKey = 'dedupeKey' in sourceTotal ? sourceTotal.dedupeKey : undefined;
        if (dedupeKey) {
          const previousQuantity = total.dedupedQuantities.get(dedupeKey) ?? 0;
          if (sourceTotal.quantity > previousQuantity) {
            total.quantity += sourceTotal.quantity - previousQuantity;
            total.dedupedQuantities.set(dedupeKey, sourceTotal.quantity);
          }
        } else {
          total.quantity += sourceTotal.quantity;
        }
        if (sourceTotal.observedAt && (!total.observedAt || sourceTotal.observedAt > total.observedAt)) {
          total.observedAt = sourceTotal.observedAt;
        }
        totalsByScope.set(scopeKey, total);
      }
    }

    const targetAdditionScopes = await loadLinkedTargetAdditionScopes(database, targetProductCodes(targetRule));
    for (const scope of targetAdditionScopes) {
      const scopeKey = `${scope.customer_id}|${scope.agreement_id}`;
      totalsByScope.set(
        scopeKey,
        totalsByScope.get(scopeKey) ?? {
          customerId: scope.customer_id,
          agreementId: scope.agreement_id,
          quantity: 0,
          dedupedQuantities: new Map<string, number>(),
          sourcesByKey: new Map<string, ReconciliationLinkedCountSource>(),
        },
      );
    }

    for (const total of totalsByScope.values()) {
      const sources = [...total.sourcesByKey.values()].sort((left, right) => left.label.localeCompare(right.label));
      // Key by parent vendor product key so separate device classes that share a CW
      // catalog code (e.g. device:server + device:workstation → Managed Endpoint Protection)
      // keep their own linked counts.
      const lineKey = linkedLineKey(total.customerId, total.agreementId, sourceVendorProductKey);
      countsByLineKey.set(lineKey, {
        ruleId: rule.id,
        ruleName: rule.ruleName,
        sourceVendorProductKey,
        quantity: total.quantity,
        sources,
      });
      anchorSnapshots.push({
        id: `linked:${rule.id}:${total.customerId}:${total.agreementId}:${sourceVendorProductKey}`,
        vendorId,
        clientId: total.customerId,
        agreementId: total.agreementId,
        vendorProductKey: sourceVendorProductKey,
        productCode: targetRule.productCode,
        productName: targetRule.productName,
        quantity: 0,
        observedAt: total.observedAt ?? new Date(0).toISOString(),
        dimensions: {
          linkedCountAnchor: true,
          linkedCountRuleId: rule.id,
          linkedCountRuleName: rule.ruleName,
          linkedCountQuantity: total.quantity,
          linkedCountSourceCount: sources.length,
        },
      });
    }
  }

  return {
    anchorSnapshots,
    countsByLineKey,
  };
}

async function loadLinkedSourceTotals(database: Queryable, source: ProductLinkRuleSource) {
  if (source.sourceType === 'vendor-product') {
    return loadVendorProductLinkedSourceTotals(database, source);
  }

  if (source.sourceType === 'filtered-dataset') {
    return loadFilteredDatasetLinkedSourceTotals(database, source);
  }

  return loadConnectWiseAdditionLinkedSourceTotals(database, source);
}

async function loadVendorProductLinkedSourceTotals(
  database: Queryable,
  source: Extract<ProductLinkRuleSource, { sourceType: 'vendor-product' }>,
) {
  const dedupeKeySql = linkedDatasetDedupeKeySql('vendor_usage_snapshots', 'vendor-usage');
  const result = await database.query<LinkedSourceQuantityRow>(
    `with latest_sync_run as (
       select ${sqlLatestReconcilableSyncRunIdExpression('$1')} as id
     ),
     approved_account_mappings as (
       select vendor_id,
              external_account_id,
              customer_id,
              agreement_id
       from vendor_account_mappings
       where vendor_id = $1
         and active = true
         and mapping_status = 'approved'
     ),
     matched_rows as (
       select
         case
           when approved_account_mappings.external_account_id is not null then approved_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as customer_id,
         case
           when approved_account_mappings.external_account_id is not null then approved_account_mappings.agreement_id
           else vendor_usage_snapshots.agreement_id
         end as agreement_id,
         ${dedupeKeySql} as dedupe_key,
         vendor_usage_snapshots.quantity,
         vendor_usage_snapshots.observed_at
       from vendor_usage_snapshots
       left join approved_account_mappings
         on approved_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and approved_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
       where vendor_usage_snapshots.vendor_id = $1
         and replace(replace(vendor_usage_snapshots.vendor_product_key, '%2F', '/'), '%2f', '/') = $2
         and vendor_usage_snapshots.sync_run_id = (select id from latest_sync_run)
         and exists (
           select 1
           from vendor_product_mappings
           where vendor_product_mappings.vendor_id = $1
             and vendor_product_mappings.active = true
             and vendor_product_mappings.mapping_status = 'approved'
             and replace(replace(vendor_product_mappings.vendor_product_key, '%2F', '/'), '%2f', '/') = $2
         )
         and case
           when approved_account_mappings.external_account_id is not null then approved_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end is not null
         and case
           when approved_account_mappings.external_account_id is not null then approved_account_mappings.agreement_id
           else vendor_usage_snapshots.agreement_id
         end is not null
     ),
     deduped_rows as (
       select
         matched_rows.customer_id,
         matched_rows.agreement_id,
         matched_rows.dedupe_key,
         max(matched_rows.quantity) as quantity,
         count(*)::int as row_count,
         max(matched_rows.observed_at) as observed_at
       from matched_rows
       group by matched_rows.customer_id, matched_rows.agreement_id, matched_rows.dedupe_key
     )
     select
       deduped_rows.customer_id,
       deduped_rows.agreement_id,
       deduped_rows.dedupe_key,
       deduped_rows.quantity,
       deduped_rows.row_count,
       deduped_rows.observed_at
     from deduped_rows
     order by deduped_rows.customer_id, deduped_rows.agreement_id, deduped_rows.dedupe_key`,
    [source.vendorId, canonicalVendorProductKey(source.vendorProductKey)],
  );

  return result.rows.map((row) => ({
    customerId: row.customer_id,
    agreementId: row.agreement_id,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at),
    dedupeKey: row.dedupe_key ?? undefined,
    source: {
      sourceType: 'vendor-product' as const,
      label: `${integrationDisplayName(source.vendorId)} / ${source.vendorProductName ?? source.vendorProductKey}`,
      quantity: numericValue(row.quantity),
      rowCount: numericValue(row.row_count),
      vendorId: source.vendorId,
      vendorProductKey: canonicalVendorProductKey(source.vendorProductKey),
    },
  }));
}

async function loadFilteredDatasetLinkedSourceTotals(
  database: Queryable,
  source: Extract<ProductLinkRuleSource, { sourceType: 'filtered-dataset' }>,
) {
  const query = linkedDatasetBaseQuery(source);
  const context: LinkedSqlContext = {
    fieldSet: query.fieldSet,
    tableAlias: 'mapped_snapshots',
    values: [...query.values],
  };
  const filterSql = linkedFilterSql(source.filter, context);
  const contributionSql = linkedRowContributionSql(source.aggregation, {
    ...context,
    tableAlias: 'filtered_rows',
  });
  const dedupeKeySql = linkedDatasetDedupeKeySql('filtered_rows', query.fieldSet);
  const result = await database.query<LinkedSourceQuantityRow>(
    `${query.sql},
     filtered_rows as (
       select *
       from mapped_snapshots
       where effective_customer_id is not null
         and effective_agreement_id is not null
         and ${filterSql}
     ),
     deduped_rows as (
       select
         filtered_rows.effective_customer_id,
         filtered_rows.effective_agreement_id,
         ${dedupeKeySql} as dedupe_key,
         max(${contributionSql}) as quantity,
         count(*)::int as row_count,
         max(filtered_rows.observed_at) as observed_at
       from filtered_rows
       group by filtered_rows.effective_customer_id, filtered_rows.effective_agreement_id, dedupe_key
     )
     select
       deduped_rows.effective_customer_id as customer_id,
       deduped_rows.effective_agreement_id as agreement_id,
       deduped_rows.dedupe_key,
       deduped_rows.quantity,
       deduped_rows.row_count,
       deduped_rows.observed_at
     from deduped_rows
     order by deduped_rows.effective_customer_id, deduped_rows.effective_agreement_id, deduped_rows.dedupe_key`,
    context.values,
  );

  const label = source.label?.trim() || query.label;
  return result.rows.map((row) => ({
    customerId: row.customer_id,
    agreementId: row.agreement_id,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at),
    dedupeKey: row.dedupe_key ?? undefined,
    source: {
      sourceType: 'filtered-dataset' as const,
      label,
      quantity: numericValue(row.quantity),
      rowCount: numericValue(row.row_count),
      vendorId: source.vendorId,
      dataset: source.dataset,
      vendorProductKey: source.dataset ? `${source.vendorId}:${source.dataset}` : `${source.vendorId}:filtered`,
    },
  }));
}

function linkedDatasetBaseQuery(source: Extract<ProductLinkRuleSource, { sourceType: 'filtered-dataset' }>): LinkedDatasetQuery {
  if (source.vendorId === 'microsoft-365' && source.dataset === 'licenses') {
    return microsoft365LicenseLinkedDatasetQuery();
  }

  return vendorUsageLinkedDatasetQuery(source);
}

function microsoft365LicenseLinkedDatasetQuery(): LinkedDatasetQuery {
  return {
    values: [microsoft365DatasetEntities('licenses')],
    fieldSet: 'microsoft-365-licenses',
    label: `${integrationDisplayName('microsoft-365')} / Licenses`,
    sql: `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = 'microsoft-365'
         and status = 'complete'
         and metadata->>'entity' = any($1::text[])
       order by completed_at desc nulls last, started_at desc
       limit 1
     ),
     mapped_snapshots as (
       select
         microsoft365_subscription_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else microsoft365_subscription_snapshots.customer_id
         end as effective_customer_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.agreement_id
           else microsoft365_subscription_snapshots.agreement_id
         end as effective_agreement_id
       from microsoft365_subscription_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'microsoft-365'
        and vendor_account_mappings.external_account_id = microsoft365_subscription_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where microsoft365_subscription_snapshots.sync_run_id = (select id from latest_sync_run)
     )`,
  };
}

function vendorUsageLinkedDatasetQuery(
  source: Extract<ProductLinkRuleSource, { sourceType: 'filtered-dataset' }>,
): LinkedDatasetQuery {
  const values: unknown[] = [source.vendorId];
  const entityFilter =
    source.vendorId === 'microsoft-365'
      ? `and metadata->>'entity' = any(${pushLinkedParam(values, microsoft365DatasetEntities('users'))}::text[])`
      : '';
  return {
    values,
    fieldSet: 'vendor-usage',
    label: `${integrationDisplayName(source.vendorId)} / ${source.dataset === 'users' ? 'Users' : 'Usage snapshots'}`,
    sql: `with latest_sync_run as (
       select id
       from sync_runs
       where integration_id = $1
         and status = 'complete'
         and coalesce(metadata->>'source', '') <> 'invoice-table'
         ${entityFilter}
       order by completed_at desc nulls last, started_at desc
       limit 1
     ),
     mapped_snapshots as (
       select
         vendor_usage_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as effective_customer_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.agreement_id
           else vendor_usage_snapshots.agreement_id
         end as effective_agreement_id
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_usage_snapshots.sync_run_id = (select id from latest_sync_run)
     )`,
  };
}

function linkedFilterSql(node: ProductLinkRuleFilterNode, context: LinkedSqlContext): string {
  if (node.nodeType === 'group') {
    const children = node.children.map((child) => linkedFilterSql(child, context)).filter(Boolean);
    if (children.length === 0) {
      return 'true';
    }

    return `(${children.join(node.operator === 'or' ? ' or ' : ' and ')})`;
  }

  const expression = `coalesce(${linkedDatasetFieldSql(node.field, context)}, '')`;
  if (node.operator === 'is-empty') {
    return `nullif(trim(${expression}), '') is null`;
  }

  if (node.operator === 'is-not-empty') {
    return `nullif(trim(${expression}), '') is not null`;
  }

  const valueParam = pushLinkedParam(context.values, node.value ?? '');
  if (node.operator === 'contains') {
    return `${expression} ilike '%' || ${valueParam}::text || '%'`;
  }

  if (node.operator === 'not-contains') {
    return `not (${expression} ilike '%' || ${valueParam}::text || '%')`;
  }

  if (node.operator === 'starts-with') {
    return `${expression} ilike ${valueParam}::text || '%'`;
  }

  if (node.operator === 'ends-with') {
    return `${expression} ilike '%' || ${valueParam}::text`;
  }

  if (node.operator === 'not-equals') {
    return `lower(${expression}) <> lower(${valueParam}::text)`;
  }

  return `lower(${expression}) = lower(${valueParam}::text)`;
}

function linkedRowContributionSql(aggregation: ProductLinkRuleAggregation, context: LinkedSqlContext) {
  if (aggregation.type === 'row-count') {
    return '1::numeric';
  }

  const expression = `trim(coalesce(${linkedDatasetFieldSql(aggregation.column, context)}, ''))`;
  return `case when ${expression} ~ '^-?[0-9]+(\\.[0-9]+)?$' then ${expression}::numeric else 0 end`;
}

function linkedDatasetFieldSql(field: string, context: LinkedSqlContext) {
  const normalized = normalizeLinkedField(field);
  const source = context.tableAlias;
  const commonFields: Record<string, string> = {
    customerid: `${source}.effective_customer_id::text`,
    agreementid: `${source}.effective_agreement_id::text`,
    externalaccountid: `${source}.external_account_id`,
    tenantid: `${source}.external_account_id`,
    productkey: `${source}.vendor_product_key`,
    vendorproductkey: `${source}.vendor_product_key`,
    productcode: `${source}.product_code`,
    productname: `${source}.product_name`,
    quantity: `${source}.quantity::text`,
    observedat: `${source}.observed_at::text`,
  };
  const microsoft365LicenseFields: Record<string, string> = {
    customerid: `${source}.effective_customer_id::text`,
    agreementid: `${source}.effective_agreement_id::text`,
    externalaccountid: `${source}.external_account_id`,
    tenantid: `${source}.external_account_id`,
    tenantname: `${source}.tenant_name`,
    tenantdefaultdomain: `${source}.tenant_default_domain_name`,
    skuid: `${source}.sku_id`,
    skupartnumber: `${source}.sku_part_number`,
    skuname: `${source}.sku_name`,
    licensename: `coalesce(${source}.sku_name, ${source}.sku_part_number, ${source}.sku_id)`,
    productname: `coalesce(${source}.sku_name, ${source}.sku_part_number, ${source}.sku_id)`,
    subscriptionstatus: `${source}.subscription_status`,
    capabilitystatus: `${source}.capability_status`,
    totalunits: `${source}.total_units::text`,
    assignedunits: `${source}.assigned_units::text`,
    unassignedunits: `${source}.unassigned_units::text`,
    enabledunits: `${source}.enabled_units::text`,
    suspendedunits: `${source}.suspended_units::text`,
    warningunits: `${source}.warning_units::text`,
    lockedoutunits: `${source}.locked_out_units::text`,
    subscriptioncount: `${source}.subscription_count::text`,
    istrial: `${source}.is_trial::text`,
    nextlifecycleat: `${source}.next_lifecycle_at::text`,
    billingtype: `${source}.billing_type`,
    billingcycle: `${source}.billing_cycle`,
    billingterm: `${source}.billing_term`,
    observedat: `${source}.observed_at::text`,
  };
  const mappedField =
    context.fieldSet === 'microsoft-365-licenses'
      ? microsoft365LicenseFields[normalized]
      : commonFields[normalized];
  if (mappedField) {
    return mappedField;
  }

  const fieldParam = pushLinkedParam(context.values, normalized);
  return `coalesce(
    (
      select dimension_entry.value
      from jsonb_each_text(${source}.dimensions) as dimension_entry(key, value)
      where regexp_replace(lower(dimension_entry.key), '[^a-z0-9]+', '', 'g') = ${fieldParam}::text
      limit 1
    ),
    (
      select raw_entry.value
      from jsonb_each_text(${source}.raw_payload) as raw_entry(key, value)
      where regexp_replace(lower(raw_entry.key), '[^a-z0-9]+', '', 'g') = ${fieldParam}::text
      limit 1
    )
  )`;
}

function linkedDatasetDedupeKeySql(source: string, fieldSet: LinkedDatasetQuery['fieldSet']) {
  const emailIdentity = linkedJsonTextValueSql(source, [
    'userPrincipalName',
    'upn',
    'email',
    'mail',
    'userEmail',
    'username',
  ]);
  const userIdentity = linkedJsonTextValueSql(source, [
    'userId',
    'aadUserId',
    'azureAdUserId',
    'objectId',
    'remoteId',
    'contactId',
    'seatId',
  ]);
  const deviceIdentity = linkedJsonTextValueSql(source, [
    'deviceId',
    'ncentralDeviceId',
    'endpointId',
    'protectedSystemId',
    'machineId',
    'computerId',
    'assetId',
    'systemId',
  ]);
  const hostnameIdentity = linkedJsonTextValueSql(source, [
    'hostname',
    'deviceName',
    'computerName',
    'agentHostname',
    'deviceHostname',
  ]);
  const serialIdentity = linkedJsonTextValueSql(source, ['serialNumber', 'serial']);

  const vendorScope = fieldSet === 'microsoft-365-licenses' ? "'microsoft-365'" : `coalesce(${source}.vendor_id, 'unknown')`;

  return `coalesce(
    case when ${emailIdentity} is not null then 'email:' || lower(${emailIdentity}) end,
    case when ${userIdentity} is not null then 'user:' || ${vendorScope} || ':' || coalesce(${source}.external_account_id, 'unknown') || ':' || lower(${userIdentity}) end,
    case when ${deviceIdentity} is not null then 'device:' || ${vendorScope} || ':' || coalesce(${source}.external_account_id, 'unknown') || ':' || lower(${deviceIdentity}) end,
    case when ${hostnameIdentity} is not null then 'host:' || ${vendorScope} || ':' || coalesce(${source}.external_account_id, 'unknown') || ':' || lower(${hostnameIdentity}) end,
    case when ${serialIdentity} is not null then 'serial:' || ${vendorScope} || ':' || coalesce(${source}.external_account_id, 'unknown') || ':' || lower(${serialIdentity}) end,
    'row:' || ${source}.id::text
  )`;
}

function linkedJsonTextValueSql(source: string, keys: string[]) {
  return `nullif(trim(coalesce(${keys.flatMap((key) => [
    `${source}.dimensions->>'${key}'`,
    `${source}.raw_payload->>'${key}'`,
  ]).join(', ')})), '')`;
}

function pushLinkedParam(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function normalizeLinkedField(field: string) {
  return field.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function microsoft365DatasetEntities(dataset: 'users' | 'licenses') {
  return dataset === 'licenses'
    ? ['m365-licenses', 'license-snapshots']
    : ['m365-users', 'license-snapshots'];
}

async function loadConnectWiseAdditionLinkedSourceTotals(
  database: Queryable,
  source: Extract<ProductLinkRuleSource, { sourceType: 'connectwise-addition' }>,
) {
  const result = await database.query<LinkedSourceQuantityRow>(
    `select
       agreement_additions.customer_id,
       agreement_additions.agreement_id,
       sum(agreement_additions.quantity) as quantity,
       count(*)::int as row_count,
       max(coalesce(agreement_additions.updated_at, agreement_additions.created_at)) as observed_at
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where agreement_additions.product_code = $1
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     group by agreement_additions.customer_id, agreement_additions.agreement_id
     order by agreement_additions.customer_id, agreement_additions.agreement_id`,
    [source.productCode],
  );

  return result.rows.map((row) => ({
    customerId: row.customer_id,
    agreementId: row.agreement_id,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at),
    source: {
      sourceType: 'connectwise-addition' as const,
      label: `ConnectWise / ${source.productName ?? source.productCode}`,
      quantity: numericValue(row.quantity),
      rowCount: numericValue(row.row_count),
      productCode: source.productCode,
    },
  }));
}

async function loadLinkedTargetAdditionScopes(database: Queryable, productCodes: string[]) {
  if (productCodes.length === 0) {
    return [];
  }

  const result = await database.query<LinkedTargetAdditionScopeRow>(
    `select distinct
       agreement_additions.customer_id,
       agreement_additions.agreement_id
     from agreement_additions
     inner join agreements
       on agreements.id = agreement_additions.agreement_id
     where agreement_additions.product_code = any($1::text[])
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'`,
    [productCodes],
  );

  return result.rows;
}

function applyLinkedCountsToLines(
  lines: ReconciliationLine[],
  countsByLineKey: Map<string, ReconciliationLinkedCount>,
): ReconciliationLine[] {
  return lines.map((line) => {
    if (line.lineType !== 'base-count') {
      return line;
    }

    const linkedCount = linkedCountForLine(line, countsByLineKey);
    if (!linkedCount) {
      return line;
    }

    // Linked counts are a selectable reference (e.g. N-able). Keep the vendor API
    // proposed quantity as the billing baseline; the UI picks the highest among
    // API / linked / invoice when present.
    return {
      ...line,
      linkedCount,
      evidence: [
        ...line.evidence,
        { label: 'Linked count rule', value: linkedCount.ruleName },
        { label: 'Linked count', value: linkedCount.quantity },
        ...linkedCount.sources.map((source) => ({
          label: `Linked source: ${source.label}`,
          value: source.quantity,
        })),
      ],
    };
  });
}

function linkedCountForLine(
  line: ReconciliationLine,
  countsByLineKey: Map<string, ReconciliationLinkedCount>,
) {
  const vendorProductKey = line.vendorProductKey?.trim();
  if (!vendorProductKey) {
    return undefined;
  }

  return countsByLineKey.get(linkedLineKey(line.clientId, line.agreementId, vendorProductKey));
}

function linkedLineKey(customerId: string, agreementId: string, vendorProductKey: string) {
  return `${customerId}|${agreementId}|${canonicalVendorProductKey(vendorProductKey).trim().toLowerCase()}`;
}

function canonicalVendorProductKey(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function integrationDisplayName(integrationId: VendorKey) {
  if (integrationId === crossVendorBundlesVendorId) {
    return 'Cross-vendor bundles';
  }

  if (isVendorDatapointId(integrationId)) {
    return integrationId.slice('datapoint:'.length);
  }

  return getIntegrationSettingsDefinition(integrationId as IntegrationId)?.displayName ?? integrationId;
}

async function loadVendorReconcileMode(database: Queryable, vendorId: string) {
  const nonSecrets = await loadVendorNonSecrets(database, vendorId);

  return integrationPsaAgreementReconcileMode(
    nonSecrets,
    getIntegrationSettingsDefinition(vendorId as IntegrationId),
  );
}

async function loadDoNotSuggestNewAdditions(database: Queryable, vendorId: string) {
  const nonSecrets = await loadVendorNonSecrets(database, vendorId);

  return integrationDoNotSuggestNewAdditions(
    nonSecrets,
    getIntegrationSettingsDefinition(vendorId as IntegrationId),
  );
}

async function loadVendorNonSecrets(database: Queryable, vendorId: string) {
  const result = await database.query<{ non_secret_settings: unknown }>(
    `select non_secret_settings
       from integration_settings
      where integration_id = $1`,
    [vendorId],
  );

  return recordFromJson(result.rows[0]?.non_secret_settings) as Record<string, string | undefined>;
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
  const snapshotsByClient = indexSnapshotsByClient(snapshots);
  return lines.map((line) => ({
    ...line,
    ...labelsByLineKey.get(`${line.clientId}|${line.agreementId}`),
    ...invoiceDetailsForLine(invoiceQuantities, line),
    matchedAgreementAdditions: matchedAgreementAdditionsForLine(
      line,
      agreementAdditions,
      snapshotsByClient.get(line.clientId) ?? [],
      ruleSet,
    ),
    devices: devicesForLine(line, snapshotsByClient.get(line.clientId) ?? [], ruleSet),
  }));
}

function indexSnapshotsByClient(snapshots: UsageSnapshot[]) {
  return snapshots.reduce((groups, snapshot) => {
    const existing = groups.get(snapshot.clientId) ?? [];
    existing.push(snapshot);
    groups.set(snapshot.clientId, existing);
    return groups;
  }, new Map<string, UsageSnapshot[]>());
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
  const lineVendorProductKeys = new Set(
    [
      line.vendorProductKey,
      ...(rule ? ruleVendorProductKeys(rule) : []),
    ].filter((key): key is string => Boolean(key)),
  );

  return snapshots
    .filter(
      (snapshot) =>
        snapshot.clientId === line.clientId &&
        snapshot.agreementId === line.agreementId &&
        (lineVendorProductKeys.size === 0 ||
          !snapshot.vendorProductKey ||
          lineVendorProductKeys.has(snapshot.vendorProductKey)) &&
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
      dimensions: compactDeviceDimensions(snapshot.dimensions),
    }));
}

const deviceDimensionKeys = [
  'hostname',
  'deviceName',
  'computerName',
  'deviceId',
  'ncentralDeviceId',
  'serialNumber',
  'accountId',
  'externalId',
  'externalAccountId',
  'externalAccountName',
  'userPrincipalName',
  'email',
  'deviceType',
  'deviceClass',
  'deviceCategory',
  'protectedSystemType',
  'physicality',
  'selectedStorageGb',
  'os',
  'operatingSystem',
  'ncentralProductType',
  'lastCheckIn',
  'lastApplianceCheckinTime',
  'appRiverBundle',
  'appRiverBundleKey',
  'appRiverBundleName',
  'subscriptionSource',
  'huntressProductClass',
  'huntressProductClassLabel',
  'huntressOrganizationId',
  'huntressOrganizationName',
  'huntressAccountId',
  'huntressAccountName',
  'huntressInvoiceId',
  'billingPeriodStart',
  'billingPeriodEnd',
] as const;

function compactDeviceDimensions(dimensions: DimensionMap): DimensionMap {
  const compact: DimensionMap = {};
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value === 'undefined' || value === null || value === '') {
      continue;
    }
    if (
      deviceDimensionKeys.includes(key as (typeof deviceDimensionKeys)[number]) ||
      key.startsWith('appRiver') ||
      key.startsWith('huntress') ||
      key.startsWith('linkedCount') ||
      key.startsWith('crossVendorBundle')
    ) {
      compact[key] = value;
    }
  }
  return compact;
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
        addition.productCode.trim().toLowerCase() === line.productCode.trim().toLowerCase() &&
        (!line.connectWiseAdditionId ||
          addition.connectWiseAdditionId === line.connectWiseAdditionId ||
          addition.id === line.connectWiseAdditionId),
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
