import type { IntegrationId } from '../../shared/integrationSettings';

export type ClientExclusionIntegrationId = Extract<IntegrationId, 'microsoft-365' | 'opentext-appriver'>;

export type IntegrationClientCandidate = {
  externalClientId: string;
  displayName: string;
  excluded: boolean;
  excludedBy?: string;
  excludedAt?: string;
  lastSeenAt?: string;
  latestError?: string;
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

type CandidateRow = {
  external_client_id: string;
  display_name: string | null;
  observed_at: Date | string | null;
  error_message?: string | null;
};

type ExclusionRow = {
  external_client_id: string;
  display_name: string;
  excluded_by: string;
  excluded_at: Date | string;
};

type SyncMetadataRow = {
  metadata: unknown;
  observed_at: Date | string | null;
};

type MutableCandidate = IntegrationClientCandidate & {
  observedTimestamp: number;
};

export function isClientExclusionIntegrationId(value: string | undefined): value is ClientExclusionIntegrationId {
  return value === 'microsoft-365' || value === 'opentext-appriver';
}

export async function loadIntegrationClientExclusionIds(
  database: Queryable,
  integrationId: ClientExclusionIntegrationId,
) {
  const result = await database.query<{ external_client_id: string }>(
    `select external_client_id
       from integration_client_exclusions
      where integration_id = $1`,
    [integrationId],
  );

  return new Set(result.rows.map((row) => normalizeClientId(row.external_client_id)).filter(Boolean));
}

export async function listIntegrationClientCandidates(
  database: Queryable,
  integrationId: ClientExclusionIntegrationId,
): Promise<IntegrationClientCandidate[]> {
  const [exclusions, mappings, discovered, failures] = await Promise.all([
    database.query<ExclusionRow>(
      `select external_client_id, display_name, excluded_by, excluded_at
         from integration_client_exclusions
        where integration_id = $1`,
      [integrationId],
    ),
    database.query<CandidateRow>(
      `select external_account_id as external_client_id,
              external_account_name as display_name,
              last_seen_at as observed_at,
              null::text as error_message
         from vendor_account_mappings
        where vendor_id = $1`,
      [integrationId],
    ),
    loadDiscoveredCandidates(database, integrationId),
    loadFailureCandidates(database, integrationId),
  ]);

  const candidates = new Map<string, MutableCandidate>();
  const merge = (row: CandidateRow, sourceExcluded = false, excludedBy?: string, excludedAt?: Date | string) => {
    const externalClientId = cleanText(row.external_client_id);
    if (!externalClientId) return;
    const key = normalizeClientId(externalClientId);
    const observedTimestamp = timestampValue(row.observed_at);
    const current = candidates.get(key);
    const rowName = friendlyDisplayName(row.display_name, externalClientId);
    const displayName = chooseDisplayName(current?.displayName, rowName, externalClientId);
    const shouldUseError = Boolean(row.error_message) && (!current?.latestError || observedTimestamp >= current.observedTimestamp);

    candidates.set(key, {
      externalClientId: current?.externalClientId ?? externalClientId,
      displayName,
      excluded: current?.excluded || sourceExcluded,
      excludedBy: excludedBy ?? current?.excludedBy,
      excludedAt: excludedAt ? isoDate(excludedAt) : current?.excludedAt,
      lastSeenAt: observedTimestamp >= (current?.observedTimestamp ?? 0) && row.observed_at
        ? isoDate(row.observed_at)
        : current?.lastSeenAt,
      latestError: shouldUseError ? cleanText(row.error_message) : current?.latestError,
      observedTimestamp: Math.max(current?.observedTimestamp ?? 0, observedTimestamp),
    });
  };

  for (const row of mappings.rows) merge(row);
  for (const row of discovered) merge(row);
  for (const row of failures) merge(row);
  for (const row of exclusions.rows) {
    merge(
      {
        external_client_id: row.external_client_id,
        display_name: row.display_name,
        observed_at: row.excluded_at,
      },
      true,
      row.excluded_by,
      row.excluded_at,
    );
  }

  return [...candidates.values()]
    .map(({ observedTimestamp: _observedTimestamp, ...candidate }) => candidate)
    .sort((left, right) =>
      Number(right.excluded) - Number(left.excluded)
      || left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
      || left.externalClientId.localeCompare(right.externalClientId),
    );
}

export async function replaceIntegrationClientExclusions(input: {
  database: Queryable;
  integrationId: ClientExclusionIntegrationId;
  excludedClientIds: string[];
  actor: string;
}) {
  const candidates = await listIntegrationClientCandidates(input.database, input.integrationId);
  const candidateById = new Map(candidates.map((candidate) => [normalizeClientId(candidate.externalClientId), candidate]));
  const requestedKeys = [...new Set(input.excludedClientIds.map(normalizeClientId).filter(Boolean))];
  if (requestedKeys.length > 5000) {
    throw new Error('No more than 5,000 clients can be excluded for one integration.');
  }

  const selected = requestedKeys.map((key) => {
    const candidate = candidateById.get(key);
    return {
      externalClientId: candidate?.externalClientId ?? cleanText(input.excludedClientIds.find((value) => normalizeClientId(value) === key)) ?? key,
      displayName: candidate?.displayName ?? key,
    };
  });

  await input.database.query(
    `with removed as (
       delete from integration_client_exclusions
        where integration_id = $1
          and not (lower(trim(external_client_id)) = any($2::text[]))
       returning external_client_id
     )
     insert into integration_client_exclusions (
       integration_id, external_client_id, display_name, excluded_by, excluded_at, updated_at
     )
     select $1, selected.external_client_id, selected.display_name, $4, now(), now()
       from unnest($3::text[], $5::text[]) as selected(external_client_id, display_name)
     on conflict (integration_id, external_client_id)
     do update set
       display_name = excluded.display_name,
       excluded_by = excluded.excluded_by,
       updated_at = now()`,
    [
      input.integrationId,
      requestedKeys,
      selected.map((item) => item.externalClientId),
      input.actor,
      selected.map((item) => item.displayName),
    ],
  );

  await input.database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, 'integration.client-exclusions.updated', 'integration', $2, $3::jsonb)`,
    [
      input.actor,
      input.integrationId,
      JSON.stringify({
        excludedClientCount: selected.length,
        excludedClients: selected,
      }),
    ],
  );

  return listIntegrationClientCandidates(input.database, input.integrationId);
}

async function loadDiscoveredCandidates(
  database: Queryable,
  integrationId: ClientExclusionIntegrationId,
): Promise<CandidateRow[]> {
  if (integrationId === 'opentext-appriver') {
    const result = await database.query<CandidateRow>(
      `select distinct on (lower(external_customer_id))
              external_customer_id as external_client_id,
              customer_name as display_name,
              updated_at as observed_at,
              error_message
         from appriver_sync_work_items
        order by lower(external_customer_id), updated_at desc`,
    );
    return result.rows;
  }

  const result = await database.query<CandidateRow>(
    `select external_account_id as external_client_id,
            max(coalesce(nullif(tenant_name, ''), nullif(tenant_default_domain_name, ''), external_account_id)) as display_name,
            max(observed_at) as observed_at,
            null::text as error_message
       from microsoft365_subscription_snapshots
      group by external_account_id`,
  );
  return result.rows;
}

async function loadFailureCandidates(
  database: Queryable,
  integrationId: ClientExclusionIntegrationId,
): Promise<CandidateRow[]> {
  const result = await database.query<SyncMetadataRow>(
    `select metadata, coalesce(completed_at, started_at) as observed_at
       from sync_runs
      where integration_id = $1
      order by started_at desc
      limit 25`,
    [integrationId],
  );
  const candidates: CandidateRow[] = [];

  for (const row of result.rows) {
    const metadata = jsonObject(row.metadata);
    const failureArrays = integrationId === 'microsoft-365'
      ? [metadata.failedTenantDetails, metadata.failedProductSubscriptionDetails]
      : [metadata.failedCustomerDetails, metadata.failedSubscriptionDetails];
    for (const failureArray of failureArrays) {
      if (!Array.isArray(failureArray)) continue;
      for (const item of failureArray) {
        const failure = jsonObject(item);
        const externalClientId = integrationId === 'microsoft-365'
          ? cleanText(failure.tenantId)
          : cleanText(failure.customerId);
        if (!externalClientId) continue;
        candidates.push({
          external_client_id: externalClientId,
          display_name: integrationId === 'microsoft-365'
            ? cleanText(failure.displayName) ?? null
            : cleanText(failure.customerName) ?? null,
          observed_at: row.observed_at,
          error_message: cleanText(failure.message),
        });
      }
    }
  }

  return candidates;
}

function chooseDisplayName(current: string | undefined, candidate: string, externalClientId: string) {
  if (!current || normalizeClientId(current) === normalizeClientId(externalClientId)) return candidate;
  if (normalizeClientId(candidate) === normalizeClientId(externalClientId)) return current;
  return current;
}

function friendlyDisplayName(value: string | null | undefined, externalClientId: string) {
  return cleanText(value) ?? externalClientId;
}

function normalizeClientId(value: unknown) {
  return cleanText(value)?.toLocaleLowerCase() ?? '';
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestampValue(value: Date | string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value instanceof Date ? value.toISOString() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
