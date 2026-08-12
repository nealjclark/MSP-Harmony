import { createHash } from 'node:crypto';
import {
  createIntegrationSettingsProvider,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import { loadConnectWiseCustomers, updateAccountMapping } from '../../mapping/mappingService';
import {
  AzureApiError,
  AzureCostManagementClient,
  azureCredentialsFromSettings,
  azureIntegrationId,
  type AzureSubscription,
  type AzureTenant,
} from './client';
import { assertAzureReady, type AzureUsageClient, type Queryable } from './operations';

export type AzureOnboardingInput = {
  customerId: string;
  agreementId: string;
  agreementAdditionId: string;
  subscriptionId: string;
  subscriptionName?: string;
};

export type AzureLighthouseTemplateUploadInput = {
  fileName?: string;
  template: unknown;
};

type AzureLighthouseAuthorization = {
  principalId: string;
  principalDisplayName: string;
  roleDefinitionId: string;
  roleName: string;
};

type AzureLighthouseTemplateRow = {
  version: number;
  file_name: string;
  template_json: unknown;
  sha256: string;
  offer_name: string | null;
  offer_description: string | null;
  managed_by_tenant_id: string | null;
  authorizations: unknown;
  uploaded_by: string;
  uploaded_at: string | Date;
};

export const azureServiceProvidersPortalUrl =
  'https://portal.azure.com/#blade/Microsoft_Azure_CustomerHub/ServiceProvidersBladeV2/providers';

type AzureMappingRow = {
  external_account_id: string;
  external_account_name: string;
  mapping_status: string;
  active: boolean;
  customer_id: string;
  customer_name: string;
  agreement_id: string | null;
  agreement_name: string | null;
  agreement_addition_id: string | null;
  connectwise_addition_id: string | null;
  addition_code: string | null;
  addition_name: string | null;
  addition_status: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_default_domain: string | null;
  reviewed_at: string | null;
  last_sync_at: string | null;
};

export async function listAzureOnboardingState(input: {
  pool: Queryable;
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  discoverAzure?: boolean;
  includeCustomerOptions?: boolean;
}) {
  const discoverAzure = input.discoverAzure ?? true;
  const includeCustomerOptions = input.includeCustomerOptions ?? true;
  const [mappings, currentTemplate, customerOptions] = await Promise.all([
    loadAzureMappings(input.pool),
    getCurrentAzureLighthouseTemplate(input.pool),
    includeCustomerOptions ? loadConnectWiseCustomers(input.pool) : Promise.resolve([]),
  ]);
  let subscriptions: AzureSubscription[] = [];
  let connectionError: string | undefined;
  let tenantLookupWarning: string | undefined;
  let tenantsById = new Map<string, AzureTenant>();
  let credentialsConfigured: boolean | undefined;
  let managingTenantId: string | undefined;
  let managingTenantName: string | undefined;

  if (discoverAzure) {
    try {
      const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
      const settings = await provider.getIntegrationSettings(azureIntegrationId);
      credentialsConfigured =
        settings.validation.missingSecrets.length === 0 &&
        settings.validation.missingNonSecrets.length === 0;
      managingTenantId = settings.nonSecrets.tenantId;
      assertAzureReady(settings);
      const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
      const [discoveredSubscriptions, tenantDiscovery] = await Promise.all([
        client.listSubscriptions(100),
        discoverAzureTenants(client),
      ]);
      subscriptions = discoveredSubscriptions;
      tenantsById = tenantDiscovery.tenantsById;
      tenantLookupWarning = tenantDiscovery.warning;
      managingTenantName = managingTenantId
        ? tenantsById.get(managingTenantId.toLowerCase())?.displayName ?? managingTenantId
        : undefined;
    } catch (error) {
      connectionError = errorMessage(error);
    }
  }

  subscriptions = enrichSubscriptionsWithTenants(subscriptions, tenantsById);

  const discoveredById = new Map(
    subscriptions.map((subscription) => [subscription.subscriptionId.toLowerCase(), subscription]),
  );
  const mappingById = new Map(
    mappings.map((mapping) => [mapping.external_account_id.toLowerCase(), mapping]),
  );
  const ids = new Set([...discoveredById.keys(), ...mappingById.keys()]);

  return {
    integrationId: azureIntegrationId,
    readiness: {
      discoveryAttempted: discoverAzure,
      credentialsConfigured,
      managingTenantId,
      managingTenantName,
      tenantLookupWarning,
      connectionError,
    },
    currentTemplate,
    customerOptions,
    portalUrl: azureServiceProvidersPortalUrl,
    subscriptions: [...ids].map((id) => {
      const subscription = discoveredById.get(id);
      const mapping = mappingById.get(id);
      return {
        subscriptionId: subscription?.subscriptionId ?? mapping?.external_account_id ?? id,
        subscriptionName:
          subscription?.displayName ?? mapping?.external_account_name ?? mapping?.external_account_id ?? id,
        tenantId: subscription?.tenantId ?? mapping?.tenant_id ?? undefined,
        tenantName:
          subscription?.tenantName ??
          mapping?.tenant_name ??
          subscription?.tenantId ??
          mapping?.tenant_id ??
          undefined,
        tenantDefaultDomain: subscription?.tenantDefaultDomain ?? mapping?.tenant_default_domain ?? undefined,
        state: subscription?.state,
        delegated: Boolean(subscription),
        mappingStatus: mapping?.mapping_status,
        active: mapping?.active ?? false,
        customerId: mapping?.customer_id,
        customerName: mapping?.customer_name,
        agreementId: mapping?.agreement_id ?? undefined,
        agreementName: mapping?.agreement_name ?? undefined,
        agreementAdditionId: mapping?.agreement_addition_id ?? undefined,
        connectWiseAdditionId: mapping?.connectwise_addition_id ?? undefined,
        additionCode: mapping?.addition_code ?? undefined,
        additionName: mapping?.addition_name ?? undefined,
        additionStatus: mapping?.addition_status ?? undefined,
        mappingComplete: Boolean(
          mapping?.agreement_id &&
          mapping.agreement_addition_id &&
          mapping.addition_status &&
          isActiveAdditionStatus(mapping.addition_status)
        ),
        reviewedAt: mapping?.reviewed_at ?? undefined,
        lastSyncAt: mapping?.last_sync_at ?? undefined,
      };
    }).sort((left, right) => String(left.subscriptionName).localeCompare(String(right.subscriptionName))),
  };
}

export async function prepareAzureOnboardingPackage(input: {
  pool: Queryable;
  onboarding: AzureOnboardingInput;
  actor?: string;
}) {
  const onboarding = normalizeOnboardingInput(input.onboarding);
  const target = await validateAzureMappingTarget(input.pool, onboarding);
  const currentTemplate = await getCurrentAzureLighthouseTemplate(input.pool);
  if (!currentTemplate) {
    throw new Error('No approved Azure Lighthouse template is uploaded. Ask an Admin to upload one first.');
  }

  const existing = await getAzureMappingStatus(input.pool, onboarding.subscriptionId);
  await updateAccountMapping(input.pool, azureIntegrationId, onboarding.subscriptionId, {
    status: existing?.active && existing.mapping_status === 'approved' ? 'approved' : 'needs-review',
    customerId: onboarding.customerId,
    agreementId: onboarding.agreementId,
    agreementAdditionId: target.agreementAdditionId,
    externalAccountName: onboarding.subscriptionName ?? onboarding.subscriptionId,
    reviewedBy: input.actor ?? 'azure-onboarding',
  });

  return {
    integrationId: azureIntegrationId,
    subscriptionId: onboarding.subscriptionId,
    subscriptionName: onboarding.subscriptionName,
    agreementAdditionId: target.agreementAdditionId,
    connectWiseAdditionId: target.connectWiseAdditionId,
    additionCode: target.additionCode,
    additionName: target.additionName,
    templateFileName: currentTemplate.fileName,
    template: currentTemplate.template,
    templateVersion: currentTemplate.version,
    templateSha256: currentTemplate.sha256,
    portalUrl: azureServiceProvidersPortalUrl,
  };
}

export async function verifyAzureOnboarding(input: {
  pool: Queryable;
  onboarding: AzureOnboardingInput;
  actor?: string;
  provider?: IntegrationSettingsProvider;
  client?: AzureUsageClient;
  now?: Date;
}) {
  const onboarding = normalizeOnboardingInput(input.onboarding);
  const target = await validateAzureMappingTarget(input.pool, onboarding);
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(azureIntegrationId);
  assertAzureReady(settings);
  const client = input.client ?? new AzureCostManagementClient(azureCredentialsFromSettings(settings));
  const subscriptions = await client.listSubscriptions(100);
  const tenantDiscovery = await discoverAzureTenants(client);
  const tenantsById = tenantDiscovery.tenantsById;
  const subscription = subscriptions.find(
    (candidate) => candidate.subscriptionId.toLowerCase() === onboarding.subscriptionId.toLowerCase(),
  );

  if (!subscription) {
    return {
      integrationId: azureIntegrationId,
      subscriptionId: onboarding.subscriptionId,
      delegated: false,
      costManagementAccessible: false,
      resourceInventoryAccessible: false,
      monitoringMetricsTested: false,
      monitoringMetricsAccessible: false,
      activated: false,
      message:
        'The subscription is not visible yet. Confirm the customer deployment succeeded, then allow several minutes for Azure Lighthouse propagation.',
    };
  }

  const now = input.now ?? new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 7);
  let costManagementAccessible = false;
  let costManagementError: string | undefined;
  let sampleRowCount = 0;
  let resourceInventoryAccessible = false;
  let resourceInventoryError: string | undefined;
  let sampleResourceCount = 0;
  let monitoringMetricsTested = false;
  let monitoringMetricsAccessible = false;
  let monitoringMetricsError: string | undefined;

  try {
    const rows = await client.queryCostUsage({
      subscriptionId: subscription.subscriptionId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    costManagementAccessible = true;
    sampleRowCount = rows.length;
  } catch (error) {
    costManagementError = errorMessage(error);
  }

  if (!client.listResources) {
    resourceInventoryError = 'The configured Azure client does not support resource inventory queries.';
  } else {
    try {
      const resources = await client.listResources(subscription.subscriptionId, 1);
      resourceInventoryAccessible = true;
      sampleResourceCount = resources.length;
      const virtualMachine = resources.find(
        (resource) => resource.type?.toLowerCase() === 'microsoft.compute/virtualmachines',
      );
      if (virtualMachine && client.queryDailyMetrics) {
        monitoringMetricsTested = true;
        try {
          await client.queryDailyMetrics({
            resourceId: virtualMachine.id,
            metricNames: ['Percentage CPU'],
            from: from.toISOString(),
            to: to.toISOString(),
          });
          monitoringMetricsAccessible = true;
        } catch (error) {
          monitoringMetricsError = errorMessage(error);
        }
      }
    } catch (error) {
      resourceInventoryError = errorMessage(error);
    }
  }

  const activated =
    costManagementAccessible &&
    resourceInventoryAccessible &&
    (!monitoringMetricsTested || monitoringMetricsAccessible);

  if (activated) {
    await updateAccountMapping(input.pool, azureIntegrationId, subscription.subscriptionId, {
      status: 'approved',
      customerId: onboarding.customerId,
      agreementId: onboarding.agreementId,
      agreementAdditionId: target.agreementAdditionId,
      externalAccountName: subscription.displayName ?? onboarding.subscriptionName ?? subscription.subscriptionId,
      reviewedBy: input.actor ?? 'azure-onboarding',
    });
  }

  return {
    integrationId: azureIntegrationId,
    subscriptionId: subscription.subscriptionId,
    subscriptionName: subscription.displayName,
    tenantId: subscription.tenantId,
    tenantName: subscription.tenantId
      ? tenantsById.get(subscription.tenantId.toLowerCase())?.displayName ?? subscription.tenantId
      : undefined,
    tenantDefaultDomain: subscription.tenantId
      ? tenantsById.get(subscription.tenantId.toLowerCase())?.defaultDomain
      : undefined,
    tenantLookupWarning: tenantDiscovery.warning,
    agreementAdditionId: target.agreementAdditionId,
    connectWiseAdditionId: target.connectWiseAdditionId,
    additionCode: target.additionCode,
    additionName: target.additionName,
    delegated: true,
    costManagementAccessible,
    costManagementError,
    sampleRowCount,
    resourceInventoryAccessible,
    resourceInventoryError,
    sampleResourceCount,
    monitoringMetricsTested,
    monitoringMetricsAccessible,
    monitoringMetricsError,
    activated,
    message: activated
      ? 'Azure Lighthouse, Cost Management, and resource reporting access are verified. The subscription mapping is active.'
      : 'Azure Lighthouse can see the subscription, but one or more reporting permissions are not ready.',
  };
}

export async function saveAzureSubscriptionMapping(input: {
  pool: Queryable;
  subscriptionId: string;
  mapping: AzureOnboardingInput;
  actor?: string;
}) {
  const mapping = normalizeOnboardingInput({ ...input.mapping, subscriptionId: input.subscriptionId });
  const target = await validateAzureMappingTarget(input.pool, mapping);
  const existing = await getAzureMappingStatus(input.pool, mapping.subscriptionId);
  if (!existing) throw new Error('The Azure subscription must be onboarded before its mapping can be edited.');
  const status = existing.active && existing.mapping_status === 'approved' ? 'approved' : 'needs-review';
  await updateAccountMapping(input.pool, azureIntegrationId, mapping.subscriptionId, {
    status,
    customerId: mapping.customerId,
    agreementId: mapping.agreementId,
    agreementAdditionId: target.agreementAdditionId,
    externalAccountName: mapping.subscriptionName ?? mapping.subscriptionId,
    reviewedBy: input.actor ?? 'azure-onboarding',
  });
  return {
    integrationId: azureIntegrationId,
    subscriptionId: mapping.subscriptionId,
    subscriptionName: mapping.subscriptionName,
    mappingStatus: status,
    active: status === 'approved',
    customerId: mapping.customerId,
    agreementId: mapping.agreementId,
    agreementAdditionId: target.agreementAdditionId,
    connectWiseAdditionId: target.connectWiseAdditionId,
    additionCode: target.additionCode,
    additionName: target.additionName,
  };
}

export async function getCurrentAzureLighthouseTemplate(database: Queryable) {
  const result = await database.query<AzureLighthouseTemplateRow>(
    `select
       version,
       file_name,
       template_json,
       sha256,
       offer_name,
       offer_description,
       managed_by_tenant_id,
       authorizations,
       uploaded_by,
       uploaded_at
     from azure_lighthouse_templates
     where template_key = 'current'
     limit 1`,
  );
  const row = result.rows[0];
  return row ? mapAzureLighthouseTemplateRow(row) : undefined;
}

export async function uploadAzureLighthouseTemplate(input: {
  pool: Queryable;
  upload: AzureLighthouseTemplateUploadInput;
  actor: string;
}) {
  const fileName = normalizeTemplateFileName(input.upload.fileName);
  const template = validateAzureLighthouseTemplate(input.upload.template);
  const metadata = extractAzureLighthouseTemplateMetadata(template);
  const normalizedJson = `${JSON.stringify(template, null, 2)}\n`;
  if (Buffer.byteLength(normalizedJson, 'utf8') > 1024 * 1024) {
    throw new Error('The ARM template must be 1 MB or smaller.');
  }
  const sha256 = createHash('sha256').update(normalizedJson).digest('hex');
  const result = await input.pool.query<AzureLighthouseTemplateRow>(
    `insert into azure_lighthouse_templates (
       template_key,
       version,
       file_name,
       template_json,
       sha256,
       offer_name,
       offer_description,
       managed_by_tenant_id,
       authorizations,
       uploaded_by,
       uploaded_at,
       updated_at
     ) values (
       'current', 1, $1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, $8, now(), now()
     )
     on conflict (template_key) do update set
       version = azure_lighthouse_templates.version + 1,
       file_name = excluded.file_name,
       template_json = excluded.template_json,
       sha256 = excluded.sha256,
       offer_name = excluded.offer_name,
       offer_description = excluded.offer_description,
       managed_by_tenant_id = excluded.managed_by_tenant_id,
       authorizations = excluded.authorizations,
       uploaded_by = excluded.uploaded_by,
       uploaded_at = now(),
       updated_at = now()
     returning
       version,
       file_name,
       template_json,
       sha256,
       offer_name,
       offer_description,
       managed_by_tenant_id,
       authorizations,
       uploaded_by,
       uploaded_at`,
    [
      fileName,
      normalizedJson,
      sha256,
      metadata.offerName ?? null,
      metadata.offerDescription ?? null,
      metadata.managedByTenantId ?? null,
      JSON.stringify(metadata.authorizations),
      input.actor,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The Azure Lighthouse template could not be saved.');
  return mapAzureLighthouseTemplateRow(row);
}

function validateAzureLighthouseTemplate(value: unknown) {
  const template = objectValue(value);
  const schema = stringValue(template.$schema);
  if (!schema?.toLowerCase().includes('subscriptiondeploymenttemplate.json')) {
    throw new Error('Upload a subscription-scope Azure Resource Manager template.');
  }
  if (
    Object.keys(objectValue(template.parameters)).length === 0 ||
    Object.keys(objectValue(template.variables)).length === 0
  ) {
    throw new Error('The ARM template must contain parameters and variables objects.');
  }
  const resources = arrayValue(template.resources).map(objectValue);
  const types = new Set(resources.map((resource) => stringValue(resource.type)?.toLowerCase()));
  if (!types.has('microsoft.managedservices/registrationdefinitions')) {
    throw new Error('The template is missing Microsoft.ManagedServices/registrationDefinitions.');
  }
  if (!types.has('microsoft.managedservices/registrationassignments')) {
    throw new Error('The template is missing Microsoft.ManagedServices/registrationAssignments.');
  }
  const metadata = extractAzureLighthouseTemplateMetadata(template);
  if (!metadata.managedByTenantId || !isGuid(metadata.managedByTenantId)) {
    throw new Error('The template must resolve to a valid managing tenant ID.');
  }
  if (metadata.authorizations.length === 0) {
    throw new Error('The template must contain at least one Azure Lighthouse authorization.');
  }
  for (const authorization of metadata.authorizations) {
    if (!isGuid(authorization.principalId) || !isGuid(authorization.roleDefinitionId)) {
      throw new Error('Every Lighthouse authorization must contain valid principal and role definition GUIDs.');
    }
  }
  return template;
}

function extractAzureLighthouseTemplateMetadata(template: Record<string, unknown>) {
  const resources = arrayValue(template.resources).map(objectValue);
  const registration = resources.find(
    (resource) => stringValue(resource.type)?.toLowerCase() ===
      'microsoft.managedservices/registrationdefinitions',
  );
  const properties = objectValue(registration?.properties);
  const authorizationsValue = resolveTemplateValue(properties.authorizations, template);
  const authorizations = arrayValue(authorizationsValue).map((value) => {
    const authorization = objectValue(value);
    const roleDefinitionId = stringValue(authorization.roleDefinitionId) ?? '';
    return {
      principalId: stringValue(authorization.principalId) ?? '',
      principalDisplayName:
        stringValue(authorization.principalIdDisplayName) ?? 'Unnamed principal',
      roleDefinitionId,
      roleName: azureRoleName(roleDefinitionId),
    } satisfies AzureLighthouseAuthorization;
  });
  return {
    offerName: stringValue(resolveTemplateValue(properties.registrationDefinitionName, template)),
    offerDescription: stringValue(resolveTemplateValue(properties.description, template)),
    managedByTenantId: stringValue(resolveTemplateValue(properties.managedByTenantId, template)),
    authorizations,
  };
}

function resolveTemplateValue(value: unknown, template: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value;
  const variable = value.match(/^\[variables\('([^']+)'\)\]$/i)?.[1];
  if (variable) return objectValue(template.variables)[variable];
  const parameter = value.match(/^\[parameters\('([^']+)'\)\]$/i)?.[1];
  if (parameter) return objectValue(objectValue(template.parameters)[parameter]).defaultValue;
  return value;
}

function mapAzureLighthouseTemplateRow(row: AzureLighthouseTemplateRow) {
  const authorizations = arrayValue(row.authorizations).map((value) => {
    const authorization = objectValue(value);
    const roleDefinitionId = stringValue(authorization.roleDefinitionId) ?? '';
    return {
      principalId: stringValue(authorization.principalId) ?? '',
      principalDisplayName:
        stringValue(authorization.principalDisplayName) ??
        stringValue(authorization.principalIdDisplayName) ??
        'Unnamed principal',
      roleDefinitionId,
      roleName: stringValue(authorization.roleName) ?? azureRoleName(roleDefinitionId),
    } satisfies AzureLighthouseAuthorization;
  });
  return {
    version: Number(row.version),
    fileName: row.file_name,
    sha256: row.sha256,
    offerName: row.offer_name ?? undefined,
    offerDescription: row.offer_description ?? undefined,
    managedByTenantId: row.managed_by_tenant_id ?? undefined,
    authorizations,
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    template: objectValue(row.template_json),
  };
}

function normalizeTemplateFileName(value: string | undefined) {
  const fileName = (value ?? 'azure-lighthouse-template.json').trim().replace(/[\\/]/g, '-');
  if (!fileName.toLowerCase().endsWith('.json')) {
    throw new Error('The Azure Lighthouse template file must use the .json extension.');
  }
  return fileName.slice(0, 200);
}

function azureRoleName(roleDefinitionId: string) {
  const roleNames: Record<string, string> = {
    'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
    'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
    '72fafb9e-0641-4937-9268-a91bfd8191a3': 'Cost Management Reader',
    '43d0d8ad-25c7-4714-9337-8ba259a9fe05': 'Monitoring Reader',
    '91c1777a-f3dc-4fae-b103-61d183457e46': 'Managed Services Registration Assignment Delete Role',
  };
  return roleNames[roleDefinitionId.toLowerCase()] ?? 'Azure built-in role';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function isGuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeOnboardingInput(input: AzureOnboardingInput): AzureOnboardingInput {
  const customerId = requiredGuid(input.customerId, 'ConnectWise customer');
  const agreementId = requiredGuid(input.agreementId, 'ConnectWise agreement');
  const agreementAdditionId = requiredGuid(input.agreementAdditionId, 'ConnectWise agreement addition');
  return {
    ...input,
    customerId,
    agreementId,
    agreementAdditionId,
    subscriptionId: requiredGuid(input.subscriptionId, 'Azure subscription ID'),
    subscriptionName: input.subscriptionName?.trim() || undefined,
  };
}

async function loadAzureMappings(database: Queryable) {
  const result = await database.query<AzureMappingRow>(
    `select
       mappings.external_account_id,
       mappings.external_account_name,
       mappings.mapping_status,
       mappings.active,
       mappings.customer_id,
       customers.name as customer_name,
       mappings.agreement_id,
       agreements.name as agreement_name,
       mappings.agreement_addition_id,
       additions.connectwise_addition_id,
       additions.product_code as addition_code,
       additions.product_name as addition_name,
       additions.addition_status,
       latest_sync.tenant_id,
       latest_sync.tenant_name,
       latest_sync.tenant_default_domain,
       mappings.reviewed_at,
       latest_sync.last_sync_at
     from vendor_account_mappings mappings
     join customers on customers.id = mappings.customer_id
     left join agreements on agreements.id = mappings.agreement_id
     left join agreement_additions additions on additions.id = mappings.agreement_addition_id
     left join lateral (
       select
         snapshots.observed_at::text as last_sync_at,
         snapshots.dimensions->>'tenantId' as tenant_id,
         snapshots.dimensions->>'tenantName' as tenant_name,
         snapshots.dimensions->>'tenantDefaultDomain' as tenant_default_domain
       from vendor_usage_snapshots snapshots
       where snapshots.vendor_id = $1
         and snapshots.external_account_id = mappings.external_account_id
       order by snapshots.observed_at desc
       limit 1
     ) latest_sync on true
     where mappings.vendor_id = $1`,
    [azureIntegrationId],
  );
  return result.rows;
}

async function getAzureMappingStatus(database: Queryable, subscriptionId: string) {
  const result = await database.query<{ active: boolean; mapping_status: string }>(
    `select active, mapping_status
     from vendor_account_mappings
     where vendor_id = $1
       and lower(external_account_id) = lower($2)
     limit 1`,
    [azureIntegrationId, subscriptionId],
  );
  return result.rows[0];
}

type AzureMappingTarget = {
  agreementAdditionId: string;
  connectWiseAdditionId: string;
  additionCode: string;
  additionName: string;
};

async function validateAzureMappingTarget(
  database: Queryable,
  input: Pick<AzureOnboardingInput, 'customerId' | 'agreementId' | 'agreementAdditionId'>,
): Promise<AzureMappingTarget> {
  const result = await database.query<{
    agreement_addition_id: string;
    connectwise_addition_id: string;
    product_code: string;
    product_name: string;
  }>(
    `select
       additions.id as agreement_addition_id,
       additions.connectwise_addition_id,
       additions.product_code,
       additions.product_name
     from agreement_additions additions
     join agreements on agreements.id = additions.agreement_id
     where agreements.customer_id = $1
       and agreements.id = $2
       and additions.id = $3
       and coalesce(additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
     limit 1`,
    [input.customerId, input.agreementId, input.agreementAdditionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Select an active ConnectWise addition that belongs to the selected customer and agreement.');
  }
  return {
    agreementAdditionId: row.agreement_addition_id,
    connectWiseAdditionId: row.connectwise_addition_id,
    additionCode: row.product_code,
    additionName: row.product_name,
  };
}

async function discoverAzureTenants(client: AzureUsageClient) {
  const tenantsById = new Map<string, AzureTenant>();
  if (!client.listTenants) return { tenantsById, warning: undefined as string | undefined };
  try {
    const tenants = await client.listTenants(100);
    for (const tenant of tenants) tenantsById.set(tenant.tenantId.toLowerCase(), tenant);
    return { tenantsById, warning: undefined as string | undefined };
  } catch (error) {
    return {
      tenantsById,
      warning: `Tenant names could not be loaded: ${errorMessage(error)}`,
    };
  }
}

function enrichSubscriptionsWithTenants(
  subscriptions: AzureSubscription[],
  tenantsById: Map<string, AzureTenant>,
) {
  return subscriptions.map((subscription) => {
    const tenant = subscription.tenantId ? tenantsById.get(subscription.tenantId.toLowerCase()) : undefined;
    return {
      ...subscription,
      tenantName: tenant?.displayName ?? subscription.tenantId,
      tenantDefaultDomain: tenant?.defaultDomain,
    };
  });
}

function isActiveAdditionStatus(status: string) {
  return !/expired|cancelled|canceled|inactive/i.test(status);
}

function requiredGuid(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} must be a valid GUID.`);
  }
  return normalized;
}

function errorMessage(error: unknown) {
  if (error instanceof AzureApiError) {
    return error.status ? `${error.message} (HTTP ${error.status})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
