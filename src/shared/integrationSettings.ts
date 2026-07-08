export type IntegrationId =
  | 'connectwise'
  | 'wisepay'
  | 'cove'
  | 'ncentral'
  | 'sentinelone'
  | 'proofpoint'
  | 'datto'
  | 'microsoft-365'
  | 'opentext-appriver'
  | 'huntress'
  | 'microsoft-azure'
  | 'pax8'
  | 'custom-table';

export type IntegrationAuthMode = 'api-key' | 'oauth2' | 'token' | 'basic' | 'none';
export type IntegrationCapability = 'live-api' | 'mapping' | 'invoice-import' | 'payment-link';
export type IntegrationConfiguredStatus = 'connected' | 'degraded' | 'not-configured';
export type IntegrationDataIngestionMethod = 'live-api' | 'csv' | 'excel' | 'json';
export type IntegrationDataSourceType =
  | 'user-license-detail'
  | 'customer-product-breakdown'
  | 'reseller-product-total'
  | 'device-count'
  | 'invoice'
  | 'license-count';
export type IntegrationNonSecretInputType = 'text' | 'checkbox';
export type IntegrationSyncFrequency = 'hourly' | 'daily' | 'weekly' | 'manual';
export type IntegrationTestResult = 'success' | 'failure' | 'untested';

export const detailOnlySyncSettingKey = 'detailOnlySync';

export type IntegrationSecretDefinition = {
  key: string;
  label: string;
  keyVaultSecretName: string;
  envVar: string;
  required: boolean;
};

export type IntegrationNonSecretDefinition = {
  key: string;
  label: string;
  envVar: string;
  required: boolean;
  defaultValue?: string;
  inputType?: IntegrationNonSecretInputType;
  description?: string;
};

export type IntegrationDataSourceDefinition = {
  key: string;
  label: string;
  sourceType: IntegrationDataSourceType;
  ingestionMethods: IntegrationDataIngestionMethod[];
  requiresCustomerMapping: boolean;
  providesCosts: boolean;
  description: string;
};

export type IntegrationSettingsDefinition = {
  integrationId: IntegrationId;
  displayName: string;
  category: string;
  authMode: IntegrationAuthMode;
  capabilities: IntegrationCapability[];
  dataSources: IntegrationDataSourceDefinition[];
  description: string;
  endpoint: string;
  requiredSecrets: IntegrationSecretDefinition[];
  requiredNonSecrets: IntegrationNonSecretDefinition[];
  optionalNonSecrets?: IntegrationNonSecretDefinition[];
  scopes: string[];
  syncFrequency: IntegrationSyncFrequency;
  webhookSupported: boolean;
};

export type IntegrationSettingsState = {
  integrationId: IntegrationId;
  nonSecrets: Record<string, string | undefined>;
  availableKeyVaultSecrets: string[];
  lastTestedAt?: string;
  lastTestResult?: IntegrationTestResult;
};

export type IntegrationSettingsValidation = {
  integrationId: IntegrationId;
  displayName: string;
  configuredStatus: IntegrationConfiguredStatus;
  missingSecrets: IntegrationSecretDefinition[];
  missingNonSecrets: IntegrationNonSecretDefinition[];
  lastTestedAt?: string;
  lastTestResult: IntegrationTestResult;
};

export const integrationSettingsRegistry: IntegrationSettingsDefinition[] = [
  {
    integrationId: 'connectwise',
    displayName: 'ConnectWise Manage',
    category: 'PSA',
    authMode: 'api-key',
    capabilities: ['live-api'],
    dataSources: [],
    description: 'PSA companies, agreements, products, additions, tickets, and approved write-back.',
    endpoint: 'https://api-na.myconnectwise.net',
    requiredSecrets: [
      secret('publicKey', 'Public Key', 'mspharmony-connectwise-public-key', 'CONNECTWISE_PUBLIC_KEY'),
      secret('privateKey', 'Private Key', 'mspharmony-connectwise-private-key', 'CONNECTWISE_PRIVATE_KEY'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'CONNECTWISE_ENDPOINT', 'https://api-na.myconnectwise.net'),
      nonSecret('companyId', 'Company ID', 'CONNECTWISE_COMPANY_ID'),
      nonSecret('clientId', 'Client ID', 'CONNECTWISE_CLIENT_ID'),
    ],
    scopes: ['companies.read', 'agreements.read', 'agreements.write', 'products.read', 'tickets.write'],
    syncFrequency: 'hourly',
    webhookSupported: false,
  },
  {
    integrationId: 'wisepay',
    displayName: 'WisePay',
    category: 'Payments',
    authMode: 'api-key',
    capabilities: ['payment-link'],
    dataSources: [],
    description: 'API key used to generate WisePay payment links for ConnectWise invoice notifications.',
    endpoint: 'https://secure2.wise-sync.com',
    requiredSecrets: [secret('apiKey', 'API Key', 'mspharmony-wisepay-api-key', 'WISEPAY_API_KEY')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Payment Link Endpoint', 'WISEPAY_ENDPOINT', 'https://secure2.wise-sync.com'),
    ],
    scopes: ['payment-link.generate'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'cove',
    displayName: 'Cove Data Protection',
    category: 'Backup',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'cove-protected-systems',
        'Protected systems',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer-level server, workstation, and selected-storage usage counts.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Protected-system counts and selected-storage usage for Cove backup billing.',
    endpoint: 'https://api.backup.management',
    requiredSecrets: [
      secret('username', 'API Username', 'mspharmony-cove-username', 'COVE_USERNAME'),
      secret('password', 'API Password', 'mspharmony-cove-password', 'COVE_PASSWORD'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'COVE_ENDPOINT', 'https://api.backup.management'),
      nonSecret('partnerName', 'Partner Name', 'COVE_PARTNER_NAME'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('COVE_DETAIL_ONLY_SYNC')],
    scopes: ['devices.read', 'usage.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'ncentral',
    displayName: 'N-able N-central',
    category: 'RMM',
    authMode: 'token',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'ncentral-device-filters',
        'Device filter counts',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer-level device and filter counts for server, workstation, and overlay billing.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Filter-driven managed server and workstation billing with custom overlay tags.',
    endpoint: 'https://ncentral.example.com',
    requiredSecrets: [secret('apiToken', 'API Token', 'mspharmony-ncentral-api-token', 'NCENTRAL_API_TOKEN')],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'NCENTRAL_ENDPOINT', 'https://ncentral.example.com')],
    optionalNonSecrets: [detailOnlySyncOption('NCENTRAL_DETAIL_ONLY_SYNC')],
    scopes: ['device-filters.read', 'devices.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'sentinelone',
    displayName: 'SentinelOne',
    category: 'Security',
    authMode: 'token',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'sentinelone-sites',
        'Site agent counts',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer or site-level endpoint agent counts from invoice tables or exports.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Endpoint, site, workstation, and server agent counts.',
    endpoint: 'https://usea1.sentinelone.net',
    requiredSecrets: [secret('apiToken', 'API Token', 'mspharmony-sentinelone-api-token', 'SENTINELONE_API_TOKEN')],
    requiredNonSecrets: [nonSecret('endpoint', 'Management Console URL', 'SENTINELONE_ENDPOINT', 'https://usea1.sentinelone.net')],
    optionalNonSecrets: [detailOnlySyncOption('SENTINELONE_DETAIL_ONLY_SYNC')],
    scopes: ['sites.read', 'agents.read'],
    syncFrequency: 'hourly',
    webhookSupported: true,
  },
  {
    integrationId: 'proofpoint',
    displayName: 'Proofpoint Essentials',
    category: 'Email Security',
    authMode: 'basic',
    capabilities: ['mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'proofpoint-domains',
        'Domain user counts',
        'customer-product-breakdown',
        ['csv', 'excel'],
        true,
        false,
        'Customer domain-level email security seat counts from invoice tables or exports.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Email security seat counts by customer domain.',
    endpoint: 'https://api.proofpointessentials.com',
    requiredSecrets: [
      secret('username', 'Username', 'mspharmony-proofpoint-username', 'PROOFPOINT_USERNAME'),
      secret('password', 'Password', 'mspharmony-proofpoint-password', 'PROOFPOINT_PASSWORD'),
    ],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'PROOFPOINT_ENDPOINT', 'https://api.proofpointessentials.com')],
    optionalNonSecrets: [detailOnlySyncOption('PROOFPOINT_DETAIL_ONLY_SYNC')],
    scopes: ['domains.read', 'users.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'datto',
    displayName: 'Datto Backup',
    category: 'Backup',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'datto-product-lines',
        'Product-line usage',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer-level BCDR protected agents and SaaS Protection product-line seat counts.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Kaseya Datto BCDR protected-agent counts and SaaS Protection seat counts.',
    endpoint: 'https://api.datto.com',
    requiredSecrets: [
      secret('apiKey', 'REST API Public Key', 'mspharmony-datto-api-key', 'DATTO_API_KEY'),
      secret('apiSecret', 'REST API Secret Key', 'mspharmony-datto-api-secret', 'DATTO_API_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Datto REST API Endpoint', 'DATTO_ENDPOINT', 'https://api.datto.com'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('DATTO_DETAIL_ONLY_SYNC')],
    scopes: ['bcdr.status.read', 'saas.domains.read', 'saas.seats.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-365',
    displayName: 'Microsoft 365',
    category: 'Productivity',
    authMode: 'oauth2',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'microsoft365-user-licenses',
        'User license detail',
        'user-license-detail',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Tenant user and assigned-license detail, including licensed user counts and email/account details.',
      ),
      dataSource(
        'microsoft365-product-totals',
        'Tenant product counts',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Tenant-level Microsoft 365 SKU totals and subscription counts.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Assigned user license counts through Microsoft Graph application permissions.',
    endpoint: 'https://graph.microsoft.com',
    requiredSecrets: [
      secret('clientSecret', 'Application Client Secret', 'mspharmony-microsoft365-client-secret', 'MICROSOFT365_CLIENT_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Microsoft Graph Endpoint', 'MICROSOFT365_ENDPOINT', 'https://graph.microsoft.com'),
      nonSecret('clientId', 'Application (Client) ID', 'MICROSOFT365_CLIENT_ID'),
      nonSecret('tenantId', 'Partner/Home Tenant ID', 'MICROSOFT365_TENANT_ID'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('MICROSOFT365_DETAIL_ONLY_SYNC', 'true')],
    scopes: [
      'Application: Directory.Read.All',
      'Application: User.Read.All',
      'Application: LicenseAssignment.Read.All',
    ],
    syncFrequency: 'daily',
    webhookSupported: true,
  },
  {
    integrationId: 'opentext-appriver',
    displayName: 'AppRiver - OpenText',
    category: 'Marketplace',
    authMode: 'oauth2',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'appriver-customer-products',
        'Customer products',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        true,
        'SecureCloud customer subscriptions and invoice line counts by customer and product.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'SecureCloud reseller subscriptions and Microsoft 365 license quantities from AppRiver.',
    endpoint: 'https://unityapi.webrootcloudav.com',
    requiredSecrets: [
      secret('clientSecret', 'API Client Secret', 'mspharmony-opentext-appriver-client-secret', 'OPENTEXT_APPRIVER_CLIENT_SECRET'),
      secret('refreshToken', 'Rotating Refresh Token', 'mspharmony-opentext-appriver-refresh-token', 'OPENTEXT_APPRIVER_REFRESH_TOKEN'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'SecureCloud API Endpoint', 'OPENTEXT_APPRIVER_ENDPOINT', 'https://unityapi.webrootcloudav.com'),
      nonSecret('clientId', 'API Client ID', 'OPENTEXT_APPRIVER_CLIENT_ID'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('OPENTEXT_APPRIVER_DETAIL_ONLY_SYNC')],
    scopes: ['SecureCloud.Customers', 'SecureCloud.Usage'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'huntress',
    displayName: 'Huntress',
    category: 'Security',
    authMode: 'none',
    capabilities: ['mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'huntress-customer-products',
        'Customer products',
        'customer-product-breakdown',
        ['csv', 'excel'],
        true,
        true,
        'Customer and product breakdown from Huntress invoices or exports.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Managed endpoint security counts by customer and product from invoice tables or exports.',
    endpoint: '',
    requiredSecrets: [],
    requiredNonSecrets: [],
    optionalNonSecrets: [detailOnlySyncOption('HUNTRESS_DETAIL_ONLY_SYNC')],
    scopes: ['invoice-table.import'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-azure',
    displayName: 'Microsoft Azure',
    category: 'Cloud',
    authMode: 'oauth2',
    capabilities: ['mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'azure-subscription-consumption',
        'Subscription consumption',
        'customer-product-breakdown',
        ['csv', 'excel'],
        true,
        true,
        'Azure subscription consumption and invoice charges by customer or subscription.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Azure subscription consumption and configurable markup inputs.',
    endpoint: 'https://management.azure.com',
    requiredSecrets: [secret('clientSecret', 'Client Secret', 'mspharmony-azure-client-secret', 'AZURE_CLIENT_SECRET')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Management Endpoint', 'AZURE_ENDPOINT', 'https://management.azure.com'),
      nonSecret('tenantId', 'Tenant ID', 'AZURE_TENANT_ID'),
      nonSecret('clientId', 'Client ID', 'AZURE_CLIENT_ID'),
      nonSecret('subscriptionId', 'Subscription ID', 'AZURE_SUBSCRIPTION_ID'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('AZURE_DETAIL_ONLY_SYNC')],
    scopes: ['Billing.Read', 'Consumption.Read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'pax8',
    displayName: 'Pax8',
    category: 'Marketplace',
    authMode: 'oauth2',
    capabilities: ['mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'pax8-customer-products',
        'Customer products',
        'customer-product-breakdown',
        ['csv', 'excel'],
        true,
        true,
        'Marketplace subscription counts by customer and product.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Marketplace subscriptions, SKU aliases, and customer product mapping.',
    endpoint: 'https://api.pax8.com',
    requiredSecrets: [secret('clientSecret', 'Client Secret', 'mspharmony-pax8-client-secret', 'PAX8_CLIENT_SECRET')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'PAX8_ENDPOINT', 'https://api.pax8.com'),
      nonSecret('clientId', 'Client ID', 'PAX8_CLIENT_ID'),
    ],
    optionalNonSecrets: [detailOnlySyncOption('PAX8_DETAIL_ONLY_SYNC')],
    scopes: ['companies.read', 'subscriptions.read', 'products.read'],
    syncFrequency: 'daily',
    webhookSupported: true,
  },
  {
    integrationId: 'custom-table',
    displayName: 'Custom Manual Import',
    category: 'Custom',
    authMode: 'none',
    capabilities: ['mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'custom-device-counts',
        'Device counts',
        'device-count',
        ['csv', 'excel', 'json'],
        true,
        false,
        'Manual device count rows with customer/account, quantity, and DeviceType or DeviceClass category fields.',
      ),
      dataSource(
        'custom-invoices',
        'Invoices',
        'invoice',
        ['csv', 'excel', 'json'],
        true,
        true,
        'Manual invoice rows with customer/account, product, quantity, and optional amount fields.',
      ),
      dataSource(
        'custom-license-counts',
        'License counts',
        'license-count',
        ['csv', 'excel', 'json'],
        true,
        false,
        'Manual license or seat count rows with customer/account, license product, and quantity fields.',
      ),
    ],
    description: 'User-defined manual imports for vendors that do not have a live API connection.',
    endpoint: '',
    requiredSecrets: [],
    requiredNonSecrets: [],
    optionalNonSecrets: [detailOnlySyncOption('CUSTOM_TABLE_DETAIL_ONLY_SYNC')],
    scopes: ['invoice-table.import'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
];

export function listIntegrationSettingsDefinitions() {
  return integrationSettingsRegistry;
}

export function getIntegrationSettingsDefinition(integrationId: IntegrationId) {
  return integrationSettingsRegistry.find((definition) => definition.integrationId === integrationId);
}

export function integrationHasCapability(integrationId: IntegrationId, capability: IntegrationCapability) {
  return Boolean(getIntegrationSettingsDefinition(integrationId)?.capabilities.includes(capability));
}

export function integrationHasAnyCapability(integrationId: IntegrationId) {
  return Boolean(getIntegrationSettingsDefinition(integrationId)?.capabilities.length);
}

export function integrationIdsWithCapability(capability: IntegrationCapability) {
  return integrationSettingsRegistry
    .filter((definition) => definition.capabilities.includes(capability))
    .map((definition) => definition.integrationId);
}

export function listIntegrationDataSources(integrationId: IntegrationId) {
  return getIntegrationSettingsDefinition(integrationId)?.dataSources ?? [];
}

export function getIntegrationDataSource(
  integrationId: IntegrationId,
  sourceType?: IntegrationDataSourceType,
) {
  const sources = listIntegrationDataSources(integrationId);
  return sourceType ? sources.find((source) => source.sourceType === sourceType) : sources[0];
}

export function integrationDataSourceRequiresCustomerMapping(sourceType: IntegrationDataSourceType) {
  return sourceType !== 'reseller-product-total';
}

export function listIntegrationNonSecretDefinitions(definition: IntegrationSettingsDefinition) {
  return [...definition.requiredNonSecrets, ...(definition.optionalNonSecrets ?? [])];
}

export function integrationDetailOnlySyncEnabled(
  nonSecrets: Record<string, string | undefined> = {},
  definition?: IntegrationSettingsDefinition,
) {
  const configuredValue =
    nonSecrets[detailOnlySyncSettingKey] ??
    definition?.optionalNonSecrets?.find((setting) => setting.key === detailOnlySyncSettingKey)?.defaultValue;

  return booleanSettingEnabled(configuredValue);
}

export function integrationSupportsDetailOnlySync(definition: IntegrationSettingsDefinition) {
  return Boolean(definition.optionalNonSecrets?.some((setting) => setting.key === detailOnlySyncSettingKey));
}

export function validateIntegrationSettings(
  definition: IntegrationSettingsDefinition,
  state?: IntegrationSettingsState,
): IntegrationSettingsValidation {
  const nonSecrets = state?.nonSecrets ?? {};
  const availableSecrets = new Set(state?.availableKeyVaultSecrets ?? []);
  const missingNonSecrets = definition.requiredNonSecrets.filter(
    (setting) => setting.required && !hasValue(nonSecrets[setting.key]) && !hasValue(setting.defaultValue),
  );
  const missingSecrets = definition.requiredSecrets.filter(
    (setting) => setting.required && !availableSecrets.has(setting.keyVaultSecretName),
  );
  const lastTestResult = state?.lastTestResult ?? 'untested';
  const configuredStatus = statusForValidation(missingSecrets.length, missingNonSecrets.length, lastTestResult);

  return {
    integrationId: definition.integrationId,
    displayName: definition.displayName,
    configuredStatus,
    missingSecrets,
    missingNonSecrets,
    lastTestedAt: state?.lastTestedAt,
    lastTestResult,
  };
}

export function validateIntegrationRegistry(states: IntegrationSettingsState[]) {
  const statesById = new Map(states.map((state) => [state.integrationId, state]));

  return integrationSettingsRegistry.map((definition) =>
    validateIntegrationSettings(definition, statesById.get(definition.integrationId)),
  );
}

function secret(
  key: string,
  label: string,
  keyVaultSecretName: string,
  envVar: string,
): IntegrationSecretDefinition {
  return {
    key,
    label,
    keyVaultSecretName,
    envVar,
    required: true,
  };
}

function nonSecret(
  key: string,
  label: string,
  envVar: string,
  defaultValue?: string,
): IntegrationNonSecretDefinition {
  return {
    key,
    label,
    envVar,
    required: true,
    defaultValue,
    inputType: 'text',
  };
}

function optionalNonSecret(
  key: string,
  label: string,
  envVar: string,
  defaultValue: string | undefined,
  inputType: IntegrationNonSecretInputType,
  description?: string,
): IntegrationNonSecretDefinition {
  return {
    key,
    label,
    envVar,
    required: false,
    defaultValue,
    inputType,
    description,
  };
}

function detailOnlySyncOption(envVar: string, defaultValue = 'false') {
  return optionalNonSecret(
    detailOnlySyncSettingKey,
    'Detail-only sync',
    envVar,
    defaultValue,
    'checkbox',
    'Customer-mapped detail is stored for reports and linked counts without product mapping.',
  );
}

function dataSource(
  key: string,
  label: string,
  sourceType: IntegrationDataSourceType,
  ingestionMethods: IntegrationDataIngestionMethod[],
  requiresCustomerMapping: boolean,
  providesCosts: boolean,
  description: string,
): IntegrationDataSourceDefinition {
  return {
    key,
    label,
    sourceType,
    ingestionMethods,
    requiresCustomerMapping,
    providesCosts,
    description,
  };
}

function resellerInvoiceTotals() {
  return dataSource(
    'reseller-product-totals',
    'Reseller product totals',
    'reseller-product-total',
    ['csv', 'excel'],
    false,
    true,
    'Invoice totals by product for the reseller account when customer-level detail comes from another API or export.',
  );
}

function statusForValidation(
  missingSecretCount: number,
  missingNonSecretCount: number,
  lastTestResult: IntegrationTestResult,
): IntegrationConfiguredStatus {
  const missingCount = missingSecretCount + missingNonSecretCount;

  if (missingCount > 0) {
    return missingCount >= 2 ? 'not-configured' : 'degraded';
  }

  return lastTestResult === 'failure' ? 'degraded' : 'connected';
}

function hasValue(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function booleanSettingEnabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}
