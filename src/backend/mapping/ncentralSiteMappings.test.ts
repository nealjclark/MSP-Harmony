import assert from 'node:assert/strict';
import {
  deactivateNcentralSiteMapping,
  listNcentralSiteMappings,
  listNcentralSiteOptions,
  siteMappingKey,
  upsertNcentralSiteMapping,
} from './ncentralSiteMappings';

const queries: Array<{ sql: string; values?: unknown[] }> = [];
const database = {
  async query<T>(sql: string, values?: unknown[]) {
    queries.push({ sql, values });
    if (sql.includes('count(*)::int as device_count')) {
      return {
        rows: [
          {
            ncentral_customer_id: '200',
            ncentral_customer_name: 'CSP Consulting',
            ncentral_site_id: '300',
            ncentral_site_name: 'Downstream Client',
            device_count: 12,
          },
          {
            ncentral_customer_id: '200',
            ncentral_customer_name: 'CSP Consulting',
            ncentral_site_id: '301',
            ncentral_site_name: 'Parent Office',
            device_count: 3,
          },
        ] as T[],
      };
    }
    if (sql.includes('from ncentral_site_mappings site_mappings')) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          ncentral_customer_id: '200',
          ncentral_customer_name: 'CSP Consulting',
          ncentral_site_id: '300',
          ncentral_site_name: 'Downstream Client',
          customer_id: '22222222-2222-4222-8222-222222222222',
          customer_name: 'Downstream Client',
          agreement_id: '33333333-3333-4333-8333-333333333333',
          agreement_name: 'Managed Services',
          active: true,
          reviewed_by: 'admin@example.com',
          reviewed_at: '2026-08-03T12:00:00.000Z',
          last_seen_at: '2026-08-03T12:00:00.000Z',
        }] as T[],
      };
    }
    if (sql.includes('insert into ncentral_site_mappings')) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          ncentral_customer_id: '200',
          ncentral_customer_name: 'CSP Consulting',
          ncentral_site_id: '300',
          ncentral_site_name: 'Downstream Client',
          customer_id: '22222222-2222-4222-8222-222222222222',
          customer_name: null,
          agreement_id: '33333333-3333-4333-8333-333333333333',
          agreement_name: null,
          active: true,
          reviewed_by: 'admin@example.com',
          reviewed_at: '2026-08-03T12:00:00.000Z',
          last_seen_at: '2026-08-03T12:00:00.000Z',
        }] as T[],
      };
    }
    if (sql.includes('update ncentral_site_mappings')) {
      return {
        rows: [{
          ncentral_customer_id: '200',
          ncentral_site_id: '300',
        }] as T[],
      };
    }
    return { rows: [] as T[] };
  },
};

async function run() {
  const options = await listNcentralSiteOptions(database);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.customerName, 'CSP Consulting');
  assert.equal(options[0]?.sites.length, 2);
  assert.equal(options[0]?.sites[0]?.deviceCount, 12);

  const mappings = await listNcentralSiteMappings(database);
  assert.equal(mappings[0]?.ncentralSiteName, 'Downstream Client');
  assert.equal(mappings[0]?.customerName, 'Downstream Client');

  await upsertNcentralSiteMapping(database, {
    ncentralCustomerId: '200',
    ncentralCustomerName: 'CSP Consulting',
    ncentralSiteId: '300',
    ncentralSiteName: 'Downstream Client',
    customerId: '22222222-2222-4222-8222-222222222222',
    agreementId: '33333333-3333-4333-8333-333333333333',
    reviewedBy: 'admin@example.com',
  });
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes('update vendor_usage_snapshots snapshots') &&
        query.sql.includes("snapshots.dimensions->>'siteId' = site_mappings.ncentral_site_id"),
    ),
    true,
  );

  await deactivateNcentralSiteMapping(
    database,
    '11111111-1111-4111-8111-111111111111',
    'admin@example.com',
  );
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes('update vendor_usage_snapshots snapshots') &&
        query.sql.includes('select account_mappings.customer_id'),
    ),
    true,
  );
  assert.equal(siteMappingKey('200', '300'), '200:300');

  console.log('N-Able site mapping tests passed');
}

void run();
