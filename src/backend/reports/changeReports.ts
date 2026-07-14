import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export const changeReportModes = ['counts', 'users', 'devices', 'microsoft365-license-counts'] as const;

export type ChangeReportMode = (typeof changeReportModes)[number];
export type ChangeReportChangeType = 'added' | 'removed' | 'increased' | 'decreased' | 'changed';

export type ChangeReportComparisonInput = {
  vendorId: IntegrationId;
  mode?: ChangeReportMode;
  startSyncRunId: string;
  endSyncRunId: string;
};

export type ChangeReportSyncRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
};

export type ChangeReportItem = {
  id: string;
  identity: string;
  displayName: string;
  observedAt?: string;
  details: Record<string, string | number | boolean | null>;
};

export type ChangeReportRow = {
  id: string;
  changeType: ChangeReportChangeType;
  customer: {
    customerId?: string;
    connectWiseCompanyId?: string;
    customerName: string;
    externalAccountId?: string;
  };
  agreement?: {
    agreementId?: string;
    agreementName?: string;
  };
  productKey: string;
  productCode?: string;
  productName: string;
  startCount: number;
  endCount: number;
  delta: number;
  addedItems: ChangeReportItem[];
  removedItems: ChangeReportItem[];
};

export type ChangeReportSummary = {
  comparisonCount: number;
  changedRowCount: number;
  addedCount: number;
  removedCount: number;
  increasedCount: number;
  decreasedCount: number;
  changedCount: number;
  startTotal: number;
  endTotal: number;
  netQuantityDelta: number;
  detailAddedCount: number;
  detailRemovedCount: number;
};

export type ChangeReportComparison = {
  id: string;
  vendorId: IntegrationId;
  vendorName: string;
  mode: ChangeReportMode;
  modeLabel: string;
  status: 'ready' | 'unavailable';
  message?: string;
  startSyncRun: ChangeReportSyncRun;
  endSyncRun: ChangeReportSyncRun;
  summary: ChangeReportSummary;
  rows: ChangeReportRow[];
};

export type ChangeReport = {
  reportType: 'change-report';
  generatedAt: string;
  summary: ChangeReportSummary;
  comparisons: ChangeReportComparison[];
};

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: string | number | null;
  records_written: string | number | null;
  error_message: string | null;
  metadata: unknown;
};

type SnapshotRow = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  connectwise_company_id: string | null;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: string | number | null;
  observed_at: Date | string;
  dimensions: unknown;
};

type SnapshotRecord = {
  id: string;
  vendorId: string;
  customerId?: string;
  connectWiseCompanyId?: string;
  customerName: string;
  customerKey: string;
  agreementId?: string;
  agreementName?: string;
  externalAccountId?: string;
  productKey: string;
  productCode?: string;
  productName: string;
  quantity: number;
  observedAt: string;
  dimensions: Record<string, unknown>;
};

type CountGroup = {
  key: string;
  customer: ChangeReportRow['customer'];
  agreement?: ChangeReportRow['agreement'];
  productKey: string;
  productCode?: string;
  productName: string;
  quantity: number;
};

type IdentityGroup = Omit<CountGroup, 'quantity'> & {
  items: Map<string, ChangeReportItem>;
};

export function isChangeReportMode(value: string | undefined): value is ChangeReportMode {
  return changeReportModes.includes(value as ChangeReportMode);
}

export function changeReportModeLabel(mode: ChangeReportMode) {
  if (mode === 'users') return 'Email users';
  if (mode === 'devices') return 'Devices';
  if (mode === 'microsoft365-license-counts') return 'M365 license counts';
  return 'Counts';
}

export async function getChangeReport(
  database: Queryable,
  comparisons: ChangeReportComparisonInput[],
  options: { now?: string } = {},
): Promise<ChangeReport> {
  const generatedAt = options.now ?? new Date().toISOString();
  const comparisonReports: ChangeReportComparison[] = [];

  for (const [index, comparison] of comparisons.entries()) {
    const mode = comparison.mode ?? 'counts';
    const vendorName = integrationDisplayName(comparison.vendorId);
    const metadataEntities = metadataEntitiesForMode(comparison.vendorId, mode);
    const [startSyncRun, endSyncRun] = await Promise.all([
      loadSyncRun(database, comparison.vendorId, comparison.startSyncRunId, metadataEntities),
      loadSyncRun(database, comparison.vendorId, comparison.endSyncRunId, metadataEntities),
    ]);

    if (!startSyncRun || !endSyncRun) {
      comparisonReports.push({
        id: comparisonId(comparison, index),
        vendorId: comparison.vendorId,
        vendorName,
        mode,
        modeLabel: changeReportModeLabel(mode),
        status: 'unavailable',
        message: missingSyncRunMessage(vendorName, startSyncRun, endSyncRun),
        startSyncRun: startSyncRun ?? missingSyncRun(comparison.startSyncRunId),
        endSyncRun: endSyncRun ?? missingSyncRun(comparison.endSyncRunId),
        summary: emptySummary(1),
        rows: [],
      });
      continue;
    }

    const [startRows, endRows] = await Promise.all([
      loadSnapshots(database, comparison.vendorId, comparison.startSyncRunId, mode),
      loadSnapshots(database, comparison.vendorId, comparison.endSyncRunId, mode),
    ]);
    const rows =
      mode === 'users' || mode === 'devices'
        ? buildIdentityChangeRows(comparison.vendorId, mode, startRows, endRows)
        : buildCountChangeRows(comparison.vendorId, startRows, endRows);

    comparisonReports.push({
      id: comparisonId(comparison, index),
      vendorId: comparison.vendorId,
      vendorName,
      mode,
      modeLabel: changeReportModeLabel(mode),
      status: 'ready',
      startSyncRun,
      endSyncRun,
      summary: summarizeRows(rows, 1),
      rows,
    });
  }

  return {
    reportType: 'change-report',
    generatedAt,
    summary: summarizeComparisons(comparisonReports),
    comparisons: comparisonReports,
  };
}

async function loadSyncRun(
  database: Queryable,
  vendorId: IntegrationId,
  syncRunId: string,
  metadataEntities?: string[],
): Promise<ChangeReportSyncRun | undefined> {
  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = $2
       and ($3::text[] is null or coalesce(metadata->>'entity', '') = any($3::text[]))
     limit 1`,
    [syncRunId, vendorId, metadataEntities ?? null],
  );
  const row = result.rows[0];
  return row ? mapSyncRun(row) : undefined;
}

async function loadSnapshots(
  database: Queryable,
  vendorId: IntegrationId,
  syncRunId: string,
  mode: ChangeReportMode,
): Promise<SnapshotRecord[]> {
  const rows =
    vendorId === 'microsoft-365' && mode === 'microsoft365-license-counts'
      ? await loadMicrosoft365LicenseSnapshots(database, syncRunId)
      : await loadVendorUsageSnapshots(database, vendorId, syncRunId);

  return rows.map((row) => mapSnapshotRow(row, vendorId));
}

async function loadVendorUsageSnapshots(database: Queryable, vendorId: IntegrationId, syncRunId: string) {
  const result = await database.query<SnapshotRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.id,
         vendor_usage_snapshots.vendor_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as effective_customer_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.agreement_id
           else vendor_usage_snapshots.agreement_id
         end as effective_agreement_id,
         vendor_usage_snapshots.external_account_id,
         vendor_usage_snapshots.vendor_product_key,
         vendor_usage_snapshots.product_code,
         vendor_usage_snapshots.product_name,
         vendor_usage_snapshots.quantity,
         vendor_usage_snapshots.observed_at,
         vendor_usage_snapshots.dimensions
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = $2
     )
     select
       mapped_snapshots.id,
       $2::text as vendor_id,
       mapped_snapshots.effective_customer_id as customer_id,
       customers.connectwise_company_id,
       customers.name as customer_name,
       mapped_snapshots.effective_agreement_id as agreement_id,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions
     from mapped_snapshots
     left join customers
       on customers.id = mapped_snapshots.effective_customer_id
     left join agreements
       on agreements.id = mapped_snapshots.effective_agreement_id
     order by customers.name nulls last,
              agreements.name nulls last,
              mapped_snapshots.external_account_id,
              mapped_snapshots.product_name`,
    [syncRunId, vendorId],
  );

  return result.rows;
}

async function loadMicrosoft365LicenseSnapshots(database: Queryable, syncRunId: string) {
  const result = await database.query<SnapshotRow>(
    `with mapped_snapshots as (
       select
         microsoft365_subscription_snapshots.id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else microsoft365_subscription_snapshots.customer_id
         end as effective_customer_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.agreement_id
           else microsoft365_subscription_snapshots.agreement_id
         end as effective_agreement_id,
         microsoft365_subscription_snapshots.external_account_id,
         coalesce(
           microsoft365_subscription_snapshots.sku_part_number,
           microsoft365_subscription_snapshots.sku_id,
           microsoft365_subscription_snapshots.sku_name
         ) as product_key,
         coalesce(microsoft365_subscription_snapshots.sku_part_number, microsoft365_subscription_snapshots.sku_id) as product_code,
         coalesce(
           microsoft365_subscription_snapshots.sku_name,
           microsoft365_subscription_snapshots.sku_part_number,
           microsoft365_subscription_snapshots.sku_id,
           'Microsoft 365 license'
         ) as product_name,
         coalesce(
           microsoft365_subscription_snapshots.total_units,
           microsoft365_subscription_snapshots.assigned_units,
           microsoft365_subscription_snapshots.enabled_units,
           microsoft365_subscription_snapshots.subscription_count,
           0
         ) as quantity,
         microsoft365_subscription_snapshots.observed_at,
         microsoft365_subscription_snapshots.dimensions || jsonb_build_object(
           'tenantName', microsoft365_subscription_snapshots.tenant_name,
           'tenantDefaultDomainName', microsoft365_subscription_snapshots.tenant_default_domain_name,
           'skuId', microsoft365_subscription_snapshots.sku_id,
           'skuPartNumber', microsoft365_subscription_snapshots.sku_part_number,
           'skuName', microsoft365_subscription_snapshots.sku_name,
           'subscriptionStatus', microsoft365_subscription_snapshots.subscription_status,
           'capabilityStatus', microsoft365_subscription_snapshots.capability_status
         ) as dimensions
       from microsoft365_subscription_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'microsoft-365'
        and vendor_account_mappings.external_account_id = microsoft365_subscription_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where microsoft365_subscription_snapshots.sync_run_id = $1
     )
     select
       mapped_snapshots.id,
       'microsoft-365' as vendor_id,
       mapped_snapshots.effective_customer_id as customer_id,
       customers.connectwise_company_id,
       customers.name as customer_name,
       mapped_snapshots.effective_agreement_id as agreement_id,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.product_key as vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions
     from mapped_snapshots
     left join customers
       on customers.id = mapped_snapshots.effective_customer_id
     left join agreements
       on agreements.id = mapped_snapshots.effective_agreement_id
     order by customers.name nulls last,
              agreements.name nulls last,
              mapped_snapshots.external_account_id,
              mapped_snapshots.product_name`,
    [syncRunId],
  );

  return result.rows;
}

function buildCountChangeRows(vendorId: IntegrationId, startRows: SnapshotRecord[], endRows: SnapshotRecord[]) {
  const startGroups = countGroups(startRows);
  const endGroups = countGroups(endRows);
  const keys = new Set([...startGroups.keys(), ...endGroups.keys()]);
  const rows: ChangeReportRow[] = [];

  for (const key of keys) {
    const start = startGroups.get(key);
    const end = endGroups.get(key);
    const startCount = roundCount(start?.quantity ?? 0);
    const endCount = roundCount(end?.quantity ?? 0);
    const delta = roundCount(endCount - startCount);
    const changeType = changeTypeForCounts(startCount, endCount, delta);
    if (!changeType) {
      continue;
    }

    const source = end ?? start;
    if (!source) {
      continue;
    }

    rows.push({
      id: `${vendorId}:${key}`,
      changeType,
      customer: source.customer,
      agreement: source.agreement,
      productKey: source.productKey,
      productCode: source.productCode,
      productName: source.productName,
      startCount,
      endCount,
      delta,
      addedItems: [],
      removedItems: [],
    });
  }

  return rows.sort(compareChangeRows);
}

function buildIdentityChangeRows(
  vendorId: IntegrationId,
  mode: Extract<ChangeReportMode, 'users' | 'devices'>,
  startRows: SnapshotRecord[],
  endRows: SnapshotRecord[],
) {
  const startGroups = identityGroups(startRows, mode);
  const endGroups = identityGroups(endRows, mode);
  const keys = new Set([...startGroups.keys(), ...endGroups.keys()]);
  const rows: ChangeReportRow[] = [];

  for (const key of keys) {
    const start = startGroups.get(key);
    const end = endGroups.get(key);
    const source = end ?? start;
    if (!source) {
      continue;
    }

    const startItems = start?.items ?? new Map<string, ChangeReportItem>();
    const endItems = end?.items ?? new Map<string, ChangeReportItem>();
    const addedItems = [...endItems.entries()]
      .filter(([identity]) => !startItems.has(identity))
      .map(([, item]) => item)
      .sort(compareItems);
    const removedItems = [...startItems.entries()]
      .filter(([identity]) => !endItems.has(identity))
      .map(([, item]) => item)
      .sort(compareItems);

    if (addedItems.length === 0 && removedItems.length === 0) {
      continue;
    }

    const startCount = startItems.size;
    const endCount = endItems.size;
    const delta = endCount - startCount;

    rows.push({
      id: `${vendorId}:${mode}:${key}`,
      changeType: changeTypeForIdentity(startCount, endCount, delta),
      customer: source.customer,
      agreement: source.agreement,
      productKey: source.productKey,
      productCode: source.productCode,
      productName: source.productName,
      startCount,
      endCount,
      delta,
      addedItems,
      removedItems,
    });
  }

  return rows.sort(compareChangeRows);
}

function countGroups(rows: SnapshotRecord[]) {
  const groups = new Map<string, CountGroup>();

  for (const row of rows) {
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity = roundCount(existing.quantity + row.quantity);
      continue;
    }

    groups.set(key, {
      key,
      customer: customerFromSnapshot(row),
      agreement: agreementFromSnapshot(row),
      productKey: row.productKey,
      productCode: row.productCode,
      productName: row.productName,
      quantity: row.quantity,
    });
  }

  return groups;
}

function identityGroups(rows: SnapshotRecord[], mode: Extract<ChangeReportMode, 'users' | 'devices'>) {
  const groups = new Map<string, IdentityGroup>();

  for (const row of rows) {
    const item = mode === 'users' ? userItemFromSnapshot(row) : deviceItemFromSnapshot(row);
    if (!item) {
      continue;
    }

    const key = groupKey(row);
    const group = groups.get(key) ?? {
      key,
      customer: customerFromSnapshot(row),
      agreement: agreementFromSnapshot(row),
      productKey: row.productKey,
      productCode: row.productCode,
      productName: row.productName,
      items: new Map<string, ChangeReportItem>(),
    };
    if (!group.items.has(item.identity)) {
      group.items.set(item.identity, item);
    }
    groups.set(key, group);
  }

  return groups;
}

function userItemFromSnapshot(row: SnapshotRecord): ChangeReportItem | undefined {
  const email = normalizeEmail(
    stringValue(row.dimensions.email) ??
      stringValue(row.dimensions.mail) ??
      stringValue(row.dimensions.userPrincipalName) ??
      stringValue(row.dimensions.upn),
  );
  if (!email) {
    return undefined;
  }

  const displayName =
    stringValue(row.dimensions.displayName) ??
    stringValue(row.dimensions.name) ??
    stringValue(row.dimensions.userName) ??
    email;

  return {
    id: row.id,
    identity: email,
    displayName,
    observedAt: row.observedAt,
    details: compactDetails({
      Email: email,
      DisplayName: displayName === email ? null : displayName,
      Tenant: stringValue(row.dimensions.tenantName),
      Domain: normalizeDomain(domainFromEmail(email) ?? stringValue(row.dimensions.domain)),
      Product: row.productName,
      State: stringValue(row.dimensions.userState),
    }),
  };
}

function deviceItemFromSnapshot(row: SnapshotRecord): ChangeReportItem | undefined {
  const rawName =
    stringValue(row.dimensions.hostname) ??
    stringValue(row.dimensions.deviceName) ??
    stringValue(row.dimensions.computerName) ??
    stringValue(row.dimensions.agentComputerName) ??
    stringValue(row.dimensions.endpointName) ??
    stringValue(row.dimensions.name);
  const identity = normalizeHostname(rawName);
  if (!identity) {
    return undefined;
  }

  return {
    id: row.id,
    identity,
    displayName: rawName ?? identity,
    observedAt: row.observedAt,
    details: compactDetails({
      Hostname: rawName ?? identity,
      DeviceId: primitiveDetail(row.dimensions.deviceId ?? row.dimensions.ncentralDeviceId ?? row.dimensions.agentId),
      Site: stringValue(row.dimensions.siteName),
      OS: stringValue(row.dimensions.operatingSystem ?? row.dimensions.os ?? row.dimensions.osType),
      Product: row.productName,
      LastCheckIn: stringValue(
        row.dimensions.lastApplianceCheckinTime ??
          row.dimensions.lastCheckIn ??
          row.dimensions.lastActiveDate ??
          row.dimensions.lastSeen,
      ),
    }),
  };
}

function mapSnapshotRow(row: SnapshotRow, vendorId: IntegrationId): SnapshotRecord {
  const dimensions = recordFromJson(row.dimensions);
  const productKey =
    stringValue(row.vendor_product_key) ??
    stringValue(row.product_code) ??
    stringValue(row.product_name) ??
    'unknown-product';
  const productName = stringValue(row.product_name) ?? stringValue(row.product_code) ?? productKey;
  const customerName = customerDisplayName(row, dimensions);
  const customerKey =
    stringValue(row.customer_id) ??
    stringValue(row.external_account_id) ??
    stringValue(dimensions.customerId) ??
    stringValue(dimensions.customerName) ??
    normalizeKey(customerName) ??
    'unmapped-account';

  return {
    id: row.id,
    vendorId,
    customerId: stringValue(row.customer_id) ?? undefined,
    connectWiseCompanyId: stringValue(row.connectwise_company_id) ?? undefined,
    customerName,
    customerKey,
    agreementId: stringValue(row.agreement_id) ?? undefined,
    agreementName: stringValue(row.agreement_name) ?? undefined,
    externalAccountId: stringValue(row.external_account_id) ?? undefined,
    productKey,
    productCode: stringValue(row.product_code) ?? undefined,
    productName,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at) ?? new Date(0).toISOString(),
    dimensions,
  };
}

function groupKey(row: SnapshotRecord) {
  return [
    row.customerKey,
    row.agreementId ?? 'no-agreement',
    row.productKey,
  ].join('|');
}

function customerFromSnapshot(row: SnapshotRecord): ChangeReportRow['customer'] {
  return {
    customerId: row.customerId,
    connectWiseCompanyId: row.connectWiseCompanyId,
    customerName: row.customerName,
    externalAccountId: row.externalAccountId,
  };
}

function agreementFromSnapshot(row: SnapshotRecord): ChangeReportRow['agreement'] | undefined {
  if (!row.agreementId && !row.agreementName) {
    return undefined;
  }

  return {
    agreementId: row.agreementId,
    agreementName: row.agreementName,
  };
}

function customerDisplayName(row: SnapshotRow, dimensions: Record<string, unknown>) {
  return (
    stringValue(row.customer_name) ??
    stringValue(dimensions.customerName) ??
    stringValue(dimensions.coveCustomerName) ??
    stringValue(dimensions.ncentralCustomerName) ??
    stringValue(dimensions.tenantName) ??
    stringValue(dimensions.appRiverCustomerName) ??
    stringValue(dimensions.dattoCustomerName) ??
    stringValue(dimensions.organizationName) ??
    stringValue(dimensions.huntressOrganizationName) ??
    stringValue(dimensions.externalAccountName) ??
    stringValue(dimensions.domain) ??
    stringValue(row.external_account_id) ??
    'Unmapped account'
  );
}

function summarizeComparisons(comparisons: ChangeReportComparison[]): ChangeReportSummary {
  return comparisons.reduce(
    (summary, comparison) => ({
      comparisonCount: summary.comparisonCount + 1,
      changedRowCount: summary.changedRowCount + comparison.summary.changedRowCount,
      addedCount: summary.addedCount + comparison.summary.addedCount,
      removedCount: summary.removedCount + comparison.summary.removedCount,
      increasedCount: summary.increasedCount + comparison.summary.increasedCount,
      decreasedCount: summary.decreasedCount + comparison.summary.decreasedCount,
      changedCount: summary.changedCount + comparison.summary.changedCount,
      startTotal: roundCount(summary.startTotal + comparison.summary.startTotal),
      endTotal: roundCount(summary.endTotal + comparison.summary.endTotal),
      netQuantityDelta: roundCount(summary.netQuantityDelta + comparison.summary.netQuantityDelta),
      detailAddedCount: summary.detailAddedCount + comparison.summary.detailAddedCount,
      detailRemovedCount: summary.detailRemovedCount + comparison.summary.detailRemovedCount,
    }),
    emptySummary(0),
  );
}

function summarizeRows(rows: ChangeReportRow[], comparisonCount: number): ChangeReportSummary {
  const startTotal = roundCount(rows.reduce((total, row) => total + row.startCount, 0));
  const endTotal = roundCount(rows.reduce((total, row) => total + row.endCount, 0));

  return {
    comparisonCount,
    changedRowCount: rows.length,
    addedCount: rows.filter((row) => row.changeType === 'added').length,
    removedCount: rows.filter((row) => row.changeType === 'removed').length,
    increasedCount: rows.filter((row) => row.changeType === 'increased').length,
    decreasedCount: rows.filter((row) => row.changeType === 'decreased').length,
    changedCount: rows.filter((row) => row.changeType === 'changed').length,
    startTotal,
    endTotal,
    netQuantityDelta: roundCount(endTotal - startTotal),
    detailAddedCount: rows.reduce((total, row) => total + row.addedItems.length, 0),
    detailRemovedCount: rows.reduce((total, row) => total + row.removedItems.length, 0),
  };
}

function emptySummary(comparisonCount: number): ChangeReportSummary {
  return {
    comparisonCount,
    changedRowCount: 0,
    addedCount: 0,
    removedCount: 0,
    increasedCount: 0,
    decreasedCount: 0,
    changedCount: 0,
    startTotal: 0,
    endTotal: 0,
    netQuantityDelta: 0,
    detailAddedCount: 0,
    detailRemovedCount: 0,
  };
}

function changeTypeForCounts(
  startCount: number,
  endCount: number,
  delta: number,
): Exclude<ChangeReportChangeType, 'changed'> | undefined {
  if (delta === 0) return undefined;
  if (startCount === 0 && endCount > 0) return 'added';
  if (startCount > 0 && endCount === 0) return 'removed';
  return delta > 0 ? 'increased' : 'decreased';
}

function changeTypeForIdentity(startCount: number, endCount: number, delta: number): ChangeReportChangeType {
  if (startCount === 0 && endCount > 0) return 'added';
  if (startCount > 0 && endCount === 0) return 'removed';
  if (delta > 0) return 'increased';
  if (delta < 0) return 'decreased';
  return 'changed';
}

function compareChangeRows(left: ChangeReportRow, right: ChangeReportRow) {
  const changeRank: Record<ChangeReportChangeType, number> = {
    added: 0,
    removed: 1,
    increased: 2,
    decreased: 3,
    changed: 4,
  };

  return (
    left.customer.customerName.localeCompare(right.customer.customerName) ||
    changeRank[left.changeType] - changeRank[right.changeType] ||
    left.productName.localeCompare(right.productName) ||
    left.productKey.localeCompare(right.productKey)
  );
}

function compareItems(left: ChangeReportItem, right: ChangeReportItem) {
  return left.displayName.localeCompare(right.displayName) || left.identity.localeCompare(right.identity);
}

function metadataEntitiesForMode(vendorId: IntegrationId, mode: ChangeReportMode) {
  if (vendorId !== 'microsoft-365') {
    return undefined;
  }

  if (mode === 'microsoft365-license-counts') {
    return ['m365-licenses', 'license-snapshots'];
  }

  return ['m365-users', 'license-snapshots'];
}

function mapSyncRun(row: SyncRunRow): ChangeReportSyncRun {
  return {
    id: row.id,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
    status: row.status,
    recordsRead: integerValue(row.records_read),
    recordsWritten: integerValue(row.records_written),
    errorMessage: row.error_message ?? undefined,
    metadata: recordFromJson(row.metadata),
  };
}

function missingSyncRun(id: string): ChangeReportSyncRun {
  return {
    id,
    startedAt: new Date(0).toISOString(),
    status: 'missing',
    recordsRead: 0,
    recordsWritten: 0,
    metadata: {},
  };
}

function missingSyncRunMessage(
  vendorName: string,
  startSyncRun: ChangeReportSyncRun | undefined,
  endSyncRun: ChangeReportSyncRun | undefined,
) {
  if (!startSyncRun && !endSyncRun) {
    return `${vendorName} start and end snapshots were not found.`;
  }

  if (!startSyncRun) {
    return `${vendorName} start snapshot was not found.`;
  }

  return `${vendorName} end snapshot was not found.`;
}

function comparisonId(input: ChangeReportComparisonInput, index: number) {
  return `${index + 1}:${input.vendorId}:${input.mode ?? 'counts'}:${input.startSyncRunId}:${input.endSyncRunId}`;
}

function integrationDisplayName(integrationId: IntegrationId) {
  return getIntegrationSettingsDefinition(integrationId)?.displayName ?? integrationId;
}

function compactDetails(values: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as Record<string, string | number | boolean | null>;
}

function primitiveDetail(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return recordFromJson(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function integerValue(value: unknown) {
  return Math.trunc(numericValue(value));
}

function roundCount(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeKey(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || undefined;
}

function normalizeEmail(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes('@') ? normalized : undefined;
}

function normalizeHostname(value: string | undefined) {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .split('.')[0]
    ?.replace(/[^a-z0-9-]+/g, '');
  return normalized || undefined;
}

function normalizeDomain(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/^@+/, '') || undefined;
}

function domainFromEmail(value: string | undefined) {
  const email = normalizeEmail(value);
  return email?.split('@')[1];
}
