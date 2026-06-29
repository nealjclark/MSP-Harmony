import { getIntegrationSettingsDefinition } from '../../shared/integrationSettings';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type DiscrepancyBasis = 'user' | 'device';
export type DiscrepancySeverity = 'matched' | 'warning' | 'critical' | 'unavailable';
export type DiscrepancyMatchingStrategy = 'normalized-hostname' | 'email-upn' | 'aggregate-count';

export type DiscrepancyComparisonDefinition = {
  id: string;
  label: string;
  basis: DiscrepancyBasis;
  leftVendorId: string;
  leftVendorName: string;
  rightVendorId: string;
  rightVendorName: string;
  matchingStrategy: DiscrepancyMatchingStrategy;
  productFamily: string;
  aggregateOnly: boolean;
};

export type DiscrepancyItem = {
  id: string;
  identity: string;
  displayName: string;
  vendorId: string;
  productKey?: string;
  productName?: string;
  domain?: string;
  observedAt?: string;
  details: Record<string, string | number | boolean | null>;
};

export type DiscrepancyRow = {
  id: string;
  customer: {
    customerId?: string;
    connectWiseCompanyId?: string;
    customerName: string;
  };
  comparisonPair: DiscrepancyComparisonDefinition;
  basis: DiscrepancyBasis;
  productFamily: string;
  domain?: string;
  leftCount: number;
  rightCount: number;
  delta: number;
  status: DiscrepancySeverity;
  stale: boolean;
  aggregateOnly: boolean;
  unavailableReason?: string;
  missingFromLeft: DiscrepancyItem[];
  missingFromRight: DiscrepancyItem[];
  referenceItems: DiscrepancyItem[];
  syncTimestamps: {
    left?: string;
    right?: string;
  };
};

export type DiscrepancyReport = {
  reportType: 'discrepancies';
  generatedAt: string;
  filters: {
    customerId?: string;
    basis?: DiscrepancyBasis;
    severity?: DiscrepancySeverity;
    includeMatched: boolean;
  };
  summary: {
    comparisonCount: number;
    rowCount: number;
    openDiscrepancyCount: number;
    warningCount: number;
    criticalCount: number;
    unavailableCount: number;
    matchedCount: number;
    deviceGapCount: number;
    userGapCount: number;
    staleSourceCount: number;
    customerCount: number;
  };
  comparisonPairs: DiscrepancyComparisonDefinition[];
  customers: Array<{
    customerId: string;
    connectWiseCompanyId?: string;
    customerName: string;
  }>;
  rows: DiscrepancyRow[];
};

export type DiscrepancyReportOptions = {
  customerId?: string;
  basis?: DiscrepancyBasis;
  severity?: DiscrepancySeverity;
  includeMatched?: boolean;
  now?: string;
};

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  metadata: unknown;
};

type SyncRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
};

type SnapshotRow = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  connectwise_company_id: string | null;
  customer_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
};

type SnapshotRecord = {
  id: string;
  vendorId: string;
  customerId?: string;
  connectWiseCompanyId?: string;
  customerName?: string;
  externalAccountId?: string;
  vendorProductKey?: string;
  productCode: string;
  productName: string;
  quantity: number;
  observedAt: string;
  dimensions: Record<string, unknown>;
};

type VendorSnapshotSet = {
  vendorId: string;
  syncRun?: SyncRun;
  rows: SnapshotRecord[];
};

type ComparisonItem = DiscrepancyItem & {
  customerId: string;
  customerName: string;
  connectWiseCompanyId?: string;
};

type AggregateGroup = {
  key: string;
  customerId: string;
  customerName: string;
  connectWiseCompanyId?: string;
  productKey: string;
  productName: string;
  domain?: string;
  quantity: number;
  items: ComparisonItem[];
};

const microsoft365UserSyncEntities = ['m365-users', 'license-snapshots'];

export const discrepancyComparisonDefinitions: DiscrepancyComparisonDefinition[] = [
  comparisonDefinition({
    id: 'ncentral-sentinelone-devices',
    label: 'N-central vs SentinelOne devices',
    basis: 'device',
    leftVendorId: 'ncentral',
    rightVendorId: 'sentinelone',
    matchingStrategy: 'normalized-hostname',
    productFamily: 'Endpoint devices',
    aggregateOnly: false,
  }),
  comparisonDefinition({
    id: 'appriver-microsoft365-users',
    label: 'AppRiver vs Microsoft 365 mailbox users',
    basis: 'user',
    leftVendorId: 'opentext-appriver',
    rightVendorId: 'microsoft-365',
    matchingStrategy: 'aggregate-count',
    productFamily: 'Licensed mailbox users',
    aggregateOnly: true,
  }),
  comparisonDefinition({
    id: 'proofpoint-microsoft365-users',
    label: 'Proofpoint vs Microsoft 365 mailbox users',
    basis: 'user',
    leftVendorId: 'proofpoint',
    rightVendorId: 'microsoft-365',
    matchingStrategy: 'aggregate-count',
    productFamily: 'Licensed mailbox users',
    aggregateOnly: true,
  }),
  comparisonDefinition({
    id: 'huntress-microsoft365-users',
    label: 'Huntress vs Microsoft 365 mailbox users',
    basis: 'user',
    leftVendorId: 'huntress',
    rightVendorId: 'microsoft-365',
    matchingStrategy: 'aggregate-count',
    productFamily: 'Licensed mailbox users',
    aggregateOnly: true,
  }),
];

export async function getDiscrepancyReport(
  database: Queryable,
  options: DiscrepancyReportOptions = {},
): Promise<DiscrepancyReport> {
  const generatedAt = options.now ?? new Date().toISOString();
  const definitions = discrepancyComparisonDefinitions.filter((definition) =>
    options.basis ? definition.basis === options.basis : true,
  );
  const snapshotCache = new Map<string, Promise<VendorSnapshotSet>>();
  const loadSide = (vendorId: string) => {
    const existing = snapshotCache.get(vendorId);
    if (existing) return existing;

    const loaded = loadVendorSnapshotSet(database, vendorId);
    snapshotCache.set(vendorId, loaded);
    return loaded;
  };

  const rows: DiscrepancyRow[] = [];
  for (const definition of definitions) {
    const [left, right] = await Promise.all([
      loadSide(definition.leftVendorId),
      loadSide(definition.rightVendorId),
    ]);
    const pairRows =
      definition.matchingStrategy === 'normalized-hostname'
        ? buildItemComparisonRows(definition, left, right, generatedAt)
        : buildAggregateUserRows(definition, left, right, generatedAt);
    rows.push(...pairRows);
  }

  const filteredRows = rows
    .filter((row) => (options.customerId ? row.customer.customerId === options.customerId : true))
    .filter((row) => (options.severity ? row.status === options.severity : true))
    .filter((row) => (options.includeMatched ? true : row.status !== 'matched'))
    .sort(compareRows);

  return {
    reportType: 'discrepancies',
    generatedAt,
    filters: {
      customerId: options.customerId,
      basis: options.basis,
      severity: options.severity,
      includeMatched: options.includeMatched === true,
    },
    summary: buildSummary(filteredRows, definitions.length),
    comparisonPairs: definitions,
    customers: customersForRows(rows),
    rows: filteredRows,
  };
}

export function isDiscrepancyBasis(value: string | undefined): value is DiscrepancyBasis {
  return value === 'user' || value === 'device';
}

export function isDiscrepancySeverity(value: string | undefined): value is DiscrepancySeverity {
  return value === 'matched' || value === 'warning' || value === 'critical' || value === 'unavailable';
}

async function loadVendorSnapshotSet(database: Queryable, vendorId: string): Promise<VendorSnapshotSet> {
  const syncRun = await loadLatestSyncRun(
    database,
    vendorId,
    vendorId === 'microsoft-365' ? microsoft365UserSyncEntities : undefined,
  );
  if (!syncRun) {
    return {
      vendorId,
      rows: [],
    };
  }

  const result = await database.query<SnapshotRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.id,
         vendor_usage_snapshots.vendor_id,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as customer_id,
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
       where vendor_usage_snapshots.vendor_id = $1
         and vendor_usage_snapshots.sync_run_id = $2::uuid
     )
     select
       mapped_snapshots.*,
       customers.connectwise_company_id,
       customers.name as customer_name
     from mapped_snapshots
     left join customers
       on customers.id = mapped_snapshots.customer_id
     where mapped_snapshots.customer_id is not null
     order by customers.name, mapped_snapshots.product_name, mapped_snapshots.observed_at`,
    [vendorId, syncRun.id],
  );

  return {
    vendorId,
    syncRun,
    rows: result.rows.map(mapSnapshotRow),
  };
}

async function loadLatestSyncRun(
  database: Queryable,
  vendorId: string,
  metadataEntities?: string[],
): Promise<SyncRun | undefined> {
  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, metadata
     from sync_runs
     where integration_id = $1
       and status = 'complete'
       and ($2::text[] is null or coalesce(metadata->>'entity', '') = any($2::text[]))
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [vendorId, metadataEntities ?? null],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
  };
}

function buildItemComparisonRows(
  definition: DiscrepancyComparisonDefinition,
  left: VendorSnapshotSet,
  right: VendorSnapshotSet,
  now: string,
): DiscrepancyRow[] {
  const noDataRows = unavailableRows(definition, left, right, now);
  if (noDataRows) {
    return noDataRows;
  }

  const leftItems = uniqueItems(left.rows.flatMap(deviceItemFromSnapshot));
  const rightItems = uniqueItems(right.rows.flatMap(deviceItemFromSnapshot));
  const customerIds = new Set([...leftItems, ...rightItems].map((item) => item.customerId));

  return [...customerIds].flatMap((customerId) => {
    const leftCustomerItems = leftItems.filter((item) => item.customerId === customerId);
    const rightCustomerItems = rightItems.filter((item) => item.customerId === customerId);
    if (leftCustomerItems.length === 0 && rightCustomerItems.length === 0) {
      return [];
    }

    const customer = customerForItems(leftCustomerItems, rightCustomerItems);
    const leftByIdentity = new Map(leftCustomerItems.map((item) => [item.identity, item]));
    const rightByIdentity = new Map(rightCustomerItems.map((item) => [item.identity, item]));
    const missingFromLeft = rightCustomerItems.filter((item) => !leftByIdentity.has(item.identity));
    const missingFromRight = leftCustomerItems.filter((item) => !rightByIdentity.has(item.identity));
    const leftCount = leftCustomerItems.length;
    const rightCount = rightCustomerItems.length;
    const delta = leftCount - rightCount;
    const mismatchScore = Math.max(Math.abs(delta), missingFromLeft.length, missingFromRight.length);

    return [
      {
        id: `${definition.id}:${customerId}`,
        customer,
        comparisonPair: definition,
        basis: definition.basis,
        productFamily: definition.productFamily,
        leftCount,
        rightCount,
        delta,
        status: severityForMismatch(mismatchScore),
        stale: sideIsStale(left, now) || sideIsStale(right, now),
        aggregateOnly: definition.aggregateOnly,
        missingFromLeft,
        missingFromRight,
        referenceItems: [],
        syncTimestamps: syncTimestamps(left, right),
      },
    ];
  });
}

function buildAggregateUserRows(
  definition: DiscrepancyComparisonDefinition,
  left: VendorSnapshotSet,
  right: VendorSnapshotSet,
  now: string,
): DiscrepancyRow[] {
  const noDataRows = unavailableRows(definition, left, right, now);
  if (noDataRows) {
    return noDataRows;
  }

  const sourceGroups = aggregateGroupsFromSnapshots(left.rows, definition.leftVendorId);
  if (sourceGroups.length === 0) {
    return [
      unavailableRow(
        definition,
        left,
        right,
        now,
        `${definition.leftVendorName} has a complete sync but no aggregate user-count rows to compare.`,
      ),
    ];
  }

  const microsoftUsers = uniqueItems(right.rows.flatMap(microsoftExchangeUserItemFromSnapshot));

  return sourceGroups.map((group) => {
    const referenceItems = microsoftUsers.filter(
      (item) =>
        item.customerId === group.customerId &&
        (!group.domain || item.domain === group.domain),
    );
    const leftCount = group.quantity;
    const rightCount = referenceItems.length;
    const delta = leftCount - rightCount;

    return {
      id: `${definition.id}:${group.key}`,
      customer: {
        customerId: group.customerId,
        connectWiseCompanyId: group.connectWiseCompanyId,
        customerName: group.customerName,
      },
      comparisonPair: definition,
      basis: definition.basis,
      productFamily: group.productName || definition.productFamily,
      domain: group.domain,
      leftCount,
      rightCount,
      delta,
      status: severityForMismatch(Math.abs(delta)),
      stale: sideIsStale(left, now) || sideIsStale(right, now),
      aggregateOnly: true,
      missingFromLeft: [],
      missingFromRight: [],
      referenceItems,
      syncTimestamps: syncTimestamps(left, right),
    };
  });
}

function unavailableRows(
  definition: DiscrepancyComparisonDefinition,
  left: VendorSnapshotSet,
  right: VendorSnapshotSet,
  now: string,
) {
  if (!left.syncRun && !right.syncRun) {
    return [
      unavailableRow(
        definition,
        left,
        right,
        now,
        `No complete ${definition.leftVendorName} or ${definition.rightVendorName} sync is available yet.`,
      ),
    ];
  }

  if (!left.syncRun) {
    return [
      unavailableRow(definition, left, right, now, `No complete ${definition.leftVendorName} sync is available yet.`),
    ];
  }

  if (!right.syncRun) {
    return [
      unavailableRow(definition, left, right, now, `No complete ${definition.rightVendorName} sync is available yet.`),
    ];
  }

  if (left.rows.length === 0 || right.rows.length === 0) {
    const emptySide = left.rows.length === 0 ? definition.leftVendorName : definition.rightVendorName;
    return [
      unavailableRow(
        definition,
        left,
        right,
        now,
        `${emptySide} has a complete sync but no mapped rows for this comparison.`,
      ),
    ];
  }

  return undefined;
}

function unavailableRow(
  definition: DiscrepancyComparisonDefinition,
  left: VendorSnapshotSet,
  right: VendorSnapshotSet,
  now: string,
  reason: string,
): DiscrepancyRow {
  return {
    id: `${definition.id}:unavailable`,
    customer: {
      customerName: 'All customers',
    },
    comparisonPair: definition,
    basis: definition.basis,
    productFamily: definition.productFamily,
    leftCount: 0,
    rightCount: 0,
    delta: 0,
    status: 'unavailable',
    stale: sideIsStale(left, now) || sideIsStale(right, now),
    aggregateOnly: definition.aggregateOnly,
    unavailableReason: reason,
    missingFromLeft: [],
    missingFromRight: [],
    referenceItems: [],
    syncTimestamps: syncTimestamps(left, right),
  };
}

function aggregateGroupsFromSnapshots(rows: SnapshotRecord[], vendorId: string) {
  const groups = new Map<string, AggregateGroup>();

  for (const row of rows) {
    if (!row.customerId) {
      continue;
    }

    const domain = normalizeDomain(
      stringValue(row.dimensions.domain) ??
        domainFromEmail(stringValue(row.dimensions.email) ?? stringValue(row.dimensions.userPrincipalName)) ??
        stringValue(row.dimensions.tenantDefaultDomainName),
    );
    const productKey = row.vendorProductKey ?? row.productCode ?? row.productName;
    const key = [row.customerId, domain ?? 'no-domain', productKey].join('|');
    const existing = groups.get(key) ?? {
      key,
      customerId: row.customerId,
      customerName: row.customerName ?? row.customerId,
      connectWiseCompanyId: row.connectWiseCompanyId,
      productKey,
      productName: row.productName,
      domain,
      quantity: 0,
      items: [],
    };

    existing.quantity += row.quantity;
    existing.items.push({
      id: row.id,
      identity: productKey,
      displayName: row.productName,
      vendorId,
      productKey,
      productName: row.productName,
      domain,
      observedAt: row.observedAt,
      customerId: row.customerId,
      customerName: row.customerName ?? row.customerId,
      connectWiseCompanyId: row.connectWiseCompanyId,
      details: {
        Domain: domain ?? null,
        Quantity: row.quantity,
        Product: row.productName,
      },
    });
    groups.set(key, existing);
  }

  return [...groups.values()].sort(
    (left, right) =>
      left.customerName.localeCompare(right.customerName) ||
      (left.domain ?? '').localeCompare(right.domain ?? '') ||
      left.productName.localeCompare(right.productName),
  );
}

function deviceItemFromSnapshot(row: SnapshotRecord): ComparisonItem[] {
  if (!row.customerId) {
    return [];
  }

  const rawName =
    stringValue(row.dimensions.hostname) ??
    stringValue(row.dimensions.deviceName) ??
    stringValue(row.dimensions.computerName) ??
    stringValue(row.dimensions.agentComputerName) ??
    stringValue(row.dimensions.endpointName) ??
    stringValue(row.dimensions.name);
  const identity = normalizeHostname(rawName);
  if (!identity) {
    return [];
  }

  return [
    {
      id: row.id,
      identity,
      displayName: rawName ?? identity,
      vendorId: row.vendorId,
      productKey: row.vendorProductKey,
      productName: row.productName,
      observedAt: row.observedAt,
      customerId: row.customerId,
      customerName: row.customerName ?? row.customerId,
      connectWiseCompanyId: row.connectWiseCompanyId,
      details: {
        Hostname: rawName ?? identity,
        DeviceId: primitiveDetail(row.dimensions.ncentralDeviceId ?? row.dimensions.deviceId ?? row.dimensions.agentId),
        Site: stringValue(row.dimensions.siteName) ?? null,
        OS: stringValue(row.dimensions.operatingSystem ?? row.dimensions.os) ?? null,
        Product: row.productName,
      },
    },
  ];
}

function microsoftExchangeUserItemFromSnapshot(row: SnapshotRecord): ComparisonItem[] {
  if (!row.customerId || !isActiveMicrosoftUser(row.dimensions) || !hasExchangeServicePlan(row.dimensions)) {
    return [];
  }

  const email = normalizeEmail(
    stringValue(row.dimensions.email) ??
      stringValue(row.dimensions.mail) ??
      stringValue(row.dimensions.userPrincipalName),
  );
  if (!email) {
    return [];
  }

  const domain = normalizeDomain(domainFromEmail(email) ?? stringValue(row.dimensions.tenantDefaultDomainName));
  return [
    {
      id: row.id,
      identity: email,
      displayName: stringValue(row.dimensions.displayName) ?? email,
      vendorId: row.vendorId,
      productKey: row.vendorProductKey,
      productName: row.productName,
      domain,
      observedAt: row.observedAt,
      customerId: row.customerId,
      customerName: row.customerName ?? row.customerId,
      connectWiseCompanyId: row.connectWiseCompanyId,
      details: {
        Email: email,
        DisplayName: stringValue(row.dimensions.displayName) ?? null,
        Tenant: stringValue(row.dimensions.tenantName) ?? null,
        Domain: domain ?? null,
        Sku: stringValue(row.dimensions.skuName ?? row.dimensions.skuPartNumber) ?? null,
      },
    },
  ];
}

function isActiveMicrosoftUser(dimensions: Record<string, unknown>) {
  if (dimensions.accountEnabled === false) {
    return false;
  }

  const userState = stringValue(dimensions.userState);
  return !userState || !/disabled|inactive/i.test(userState);
}

function hasExchangeServicePlan(dimensions: Record<string, unknown>) {
  const servicePlans = dimensions.servicePlans;
  if (!Array.isArray(servicePlans)) {
    return false;
  }

  return servicePlans.some((item) => {
    const record = recordFromJson(item);
    const serviceName = stringValue(record.serviceName) ?? stringValue(record.displayName);
    const status = stringValue(record.capabilityStatus);
    return Boolean(serviceName && /exchange/i.test(serviceName) && !/disabled|suspended/i.test(status ?? ''));
  });
}

function uniqueItems(items: ComparisonItem[]) {
  const byIdentity = new Map<string, ComparisonItem>();
  for (const item of items) {
    const key = `${item.customerId}|${item.identity}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, item);
    }
  }

  return [...byIdentity.values()].sort(
    (left, right) =>
      left.customerName.localeCompare(right.customerName) ||
      left.displayName.localeCompare(right.displayName) ||
      left.identity.localeCompare(right.identity),
  );
}

function customerForItems(left: ComparisonItem[], right: ComparisonItem[]) {
  const first = left[0] ?? right[0];
  return {
    customerId: first?.customerId,
    connectWiseCompanyId: first?.connectWiseCompanyId,
    customerName: first?.customerName ?? 'Unknown customer',
  };
}

function severityForMismatch(score: number): DiscrepancySeverity {
  if (score <= 0) return 'matched';
  if (score <= 2) return 'warning';
  return 'critical';
}

function sideIsStale(side: VendorSnapshotSet, now: string) {
  const syncTime = side.syncRun?.completedAt ?? side.syncRun?.startedAt;
  if (!syncTime) {
    return false;
  }

  const observed = Date.parse(syncTime);
  const anchor = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(anchor)) {
    return false;
  }

  return anchor - observed > staleThresholdMs(side.vendorId);
}

function staleThresholdMs(vendorId: string) {
  const frequency = getIntegrationSettingsDefinition(vendorId as never)?.syncFrequency;
  if (frequency === 'hourly') return 2 * 60 * 60 * 1000;
  if (frequency === 'weekly') return 8 * 24 * 60 * 60 * 1000;
  if (frequency === 'manual') return Number.POSITIVE_INFINITY;
  return 36 * 60 * 60 * 1000;
}

function syncTimestamps(left: VendorSnapshotSet, right: VendorSnapshotSet) {
  return {
    left: left.syncRun?.completedAt ?? left.syncRun?.startedAt,
    right: right.syncRun?.completedAt ?? right.syncRun?.startedAt,
  };
}

function buildSummary(rows: DiscrepancyRow[], comparisonCount: number): DiscrepancyReport['summary'] {
  const staleSources = new Set<string>();
  for (const row of rows) {
    if (!row.stale) continue;
    if (row.syncTimestamps.left) staleSources.add(`${row.comparisonPair.leftVendorId}:${row.syncTimestamps.left}`);
    if (row.syncTimestamps.right) staleSources.add(`${row.comparisonPair.rightVendorId}:${row.syncTimestamps.right}`);
  }

  return {
    comparisonCount,
    rowCount: rows.length,
    openDiscrepancyCount: rows.filter((row) => row.status === 'warning' || row.status === 'critical').length,
    warningCount: rows.filter((row) => row.status === 'warning').length,
    criticalCount: rows.filter((row) => row.status === 'critical').length,
    unavailableCount: rows.filter((row) => row.status === 'unavailable').length,
    matchedCount: rows.filter((row) => row.status === 'matched').length,
    deviceGapCount: rows.filter((row) => row.basis === 'device' && (row.status === 'warning' || row.status === 'critical')).length,
    userGapCount: rows.filter((row) => row.basis === 'user' && (row.status === 'warning' || row.status === 'critical')).length,
    staleSourceCount: staleSources.size,
    customerCount: new Set(rows.map((row) => row.customer.customerId).filter(Boolean)).size,
  };
}

function customersForRows(rows: DiscrepancyRow[]) {
  const byId = new Map<string, { customerId: string; connectWiseCompanyId?: string; customerName: string }>();
  for (const row of rows) {
    const customerId = row.customer.customerId;
    if (!customerId || byId.has(customerId)) {
      continue;
    }

    byId.set(customerId, {
      customerId,
      connectWiseCompanyId: row.customer.connectWiseCompanyId,
      customerName: row.customer.customerName,
    });
  }

  return [...byId.values()].sort((left, right) => left.customerName.localeCompare(right.customerName));
}

function compareRows(left: DiscrepancyRow, right: DiscrepancyRow) {
  const severityRank: Record<DiscrepancySeverity, number> = {
    critical: 0,
    warning: 1,
    unavailable: 2,
    matched: 3,
  };

  return (
    severityRank[left.status] - severityRank[right.status] ||
    left.customer.customerName.localeCompare(right.customer.customerName) ||
    left.comparisonPair.label.localeCompare(right.comparisonPair.label) ||
    left.productFamily.localeCompare(right.productFamily) ||
    (left.domain ?? '').localeCompare(right.domain ?? '')
  );
}

function comparisonDefinition(
  input: Omit<DiscrepancyComparisonDefinition, 'leftVendorName' | 'rightVendorName'>,
): DiscrepancyComparisonDefinition {
  return {
    ...input,
    leftVendorName: integrationDisplayName(input.leftVendorId),
    rightVendorName: integrationDisplayName(input.rightVendorId),
  };
}

function integrationDisplayName(vendorId: string) {
  if (vendorId === 'huntress') return 'Huntress';
  return getIntegrationSettingsDefinition(vendorId as never)?.displayName ?? vendorId;
}

function mapSnapshotRow(row: SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    customerId: row.customer_id ?? undefined,
    connectWiseCompanyId: row.connectwise_company_id ?? undefined,
    customerName: row.customer_name ?? undefined,
    externalAccountId: row.external_account_id ?? undefined,
    vendorProductKey: row.vendor_product_key ?? undefined,
    productCode: row.product_code,
    productName: row.product_name,
    quantity: numericValue(row.quantity),
    observedAt: isoDate(row.observed_at) ?? new Date(0).toISOString(),
    dimensions: recordFromJson(row.dimensions),
  };
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

function normalizeEmail(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes('@') ? normalized : undefined;
}

function normalizeDomain(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/^@+/, '') || undefined;
}

function domainFromEmail(value: string | undefined) {
  const email = normalizeEmail(value);
  return email?.split('@')[1];
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

function primitiveDetail(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
