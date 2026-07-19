import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { syncProofpointUsageSnapshots, testProofpointConnection, type Queryable } from './operations';

const definition = getIntegrationSettingsDefinition('proofpoint');
assert.ok(definition);
const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'proofpoint');
    return {
      definition,
      nonSecrets: { endpoint: 'https://us2.proofpointessentials.com', organizationDomain: 'partner.example' },
      secrets: { username: 'admin@partner.example', password: 'secret' },
      secretSource: 'environment',
      validation: {
        integrationId: 'proofpoint', displayName: 'Proofpoint Essentials', configuredStatus: 'connected',
        missingSecrets: [], missingNonSecrets: [], lastTestResult: 'success',
      },
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() { return [await this.getIntegrationSettings('proofpoint')]; },
};

const inserted: unknown[][] = [];
const completed: unknown[][] = [];
const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) return { rows: [{ id: 'sync-proofpoint-1' } as T] };
    if (sql.includes('from vendor_account_mappings')) {
      return { rows: [{ external_account_id: 'northstar.example', customer_id: 'customer-1', agreement_id: 'agreement-1' } as T] };
    }
    if (sql.includes('from vendor_product_mappings')) {
      return { rows: [{
        vendor_product_key: 'business_plus',
        connectwise_product_code: 'CW-PPE-BUSINESS-PLUS',
        connectwise_product_name: 'Proofpoint Essentials Business Plus',
      } as T] };
    }
    if (sql.includes('insert into vendor_usage_snapshots')) { inserted.push(values ?? []); return { rows: [] }; }
    if (sql.includes("set status = 'complete'")) { completed.push(values ?? []); return { rows: [] }; }
    return { rows: [] };
  },
};

const organizations = [
  {
    primaryDomain: 'northstar.example', name: 'Northstar Dental', eid: '101', activeUsers: 5,
    userLicenses: 50, licensingPackage: 'business_plus', renewalDate: '2026/09/17', raw: { eid: 101, active_users: 5 },
  },
  {
    primaryDomain: 'summit.example', name: 'Summit Legal', eid: '102', activeUsers: 2,
    userLicenses: 25, licensingPackage: 'professional_plus', renewalDate: '2026/10/01', raw: { eid: 102, active_users: 2 },
  },
];
const client = {
  async listOrganizations() { return organizations; },
  async listDomains(domain: string) {
    return domain === 'northstar.example'
      ? [
          { name: 'northstar.example', isActive: true, raw: { name: 'northstar.example' } },
          { name: 'northstar-dental.example', isActive: true, raw: { name: 'northstar-dental.example' } },
        ]
      : [{ name: domain, isActive: true, raw: { name: domain } }];
  },
  async listUsers(domain: string) {
    return domain === 'northstar.example'
      ? [
          { primaryEmail: 'alice@northstar.example', isActive: true, isBillable: true, raw: {} },
          { primaryEmail: 'bob@northstar.example', isActive: true, isBillable: true, raw: {} },
          { primaryEmail: 'carol@northstar-dental.example', isActive: true, isBillable: true, raw: {} },
          { primaryEmail: 'service@northstar.example', isActive: true, isBillable: false, raw: {} },
        ]
      : [{ primaryEmail: 'inactive@summit.example', isActive: false, isBillable: true, raw: {} }];
  },
};
const euClient = {
  async listOrganizations() {
    return [{
      primaryDomain: 'agensight.co.uk', name: 'Agensight Limited', eid: '103', activeUsers: 4,
      userLicenses: 10, licensingPackage: 'business_plus', renewalDate: '2026/11/01',
      raw: { eid: 103, active_users: 4 },
    }];
  },
  async listDomains() {
    return [{ name: 'agensight.co.uk', isActive: true, raw: { name: 'agensight.co.uk' } }];
  },
  async listUsers() {
    return ['one', 'two', 'three', 'four'].map((name) => ({
      primaryEmail: `${name}@agensight.co.uk`, isActive: true, isBillable: true, raw: {},
    }));
  },
};

async function run() {
  const testResult = await testProofpointConnection({ provider, client, now: '2026-07-18T12:00:00.000Z' });
  assert.equal(testResult.stackCount, 1);
  assert.equal(testResult.organizationCount, 2);
  assert.equal(testResult.firstOrganizationUserCount, 4);
  const multiStackTestResult = await testProofpointConnection({
    provider,
    clients: [
      { endpoint: 'https://us5.proofpointessentials.com', client },
      { endpoint: 'https://eu1.proofpointessentials.com', client: euClient },
    ],
    now: '2026-07-18T12:01:00.000Z',
  });
  assert.equal(multiStackTestResult.stackCount, 2);
  assert.deepEqual(multiStackTestResult.stacks, [
    { stackUrl: 'https://us5.proofpointessentials.com', organizationCount: 2 },
    { stackUrl: 'https://eu1.proofpointessentials.com', organizationCount: 1 },
  ]);
  assert.equal(multiStackTestResult.organizationCount, 3);
  assert.equal(multiStackTestResult.sampleOrganizations.some((item) => item.name === 'Agensight Limited'), true);
  const result = await syncProofpointUsageSnapshots({
    pool: database,
    provider,
    clients: [
      { endpoint: 'https://us5.proofpointessentials.com', client },
      { endpoint: 'https://eu1.proofpointessentials.com', client: euClient },
    ],
    now: '2026-07-18T12:05:00.000Z',
  });
  assert.equal(result.recordsRead, 9);
  assert.equal(result.recordsWritten, 3);
  assert.equal(result.activeBillableUsers, 11);
  assert.equal(result.excludedUsers, 2);
  assert.equal(result.mappedSnapshots, 1);
  assert.equal(result.unmappedSnapshots, 2);
  assert.equal(inserted[0]?.[3], 'northstar.example');
  assert.equal(inserted[0]?.[4], 'business_plus');
  assert.equal(inserted[0]?.[5], 'CW-PPE-BUSINESS-PLUS');
  assert.equal(inserted[0]?.[6], 'Proofpoint Essentials Business Plus');
  assert.equal(inserted[0]?.[7], 5);
  assert.equal(inserted[1]?.[4], 'professional_plus');
  assert.equal(inserted[1]?.[5], 'PROOFPOINT-ESSENTIALS-PROFESSIONAL-PLUS');
  assert.equal(inserted[1]?.[6], 'Proofpoint Essentials Professional Plus');
  assert.equal(inserted[1]?.[7], 2);
  const northstarDimensions = JSON.parse(String(inserted[0]?.[9]));
  assert.deepEqual(northstarDimensions.domainNames, ['northstar.example', 'northstar-dental.example']);
  assert.deepEqual(northstarDimensions.domainUserCounts, {
    'northstar.example': 2,
    'northstar-dental.example': 1,
  });
  assert.equal(northstarDimensions.activeBillableUsers, 5);
  assert.equal(northstarDimensions.licensingPackage, 'business_plus');
  assert.equal(northstarDimensions.purchasedLicenses, 50);
  assert.equal(northstarDimensions.renewalDate, '2026/09/17');
  assert.equal(northstarDimensions.usersEndpointActiveBillableCount, 3);
  assert.equal(northstarDimensions.activeUserCountMismatch, true);
  const agensightDimensions = JSON.parse(String(inserted[2]?.[9]));
  assert.equal(inserted[2]?.[3], 'agensight.co.uk');
  assert.equal(inserted[2]?.[4], 'business_plus');
  assert.equal(inserted[2]?.[7], 4);
  assert.equal(agensightDimensions.customerName, 'Agensight Limited');
  assert.equal(agensightDimensions.proofpointStackUrl, 'https://eu1.proofpointessentials.com');
  assert.equal(inserted.length, 3);
  const completedMetadata = JSON.parse(String(completed[0]?.[3]));
  assert.equal(completedMetadata.activeBillableUsers, 11);
  assert.equal(completedMetadata.stackCount, 2);
  console.log('proofpoint operations tests passed');
}

run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
