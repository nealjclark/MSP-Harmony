import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import { NcentralClient, ncentralCredentialsFromSettings, type NcentralDeviceFilter, type NcentralDeviceSummary } from './client';
import {
  ensureDefaultNcentralFilterMappings,
  listNcentralFilterMappings,
  updateNcentralMappingResolvedFilterId,
  type NcentralFilterMapping,
} from './filterMappings';
import {
  buildNcentralRuleSet,
  defaultNcentralProductMappings,
  isNcentralProductMappingKey,
  productTypeForKey,
  type NcentralProductMapping,
  type NcentralProductMappingKey,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type NcentralUsageClient = {
  authenticate: () => Promise<unknown>;
  validateToken?: () => Promise<void>;
  listDeviceFilters: (options?: { pageSize?: number; maxPages?: number }) => Promise<NcentralDeviceFilter[]>;
  listDevicesByFilter: (filterId: string, options?: { pageSize?: number; maxPages?: number }) => Promise<NcentralDeviceSummary[]>;
  enrichDevicesWithDetails?: (
    devices: NcentralDeviceSummary[],
    options?: { concurrency?: number },
  ) => Promise<Map<number, NcentralDeviceSummary & { lastApplianceCheckinTime?: string }>>;
};

export type NcentralConnectionTestResult = {
  integrationId: 'ncentral';
  testedAt: string;
  filterCount: number;
  sampleFilters: Array<{ filterId: string; filterName: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type NcentralUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedSnapshots: number;
  productSnapshots: Record<string, number>;
  overlayMatches: Record<string, number>;
  detailEnrichedSnapshots: number;
};

type VendorAccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string | null;
};

type VendorProductMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

type AggregatedDevice = {
  device: NcentralDeviceSummary;
  productMappings: NcentralFilterMapping[];
  overlayMappings: NcentralFilterMapping[];
};

export async function testNcentralConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: NcentralUsageClient;
  now?: string;
} = {}): Promise<NcentralConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('ncentral');
  assertNcentralReady(settings);

  const client = input.client ?? new NcentralClient(ncentralCredentialsFromSettings(settings));
  await client.authenticate();
  await client.validateToken?.();
  const filters = await client.listDeviceFilters({ pageSize: 25, maxPages: 1 });

  return {
    integrationId: 'ncentral',
    testedAt: input.now ?? new Date().toISOString(),
    filterCount: filters.length,
    sampleFilters: filters.slice(0, 5).map((filter) => ({
      filterId: filter.filterId,
      filterName: filter.filterName,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncNcentralUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: NcentralUsageClient;
  pageSize?: number;
  maxPages?: number;
  detailConcurrency?: number;
  enrichDetails?: boolean;
  now?: string;
}): Promise<NcentralUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('ncentral');
  assertNcentralReady(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startNcentralSyncRun(input.pool);
  const client = input.client ?? new NcentralClient(ncentralCredentialsFromSettings(settings));

  try {
    await ensureDefaultNcentralFilterMappings(input.pool);
    const [accountMappings, productMappings, savedMappings, filters] = await Promise.all([
      loadNcentralAccountMappings(input.pool),
      loadNcentralProductMappings(input.pool),
      listNcentralFilterMappings(input.pool),
      client.listDeviceFilters({ pageSize: 500, maxPages: 20 }),
    ]);
    const activeMappings = resolveFilterMappings(savedMappings.filter((mapping) => mapping.active), filters);
    const aggregatedDevices = await loadAggregatedDevices(input.pool, client, activeMappings, {
      pageSize: input.pageSize,
      maxPages: input.maxPages,
    });
    const allDevices = [...aggregatedDevices.values()].map((entry) => entry.device);
    const detailMap =
      input.enrichDetails === false || !client.enrichDevicesWithDetails
        ? new Map<number, NcentralDeviceSummary & { lastApplianceCheckinTime?: string }>()
        : await client.enrichDevicesWithDetails(allDevices, { concurrency: input.detailConcurrency });

    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedSnapshots = 0;
    let detailEnrichedSnapshots = 0;
    const productSnapshots: Record<string, number> = {};
    const overlayMatches: Record<string, number> = {};

    for (const aggregated of aggregatedDevices.values()) {
      const primaryProductMapping = choosePrimaryProductMapping(aggregated.productMappings);
      if (!primaryProductMapping?.vendorProductKey || !isNcentralProductMappingKey(primaryProductMapping.vendorProductKey)) {
        skippedSnapshots += 1;
        continue;
      }

      const productMapping = productMappings[primaryProductMapping.vendorProductKey] ?? defaultProductMapping(primaryProductMapping);
      const detail = detailMap.get(aggregated.device.deviceId);
      if (detail?.lastApplianceCheckinTime) {
        detailEnrichedSnapshots += 1;
      }

      const externalAccountId = externalAccountIdForDevice(detail ?? aggregated.device);
      const accountMapping = externalAccountId ? accountMappings.get(externalAccountId) : undefined;
      if (accountMapping) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      productSnapshots[primaryProductMapping.vendorProductKey] =
        (productSnapshots[primaryProductMapping.vendorProductKey] ?? 0) + 1;
      for (const overlay of aggregated.overlayMappings) {
        if (overlay.tagKey) {
          overlayMatches[overlay.tagKey] = (overlayMatches[overlay.tagKey] ?? 0) + 1;
        }
      }

      await insertNcentralUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId,
        externalAccountId,
        vendorProductKey: primaryProductMapping.vendorProductKey,
        productCode: productMapping.productCode,
        productName: productMapping.productName,
        observedAt,
        device: detail ?? aggregated.device,
        primaryProductMapping,
        productMappings: aggregated.productMappings,
        overlayMappings: aggregated.overlayMappings,
      });
      recordsWritten += 1;
    }

    await completeNcentralSyncRun(input.pool, syncRunId, aggregatedDevices.size, recordsWritten, {
      entity: 'usage-snapshots',
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
      overlayMatches,
      detailEnrichedSnapshots,
      filterMappings: activeMappings.map((mapping) => ({
        id: mapping.id,
        filterId: mapping.filterId,
        filterName: mapping.filterName,
        mappingType: mapping.mappingType,
        vendorProductKey: mapping.vendorProductKey,
        tagKey: mapping.tagKey,
      })),
    });

    return {
      syncRunId,
      recordsRead: aggregatedDevices.size,
      recordsWritten,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      productSnapshots,
      overlayMatches,
      detailEnrichedSnapshots,
    };
  } catch (error) {
    await failNcentralSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertNcentralReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `N-central settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadNcentralProductMappings(database: Queryable): Promise<Record<string, NcentralProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = 'ncentral'
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
  );
  const mappings: Record<string, NcentralProductMapping> = { ...defaultNcentralProductMappings };
  const rowsByKey = new Map<string, VendorProductMappingRow[]>();

  for (const row of result.rows) {
    rowsByKey.set(row.vendor_product_key, [...(rowsByKey.get(row.vendor_product_key) ?? []), row]);
  }

  for (const [vendorProductKey, rows] of rowsByKey.entries()) {
    const orderedRows = [...rows].sort(
      (left, right) =>
        integerValue(left.target_index) - integerValue(right.target_index) ||
        left.connectwise_product_code.localeCompare(right.connectwise_product_code),
    );
    const primary = orderedRows[0];
    if (!primary) {
      continue;
    }

    mappings[vendorProductKey] = {
      vendorProductKey,
      productCode: primary.connectwise_product_code,
      productName: primary.connectwise_product_name,
      targetProductCodes: [...new Set(orderedRows.map((row) => row.connectwise_product_code))],
      unitPrice: nullableMoney(primary.unit_price),
    };
  }

  return mappings;
}

export async function loadNcentralRuleSet(database: Queryable) {
  const [productMappings, filterMappings, snapshotProducts] = await Promise.all([
    loadNcentralProductMappings(database),
    listNcentralFilterMappings(database),
    loadDistinctNcentralSnapshotProducts(database),
  ]);
  const dynamicMappings = Object.fromEntries(
    filterMappings
      .filter((mapping) => mapping.active && mapping.mappingType === 'product' && mapping.vendorProductKey)
      .map((mapping) => [
        mapping.vendorProductKey as string,
        productMappings[mapping.vendorProductKey as string] ?? defaultProductMapping(mapping),
      ]),
  );
  const resolvedMappings = {
    ...productMappings,
    ...dynamicMappings,
  };

  for (const snapshotProduct of snapshotProducts) {
    if (!snapshotProduct.vendor_product_key || resolvedMappings[snapshotProduct.vendor_product_key]) {
      continue;
    }

    resolvedMappings[snapshotProduct.vendor_product_key] = {
      vendorProductKey: snapshotProduct.vendor_product_key,
      productCode: snapshotProduct.product_code,
      productName: snapshotProduct.product_name,
    };
  }

  return buildNcentralRuleSet(resolvedMappings);
}

async function loadDistinctNcentralSnapshotProducts(database: Queryable) {
  const result = await database.query<{
    vendor_product_key: string;
    product_code: string;
    product_name: string;
  }>(
    `select distinct on (vendor_product_key)
       vendor_product_key,
       product_code,
       product_name
     from vendor_usage_snapshots
     where vendor_id = 'ncentral'
       and vendor_product_key is not null
       and sync_run_id = (
         select id
         from sync_runs
         where integration_id = 'ncentral'
           and status = 'complete'
         order by completed_at desc nulls last, started_at desc
         limit 1
       )
     order by vendor_product_key, observed_at desc`,
  );

  return result.rows;
}

function resolveFilterMappings(mappings: NcentralFilterMapping[], filters: NcentralDeviceFilter[]) {
  const filtersById = new Map(filters.map((filter) => [filter.filterId, filter]));
  const filtersByName = new Map(filters.map((filter) => [normalizeFilterName(filter.filterName), filter]));

  return mappings.flatMap((mapping) => {
    const matchedFilter =
      (mapping.filterId ? filtersById.get(mapping.filterId) : undefined) ??
      filtersByName.get(normalizeFilterName(mapping.filterName));
    if (!matchedFilter) {
      return [];
    }

    return [
      {
        ...mapping,
        filterId: matchedFilter.filterId,
        filterName: matchedFilter.filterName,
        rawPayload: matchedFilter.raw as Record<string, unknown>,
      },
    ];
  });
}

async function loadAggregatedDevices(
  database: Queryable,
  client: NcentralUsageClient,
  mappings: NcentralFilterMapping[],
  options: { pageSize?: number; maxPages?: number },
) {
  const aggregated = new Map<number, AggregatedDevice>();

  for (const mapping of mappings) {
    if (!mapping.filterId) {
      continue;
    }

    const devices = await client.listDevicesByFilter(mapping.filterId, options);
    await updateNcentralMappingResolvedFilterId(database, mapping.id, mapping.filterId, mapping.rawPayload);
    for (const device of devices) {
      const current =
        aggregated.get(device.deviceId) ??
        ({
          device,
          productMappings: [],
          overlayMappings: [],
        } satisfies AggregatedDevice);
      if (mapping.mappingType === 'product') {
        current.productMappings.push(mapping);
      } else {
        current.overlayMappings.push(mapping);
      }
      aggregated.set(device.deviceId, current);
    }
  }

  return aggregated;
}

function choosePrimaryProductMapping(mappings: NcentralFilterMapping[]) {
  return [...mappings].sort((left, right) => left.priority - right.priority || left.filterName.localeCompare(right.filterName))[0];
}

async function loadNcentralAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'ncentral'
       and active = true
       and mapping_status = 'approved'`,
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id ?? undefined,
      },
    ]),
  );
}

async function startNcentralSyncRun(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('ncentral', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity: 'usage-snapshots' })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create N-central usage snapshot sync run.');
  }

  return syncRunId;
}

async function insertNcentralUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId?: string;
    vendorProductKey: NcentralProductMappingKey;
    productCode: string;
    productName: string;
    observedAt: string;
    device: NcentralDeviceSummary & { lastApplianceCheckinTime?: string };
    primaryProductMapping: NcentralFilterMapping;
    productMappings: NcentralFilterMapping[];
    overlayMappings: NcentralFilterMapping[];
  },
) {
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id,
       vendor_id,
       customer_id,
       agreement_id,
       external_account_id,
       vendor_product_key,
       product_code,
       product_name,
       quantity,
       observed_at,
       dimensions,
       raw_payload
     )
     values ($1, 'ncentral', $2, $3, $4, $5, $6, $7, 1, $8, $9::jsonb, $10::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId ?? null,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.observedAt,
      JSON.stringify(dimensionsForDevice(input)),
      JSON.stringify(input.device.raw),
    ],
  );
}

async function completeNcentralSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete',
         completed_at = now(),
         records_read = $2,
         records_written = $3,
         metadata = metadata || $4::jsonb
     where id = $1`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failNcentralSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function dimensionsForDevice(input: {
  device: NcentralDeviceSummary & { lastApplianceCheckinTime?: string };
  vendorProductKey: string;
  primaryProductMapping: NcentralFilterMapping;
  productMappings: NcentralFilterMapping[];
  overlayMappings: NcentralFilterMapping[];
}) {
  const productType = productTypeForKey(input.vendorProductKey);
  const productFilterNames = input.productMappings.map((mapping) => mapping.filterName);
  const productConflictKeys = input.productMappings
    .map((mapping) => mapping.vendorProductKey)
    .filter((key): key is string => Boolean(key && key !== input.vendorProductKey));
  const overlayTags = input.overlayMappings.map((mapping) => mapping.tagKey).filter((tag): tag is string => Boolean(tag));

  return {
    ncentralProductType: productType,
    ncentralDeviceId: input.device.deviceId,
    hostname: input.device.longName,
    deviceName: input.device.longName,
    deviceClass: input.device.deviceClass,
    description: input.device.description,
    customerId: input.device.customerId,
    customerName: input.device.customerName,
    ncentralCustomerName: input.device.customerName,
    siteId: input.device.siteId,
    siteName: input.device.siteName,
    orgUnitId: input.device.orgUnitId,
    soId: input.device.soId,
    osId: input.device.osId,
    operatingSystem: input.device.supportedOs,
    lastLoggedInUser: input.device.lastLoggedInUser,
    stillLoggedIn: input.device.stillLoggedIn,
    lastApplianceCheckinTime: input.device.lastApplianceCheckinTime,
    productFilterId: input.primaryProductMapping.filterId,
    productFilterName: input.primaryProductMapping.filterName,
    productFilterNames,
    productConflictKeys,
    overlayTags,
    doNotBill: overlayTags.includes('do-not-bill'),
  };
}

function defaultProductMapping(mapping: Pick<NcentralFilterMapping, 'vendorProductKey' | 'displayName'>): NcentralProductMapping {
  const vendorProductKey = mapping.vendorProductKey || 'ncentral-custom-device';
  return {
    vendorProductKey,
    productCode: vendorProductKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    productName: mapping.displayName || vendorProductKey,
  };
}

function externalAccountIdForDevice(device: NcentralDeviceSummary) {
  if (typeof device.customerId === 'number') {
    return String(device.customerId);
  }

  if (typeof device.orgUnitId === 'number') {
    return String(device.orgUnitId);
  }

  return device.customerName;
}

function nullableMoney(value: string | number | null | undefined) {
  const amount = typeof value === 'number' ? value : value ? Number.parseFloat(value) : undefined;
  return typeof amount === 'number' && Number.isFinite(amount) ? { amount, currency: 'USD' as const } : undefined;
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

function normalizeFilterName(value: string) {
  return value.trim().toLowerCase();
}
