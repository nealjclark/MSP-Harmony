import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getIntegrationSettingsDefinition, type IntegrationSettingsValidation } from '../../../shared/integrationSettings';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import type { AzureUsageClient, Queryable } from './operations';
import {
  azureServiceProvidersPortalUrl,
  listAzureOnboardingState,
  prepareAzureOnboardingPackage,
  refreshAzureLighthouseTenants,
  uploadAzureLighthouseTemplate,
  verifyAzureOnboarding,
} from './onboarding';

const definition = getIntegrationSettingsDefinition('microsoft-azure');
assert.ok(definition);

const ids = {
  customer: '11111111-1111-4111-8111-111111111111',
  agreement: '22222222-2222-4222-8222-222222222222',
  agreementAddition: '99999999-9999-4999-8999-999999999999',
  managingTenant: '33333333-3333-4333-8333-333333333333',
  customerTenant: '55555555-5555-4555-8555-555555555555',
  subscription: '66666666-6666-4666-8666-666666666666',
};

const approvedTemplate = JSON.parse(
  readFileSync(new URL('../../../../infra/azure/lighthouse-cost-management.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const storedTemplateRow = {
  version: 1,
  file_name: 'template (1).json',
  template_json: approvedTemplate,
  sha256: '0d47be82d5b356c6f079565f9c198e7328ac93352f57f1a3aa2a1034a2ea3f4b',
  offer_name: 'BMB Azure Management',
  offer_description: '',
  managed_by_tenant_id: '30a502d2-8570-4207-9b98-ec48dd176588',
  authorizations: [
    {
      principalId: 'a02badf9-02c7-4254-93cb-42ae82215300',
      principalDisplayName: 'BMB Lighthosue',
      roleDefinitionId: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
      roleName: 'Contributor',
    },
    {
      principalId: '0800ddab-4459-495a-81e6-aa6b2ac930a3',
      principalDisplayName: 'BMB Azure Reporting',
      roleDefinitionId: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
      roleName: 'Reader',
    },
  ],
  uploaded_by: 'Initial approved template',
  uploaded_at: '2026-08-12T12:00:00.000Z',
};

const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings() {
    return {
      definition,
      nonSecrets: {
        endpoint: 'https://management.azure.com',
        tenantId: ids.managingTenant,
        clientId: '77777777-7777-4777-8777-777777777777',
      },
      secrets: { clientSecret: 'secret' },
      secretSource: 'environment',
      validation: {
        integrationId: 'microsoft-azure',
        displayName: 'Azure - Lighthouse',
        configuredStatus: 'connected',
        missingSecrets: [],
        missingNonSecrets: [],
        lastTestResult: 'success',
      } as IntegrationSettingsValidation,
    } satisfies IntegrationRuntimeSettings;
  },
  async listIntegrationSettings() {
    return [await this.getIntegrationSettings('microsoft-azure')];
  },
};

function database(options: {
  mappingRows?: unknown[];
  activeMapping?: boolean;
  templateRow?: typeof storedTemplateRow;
} = {}) {
  const mappingStatuses: string[] = [];
  const tenantInserts: Array<{ tenantId: string; tenantName: string | null }> = [];
  const templateRow = options.templateRow ?? storedTemplateRow;
  const pool: Queryable = {
    async query<T = unknown>(sql: string, values?: unknown[]) {
      if (sql.includes('from azure_lighthouse_templates')) {
        return { rows: [templateRow as T] };
      }
      if (sql.includes('insert into azure_lighthouse_templates')) {
        return {
          rows: [{
            version: templateRow.version + 1,
            file_name: String(values?.[0]),
            template_json: JSON.parse(String(values?.[1])),
            sha256: String(values?.[2]),
            offer_name: values?.[3] as string | null,
            offer_description: values?.[4] as string | null,
            managed_by_tenant_id: values?.[5] as string | null,
            authorizations: JSON.parse(String(values?.[6])),
            uploaded_by: String(values?.[7]),
            uploaded_at: '2026-08-12T14:30:00.000Z',
          } as T],
        };
      }
      if (sql.includes('insert into azure_lighthouse_tenants')) {
        tenantInserts.push({
          tenantId: String(values?.[0]),
          tenantName: (values?.[1] as string | null) ?? null,
        });
        return { rows: [] as T[] };
      }
      if (sql.includes('from vendor_account_mappings mappings')) {
        return { rows: (options.mappingRows ?? []) as T[] };
      }
      if (sql.includes('select vendor_id, external_account_id, customer_id, agreement_id')) {
        return { rows: (options.mappingRows ?? []) as T[] };
      }
      if (sql.includes('select active, mapping_status') && sql.includes('from vendor_account_mappings')) {
        return { rows: options.activeMapping ? [{ active: true, mapping_status: 'approved' } as T] : [] };
      }
      if (sql.includes('from agreement_additions additions') && sql.includes('agreements.customer_id')) {
        return { rows: [{
          agreement_addition_id: ids.agreementAddition,
          connectwise_addition_id: '4201',
          product_code: 'AZURE',
          product_name: 'Azure Consumption',
        } as T] };
      }
      if (sql.includes('from customers') && sql.includes('agreement_additions')) {
        return { rows: [] as T[] };
      }
      if (sql.includes('insert into vendor_account_mappings')) {
        mappingStatuses.push(String(values?.[6]));
      }
      return { rows: [] as T[] };
    },
  };
  return { pool, mappingStatuses, tenantInserts };
}

const onboarding = {
  customerId: ids.customer,
  agreementId: ids.agreement,
  agreementAdditionId: ids.agreementAddition,
  subscriptionId: ids.subscription,
  subscriptionName: 'Northstar Azure',
};

async function run() {
  const uploaded = await uploadAzureLighthouseTemplate({
    pool: database().pool,
    upload: { fileName: 'template (1).json', template: approvedTemplate },
    actor: 'admin@example.com',
  });
  assert.equal(uploaded.version, 2);
  assert.equal(uploaded.fileName, 'template (1).json');
  assert.equal(uploaded.offerName, 'BMB Azure Management');
  assert.equal(uploaded.managedByTenantId, '30a502d2-8570-4207-9b98-ec48dd176588');
  assert.deepEqual(uploaded.authorizations.map((authorization) => authorization.roleName), ['Contributor', 'Reader']);
  assert.equal(uploaded.uploadedBy, 'admin@example.com');
  assert.equal(uploaded.sha256.length, 64);

  await assert.rejects(
    uploadAzureLighthouseTemplate({
      pool: database().pool,
      upload: { fileName: 'bad.json', template: { $schema: 'not-a-subscription-template' } },
      actor: 'admin@example.com',
    }),
    /subscription-scope Azure Resource Manager template/,
  );

  const preparedDatabase = database();
  const onboardingPackage = await prepareAzureOnboardingPackage({
    pool: preparedDatabase.pool,
    onboarding,
    actor: 'tech@example.com',
  });
  assert.equal(onboardingPackage.templateVersion, 1);
  assert.equal(onboardingPackage.templateFileName, 'template (1).json');
  assert.deepEqual(onboardingPackage.template, approvedTemplate);
  assert.equal(onboardingPackage.portalUrl, azureServiceProvidersPortalUrl);
  assert.equal(preparedDatabase.mappingStatuses[0], 'needs-review');

  const existingDatabase = database({ activeMapping: true });
  await prepareAzureOnboardingPackage({ pool: existingDatabase.pool, onboarding });
  assert.deepEqual(existingDatabase.mappingStatuses, ['approved']);

  const unavailable = await verifyAzureOnboarding({
    pool: database().pool,
    onboarding,
    provider,
    client: {
      async listSubscriptions() { return []; },
      async queryCostUsage() { return []; },
    },
  });
  assert.equal(unavailable.delegated, false);
  assert.equal(unavailable.activated, false);

  const verifiedDatabase = database();
  const client: AzureUsageClient = {
    async listSubscriptions() {
      return [{
        subscriptionId: ids.subscription,
        displayName: 'Northstar Azure',
        tenantId: ids.customerTenant,
        state: 'Enabled',
        raw: {},
      }];
    },
    async listTenants() {
      return [{
        tenantId: ids.customerTenant,
        displayName: 'Northstar Legal',
        defaultDomain: 'northstar.example',
        domains: ['northstar.example'],
        tenantCategory: 'ProjectedBy',
        raw: {},
      }];
    },
    async queryCostUsage() { return []; },
    async listResources() { return []; },
  };
  const verified = await verifyAzureOnboarding({
    pool: verifiedDatabase.pool,
    onboarding,
    provider,
    client,
    now: new Date('2026-08-04T12:00:00.000Z'),
  });
  assert.equal(verified.delegated, true);
  assert.equal(verified.costManagementAccessible, true);
  assert.equal(verified.resourceInventoryAccessible, true);
  assert.equal(verified.activated, true);
  assert.equal(verified.tenantName, 'Northstar Legal');
  assert.equal(verifiedDatabase.mappingStatuses[0], 'approved');

  const resourceDeniedDatabase = database();
  const resourceDenied = await verifyAzureOnboarding({
    pool: resourceDeniedDatabase.pool,
    onboarding,
    provider,
    client: {
      ...client,
      async listResources() { throw new Error('Resource inventory forbidden'); },
    },
  });
  assert.equal(resourceDenied.costManagementAccessible, true);
  assert.equal(resourceDenied.resourceInventoryAccessible, false);
  assert.equal(resourceDenied.activated, false);

  const state = await listAzureOnboardingState({
    pool: database({
      mappingRows: [{
        external_account_id: ids.subscription,
        external_account_name: 'Northstar Azure',
        mapping_status: 'approved',
        active: true,
        customer_id: ids.customer,
        customer_name: 'Northstar',
        agreement_id: ids.agreement,
        agreement_name: 'Managed Services',
        agreement_addition_id: ids.agreementAddition,
        connectwise_addition_id: '4201',
        addition_code: 'AZURE',
        addition_name: 'Azure Consumption',
        addition_status: 'Active',
        reviewed_at: null,
        last_sync_at: null,
      }],
    }).pool,
    provider,
    client,
  });
  assert.equal(state.readiness.credentialsConfigured, true);
  assert.equal(state.currentTemplate?.fileName, 'template (1).json');
  assert.equal(state.portalUrl, azureServiceProvidersPortalUrl);
  assert.equal(state.subscriptions.length, 1);
  assert.equal(state.subscriptions[0]?.active, true);
  assert.equal(state.subscriptions[0]?.customerName, 'Northstar');
  assert.equal(state.subscriptions[0]?.tenantName, 'Northstar Legal');
  assert.equal(state.subscriptions[0]?.additionName, 'Azure Consumption');

  const lighthouseNamed = await listAzureOnboardingState({
    pool: database().pool,
    provider,
    client: {
      async listSubscriptions() {
        return [{
          subscriptionId: ids.subscription,
          displayName: 'Azure subscription 1',
          tenantId: ids.customerTenant,
          state: 'Enabled',
          raw: {},
        }];
      },
      async listTenants() {
        return [{
          tenantId: ids.managingTenant,
          displayName: 'BMB Solutions',
          defaultDomain: 'bmb.example',
          domains: ['bmb.example'],
          raw: {},
        }];
      },
      async listLighthouseDelegations() {
        return [{
          subscriptionId: ids.subscription,
          manageeTenantId: ids.customerTenant,
          manageeTenantName: 'Callaghan CPA LLP',
          managedByTenantId: ids.managingTenant,
          managedByTenantName: 'BMB Solutions',
        }];
      },
      async queryCostUsage() { return []; },
    },
  });
  assert.equal(lighthouseNamed.subscriptions[0]?.tenantName, 'Callaghan CPA LLP');
  assert.equal(lighthouseNamed.subscriptions[0]?.tenantId, ids.customerTenant);

  let discoveryCalls = 0;
  const fastState = await listAzureOnboardingState({
    pool: database({
      mappingRows: [{
        external_account_id: ids.subscription,
        external_account_name: 'Northstar Azure',
        mapping_status: 'approved',
        active: true,
        customer_id: ids.customer,
        customer_name: 'Northstar',
        agreement_id: ids.agreement,
        agreement_name: 'Managed Services',
        agreement_addition_id: ids.agreementAddition,
        connectwise_addition_id: '4201',
        addition_code: 'AZURE',
        addition_name: 'Azure Consumption',
        addition_status: 'Active',
        tenant_id: ids.customerTenant,
        tenant_name: 'Northstar Legal',
        tenant_default_domain: 'northstar.example',
        reviewed_at: null,
        last_sync_at: null,
      }],
    }).pool,
    discoverAzure: false,
    includeCustomerOptions: false,
    client: {
      async listSubscriptions() { discoveryCalls += 1; return []; },
      async listTenants() { discoveryCalls += 1; return []; },
      async queryCostUsage() { return []; },
    },
  });
  assert.equal(discoveryCalls, 0);
  assert.equal(fastState.customerOptions.length, 0);
  assert.equal(fastState.readiness.discoveryAttempted, false);
  assert.equal(fastState.subscriptions[0]?.tenantName, 'Northstar Legal');

  const refreshDatabase = database({
    mappingRows: [{
      vendor_id: 'microsoft-365',
      external_account_id: ids.customerTenant,
      customer_id: ids.customer,
      agreement_id: ids.agreement,
    }],
  });
  const refreshed = await refreshAzureLighthouseTenants({
    pool: refreshDatabase.pool,
    provider,
    actor: 'tech@example.com',
    client: {
      async listSubscriptions() {
        return [{
          subscriptionId: ids.subscription,
          displayName: 'Northstar Azure',
          tenantId: ids.customerTenant,
          state: 'Enabled',
          raw: {},
        }];
      },
      async listTenants() {
        return [{
          tenantId: ids.customerTenant,
          displayName: 'Northstar Legal',
          defaultDomain: 'northstar.example',
          domains: ['northstar.example'],
          tenantCategory: 'ProjectedBy',
          raw: {},
        }];
      },
      async queryCostUsage() { return []; },
      async listResources() { return []; },
    },
  });
  assert.equal(refreshed.tenantCount, 1);
  assert.equal(refreshed.mappedCount, 1);
  assert.equal(refreshed.unmappedCount, 0);
  assert.equal(refreshDatabase.tenantInserts[0]?.tenantId, ids.customerTenant);
  assert.equal(refreshDatabase.tenantInserts[0]?.tenantName, 'Northstar Legal');
  assert.equal(refreshDatabase.mappingStatuses[0], 'approved');

  console.log('azure onboarding tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
