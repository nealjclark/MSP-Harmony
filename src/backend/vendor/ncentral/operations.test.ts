import assert from 'node:assert/strict';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { loadNcentralRuleSet, syncNcentralUsageSnapshots, testNcentralConnection, type Queryable } from './operations';

const ncentralDefinition = getIntegrationSettingsDefinition('ncentral');
assert.ok(ncentralDefinition);

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings(integrationId) {
    assert.equal(integrationId, 'ncentral');
    return {
      definition: ncentralDefinition,
      nonSecrets: {
        endpoint: 'https://ncentral.example.com',
      },
      secrets: {
        apiToken: 'token',
      },
      secretSource: 'environment',
      validation: {
        integrationId: 'ncentral',
        displayName: 'N-able N-central',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('ncentral')];
  },
};

const insertedSnapshots: unknown[][] = [];
const completedRuns: unknown[][] = [];

const database: Queryable = {
  async query<T = unknown>(sql: string, values?: unknown[]) {
    if (sql.includes('insert into sync_runs')) {
      return { rows: [{ id: 'sync-ncentral-1' } as T] };
    }

    if (sql.includes('from vendor_account_mappings')) {
      return {
        rows: [
          {
            external_account_id: '200',
            customer_id: 'customer-1',
            agreement_id: 'agreement-1',
          } as T,
        ],
      };
    }

    if (sql.includes('from vendor_product_mappings')) {
      return {
        rows: [
          {
            vendor_product_key: 'ncentral-physical-server',
            target_index: 0,
            connectwise_product_code: 'CW-MANAGED-SERVER',
            connectwise_product_name: 'CW Managed Server',
            unit_price: '150',
          } as T,
          {
            vendor_product_key: 'ncentral-workstation',
            target_index: 0,
            connectwise_product_code: 'CW-MANAGED-WORKSTATION',
            connectwise_product_name: 'CW Managed Workstation',
            unit_price: '35',
          } as T,
        ],
      };
    }

    if (sql.includes('from ncentral_filter_mappings')) {
      return {
        rows: [
          {
            id: 'filter-physical',
            filter_id: '10',
            filter_name: 'Billing - Servers - Physical',
            mapping_type: 'product',
            vendor_product_key: 'ncentral-physical-server',
            display_name: 'Physical Server',
            tag_key: null,
            priority: 10,
            mapping_status: 'approved',
            active: true,
            raw_payload: {},
            created_at: '2026-06-16T00:00:00.000Z',
            updated_at: '2026-06-16T00:00:00.000Z',
          } as T,
          {
            id: 'filter-workstation',
            filter_id: '11',
            filter_name: 'Billing - Workstations and Laptops',
            mapping_type: 'product',
            vendor_product_key: 'ncentral-workstation',
            display_name: 'Workstation',
            tag_key: null,
            priority: 30,
            mapping_status: 'approved',
            active: true,
            raw_payload: {},
            created_at: '2026-06-16T00:00:00.000Z',
            updated_at: '2026-06-16T00:00:00.000Z',
          } as T,
          {
            id: 'filter-donotbill',
            filter_id: '20',
            filter_name: 'Billing - DoNotBill Devices',
            mapping_type: 'overlay',
            vendor_product_key: null,
            display_name: 'Do not bill',
            tag_key: 'do-not-bill',
            priority: 100,
            mapping_status: 'approved',
            active: true,
            raw_payload: {},
            created_at: '2026-06-16T00:00:00.000Z',
            updated_at: '2026-06-16T00:00:00.000Z',
          } as T,
        ],
      };
    }

    if (sql.includes('insert into vendor_usage_snapshots')) {
      insertedSnapshots.push(values ?? []);
      return { rows: [] as T[] };
    }

    if (sql.includes("set status = 'complete'")) {
      completedRuns.push(values ?? []);
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  },
};

async function run() {
  const client = {
    async authenticate() {
      return {};
    },
    async validateToken() {
      return;
    },
    async listDeviceFilters() {
      return [
        { filterId: '10', filterName: 'Billing - Servers - Physical', raw: { filterId: '10' } },
        { filterId: '11', filterName: 'Billing - Workstations and Laptops', raw: { filterId: '11' } },
        { filterId: '20', filterName: 'Billing - DoNotBill Devices', raw: { filterId: '20' } },
      ];
    },
    async listDevicesByFilter(filterId: string) {
      if (filterId === '10') {
        return [
          {
            deviceId: 101,
            longName: 'server-01',
            deviceClass: 'Windows Server',
            customerId: 200,
            customerName: 'Mapped Customer',
            supportedOs: 'Windows Server 2022',
            raw: { deviceId: 101 },
          },
        ];
      }
      if (filterId === '11') {
        return [
          {
            deviceId: 102,
            longName: 'workstation-01',
            deviceClass: 'Windows Workstation',
            customerId: 201,
            customerName: 'Unmapped Customer',
            supportedOs: 'Windows 11',
            raw: { deviceId: 102 },
          },
        ];
      }
      return [
        {
          deviceId: 101,
          longName: 'server-01',
          deviceClass: 'Windows Server',
          customerId: 200,
          customerName: 'Mapped Customer',
          supportedOs: 'Windows Server 2022',
          raw: { deviceId: 101 },
        },
      ];
    },
    async enrichDevicesWithDetails(devices: Array<{ deviceId: number }>) {
      return new Map(
        devices.map((device) => [
          device.deviceId,
          {
            ...device,
            longName: device.deviceId === 101 ? 'server-01' : 'workstation-01',
            customerId: device.deviceId === 101 ? 200 : 201,
            customerName: device.deviceId === 101 ? 'Mapped Customer' : 'Unmapped Customer',
            raw: { deviceId: device.deviceId },
            lastApplianceCheckinTime: device.deviceId === 101 ? '2026-06-16T12:00:00Z' : undefined,
          },
        ]),
      );
    },
  };

  const testResult = await testNcentralConnection({
    provider,
    client,
    now: '2026-06-16T12:00:00.000Z',
  });
  assert.equal(testResult.filterCount, 3);

  const syncResult = await syncNcentralUsageSnapshots({
    pool: database,
    provider,
    client,
    now: '2026-06-16T13:00:00.000Z',
  });

  assert.equal(syncResult.syncRunId, 'sync-ncentral-1');
  assert.equal(syncResult.recordsRead, 2);
  assert.equal(syncResult.recordsWritten, 2);
  assert.equal(syncResult.mappedSnapshots, 1);
  assert.equal(syncResult.unmappedSnapshots, 1);
  assert.equal(syncResult.productSnapshots['ncentral-physical-server'], 1);
  assert.equal(syncResult.overlayMatches['do-not-bill'], 1);
  assert.equal(syncResult.detailEnrichedSnapshots, 1);

  const mappedServer = insertedSnapshots[0];
  assert.equal(mappedServer?.[1], 'customer-1');
  assert.equal(mappedServer?.[2], 'agreement-1');
  assert.equal(mappedServer?.[3], '200');
  assert.equal(mappedServer?.[4], 'ncentral-physical-server');
  assert.equal(mappedServer?.[5], 'CW-MANAGED-SERVER');
  assert.deepEqual(JSON.parse(String(mappedServer?.[8])).overlayTags, ['do-not-bill']);
  assert.equal(JSON.parse(String(mappedServer?.[8])).lastApplianceCheckinTime, '2026-06-16T12:00:00Z');

  const ruleSet = await loadNcentralRuleSet(database);
  const serverRule = ruleSet.rules.find((rule) => rule.vendorProductKey === 'ncentral-physical-server');
  assert.equal(serverRule?.productCode, 'CW-MANAGED-SERVER');

  assert.equal(completedRuns.length, 1);
  console.log('ncentral operations tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
