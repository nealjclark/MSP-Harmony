import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import {
  Microsoft365Client,
  microsoft365CredentialsFromSettings,
  productKeyForLicense,
  type Microsoft365AccessToken,
  type Microsoft365AssignedLicense,
  type Microsoft365CompanySubscription,
  type Microsoft365CustomerUser,
  type Microsoft365SubscribedSku,
  type Microsoft365Tenant,
} from './client';
import {
  buildMicrosoft365RuleSet,
  type Microsoft365ProductMapping,
} from './rules';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type Microsoft365LicenseClient = {
  authenticate: (tenantId: string) => Promise<Microsoft365AccessToken | unknown>;
  listPartnerCustomerContracts: (options?: { pageSize?: number; maxPages?: number }) => Promise<Microsoft365Tenant[]>;
  listTenantUsers: (
    tenantId: string,
    options?: { pageSize?: number; maxPages?: number },
  ) => Promise<Microsoft365CustomerUser[]>;
  listTenantSubscribedSkus: (tenantId: string) => Promise<Microsoft365SubscribedSku[]>;
  listTenantDirectorySubscriptions: (tenantId: string) => Promise<Microsoft365CompanySubscription[]>;
};

export type Microsoft365ConnectionTestResult = {
  integrationId: 'microsoft-365';
  testedAt: string;
  tenantCount: number;
  sampleTenants: Array<{ tenantId: string; displayName?: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type Microsoft365SyncDataset = 'users' | 'licenses';

export type Microsoft365UserLicenseSnapshotSyncResult = {
  dataset: 'users';
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  tenantsRead: number;
  usersRead: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  skippedAssignedLicenses: number;
  failedTenants: number;
  productSnapshots: Record<string, number>;
};

export type Microsoft365ProductSubscriptionSnapshotSyncResult = {
  dataset: 'licenses';
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  tenantsRead: number;
  companySubscriptionsRead: number;
  productSubscriptionsWritten: number;
  failedTenants: number;
  failedProductSubscriptionTenants: number;
};

export type Microsoft365LicenseSnapshotSyncResult =
  | Microsoft365UserLicenseSnapshotSyncResult
  | Microsoft365ProductSubscriptionSnapshotSyncResult;

const microsoft365UserSyncEntity = 'm365-users';
const microsoft365LicenseSyncEntity = 'm365-licenses';

type VendorAccountMappingRow = {
  external_account_id: string;
  external_account_name?: string | null;
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

type TenantSyncError = {
  tenantId: string;
  displayName?: string;
  message: string;
};

type Microsoft365AccountMapping = {
  customerId: string;
  agreementId?: string;
};

type Microsoft365SubscriptionSnapshotInput = {
  syncRunId: string;
  customerId?: string;
  agreementId?: string;
  externalAccountId: string;
  tenantName?: string;
  tenantDefaultDomainName?: string;
  skuId?: string;
  skuPartNumber?: string;
  skuName?: string;
  capabilityStatus?: string;
  subscriptionStatus?: string;
  subscriptionIds: string[];
  commerceSubscriptionIds: string[];
  subscriptionCount: number;
  totalUnits?: number;
  assignedUnits?: number;
  unassignedUnits?: number;
  enabledUnits?: number;
  suspendedUnits?: number;
  warningUnits?: number;
  lockedOutUnits?: number;
  nextLifecycleAt?: string;
  billingType?: string;
  billingCycle?: string;
  billingTerm?: string;
  isTrial?: boolean;
  observedAt: string;
  dimensions: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

export async function testMicrosoft365Connection(input: {
  provider?: IntegrationSettingsProvider;
  pool?: Queryable;
  client?: Microsoft365LicenseClient;
  now?: string;
} = {}): Promise<Microsoft365ConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('microsoft-365');
  assertMicrosoft365Ready(settings);

  const client = input.client ?? new Microsoft365Client(microsoft365CredentialsFromSettings(settings));
  const tenants = await loadMicrosoft365TenantTargets(client, input.pool);
  const firstTenant = tenants[0];
  if (!firstTenant) {
    throw new Error('Microsoft 365 did not discover any customer tenants from Microsoft Graph contracts.');
  }

  await client.authenticate(firstTenant.tenantId);
  await client.listTenantSubscribedSkus(firstTenant.tenantId);
  await client.listTenantDirectorySubscriptions(firstTenant.tenantId);

  return {
    integrationId: 'microsoft-365',
    testedAt: input.now ?? new Date().toISOString(),
    tenantCount: tenants.length,
    sampleTenants: tenants.slice(0, 5).map((tenant) => ({
      tenantId: tenant.tenantId,
      displayName: tenant.displayName,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncMicrosoft365UserLicenseSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: Microsoft365LicenseClient;
  pageSize?: number;
  maxPages?: number;
  now?: string;
}): Promise<Microsoft365UserLicenseSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('microsoft-365');
  assertMicrosoft365Ready(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startMicrosoft365SyncRun(input.pool, microsoft365UserSyncEntity);
  const client = input.client ?? new Microsoft365Client(microsoft365CredentialsFromSettings(settings));

  try {
    const [accountMappings, productMappings] = await Promise.all([
      loadMicrosoft365AccountMappings(input.pool),
      loadMicrosoft365ProductMappings(input.pool),
    ]);
    const tenants = await loadMicrosoft365TenantTargets(client, input.pool);

    let recordsRead = 0;
    let recordsWritten = 0;
    let usersRead = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let skippedAssignedLicenses = 0;
    const productSnapshots: Record<string, number> = {};
    const failedTenantDetails: TenantSyncError[] = [];

    for (const tenant of tenants) {
      let users: Microsoft365CustomerUser[] = [];
      let subscribedSkuMap = new Map<string, Microsoft365SubscribedSku>();
      let subscribedSkus: Microsoft365SubscribedSku[] = [];

      try {
        const [tenantUsers, tenantSubscribedSkus] = await Promise.all([
          client.listTenantUsers(tenant.tenantId, {
            pageSize: input.pageSize,
            maxPages: input.maxPages,
          }),
          client.listTenantSubscribedSkus(tenant.tenantId),
        ]);
        users = tenantUsers;
        subscribedSkus = tenantSubscribedSkus;
        subscribedSkuMap = subscribedSkusByProductKey(subscribedSkus);
      } catch (error) {
        failedTenantDetails.push({
          tenantId: tenant.tenantId,
          displayName: tenant.displayName,
          message: errorMessage(error),
        });
        continue;
      }

      usersRead += users.length;
      const accountMapping = accountMappings.get(tenant.tenantId);

      for (const user of users) {
        for (const baseLicense of user.assignedLicenses) {
          recordsRead += 1;
          const subscribedSku = subscribedSkuMap.get(baseLicense.skuId);
          const license = hydrateAssignedLicense(baseLicense, subscribedSku);
          const vendorProductKey = productKeyForLicense(license);
          if (!vendorProductKey) {
            skippedAssignedLicenses += 1;
            continue;
          }

          const productMapping = productMappings[vendorProductKey] ?? defaultProductMapping(license);

          if (accountMapping?.customerId && accountMapping.agreementId) {
            mappedSnapshots += 1;
          } else {
            unmappedSnapshots += 1;
          }

          productSnapshots[vendorProductKey] = (productSnapshots[vendorProductKey] ?? 0) + 1;

          await insertMicrosoft365LicenseSnapshot(input.pool, {
            syncRunId,
            customerId: accountMapping?.customerId,
            agreementId: accountMapping?.agreementId,
            externalAccountId: tenant.tenantId,
            vendorProductKey,
            productCode: productMapping.productCode,
            productName: productMapping.productName,
            observedAt,
            tenant,
            user,
            license,
            subscribedSku,
          });
          recordsWritten += 1;
        }
      }
    }

    await completeMicrosoft365SyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: microsoft365UserSyncEntity,
      dataset: 'users',
      tenantsRead: tenants.length,
      usersRead,
      mappedSnapshots,
      unmappedSnapshots,
      skippedAssignedLicenses,
      productSnapshots,
      failedTenants: failedTenantDetails.length,
      failedTenantDetails,
    });

    return {
      dataset: 'users',
      syncRunId,
      recordsRead,
      recordsWritten,
      tenantsRead: tenants.length,
      usersRead,
      mappedSnapshots,
      unmappedSnapshots,
      skippedAssignedLicenses,
      failedTenants: failedTenantDetails.length,
      productSnapshots,
    };
  } catch (error) {
    await failMicrosoft365SyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export async function syncMicrosoft365ProductSubscriptionSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: Microsoft365LicenseClient;
  now?: string;
}): Promise<Microsoft365ProductSubscriptionSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('microsoft-365');
  assertMicrosoft365Ready(settings);

  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startMicrosoft365SyncRun(input.pool, microsoft365LicenseSyncEntity);
  const client = input.client ?? new Microsoft365Client(microsoft365CredentialsFromSettings(settings));

  try {
    const accountMappings = await loadMicrosoft365AccountMappings(input.pool);
    const tenants = await loadMicrosoft365TenantTargets(client, input.pool);

    let recordsRead = 0;
    let recordsWritten = 0;
    let companySubscriptionsRead = 0;
    let productSubscriptionsWritten = 0;
    const failedTenantDetails: TenantSyncError[] = [];
    const failedProductSubscriptionDetails: TenantSyncError[] = [];

    for (const tenant of tenants) {
      let subscribedSkus: Microsoft365SubscribedSku[] = [];
      let companySubscriptions: Microsoft365CompanySubscription[] = [];

      try {
        subscribedSkus = await client.listTenantSubscribedSkus(tenant.tenantId);
      } catch (error) {
        failedTenantDetails.push({
          tenantId: tenant.tenantId,
          displayName: tenant.displayName,
          message: errorMessage(error),
        });
        continue;
      }

      try {
        companySubscriptions = await client.listTenantDirectorySubscriptions(tenant.tenantId);
        companySubscriptionsRead += companySubscriptions.length;
      } catch (error) {
        failedProductSubscriptionDetails.push({
          tenantId: tenant.tenantId,
          displayName: tenant.displayName,
          message: errorMessage(error),
        });
      }

      recordsRead += subscribedSkus.length + companySubscriptions.length;
      const accountMapping = accountMappings.get(tenant.tenantId);

      for (const subscriptionSnapshot of buildMicrosoft365SubscriptionSnapshots({
        syncRunId,
        accountMapping,
        tenant,
        subscribedSkus,
        companySubscriptions,
        observedAt,
      })) {
        await insertMicrosoft365SubscriptionSnapshot(input.pool, subscriptionSnapshot);
        productSubscriptionsWritten += 1;
        recordsWritten += 1;
      }
    }

    await completeMicrosoft365SyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: microsoft365LicenseSyncEntity,
      dataset: 'licenses',
      tenantsRead: tenants.length,
      companySubscriptionsRead,
      productSubscriptionsWritten,
      failedTenants: failedTenantDetails.length,
      failedTenantDetails,
      failedProductSubscriptionTenants: failedProductSubscriptionDetails.length,
      failedProductSubscriptionDetails,
    });

    return {
      dataset: 'licenses',
      syncRunId,
      recordsRead,
      recordsWritten,
      tenantsRead: tenants.length,
      companySubscriptionsRead,
      productSubscriptionsWritten,
      failedTenants: failedTenantDetails.length,
      failedProductSubscriptionTenants: failedProductSubscriptionDetails.length,
    };
  } catch (error) {
    await failMicrosoft365SyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertMicrosoft365Ready(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `Microsoft 365 settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

export async function loadMicrosoft365ProductMappings(
  database: Queryable,
): Promise<Record<string, Microsoft365ProductMapping>> {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, target_index, connectwise_product_code, connectwise_product_name, unit_price
     from vendor_product_mappings
     where vendor_id = 'microsoft-365'
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code`,
  );
  const mappings: Record<string, Microsoft365ProductMapping> = {};
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

export async function loadMicrosoft365RuleSet(database: Queryable) {
  return buildMicrosoft365RuleSet(await loadMicrosoft365ProductMappings(database));
}

async function loadMicrosoft365TenantTargets(client: Microsoft365LicenseClient, database?: Queryable) {
  const discoveredTenants = await client.listPartnerCustomerContracts({
    pageSize: 100,
    maxPages: 100,
  });
  const mappedTenants = database ? await loadMicrosoft365MappingTenants(database) : [];
  const tenantsById = new Map<string, Microsoft365Tenant>();

  for (const tenant of [...discoveredTenants, ...mappedTenants]) {
    if (!tenantsById.has(tenant.tenantId)) {
      tenantsById.set(tenant.tenantId, tenant);
    }
  }

  return [...tenantsById.values()];
}

async function loadMicrosoft365MappingTenants(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, external_account_name, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'microsoft-365'
       and active = true
       and mapping_status = 'approved'`,
  );

  return result.rows.map((row) => ({
    tenantId: row.external_account_id,
    displayName: row.external_account_name ?? undefined,
  }));
}

async function loadMicrosoft365AccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, external_account_name, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'microsoft-365'
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

async function startMicrosoft365SyncRun(database: Queryable, entity: typeof microsoft365UserSyncEntity | typeof microsoft365LicenseSyncEntity) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('microsoft-365', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error(`Unable to create Microsoft 365 ${entity} sync run.`);
  }

  return syncRunId;
}

async function insertMicrosoft365LicenseSnapshot(
  database: Queryable,
  input: {
    syncRunId: string;
    customerId?: string;
    agreementId?: string;
    externalAccountId: string;
    vendorProductKey: string;
    productCode: string;
    productName: string;
    observedAt: string;
    tenant: Microsoft365Tenant;
    user: Microsoft365CustomerUser;
    license: Microsoft365AssignedLicense;
    subscribedSku?: Microsoft365SubscribedSku;
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
     values ($1, 'microsoft-365', $2, $3, $4, $5, $6, $7, 1, $8, $9::jsonb, $10::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId,
      input.vendorProductKey,
      input.productCode,
      input.productName,
      input.observedAt,
      JSON.stringify(dimensionsForLicense(input)),
      JSON.stringify(input.license.raw),
    ],
  );
}

function buildMicrosoft365SubscriptionSnapshots(input: {
  syncRunId: string;
  accountMapping?: Microsoft365AccountMapping;
  tenant: Microsoft365Tenant;
  subscribedSkus: Microsoft365SubscribedSku[];
  companySubscriptions: Microsoft365CompanySubscription[];
  observedAt: string;
}): Microsoft365SubscriptionSnapshotInput[] {
  const subscriptionsBySku = companySubscriptionsBySku(input.companySubscriptions);
  const snapshots = input.subscribedSkus.map((subscribedSku) =>
    subscriptionSnapshotFromSubscribedSku({
      ...input,
      subscribedSku,
      companySubscriptions: subscriptionsBySku.get(subscribedSku.skuId) ??
        (subscribedSku.skuPartNumber ? subscriptionsBySku.get(subscribedSku.skuPartNumber) : undefined) ??
        [],
    }),
  );
  const subscribedSkuKeys = new Set(
    input.subscribedSkus.flatMap((sku) => [sku.skuId, sku.skuPartNumber].filter((value): value is string => Boolean(value))),
  );

  for (const subscription of input.companySubscriptions) {
    const skuKey = subscription.skuId ?? subscription.skuPartNumber;
    if (!skuKey || subscribedSkuKeys.has(skuKey)) {
      continue;
    }

    snapshots.push(subscriptionSnapshotFromCompanySubscription({
      ...input,
      companySubscription: subscription,
    }));
  }

  return snapshots;
}

function subscriptionSnapshotFromSubscribedSku(input: {
  syncRunId: string;
  accountMapping?: Microsoft365AccountMapping;
  tenant: Microsoft365Tenant;
  subscribedSku: Microsoft365SubscribedSku;
  companySubscriptions: Microsoft365CompanySubscription[];
  observedAt: string;
}): Microsoft365SubscriptionSnapshotInput {
  const totalUnitsFromSubscriptions = sumDefined(input.companySubscriptions.map((subscription) => subscription.totalLicenses));
  const totalUnits = totalUnitsFromSubscriptions ?? prepaidTotalUnits(input.subscribedSku);
  const assignedUnits = input.subscribedSku.consumedUnits;
  const nextLifecycleAt = earliestDate(input.companySubscriptions.map((subscription) => subscription.nextLifecycleDateTime));
  const subscriptionStatuses = uniqueStrings(input.companySubscriptions.map((subscription) => subscription.status));
  const isTrial = aggregateTrialState(input.companySubscriptions);

  return {
    syncRunId: input.syncRunId,
    customerId: input.accountMapping?.customerId,
    agreementId: input.accountMapping?.agreementId,
    externalAccountId: input.tenant.tenantId,
    tenantName: input.tenant.displayName,
    tenantDefaultDomainName: input.tenant.defaultDomainName,
    skuId: input.subscribedSku.skuId,
    skuPartNumber: input.subscribedSku.skuPartNumber,
    skuName: input.subscribedSku.skuName,
    capabilityStatus: input.subscribedSku.capabilityStatus,
    subscriptionStatus: subscriptionStatuses.join(', ') || undefined,
    subscriptionIds: input.subscribedSku.subscriptionIds,
    commerceSubscriptionIds: uniqueStrings(
      input.companySubscriptions.map((subscription) => subscription.commerceSubscriptionId ?? subscription.id),
    ),
    subscriptionCount: input.companySubscriptions.length,
    totalUnits,
    assignedUnits,
    unassignedUnits: subtractIfDefined(totalUnits, assignedUnits),
    enabledUnits: input.subscribedSku.enabledUnits,
    suspendedUnits: input.subscribedSku.suspendedUnits,
    warningUnits: input.subscribedSku.warningUnits,
    lockedOutUnits: input.subscribedSku.lockedOutUnits,
    nextLifecycleAt,
    isTrial,
    observedAt: input.observedAt,
    dimensions: {
      tenantId: input.tenant.tenantId,
      tenantName: input.tenant.displayName,
      tenantDefaultDomainName: input.tenant.defaultDomainName,
      tenantContractType: input.tenant.contractType,
      appliesTo: input.subscribedSku.appliesTo,
      accountId: input.subscribedSku.accountId,
      accountName: input.subscribedSku.accountName,
      subscriptionLifecycleDates: uniqueStrings(
        input.companySubscriptions.map((subscription) => subscription.nextLifecycleDateTime),
      ),
      subscriptionStatuses,
      servicePlans: input.subscribedSku.servicePlans.map((plan) => ({
        id: plan.id,
        displayName: plan.displayName,
        serviceName: plan.serviceName,
        capabilityStatus: plan.capabilityStatus,
        targetType: plan.targetType,
      })),
      billingTypeSource: 'not-returned-by-graph',
    },
    rawPayload: {
      subscribedSku: input.subscribedSku.raw,
      companySubscriptions: input.companySubscriptions.map((subscription) => subscription.raw),
    },
  };
}

function subscriptionSnapshotFromCompanySubscription(input: {
  syncRunId: string;
  accountMapping?: Microsoft365AccountMapping;
  tenant: Microsoft365Tenant;
  companySubscription: Microsoft365CompanySubscription;
  observedAt: string;
}): Microsoft365SubscriptionSnapshotInput {
  return {
    syncRunId: input.syncRunId,
    customerId: input.accountMapping?.customerId,
    agreementId: input.accountMapping?.agreementId,
    externalAccountId: input.tenant.tenantId,
    tenantName: input.tenant.displayName,
    tenantDefaultDomainName: input.tenant.defaultDomainName,
    skuId: input.companySubscription.skuId,
    skuPartNumber: input.companySubscription.skuPartNumber,
    skuName: input.companySubscription.skuPartNumber,
    subscriptionStatus: input.companySubscription.status,
    subscriptionIds: [],
    commerceSubscriptionIds: [
      input.companySubscription.commerceSubscriptionId ?? input.companySubscription.id,
    ],
    subscriptionCount: 1,
    totalUnits: input.companySubscription.totalLicenses,
    nextLifecycleAt: input.companySubscription.nextLifecycleDateTime,
    isTrial: input.companySubscription.isTrial,
    observedAt: input.observedAt,
    dimensions: {
      tenantId: input.tenant.tenantId,
      tenantName: input.tenant.displayName,
      tenantDefaultDomainName: input.tenant.defaultDomainName,
      tenantContractType: input.tenant.contractType,
      ownerId: input.companySubscription.ownerId,
      ownerTenantId: input.companySubscription.ownerTenantId,
      ownerType: input.companySubscription.ownerType,
      serviceStatus: input.companySubscription.serviceStatus.map((plan) => ({
        id: plan.id,
        displayName: plan.displayName,
        serviceName: plan.serviceName,
        capabilityStatus: plan.capabilityStatus,
        targetType: plan.targetType,
      })),
      billingTypeSource: 'not-returned-by-graph',
    },
    rawPayload: {
      companySubscription: input.companySubscription.raw,
    },
  };
}

async function insertMicrosoft365SubscriptionSnapshot(
  database: Queryable,
  input: Microsoft365SubscriptionSnapshotInput,
) {
  await database.query(
    `insert into microsoft365_subscription_snapshots (
       sync_run_id,
       customer_id,
       agreement_id,
       external_account_id,
       tenant_name,
       tenant_default_domain_name,
       sku_id,
       sku_part_number,
       sku_name,
       capability_status,
       subscription_status,
       subscription_ids,
       commerce_subscription_ids,
       subscription_count,
       total_units,
       assigned_units,
       unassigned_units,
       enabled_units,
       suspended_units,
       warning_units,
       locked_out_units,
       next_lifecycle_at,
       billing_type,
       billing_cycle,
       billing_term,
       is_trial,
       observed_at,
       dimensions,
       raw_payload
     )
     values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $20,
       $21, $22, $23, $24, $25, $26, $27, $28::jsonb, $29::jsonb
     )`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.externalAccountId,
      input.tenantName ?? null,
      input.tenantDefaultDomainName ?? null,
      input.skuId ?? null,
      input.skuPartNumber ?? null,
      input.skuName ?? null,
      input.capabilityStatus ?? null,
      input.subscriptionStatus ?? null,
      JSON.stringify(input.subscriptionIds),
      JSON.stringify(input.commerceSubscriptionIds),
      input.subscriptionCount,
      input.totalUnits ?? null,
      input.assignedUnits ?? null,
      input.unassignedUnits ?? null,
      input.enabledUnits ?? null,
      input.suspendedUnits ?? null,
      input.warningUnits ?? null,
      input.lockedOutUnits ?? null,
      input.nextLifecycleAt ?? null,
      input.billingType ?? null,
      input.billingCycle ?? null,
      input.billingTerm ?? null,
      input.isTrial ?? null,
      input.observedAt,
      JSON.stringify(input.dimensions),
      JSON.stringify(input.rawPayload),
    ],
  );
}

async function completeMicrosoft365SyncRun(
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

async function failMicrosoft365SyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function hydrateAssignedLicense(
  license: Microsoft365AssignedLicense,
  subscribedSku: Microsoft365SubscribedSku | undefined,
): Microsoft365AssignedLicense {
  if (!subscribedSku) {
    return license;
  }

  return {
    ...license,
    skuPartNumber: subscribedSku.skuPartNumber,
    skuName: subscribedSku.skuName ?? subscribedSku.skuPartNumber,
    servicePlans: subscribedSku.servicePlans,
  };
}

function subscribedSkusByProductKey(skus: Microsoft365SubscribedSku[]) {
  const mapped = new Map<string, Microsoft365SubscribedSku>();
  for (const sku of skus) {
    mapped.set(sku.skuId, sku);
    if (sku.skuPartNumber) {
      mapped.set(sku.skuPartNumber, sku);
    }
  }

  return mapped;
}

function companySubscriptionsBySku(subscriptions: Microsoft365CompanySubscription[]) {
  const mapped = new Map<string, Microsoft365CompanySubscription[]>();
  for (const subscription of subscriptions) {
    for (const key of [subscription.skuId, subscription.skuPartNumber]) {
      if (!key) {
        continue;
      }

      mapped.set(key, [...(mapped.get(key) ?? []), subscription]);
    }
  }

  return mapped;
}

function prepaidTotalUnits(sku: Microsoft365SubscribedSku) {
  return sumDefined([
    sku.enabledUnits,
    sku.suspendedUnits,
    sku.warningUnits,
    sku.lockedOutUnits,
  ]);
}

function sumDefined(values: Array<number | undefined>) {
  const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numericValues.length === 0) {
    return undefined;
  }

  return numericValues.reduce((total, value) => total + value, 0);
}

function subtractIfDefined(left: number | undefined, right: number | undefined) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return undefined;
  }

  return left - right;
}

function earliestDate(values: Array<string | undefined>) {
  const timestamps = values
    .map((value) => {
      const timestamp = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(timestamp) ? { value, timestamp } : undefined;
    })
    .filter((value): value is { value: string; timestamp: number } => Boolean(value))
    .sort((left, right) => left.timestamp - right.timestamp);

  return timestamps[0]?.value;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function aggregateTrialState(subscriptions: Microsoft365CompanySubscription[]) {
  if (subscriptions.length === 0) {
    return undefined;
  }

  if (subscriptions.some((subscription) => subscription.isTrial === true)) {
    return true;
  }

  if (subscriptions.every((subscription) => subscription.isTrial === false)) {
    return false;
  }

  return undefined;
}

function dimensionsForLicense(input: {
  tenant: Microsoft365Tenant;
  user: Microsoft365CustomerUser;
  license: Microsoft365AssignedLicense;
  subscribedSku?: Microsoft365SubscribedSku;
}) {
  return {
    licenseSource: 'assigned-user-license',
    authModel: 'graph-app-only',
    tenantId: input.tenant.tenantId,
    tenantName: input.tenant.displayName,
    tenantDefaultDomainName: input.tenant.defaultDomainName,
    tenantContractType: input.tenant.contractType,
    userId: input.user.id,
    userPrincipalName: input.user.userPrincipalName,
    email: input.user.mail ?? input.user.userPrincipalName,
    mail: input.user.mail,
    displayName: input.user.displayName,
    accountEnabled: input.user.accountEnabled,
    userState: input.user.accountEnabled === false ? 'disabled' : 'active',
    skuId: input.license.skuId,
    skuName: input.license.skuName,
    skuPartNumber: input.license.skuPartNumber,
    disabledPlans: input.license.disabledPlans,
    consumedUnits: input.subscribedSku?.consumedUnits,
    enabledUnits: input.subscribedSku?.enabledUnits,
    suspendedUnits: input.subscribedSku?.suspendedUnits,
    warningUnits: input.subscribedSku?.warningUnits,
    servicePlans: input.license.servicePlans.map((plan) => ({
      id: plan.id,
      displayName: plan.displayName,
      serviceName: plan.serviceName,
      capabilityStatus: plan.capabilityStatus,
      targetType: plan.targetType,
    })),
  };
}

function defaultProductMapping(license: Microsoft365AssignedLicense): Microsoft365ProductMapping {
  const vendorProductKey = productKeyForLicense(license);
  return {
    vendorProductKey,
    productCode: vendorProductKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    productName: license.skuName ?? license.skuPartNumber ?? vendorProductKey,
  };
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
