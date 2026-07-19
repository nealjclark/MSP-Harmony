import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import {
  ProofpointClient,
  proofpointCredentialSetsFromSettings,
  type ProofpointDomain,
  type ProofpointOrganization,
  type ProofpointUser,
} from './client';

export type QueryResult<T> = { rows: T[] };
export type Queryable = { query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>> };

export type ProofpointUsageClient = {
  listOrganizations: () => Promise<ProofpointOrganization[]>;
  listDomains: (organizationDomain: string) => Promise<ProofpointDomain[]>;
  listUsers: (organizationDomain: string) => Promise<ProofpointUser[]>;
};

export type ProofpointUsageSource = {
  endpoint: string;
  client: ProofpointUsageClient;
};

export type ProofpointConnectionTestResult = {
  integrationId: 'proofpoint';
  testedAt: string;
  stackCount: number;
  stacks: Array<{ stackUrl: string; organizationCount: number }>;
  organizationCount: number;
  firstOrganizationUserCount: number;
  sampleOrganizations: Array<{ primaryDomain: string; name?: string; stackUrl: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type ProofpointUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  organizationsRead: number;
  activeBillableUsers: number;
  excludedUsers: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
};

type VendorAccountMappingRow = { external_account_id: string; customer_id: string; agreement_id: string | null };
type VendorProductMappingRow = {
  vendor_product_key: string;
  connectwise_product_code: string;
  connectwise_product_name: string;
};

type ProofpointProduct = { productCode: string; productName: string };

export async function testProofpointConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: ProofpointUsageClient;
  clients?: ProofpointUsageSource[];
  now?: string;
} = {}): Promise<ProofpointConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('proofpoint');
  assertProofpointReady(settings);
  const sources = proofpointUsageSources(settings, input.client, input.clients);
  const organizationGroups = await Promise.all(
    sources.map(async (source) => ({
      source,
      organizations: await withProofpointStack(source.endpoint, () => source.client.listOrganizations()),
    })),
  );
  const organizations = organizationGroups.flatMap(({ source, organizations: stackOrganizations }) =>
    stackOrganizations.map((organization) => ({ source, organization })),
  );
  const firstOrganizationUserCount = organizations[0]
    ? (await organizations[0].source.client.listUsers(organizations[0].organization.primaryDomain)).length
    : 0;

  return {
    integrationId: 'proofpoint',
    testedAt: input.now ?? new Date().toISOString(),
    stackCount: sources.length,
    stacks: organizationGroups.map(({ source, organizations: stackOrganizations }) => ({
      stackUrl: source.endpoint,
      organizationCount: stackOrganizations.length,
    })),
    organizationCount: organizations.length,
    firstOrganizationUserCount,
    sampleOrganizations: organizations.slice(0, 5).map(({ source, organization }) => ({
      primaryDomain: organization.primaryDomain,
      name: organization.name,
      stackUrl: source.endpoint,
    })),
    runtimeSettings: { definition: settings.definition, nonSecrets: settings.nonSecrets, validation: settings.validation },
  };
}

export async function syncProofpointUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: ProofpointUsageClient;
  clients?: ProofpointUsageSource[];
  now?: string;
  onProgress?: SyncProgressReporter;
}): Promise<ProofpointUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('proofpoint');
  assertProofpointReady(settings);
  const observedAt = input.now ?? new Date().toISOString();
  const syncRunId = await startSyncRun(input.pool);
  const sources = proofpointUsageSources(settings, input.client, input.clients);

  try {
    const [organizationGroups, accountMappings, productMappings] = await Promise.all([
      Promise.all(sources.map(async (source) => ({
        source,
        organizations: await withProofpointStack(source.endpoint, () => source.client.listOrganizations()),
      }))),
      loadAccountMappings(input.pool),
      loadProductMappings(input.pool),
    ]);
    const organizations = organizationGroups.flatMap(({ source, organizations: stackOrganizations }) =>
      stackOrganizations.map((organization) => ({ source, organization })),
    );
    let recordsRead = 0;
    let recordsWritten = 0;
    let activeBillableUsers = 0;
    let excludedUsers = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;

    await input.onProgress?.({ completed: 0, total: organizations.length, unitLabel: 'organizations' });
    for (const [index, { source, organization }] of organizations.entries()) {
      await input.onProgress?.({
        completed: index,
        total: organizations.length,
        currentItem: organization.name ?? organization.primaryDomain,
        unitLabel: 'organizations',
      });
      const [domains, users] = await Promise.all([
        withProofpointStack(source.endpoint, () => source.client.listDomains(organization.primaryDomain)),
        withProofpointStack(source.endpoint, () => source.client.listUsers(organization.primaryDomain)),
      ]);
      recordsRead += users.length;
      const domainCounts = countBillableUsersByDomain(organization, domains, users);
      const usersEndpointActiveBillableCount = [...domainCounts.values()].reduce((sum, count) => sum + count, 0);
      const quantity = requireProofpointActiveUsers(organization);
      const vendorProductKey = requireProofpointLicensingPackage(organization);
      const product = productMappings.get(vendorProductKey) ?? defaultProductForPackage(vendorProductKey);
      activeBillableUsers += quantity;
      excludedUsers += users.filter((user) => !user.isActive || !user.isBillable).length;
      const combinedDomains = domainsForSnapshot(organization, domains, domainCounts);
      const mapping =
        accountMappings.get(organization.primaryDomain) ??
        (organization.eid ? accountMappings.get(organization.eid.toLowerCase()) : undefined) ??
        combinedDomains.map((domain) => accountMappings.get(domain.name)).find(Boolean);
      if (mapping) mappedSnapshots += 1;
      else unmappedSnapshots += 1;
      await insertUsageSnapshot(input.pool, {
        syncRunId,
        customerId: mapping?.customerId,
        agreementId: mapping?.agreementId,
        organization,
        stackUrl: source.endpoint,
        vendorProductKey,
        domains: combinedDomains,
        domainCounts,
        usersEndpointActiveBillableCount,
        quantity,
        observedAt,
        product,
      });
      recordsWritten += 1;
    }

    await input.onProgress?.({ completed: organizations.length, total: organizations.length, unitLabel: 'organizations' });
    await completeSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'usage-snapshots',
      organizationsRead: organizations.length,
      stackCount: sources.length,
      stackUrls: sources.map((source) => source.endpoint),
      activeBillableUsers,
      excludedUsers,
      mappedSnapshots,
      unmappedSnapshots,
      productMappings: [...productMappings.keys()],
    });
    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      organizationsRead: organizations.length,
      activeBillableUsers,
      excludedUsers,
      mappedSnapshots,
      unmappedSnapshots,
    };
  } catch (error) {
    await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

function proofpointUsageSources(
  settings: IntegrationRuntimeSettings,
  client?: ProofpointUsageClient,
  clients?: ProofpointUsageSource[],
): ProofpointUsageSource[] {
  if (clients?.length) return clients;
  if (client) {
    return [{ endpoint: settings.nonSecrets.endpoint ?? settings.definition.endpoint, client }];
  }
  return proofpointCredentialSetsFromSettings(settings).map((credentials) => ({
    endpoint: credentials.endpoint,
    client: new ProofpointClient(credentials),
  }));
}

async function withProofpointStack<T>(endpoint: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Proofpoint stack ${endpoint} failed: ${message}`);
  }
}

export function assertProofpointReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) return;
  throw new Error(
    `Proofpoint Essentials settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName).join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar).join(', ') || 'none'}.`,
  );
}

function countBillableUsersByDomain(
  organization: ProofpointOrganization,
  domains: ProofpointDomain[],
  users: ProofpointUser[],
) {
  const counts = new Map<string, number>();
  for (const domain of domains.filter((item) => item.isActive !== false)) counts.set(domain.name, 0);
  if (counts.size === 0) counts.set(organization.primaryDomain, 0);
  for (const user of users) {
    if (!user.isActive || !user.isBillable) continue;
    const emailDomain = user.primaryEmail.split('@').pop()?.toLowerCase() || organization.primaryDomain;
    counts.set(emailDomain, (counts.get(emailDomain) ?? 0) + 1);
  }
  return counts;
}

function requireProofpointActiveUsers(organization: ProofpointOrganization) {
  if (organization.activeUsers !== undefined) return organization.activeUsers;
  throw new Error(
    `Proofpoint Essentials organization ${organization.name ?? organization.primaryDomain} did not return a valid active_users value. ` +
    'The sync was stopped because active_users is the authoritative billed quantity.',
  );
}

function requireProofpointLicensingPackage(organization: ProofpointOrganization) {
  const licensingPackage = organization.licensingPackage?.trim().toLowerCase();
  if (licensingPackage) return licensingPackage;
  throw new Error(
    `Proofpoint Essentials organization ${organization.name ?? organization.primaryDomain} did not return licensing_package. ` +
    'The sync was stopped because licensing_package is required for product mapping.',
  );
}

function domainsForSnapshot(
  organization: ProofpointOrganization,
  domains: ProofpointDomain[],
  counts: Map<string, number>,
) {
  const byName = new Map(domains.filter((item) => item.isActive !== false).map((domain) => [domain.name, domain]));
  for (const name of counts.keys()) {
    if (!byName.has(name)) byName.set(name, { name, raw: { name } });
  }
  if (byName.size === 0) byName.set(organization.primaryDomain, { name: organization.primaryDomain, raw: { name: organization.primaryDomain } });
  return [...byName.values()];
}

async function loadAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'proofpoint' and active = true and mapping_status = 'approved'`,
  );
  return new Map(result.rows.map((row) => [row.external_account_id.toLowerCase(), {
    customerId: row.customer_id,
    agreementId: row.agreement_id ?? undefined,
  }]));
}

async function loadProductMappings(database: Queryable) {
  const result = await database.query<VendorProductMappingRow>(
    `select vendor_product_key, connectwise_product_code, connectwise_product_name
     from vendor_product_mappings
     where vendor_id = 'proofpoint'
       and active = true and mapping_status = 'approved'
     order by vendor_product_key, target_index, connectwise_product_code`,
  );
  const mappings = new Map<string, ProofpointProduct>();
  for (const row of result.rows) {
    const key = row.vendor_product_key.trim().toLowerCase();
    if (!mappings.has(key)) {
      mappings.set(key, {
        productCode: row.connectwise_product_code,
        productName: row.connectwise_product_name,
      });
    }
  }
  return mappings;
}

function defaultProductForPackage(vendorProductKey: string): ProofpointProduct {
  const packageName = vendorProductKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return {
    productCode: `PROOFPOINT-ESSENTIALS-${vendorProductKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    productName: `Proofpoint Essentials ${packageName}`,
  };
}

async function startSyncRun(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('proofpoint', 'running', $1::jsonb) returning id`,
    [JSON.stringify({ entity: 'usage-snapshots' })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to create Proofpoint Essentials usage snapshot sync run.');
  return id;
}

async function insertUsageSnapshot(database: Queryable, input: {
  syncRunId: string;
  customerId?: string;
  agreementId?: string;
  organization: ProofpointOrganization;
  stackUrl: string;
  vendorProductKey: string;
  domains: ProofpointDomain[];
  domainCounts: Map<string, number>;
  usersEndpointActiveBillableCount: number;
  quantity: number;
  observedAt: string;
  product: ProofpointProduct;
}) {
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id, vendor_id, customer_id, agreement_id, external_account_id,
       vendor_product_key, product_code, product_name, quantity, observed_at, dimensions, raw_payload
     ) values ($1, 'proofpoint', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.organization.primaryDomain,
      input.vendorProductKey,
      input.product.productCode,
      input.product.productName,
      input.quantity,
      input.observedAt,
      JSON.stringify({
        customerName: input.organization.name,
        proofpointStackUrl: input.stackUrl,
        organizationDomain: input.organization.primaryDomain,
        domainNames: input.domains.map((domain) => domain.name),
        domainUserCounts: Object.fromEntries(input.domainCounts),
        proofpointOrganizationEid: input.organization.eid,
        activeBillableUsers: input.quantity,
        productName: input.product.productName,
        licensingPackage: input.organization.licensingPackage,
        purchasedLicenses: input.organization.userLicenses,
        renewalDate: input.organization.renewalDate,
        usersEndpointActiveBillableCount: input.usersEndpointActiveBillableCount,
        activeUserCountMismatch: input.quantity !== input.usersEndpointActiveBillableCount,
      }),
      JSON.stringify({
        proofpointStackUrl: input.stackUrl,
        organization: input.organization.raw,
        domains: input.domains.map((domain) => domain.raw),
        domainUserCounts: Object.fromEntries(input.domainCounts),
        activeBillableUsers: input.quantity,
        licensingPackage: input.organization.licensingPackage,
        purchasedLicenses: input.organization.userLicenses,
        renewalDate: input.organization.renewalDate,
        usersEndpointActiveBillableCount: input.usersEndpointActiveBillableCount,
        activeUserCountMismatch: input.quantity !== input.usersEndpointActiveBillableCount,
      }),
    ],
  );
}

async function completeSyncRun(database: Queryable, id: string, read: number, written: number, metadata: Record<string, unknown>) {
  await database.query(
    `update sync_runs set status = 'complete', completed_at = now(), records_read = $2,
       records_written = $3, metadata = metadata || $4::jsonb where id = $1`,
    [id, read, written, JSON.stringify(metadata)],
  );
}

async function failSyncRun(database: Queryable, id: string, error: unknown) {
  await database.query(
    `update sync_runs set status = 'failed', completed_at = now(), error_message = $2 where id = $1`,
    [id, error instanceof Error ? error.message : String(error)],
  );
}
