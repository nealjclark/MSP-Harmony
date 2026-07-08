import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import type { Queryable } from './agreementReports';
import { getAgreementReportDetails, listAgreementReportSyncRuns, type AgreementReportSyncRun } from './agreementReports';

export type RawSyncIntegrationId = IntegrationId;
export type RawSyncDataset = 'users' | 'licenses';

export type RawSyncRun = AgreementReportSyncRun;

export type RawSyncDetail = Record<string, string | number | boolean | null>;

export type RawSyncDetails = {
  integrationId: RawSyncIntegrationId;
  dataset?: RawSyncDataset;
  syncRun: RawSyncRun;
  columns: readonly string[];
  rows: RawSyncDetail[];
  summary: {
    rowCount: number;
    companyCount: number;
    agreementCount: number;
    productCount: number;
  };
};

export type RawSyncDetailsOptions = {
  dataset?: RawSyncDataset;
  customerId?: string;
  includeSensitive?: boolean;
};

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  status: string;
  records_read: number;
  records_written: number;
  error_message: string | null;
  metadata: unknown;
};

const legacyMicrosoft365SyncEntity = 'license-snapshots';
const microsoft365UserSyncEntity = 'm365-users';
const microsoft365LicenseSyncEntity = 'm365-licenses';
const appRiverSyncEntity = 'subscription-snapshots';
const dattoSyncEntity = 'usage-snapshots';

type CoveSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type NcentralSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type Microsoft365SnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type Microsoft365SubscriptionSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string;
  tenant_name: string | null;
  tenant_default_domain_name: string | null;
  sku_id: string | null;
  sku_part_number: string | null;
  sku_name: string | null;
  capability_status: string | null;
  subscription_status: string | null;
  subscription_ids: unknown;
  commerce_subscription_ids: unknown;
  subscription_count: string | number;
  total_units: string | number | null;
  assigned_units: string | number | null;
  unassigned_units: string | number | null;
  enabled_units: string | number | null;
  suspended_units: string | number | null;
  warning_units: string | number | null;
  locked_out_units: string | number | null;
  next_lifecycle_at: Date | string | null;
  billing_type: string | null;
  billing_cycle: string | null;
  billing_term: string | null;
  is_trial: boolean | null;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type AppRiverSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type DattoSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string;
  product_name: string;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

type GenericSnapshotRow = {
  customer_id: string | null;
  customer_name: string | null;
  agreement_name: string | null;
  external_account_id: string | null;
  vendor_product_key: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: string | number;
  observed_at: Date | string;
  dimensions: unknown;
  raw_payload: unknown;
};

export const coveRawSyncColumns = [
  'Customer',
  'Agreement',
  'CoveCustomer',
  'CovePartnerId',
  'Hostname',
  'ProtectedSystemType',
  'Physicality',
  'ProductCode',
  'ProductName',
  'Quantity',
  'SelectedStorageGB',
  'UsedStorageGB',
  'AccountId',
  'OS',
  'DataSources',
  'CreationDate',
  'ExpirationDate',
  'LastComplete',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const ncentralRawSyncColumns = [
  'Customer',
  'Agreement',
  'NcentralCustomer',
  'DeviceId',
  'Hostname',
  'DeviceClass',
  'ProductKey',
  'ProductCode',
  'ProductName',
  'Quantity',
  'ProductFilter',
  'OverlayTags',
  'LastCheckIn',
  'OS',
  'Site',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const microsoft365RawSyncColumns = [
  'Customer',
  'Agreement',
  'TenantName',
  'TenantId',
  'UserPrincipalName',
  'DisplayName',
  'UserState',
  'ProductKey',
  'SkuName',
  'SkuId',
  'ProductCode',
  'ProductName',
  'Quantity',
  'ConsumedUnits',
  'ServicePlans',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const microsoft365LicenseRawSyncColumns = [
  'Customer',
  'Agreement',
  'TenantName',
  'TenantId',
  'TenantDefaultDomain',
  'SkuPartNumber',
  'SkuName',
  'SkuId',
  'SubscriptionStatus',
  'CapabilityStatus',
  'TotalUnits',
  'AssignedUnits',
  'UnassignedUnits',
  'EnabledUnits',
  'SuspendedUnits',
  'WarningUnits',
  'LockedOutUnits',
  'SubscriptionCount',
  'SubscriptionIds',
  'CommerceSubscriptionIds',
  'IsTrial',
  'NextLifecycleAt',
  'BillingType',
  'BillingCycle',
  'BillingTerm',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const appRiverRawSyncColumns = [
  'Customer',
  'Agreement',
  'AppRiverCustomer',
  'AppRiverCustomerId',
  'Domain',
  'ProductKey',
  'ProductCode',
  'ProductName',
  'Quantity',
  'TotalLicenses',
  'AssignedLicenses',
  'UnassignedLicenses',
  'SubscriptionTerm',
  'BillingFrequency',
  'CommitmentEndDate',
  'ExpirationDate',
  'IsTrial',
  'SubscriptionKey',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const dattoRawSyncColumns = [
  'Customer',
  'Agreement',
  'DattoCustomer',
  'ProductFamily',
  'DeviceHostname',
  'DeviceSerial',
  'DeviceModel',
  'AgentName',
  'AgentHostname',
  'AgentVersion',
  'ProtectedVolumes',
  'UnprotectedVolumes',
  'Paused',
  'Archived',
  'LocalSnapshots',
  'LastSnapshot',
  'LastScreenshot',
  'ScreenshotSuccess',
  'SaaSDomain',
  'SaaSCustomerId',
  'ProductType',
  'RetentionType',
  'ProductKey',
  'ProductCode',
  'ProductName',
  'Quantity',
  'QuantitySource',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export const genericRawSyncColumns = [
  'Customer',
  'Agreement',
  'SourceType',
  'SyncMode',
  'ExternalAccountName',
  'ProductKey',
  'ProductCode',
  'ProductName',
  'Quantity',
  'DeviceId',
  'DeviceName',
  'DeviceType',
  'DeviceClass',
  'DeviceCategory',
  'LicenseId',
  'LicenseName',
  'UserPrincipalName',
  'Email',
  'InvoiceFileName',
  'InvoiceNumber',
  'ExternalAccountId',
  'Mapped',
  'ObservedAt',
  'RawPayload',
] as const;

export async function listRawSyncRuns(
  database: Queryable,
  integrationId: RawSyncIntegrationId,
  options: { limit?: number; dataset?: RawSyncDataset } = {},
): Promise<RawSyncRun[]> {
  if (integrationId === 'connectwise') {
    return listAgreementReportSyncRuns(database, options);
  }

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  if (integrationId === 'microsoft-365') {
    const result = await database.query<SyncRunRow>(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
       from sync_runs
       where integration_id = 'microsoft-365'
         and metadata->>'entity' = any($1::text[])
       order by started_at desc
       limit $2`,
      [microsoft365DatasetEntities(options.dataset ?? 'users'), limit],
    );

    return result.rows.map(mapSyncRun);
  }

  if (integrationId === 'opentext-appriver') {
    const result = await database.query<SyncRunRow>(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
       from sync_runs
       where integration_id = 'opentext-appriver'
         and metadata->>'entity' = $1
       order by started_at desc
       limit $2`,
      [appRiverSyncEntity, limit],
    );

    return result.rows.map(mapSyncRun);
  }

  if (integrationId === 'datto') {
    const result = await database.query<SyncRunRow>(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
       from sync_runs
       where integration_id = 'datto'
         and metadata->>'entity' = $1
       order by started_at desc
       limit $2`,
      [dattoSyncEntity, limit],
    );

    return result.rows.map(mapSyncRun);
  }

  if (integrationId !== 'cove') {
    const result = await database.query<SyncRunRow>(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
       from sync_runs
       where integration_id = $1
       order by started_at desc
       limit $2`,
      [integrationId, limit],
    );

    return result.rows.map(mapSyncRun);
  }

  const result = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where integration_id = 'cove'
       and metadata->>'entity' = 'usage-snapshots'
     order by started_at desc
     limit $1`,
    [limit],
  );

  return result.rows.map(mapSyncRun);
}

export async function getRawSyncDetails(
  database: Queryable,
  integrationId: RawSyncIntegrationId,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  if (integrationId === 'connectwise') {
    const details = await getAgreementReportDetails(database, syncRunId);
    return details
      ? {
          integrationId,
          ...details,
        }
      : undefined;
  }

  if (integrationId === 'cove') {
    return getCoveRawSyncDetails(database, syncRunId, options);
  }

  if (integrationId === 'ncentral') {
    return getNcentralRawSyncDetails(database, syncRunId, options);
  }

  if (integrationId === 'microsoft-365') {
    return options.dataset === 'licenses'
      ? getMicrosoft365LicenseRawSyncDetails(database, syncRunId, options)
      : getMicrosoft365UserRawSyncDetails(database, syncRunId, options);
  }

  if (integrationId === 'opentext-appriver') {
    return getAppRiverRawSyncDetails(database, syncRunId, options);
  }

  if (integrationId === 'datto') {
    return getDattoRawSyncDetails(database, syncRunId, options);
  }

  return getGenericRawSyncDetails(database, integrationId, syncRunId);
}

async function getMicrosoft365UserRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'microsoft-365'
       and metadata->>'entity' = any($2::text[])
     limit 1`,
    [syncRunId, microsoft365DatasetEntities('users')],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<Microsoft365SnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = 'microsoft-365'
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.dimensions->>'tenantName', mapped_snapshots.external_account_id),
       mapped_snapshots.dimensions->>'userPrincipalName',
       mapped_snapshots.vendor_product_key`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map((row) =>
    mapMicrosoft365SnapshotRow(row, {
      includeSensitive: options.includeSensitive === true,
    }),
  );

  return {
    integrationId: 'microsoft-365',
    dataset: 'users',
    syncRun: mapSyncRun(syncRunRow),
    columns: microsoft365RawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedMicrosoft365TenantCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductKey'),
    },
  };
}

async function getMicrosoft365LicenseRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'microsoft-365'
       and metadata->>'entity' = any($2::text[])
     limit 1`,
    [syncRunId, microsoft365DatasetEntities('licenses')],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<Microsoft365SubscriptionSnapshotRow>(
    `with mapped_snapshots as (
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
       where microsoft365_subscription_snapshots.sync_run_id = $1
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.tenant_name,
       mapped_snapshots.tenant_default_domain_name,
       mapped_snapshots.sku_id,
       mapped_snapshots.sku_part_number,
       mapped_snapshots.sku_name,
       mapped_snapshots.capability_status,
       mapped_snapshots.subscription_status,
       mapped_snapshots.subscription_ids,
       mapped_snapshots.commerce_subscription_ids,
       mapped_snapshots.subscription_count,
       mapped_snapshots.total_units,
       mapped_snapshots.assigned_units,
       mapped_snapshots.unassigned_units,
       mapped_snapshots.enabled_units,
       mapped_snapshots.suspended_units,
       mapped_snapshots.warning_units,
       mapped_snapshots.locked_out_units,
       mapped_snapshots.next_lifecycle_at,
       mapped_snapshots.billing_type,
       mapped_snapshots.billing_cycle,
       mapped_snapshots.billing_term,
       mapped_snapshots.is_trial,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.tenant_name, mapped_snapshots.external_account_id),
       mapped_snapshots.sku_part_number,
       mapped_snapshots.sku_id`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map((row) =>
    mapMicrosoft365LicenseSnapshotRow(row, {
      includeSensitive: options.includeSensitive === true,
    }),
  );

  return {
    integrationId: 'microsoft-365',
    dataset: 'licenses',
    syncRun: mapSyncRun(syncRunRow),
    columns: microsoft365LicenseRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedMicrosoft365TenantCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'SkuPartNumber') || uniqueCount(rows, 'SkuId'),
    },
  };
}

function mapMicrosoft365SnapshotRow(
  row: Microsoft365SnapshotRow,
  options: { includeSensitive?: boolean } = {},
): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);
  const includeSensitive = options.includeSensitive === true;

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    TenantName: stringValue(dimensions.tenantName),
    TenantId: stringValue(dimensions.tenantId) ?? row.external_account_id,
    UserPrincipalName: includeSensitive ? stringValue(dimensions.userPrincipalName) : redactedValue(dimensions.userPrincipalName),
    DisplayName: includeSensitive ? stringValue(dimensions.displayName) : redactedValue(dimensions.displayName),
    UserState: stringValue(dimensions.userState),
    ProductKey: row.vendor_product_key,
    SkuName: stringValue(dimensions.skuName),
    SkuId: stringValue(dimensions.skuId),
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    ConsumedUnits: numberValue(dimensions.consumedUnits) ?? null,
    ServicePlans: servicePlanSummary(dimensions.servicePlans),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: includeSensitive ? compactJson(row.raw_payload) : null,
  };
}

function mapMicrosoft365LicenseSnapshotRow(
  row: Microsoft365SubscriptionSnapshotRow,
  options: { includeSensitive?: boolean } = {},
): RawSyncDetail {
  const includeSensitive = options.includeSensitive === true;

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    TenantName: row.tenant_name,
    TenantId: row.external_account_id,
    TenantDefaultDomain: includeSensitive ? row.tenant_default_domain_name : redactedValue(row.tenant_default_domain_name),
    SkuPartNumber: row.sku_part_number,
    SkuName: row.sku_name,
    SkuId: row.sku_id,
    SubscriptionStatus: row.subscription_status,
    CapabilityStatus: row.capability_status,
    TotalUnits: numberValue(row.total_units) ?? null,
    AssignedUnits: numberValue(row.assigned_units) ?? null,
    UnassignedUnits: numberValue(row.unassigned_units) ?? null,
    EnabledUnits: numberValue(row.enabled_units) ?? null,
    SuspendedUnits: numberValue(row.suspended_units) ?? null,
    WarningUnits: numberValue(row.warning_units) ?? null,
    LockedOutUnits: numberValue(row.locked_out_units) ?? null,
    SubscriptionCount: numberValue(row.subscription_count) ?? 0,
    SubscriptionIds: arrayValue(row.subscription_ids).join(', ') || null,
    CommerceSubscriptionIds: arrayValue(row.commerce_subscription_ids).join(', ') || null,
    IsTrial: row.is_trial,
    NextLifecycleAt: isoDate(row.next_lifecycle_at) ?? null,
    BillingType: row.billing_type,
    BillingCycle: row.billing_cycle,
    BillingTerm: row.billing_term,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: includeSensitive ? compactJson(row.raw_payload) : null,
  };
}

async function getAppRiverRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'opentext-appriver'
       and metadata->>'entity' = $2
     limit 1`,
    [syncRunId, appRiverSyncEntity],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<AppRiverSnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = 'opentext-appriver'
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.dimensions->>'customerName', mapped_snapshots.external_account_id),
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.dimensions->>'subscriptionKey'`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map(mapAppRiverSnapshotRow);

  return {
    integrationId: 'opentext-appriver',
    syncRun: mapSyncRun(syncRunRow),
    columns: appRiverRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedAppRiverCustomerCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductKey'),
    },
  };
}

function mapAppRiverSnapshotRow(row: AppRiverSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    AppRiverCustomer: stringValue(dimensions.customerName) ?? stringValue(dimensions.appRiverCustomerName),
    AppRiverCustomerId: primitiveValue(dimensions.appRiverCustomerId),
    Domain: stringValue(dimensions.domain),
    ProductKey: row.vendor_product_key,
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    TotalLicenses: numberValue(dimensions.totalLicenses) ?? null,
    AssignedLicenses: numberValue(dimensions.assignedLicenses) ?? null,
    UnassignedLicenses: numberValue(dimensions.unassignedLicenses) ?? null,
    SubscriptionTerm: stringValue(dimensions.subscriptionTerm),
    BillingFrequency: stringValue(dimensions.billingFrequency),
    CommitmentEndDate: stringValue(dimensions.commitmentEndDate),
    ExpirationDate: stringValue(dimensions.expirationDate),
    IsTrial: primitiveValue(dimensions.isTrial),
    SubscriptionKey: stringValue(dimensions.subscriptionKey),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

async function getDattoRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'datto'
       and metadata->>'entity' = $2
     limit 1`,
    [syncRunId, dattoSyncEntity],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<DattoSnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = 'datto'
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.dimensions->>'dattoCustomerName', mapped_snapshots.dimensions->>'domain', mapped_snapshots.external_account_id),
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.dimensions->>'dattoAgentName',
       mapped_snapshots.dimensions->>'domain'`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map(mapDattoSnapshotRow);

  return {
    integrationId: 'datto',
    syncRun: mapSyncRun(syncRunRow),
    columns: dattoRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedDattoAccountCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductKey'),
    },
  };
}

function mapDattoSnapshotRow(row: DattoSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    DattoCustomer: stringValue(dimensions.dattoCustomerName),
    ProductFamily: stringValue(dimensions.dattoProductFamily),
    DeviceHostname: stringValue(dimensions.dattoDeviceHostname),
    DeviceSerial: stringValue(dimensions.dattoDeviceSerial),
    DeviceModel: stringValue(dimensions.dattoDeviceModel),
    AgentName: stringValue(dimensions.dattoAgentName) ?? stringValue(dimensions.dattoAgentHostname),
    AgentHostname: stringValue(dimensions.dattoAgentHostname),
    AgentVersion: stringValue(dimensions.dattoAgentVersion),
    ProtectedVolumes: numberValue(dimensions.dattoProtectedVolumesCount) ?? null,
    UnprotectedVolumes: numberValue(dimensions.dattoUnprotectedVolumesCount) ?? null,
    Paused: booleanValue(dimensions.dattoIsPaused),
    Archived: booleanValue(dimensions.dattoIsArchived),
    LocalSnapshots: numberValue(dimensions.dattoLocalSnapshots) ?? null,
    LastSnapshot: numberValue(dimensions.dattoLastSnapshot) ?? null,
    LastScreenshot: numberValue(dimensions.dattoLastScreenshot) ?? null,
    ScreenshotSuccess: booleanValue(dimensions.dattoScreenshotSuccess),
    SaaSDomain: stringValue(dimensions.domain),
    SaaSCustomerId: stringValue(dimensions.dattoSaasCustomerId),
    ProductType: stringValue(dimensions.dattoSaasProductType),
    RetentionType: stringValue(dimensions.dattoSaasRetentionType),
    ProductKey: row.vendor_product_key,
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    QuantitySource: stringValue(dimensions.quantitySource),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

async function getNcentralRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'ncentral'
       and metadata->>'entity' = 'usage-snapshots'
     limit 1`,
    [syncRunId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<NcentralSnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = 'ncentral'
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.dimensions->>'ncentralCustomerName', mapped_snapshots.external_account_id),
       mapped_snapshots.product_code,
       mapped_snapshots.dimensions->>'hostname'`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map(mapNcentralSnapshotRow);

  return {
    integrationId: 'ncentral',
    syncRun: mapSyncRun(syncRunRow),
    columns: ncentralRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedNcentralCustomerCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductCode'),
    },
  };
}

function mapNcentralSnapshotRow(row: NcentralSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    NcentralCustomer: stringValue(dimensions.ncentralCustomerName),
    DeviceId: primitiveValue(dimensions.ncentralDeviceId),
    Hostname: stringValue(dimensions.hostname),
    DeviceClass: stringValue(dimensions.deviceClass),
    ProductKey: row.vendor_product_key,
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    ProductFilter: stringValue(dimensions.productFilterName),
    OverlayTags: arrayValue(dimensions.overlayTags).join(', '),
    LastCheckIn: stringValue(dimensions.lastApplianceCheckinTime),
    OS: stringValue(dimensions.operatingSystem),
    Site: stringValue(dimensions.siteName),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

export function isRawSyncIntegrationId(value: string | undefined): value is RawSyncIntegrationId {
  return typeof value === 'string' && Boolean(getIntegrationSettingsDefinition(value as IntegrationId));
}

async function getGenericRawSyncDetails(
  database: Queryable,
  integrationId: IntegrationId,
  syncRunId: string,
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = $2
     limit 1`,
    [syncRunId, integrationId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<GenericSnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = $2
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.vendor_product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers
       on customers.id = mapped_snapshots.effective_customer_id
     left join agreements
       on agreements.id = mapped_snapshots.effective_agreement_id
     order by customers.name nulls last,
              agreements.name nulls last,
              mapped_snapshots.external_account_id,
              mapped_snapshots.product_name`,
    [syncRunId, integrationId],
  );
  const rows = detailResult.rows.map(mapGenericSnapshotRow);

  return {
    integrationId,
    syncRun: mapSyncRun(syncRunRow),
    columns: genericRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer'),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductKey'),
    },
  };
}

function mapGenericSnapshotRow(row: GenericSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);
  const rawPayload = recordFromJson(row.raw_payload);
  const rawString = (key: string) => stringValue(rawPayload[key]);
  const dimensionString = (key: string) => stringValue(dimensions[key]) ?? rawString(key);

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    SourceType: dimensionString('sourceType'),
    SyncMode: dimensionString('syncMode'),
    ExternalAccountName: dimensionString('externalAccountName'),
    ProductKey: row.vendor_product_key,
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    DeviceId: dimensionString('deviceId'),
    DeviceName: dimensionString('deviceName'),
    DeviceType: dimensionString('deviceType'),
    DeviceClass: dimensionString('deviceClass'),
    DeviceCategory: dimensionString('deviceCategoryLabel') ?? dimensionString('deviceCategory'),
    LicenseId: dimensionString('licenseId'),
    LicenseName: dimensionString('licenseName'),
    UserPrincipalName: dimensionString('userPrincipalName'),
    Email: dimensionString('email'),
    InvoiceFileName: dimensionString('invoiceFileName'),
    InvoiceNumber: dimensionString('invoiceNumber'),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

async function getCoveRawSyncDetails(
  database: Queryable,
  syncRunId: string,
  options: RawSyncDetailsOptions = {},
): Promise<RawSyncDetails | undefined> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata
     from sync_runs
     where id = $1
       and integration_id = 'cove'
       and metadata->>'entity' = 'usage-snapshots'
     limit 1`,
    [syncRunId],
  );
  const syncRunRow = syncRunResult.rows[0];

  if (!syncRunRow) {
    return undefined;
  }

  const detailResult = await database.query<CoveSnapshotRow>(
    `with mapped_snapshots as (
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
       where vendor_usage_snapshots.sync_run_id = $1
         and vendor_usage_snapshots.vendor_id = 'cove'
     )
     select
       mapped_snapshots.effective_customer_id as customer_id,
       customers.name as customer_name,
       agreements.name as agreement_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.dimensions,
       mapped_snapshots.raw_payload
     from mapped_snapshots
     left join customers on customers.id = mapped_snapshots.effective_customer_id
     left join agreements on agreements.id = mapped_snapshots.effective_agreement_id
     where ($2::uuid is null or mapped_snapshots.effective_customer_id = $2::uuid)
     order by coalesce(customers.name, mapped_snapshots.dimensions->>'coveCustomerName', mapped_snapshots.external_account_id),
       mapped_snapshots.product_code,
       mapped_snapshots.dimensions->>'hostname'`,
    [syncRunId, options.customerId ?? null],
  );
  const rows = detailResult.rows.map(mapCoveSnapshotRow);

  return {
    integrationId: 'cove',
    syncRun: mapSyncRun(syncRunRow),
    columns: coveRawSyncColumns,
    rows,
    summary: {
      rowCount: rows.length,
      companyCount: uniqueCount(rows, 'Customer') + uniqueUnmappedCustomerCount(rows),
      agreementCount: uniqueCount(rows, 'Agreement'),
      productCount: uniqueCount(rows, 'ProductCode'),
    },
  };
}

function mapCoveSnapshotRow(row: CoveSnapshotRow): RawSyncDetail {
  const dimensions = recordFromJson(row.dimensions);

  return {
    CustomerId: row.customer_id,
    Customer: row.customer_name,
    Agreement: row.agreement_name,
    CoveCustomer: stringValue(dimensions.coveCustomerName),
    CovePartnerId: primitiveValue(dimensions.covePartnerId),
    Hostname: stringValue(dimensions.hostname),
    ProtectedSystemType: stringValue(dimensions.protectedSystemType),
    Physicality: stringValue(dimensions.physicality),
    ProductCode: row.product_code,
    ProductName: row.product_name,
    Quantity: numberValue(row.quantity) ?? 0,
    SelectedStorageGB: numberValue(dimensions.selectedStorageGb) ?? 0,
    UsedStorageGB: numberValue(dimensions.usedStorageGb) ?? 0,
    AccountId: primitiveValue(dimensions.accountId),
    OS: stringValue(dimensions.os),
    DataSources: stringValue(dimensions.dataSources),
    CreationDate: stringValue(dimensions.creationDate),
    ExpirationDate: stringValue(dimensions.expirationDate),
    LastComplete: stringValue(dimensions.lastComplete),
    ExternalAccountId: row.external_account_id,
    Mapped: Boolean(row.customer_name && row.agreement_name),
    ObservedAt: isoDate(row.observed_at) ?? null,
    RawPayload: compactJson(row.raw_payload),
  };
}

function mapSyncRun(row: SyncRunRow): RawSyncRun {
  return {
    id: row.id,
    startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
    completedAt: isoDate(row.completed_at),
    status: row.status,
    recordsRead: row.records_read,
    recordsWritten: row.records_written,
    errorMessage: row.error_message ?? undefined,
    metadata: recordFromJson(row.metadata),
  };
}

function recordFromJson(value: unknown): Record<string, unknown> {
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

  return value as Record<string, unknown>;
}

function compactJson(value: unknown) {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}

function isoDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function stringValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }

  return null;
}

function primitiveValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function uniqueCount(rows: RawSyncDetail[], column: keyof RawSyncDetail) {
  return new Set(rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== '')).size;
}

function uniqueUnmappedCustomerCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.CoveCustomer)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}

function uniqueUnmappedNcentralCustomerCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.NcentralCustomer)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}

function uniqueUnmappedMicrosoft365TenantCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.TenantId ?? row.TenantName)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}

function uniqueUnmappedAppRiverCustomerCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.AppRiverCustomerId ?? row.AppRiverCustomer)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}

function uniqueUnmappedDattoAccountCount(rows: RawSyncDetail[]) {
  return new Set(
    rows
      .filter((row) => !row.Customer)
      .map((row) => row.SaaSCustomerId ?? row.DattoCustomer ?? row.SaaSDomain ?? row.ExternalAccountId)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  ).size;
}

function microsoft365DatasetEntities(dataset: RawSyncDataset) {
  return dataset === 'licenses'
    ? [microsoft365LicenseSyncEntity, legacyMicrosoft365SyncEntity]
    : [microsoft365UserSyncEntity, legacyMicrosoft365SyncEntity];
}

function arrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function servicePlanSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item) => {
      const plan = recordFromJson(item);
      return stringValue(plan.serviceName) ?? stringValue(plan.displayName);
    })
    .filter((item): item is string => Boolean(item))
    .join(', ');
}

function redactedValue(value: unknown) {
  return stringValue(value) ? '[redacted]' : null;
}
