import assert from 'node:assert/strict';
import {
  listIntegrationClientCandidates,
  loadIntegrationClientExclusionIds,
  replaceIntegrationClientExclusions,
  type Queryable,
} from './clientExclusions';

const exclusions = new Map<string, { display_name: string; excluded_by: string; excluded_at: string }>([
  ['waldorf', {
    display_name: 'Waldorf',
    excluded_by: 'admin@example.com',
    excluded_at: '2026-08-17T12:00:00.000Z',
  }],
]);
const auditEvents: unknown[][] = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values: unknown[] = []) {
    if (sql.includes('select external_client_id') && sql.includes('from integration_client_exclusions')) {
      return {
        rows: [...exclusions.entries()].map(([external_client_id, exclusion]) => ({
          external_client_id,
          ...exclusion,
        } as T)),
      };
    }
    if (sql.includes('from vendor_account_mappings')) {
      return { rows: [{
        external_client_id: 'meyer-davis',
        display_name: 'Meyer Davis',
        observed_at: '2026-08-18T10:00:00.000Z',
        error_message: null,
      } as T] };
    }
    if (sql.includes('from appriver_sync_work_items')) {
      return { rows: [
        {
          external_client_id: 'meyer-davis',
          display_name: 'Meyer Davis',
          observed_at: '2026-08-18T11:00:00.000Z',
          error_message: 'Customer subscription request returned 403.',
        } as T,
        {
          external_client_id: 'waldorf',
          display_name: 'Waldorf',
          observed_at: '2026-08-18T11:05:00.000Z',
          error_message: 'Customer is no longer available.',
        } as T,
      ] };
    }
    if (sql.includes('from sync_runs')) {
      return { rows: [] as T[] };
    }
    if (sql.includes('with removed as')) {
      const requestedKeys = new Set((values[1] as string[]) ?? []);
      for (const key of [...exclusions.keys()]) {
        if (!requestedKeys.has(key.toLowerCase())) exclusions.delete(key);
      }
      const ids = (values[2] as string[]) ?? [];
      const names = (values[4] as string[]) ?? [];
      ids.forEach((id, index) => exclusions.set(id, {
        display_name: names[index] ?? id,
        excluded_by: String(values[3]),
        excluded_at: '2026-08-18T12:00:00.000Z',
      }));
      return { rows: [] as T[] };
    }
    if (sql.includes("integration.client-exclusions.updated")) {
      auditEvents.push(values);
      return { rows: [] as T[] };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
  },
};

async function run() {
  const candidates = await listIntegrationClientCandidates(database, 'opentext-appriver');
  assert.deepEqual(candidates.map((candidate) => candidate.displayName), ['Waldorf', 'Meyer Davis']);
  assert.equal(candidates[0]?.excluded, true);
  assert.match(candidates[1]?.latestError ?? '', /403/);

  const saved = await replaceIntegrationClientExclusions({
    database,
    integrationId: 'opentext-appriver',
    excludedClientIds: ['waldorf', 'meyer-davis'],
    actor: 'admin@example.com',
  });
  assert.equal(saved.filter((candidate) => candidate.excluded).length, 2);
  assert.equal(auditEvents.length, 1);

  const ids = await loadIntegrationClientExclusionIds(database, 'opentext-appriver');
  assert.deepEqual(ids, new Set(['waldorf', 'meyer-davis']));

  console.log('integration client exclusions tests passed');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
