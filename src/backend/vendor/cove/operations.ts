import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import { CoveClient, coveCredentialsFromSettings, type CoveDeviceStatistic, type CoveLoginResult } from './client';
import {
  buildCoveRuleSet,
  defaultCoveProductMappings,
  type CoveProductMapping,
  type CoveProductMappingKey,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type CoveUsageClient = {
  login: () => Promise<CoveLoginResult>;
  listAccountStatistics: (options?: { pageSize?: number; maxPages?: number }) => Promise<CoveDeviceStatistic[]>;
};

export type CoveConnectionTestResult = {
  integrationId: 'cove';
  testedAt: string;
  partnerId: number;
  username?: string;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type CoveUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedSnapshots: number;
  serverSnapshots: number;
  workstationSnapshots: number;
};

type VendorAccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string;
};

type VendorProductMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

const productKeys = ['cove-workstation', 'cove-server', 'cove-server-storage-addon'] as const;

export async function testCoveConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: CoveUsageClient;
  now?: string;
} = {}): Promise<CoveConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('cove');
  assertCoveReady(settings);

  const client = input.client ?? new CoveClient(coveCredentialsFromSettings(settings));
  const login = await client.login();

  return {
    integrationId: 'cove',
    testedAt: input.now ?? new Date().toISOString(),
    partnerId: login.partnerId,
    username: login.username,
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncCoveUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: CoveUsageClient;
  pageSize?: number;
  maxPages?: number;
  now?: string;
  onProgress?: SyncProgressReporter;
}): Promise<CoveUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('cove');
  assertCoveReady(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startCoveSyncRun(input.pool);
  const client = input.client ?? new CoveClient(coveCredentialsFromSettings(settings));

  try {
    const [accountMappings, productMappings, devices] = await Promise.all([
      loadCoveAccountMappings(input.pool),
      loadCoveProductMappings(input.pool),
      client.listAccountStatistics({
        pageSize: input.pageSize,
        maxPages: input.maxPages,
      }),
    ]);

    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedSnapshots = 0;
    let serverSnapshots = 0;
    let workstationSnapshots = 0;

    await input.onProgress?.({ completed: 0, total: devices.length, unitLabel: 'devices' });
    for (const [deviceIndex, device] of devices.entries()) {
      await input.onProgress?.({
        completed: deviceIndex,
        total: devices.length,
        currentItem: device.customerName ?? device.computerName,
        unitLabel: 'devices',
      });
      const productKey = productKeyForDevice(device);
      if (!productKey) {
        skippedSnapshots += 1;
        continue;
      }

      const externalAccountId = externalAccountIdForDevice(device);
      const accountMapping = externalAccountId ? accountMappings.get(externalAccountId) : undefined;
      const productMapping = productMappings[productKey];

      if (accountMapping) {
        mappedSnapshots += 1;
      } else {
        unmappedSnapshots += 1;
      }

      if (device.deviceType === 'server') {
        serverSnapshots += 1;
      } else {
        workstationSnapshots += 1;
      }

      await insertCoveUsageSnapshot(input.pool, {
        syncRunId,
        customerId: accountMapping?.customerId,
        agreementId: accountMapping?.agreementId,
        externalAccountId,
        vendorProductKey: productKey,
        productCode: productMapping.productCode,
        productName: productMapping.productName,
        observedAt,
        device,
      });
      recordsWritten += 1;
    }

    await input.onProgress?.({ completed: devices.length, total: devices.length, unitLabel: 'devices' });
    await completeCoveSyncRun(input.pool, syncRunId, devices.length, recordsWritten, {
      entity: 'usage-snapshots',
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      serverSnapshots,
      workstationSnapshots,
      productMappings: productMappingMetadata(productMappings),
    });

    return {
      syncRunId,
      recordsRead: devices.length,
      recordsWritten,
      mappedSnapshots,
      unmappedSnapshots,
      skippedSnapshots,
      serverSnapshots,
      workstationSnapshots,
    };
  } catch (error) {
    await failCoveSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertCoveReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `Cove settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadCoveProductMappings(
  database: Queryable,
): Promise<Record<CoveProductMappingKey, CoveProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = 'cove'
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
  );
  const mappings = { ...defaultCoveProductMappings };
  const rowsByKey = new Map<CoveProductMappingKey, VendorProductMappingRow[]>();

  for (const row of result.rows) {
    if (!isCoveProductMappingKey(row.vendor_product_key)) {
      continue;
    }

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

export async function loadCoveRuleSet(database: Queryable) {
  return buildCoveRuleSet(await loadCoveProductMappings(database));
}

async function loadCoveAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'cove'
       and active = true
       and mapping_status = 'approved'`,
  );

  return new Map(
    result.rows.map((row) => [
      row.external_account_id,
      {
        customerId: row.customer_id,
        agreementId: row.agreement_id,
      },
    ]),
  );
}

async function startCoveSyncRun(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('cove', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity: 'usage-snapshots' })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error('Unable to create Cove usage snapshot sync run.');
  }

  return syncRunId;
}

async function insertCoveUsageSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId?: string;
    vendorProductKey: CoveProductMappingKey;
    productCode: string;
    productName: string;
    observedAt: string;
    device: CoveDeviceStatistic;
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
     values ($1, 'cove', $2, $3, $4, $5, $6, $7, 1, $8, $9::jsonb, $10::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId ?? null,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.observedAt,
      JSON.stringify(dimensionsForDevice(input.device)),
      JSON.stringify(input.device.raw),
    ],
  );
}

async function completeCoveSyncRun(
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

async function failCoveSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function productKeyForDevice(device: CoveDeviceStatistic): CoveProductMappingKey | undefined {
  if (device.deviceType === 'server') return 'cove-server';
  if (device.deviceType === 'workstation') return 'cove-workstation';
  return undefined;
}

function externalAccountIdForDevice(device: CoveDeviceStatistic) {
  if (typeof device.partnerId === 'number') {
    return String(device.partnerId);
  }

  if (typeof device.accountId === 'number') {
    return String(device.accountId);
  }

  return device.customerName;
}

function dimensionsForDevice(device: CoveDeviceStatistic) {
  return {
    protectedSystemType: device.deviceType,
    physicality: device.physicality,
    selectedStorageGb: device.selectedStorageGb,
    usedStorageGb: device.usedStorageGb,
    hostname: device.computerName,
    coveCustomerName: device.customerName,
    covePartnerId: device.partnerId,
    accountId: device.accountId,
    os: device.os,
    dataSources: device.dataSources,
    creationDate: device.creationDate,
    expirationDate: device.expirationDate,
    lastComplete: device.lastComplete,
  };
}

function productMappingMetadata(mappings: Record<CoveProductMappingKey, CoveProductMapping>) {
  return Object.fromEntries(
    productKeys.map((key) => [
      key,
      {
        productCode: mappings[key].productCode,
        productName: mappings[key].productName,
        unitPrice: mappings[key].unitPrice?.amount,
      },
    ]),
  );
}

function isCoveProductMappingKey(value: string): value is CoveProductMappingKey {
  return productKeys.includes(value as CoveProductMappingKey);
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
