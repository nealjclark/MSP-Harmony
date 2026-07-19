import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import type { VendorRuleSet } from '../../shared/types';
import {
  CaveloClient,
  caveloCredentialsFromSettings,
  type CaveloAgent,
  type CaveloOrganization,
} from './client';

export type QueryResult<T> = { rows: T[] };
export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type CaveloUsageClient = {
  listOrganizations: () => Promise<CaveloOrganization[]>;
  listOrganizationAgents: (organizationUuid: string) => Promise<CaveloAgent[]>;
};

export type CaveloConnectionTestResult = {
  integrationId: 'cavelo';
  testedAt: string;
  organizationCount: number;
  sampleOrganizations: Array<{ organizationUuid: string; organizationId?: string; name?: string }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type CaveloUsageSnapshotSyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
  mappedSnapshots: number;
  unmappedSnapshots: number;
  inactiveAgents: number;
  organizationsRead: number;
};

type VendorAccountMappingRow = {
  external_account_id: string;
  customer_id: string;
  agreement_id: string | null;
};

type VendorProductMappingRow = {
  connectwise_product_code: string;
  connectwise_product_name: string;
};

const caveloProductKey = 'cavelo-agent';
const defaultProduct = { productCode: 'CAVELO-AGENT', productName: 'Cavelo Active Agent' };

type CaveloProductMappingRow = {
  vendor_product_key: string;
  target_index: string | number;
  connectwise_product_code: string;
  connectwise_product_name: string;
  unit_price: string | number | null;
};

export async function loadCaveloRuleSet(database: Queryable): Promise<VendorRuleSet> {
  const result = await database.query<CaveloProductMappingRow>(
    `select vendor_product_key,
            target_index,
            connectwise_product_code,
            connectwise_product_name,
            unit_price
       from vendor_product_mappings
      where vendor_id = 'cavelo'
        and active = true
        and mapping_status = 'approved'
      order by vendor_product_key, target_index, connectwise_product_code`,
  );
  const mappingsByProduct = new Map<string, CaveloProductMappingRow[]>();
  for (const row of result.rows) {
    const mappings = mappingsByProduct.get(row.vendor_product_key) ?? [];
    mappings.push(row);
    mappingsByProduct.set(row.vendor_product_key, mappings);
  }

  return {
    vendorId: 'cavelo',
    vendorName: 'Cavelo',
    rules: [...mappingsByProduct.entries()].map(([vendorProductKey, mappings]) => {
      const primary = mappings[0]!;
      return {
        id: `cavelo:${vendorProductKey}:device-count`,
        vendorId: 'cavelo',
        vendorProductKey,
        productCode: primary.connectwise_product_code,
        targetProductCodes: [...new Set(mappings.map((mapping) => mapping.connectwise_product_code))],
        productName: primary.connectwise_product_name,
        sourceMetric: 'snapshot-count' as const,
        billableUnit: 'device' as const,
        unitPrice:
          primary.unit_price === null
            ? undefined
            : { amount: Number(primary.unit_price), currency: 'USD' as const },
        notes: 'Cavelo active device count matched to an existing addition or the first approved default target.',
      };
    }),
  };
}

export async function testCaveloConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: CaveloUsageClient;
  now?: string;
} = {}): Promise<CaveloConnectionTestResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('cavelo');
  assertCaveloReady(settings);
  const client = input.client ?? new CaveloClient(caveloCredentialsFromSettings(settings));
  const organizations = await client.listOrganizations();

  return {
    integrationId: 'cavelo',
    testedAt: input.now ?? new Date().toISOString(),
    organizationCount: organizations.length,
    sampleOrganizations: organizations.slice(0, 5).map(({ organizationUuid, organizationId, name }) => ({
      organizationUuid,
      organizationId,
      name,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncCaveloUsageSnapshots(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: CaveloUsageClient;
  now?: string;
  onProgress?: SyncProgressReporter;
}): Promise<CaveloUsageSnapshotSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('cavelo');
  assertCaveloReady(settings);
  const observedAt = input.now ?? new Date().toISOString();
  const inactiveCutoff = new Date(observedAt).getTime() - 30 * 24 * 60 * 60 * 1000;
  const syncRunId = await startCaveloSyncRun(input.pool);
  const client = input.client ?? new CaveloClient(caveloCredentialsFromSettings(settings));

  try {
    const [organizations, accountMappings, product] = await Promise.all([
      client.listOrganizations(),
      loadCaveloAccountMappings(input.pool),
      loadCaveloProductMapping(input.pool),
    ]);
    let recordsRead = 0;
    let recordsWritten = 0;
    let mappedSnapshots = 0;
    let unmappedSnapshots = 0;
    let inactiveAgents = 0;

    await input.onProgress?.({ completed: 0, total: organizations.length, unitLabel: 'organizations' });
    for (const [organizationIndex, organization] of organizations.entries()) {
      await input.onProgress?.({
        completed: organizationIndex,
        total: organizations.length,
        currentItem: organization.name ?? organization.organizationUuid,
        unitLabel: 'organizations',
      });
      const agents = await client.listOrganizationAgents(organization.organizationUuid);
      recordsRead += agents.length;
      const accountMapping = accountMappings.get(organization.organizationUuid);

      for (const agent of agents) {
        if (!isActiveAgent(agent, inactiveCutoff)) {
          inactiveAgents += 1;
          continue;
        }
        if (accountMapping) mappedSnapshots += 1;
        else unmappedSnapshots += 1;

        await insertCaveloUsageSnapshot(input.pool, {
          syncRunId,
          customerId: accountMapping?.customerId,
          agreementId: accountMapping?.agreementId,
          observedAt,
          organization,
          agent,
          product,
        });
        recordsWritten += 1;
      }
    }

    await input.onProgress?.({ completed: organizations.length, total: organizations.length, unitLabel: 'organizations' });
    await completeCaveloSyncRun(input.pool, syncRunId, recordsRead, recordsWritten, {
      entity: 'usage-snapshots',
      organizationsRead: organizations.length,
      activeAgents: recordsWritten,
      inactiveAgents,
      mappedSnapshots,
      unmappedSnapshots,
      inactivityDays: 30,
      productMapping: product,
    });

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
      mappedSnapshots,
      unmappedSnapshots,
      inactiveAgents,
      organizationsRead: organizations.length,
    };
  } catch (error) {
    await failCaveloSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertCaveloReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) return;
  throw new Error(
    `Cavelo settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

function isActiveAgent(agent: CaveloAgent, cutoff: number) {
  if (agent.enabled === false || !agent.latestHeartbeatTime) return false;
  const heartbeat = Date.parse(agent.latestHeartbeatTime);
  return Number.isFinite(heartbeat) && heartbeat >= cutoff;
}

async function loadCaveloAccountMappings(database: Queryable) {
  const result = await database.query<VendorAccountMappingRow>(
    `select external_account_id, customer_id, agreement_id
     from vendor_account_mappings
     where vendor_id = 'cavelo'
       and active = true
       and mapping_status = 'approved'`,
  );
  return new Map(result.rows.map((row) => [
    row.external_account_id,
    { customerId: row.customer_id, agreementId: row.agreement_id ?? undefined },
  ]));
}

async function loadCaveloProductMapping(database: Queryable) {
  const result = await database.query<VendorProductMappingRow>(
    `select connectwise_product_code, connectwise_product_name
     from vendor_product_mappings
     where vendor_id = 'cavelo'
       and vendor_product_key = $1
       and active = true
       and mapping_status = 'approved'
     order by target_index, connectwise_product_code
     limit 1`,
    [caveloProductKey],
  );
  const row = result.rows[0];
  return row ? { productCode: row.connectwise_product_code, productName: row.connectwise_product_name } : defaultProduct;
}

async function startCaveloSyncRun(database: Queryable) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('cavelo', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity: 'usage-snapshots', inactivityDays: 30 })],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to create Cavelo usage snapshot sync run.');
  return id;
}

async function insertCaveloUsageSnapshot(database: Queryable, input: {
  syncRunId: string;
  customerId?: string;
  agreementId?: string;
  observedAt: string;
  organization: CaveloOrganization;
  agent: CaveloAgent;
  product: typeof defaultProduct;
}) {
  await database.query(
    `insert into vendor_usage_snapshots (
       sync_run_id, vendor_id, customer_id, agreement_id, external_account_id,
       vendor_product_key, product_code, product_name, quantity, observed_at, dimensions, raw_payload
     )
     values ($1, 'cavelo', $2, $3, $4, $5, $6, $7, 1, $8, $9::jsonb, $10::jsonb)`,
    [
      input.syncRunId,
      input.customerId ?? null,
      input.agreementId ?? null,
      input.organization.organizationUuid,
      caveloProductKey,
      input.product.productCode,
      input.product.productName,
      input.observedAt,
      JSON.stringify({
        customerName: input.organization.name,
        caveloOrganizationUuid: input.organization.organizationUuid,
        caveloOrganizationId: input.organization.organizationId,
        caveloAgentId: input.agent.agentId,
        hostname: input.agent.hostname,
        enabled: input.agent.enabled,
        latestHeartbeatTime: input.agent.latestHeartbeatTime,
        operatingSystem: input.agent.operatingSystem,
      }),
      JSON.stringify({ organization: input.organization.raw, agent: input.agent.raw }),
    ],
  );
}

async function completeCaveloSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete', completed_at = now(), records_read = $2, records_written = $3,
         metadata = metadata || $4::jsonb
     where id = $1`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failCaveloSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs set status = 'failed', completed_at = now(), error_message = $2 where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}
