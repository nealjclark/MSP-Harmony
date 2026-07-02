export type IntegrationId =
  | 'connectwise'
  | 'cove'
  | 'ncentral'
  | 'sentinelone'
  | 'proofpoint'
  | 'datto'
  | 'microsoft-365'
  | 'opentext-appriver'
  | 'microsoft-azure'
  | 'pax8';

export type IntegrationAuthMode = 'api-key' | 'oauth2' | 'token' | 'basic';
export type IntegrationCapability = 'live-api' | 'mapping' | 'invoice-import';
export type IntegrationConfiguredStatus = 'connected' | 'degraded' | 'not-configured';
export type IntegrationSyncFrequency = 'hourly' | 'daily' | 'weekly' | 'manual';
export type IntegrationTestResult = 'success' | 'failure' | 'untested';

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
};

export type IntegrationSettingsDefinition = {
  integrationId: IntegrationId;
  displayName: string;
  category: string;
  authMode: IntegrationAuthMode;
  capabilities: IntegrationCapability[];
  description: string;
  endpoint: string;
  requiredSecrets: IntegrationSecretDefinition[];
  requiredNonSecrets: IntegrationNonSecretDefinition[];
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
    integrationId: 'cove',
    displayName: 'Cove Data Protection',
    category: 'Backup',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping'],
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
    scopes: ['devices.read', 'usage.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'ncentral',
    displayName: 'N-able N-central',
    category: 'RMM',
    authMode: 'token',
    capabilities: ['live-api', 'mapping'],
    description: 'Filter-driven managed server and workstation billing with custom overlay tags.',
    endpoint: 'https://ncentral.example.com',
    requiredSecrets: [secret('apiToken', 'API Token', 'mspharmony-ncentral-api-token', 'NCENTRAL_API_TOKEN')],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'NCENTRAL_ENDPOINT', 'https://ncentral.example.com')],
    scopes: ['device-filters.read', 'devices.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'sentinelone',
    displayName: 'SentinelOne',
    category: 'Security',
    authMode: 'token',
    capabilities: [],
    description: 'Endpoint, site, workstation, and server agent counts.',
    endpoint: 'https://usea1.sentinelone.net',
    requiredSecrets: [secret('apiToken', 'API Token', 'mspharmony-sentinelone-api-token', 'SENTINELONE_API_TOKEN')],
    requiredNonSecrets: [nonSecret('endpoint', 'Management Console URL', 'SENTINELONE_ENDPOINT', 'https://usea1.sentinelone.net')],
    scopes: ['sites.read', 'agents.read'],
    syncFrequency: 'hourly',
    webhookSupported: true,
  },
  {
    integrationId: 'proofpoint',
    displayName: 'Proofpoint Essentials',
    category: 'Email Security',
    authMode: 'basic',
    capabilities: [],
    description: 'Email security seat counts by customer domain.',
    endpoint: 'https://api.proofpointessentials.com',
    requiredSecrets: [
      secret('username', 'Username', 'mspharmony-proofpoint-username', 'PROOFPOINT_USERNAME'),
      secret('password', 'Password', 'mspharmony-proofpoint-password', 'PROOFPOINT_PASSWORD'),
    ],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'PROOFPOINT_ENDPOINT', 'https://api.proofpointessentials.com')],
    scopes: ['domains.read', 'users.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'datto',
    displayName: 'Datto Backup',
    category: 'Backup',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping'],
    description: 'Kaseya Datto BCDR protected-agent counts and SaaS Protection seat counts.',
    endpoint: 'https://api.datto.com',
    requiredSecrets: [
      secret('apiKey', 'REST API Public Key', 'mspharmony-datto-api-key', 'DATTO_API_KEY'),
      secret('apiSecret', 'REST API Secret Key', 'mspharmony-datto-api-secret', 'DATTO_API_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Datto REST API Endpoint', 'DATTO_ENDPOINT', 'https://api.datto.com'),
    ],
    scopes: ['bcdr.status.read', 'saas.domains.read', 'saas.seats.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-365',
    displayName: 'Microsoft 365',
    category: 'Productivity',
    authMode: 'oauth2',
    capabilities: ['live-api', 'mapping'],
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
    scopes: ['SecureCloud.Customers', 'SecureCloud.Usage'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-azure',
    displayName: 'Microsoft Azure',
    category: 'Cloud',
    authMode: 'oauth2',
    capabilities: [],
    description: 'Azure subscription consumption and configurable markup inputs.',
    endpoint: 'https://management.azure.com',
    requiredSecrets: [secret('clientSecret', 'Client Secret', 'mspharmony-azure-client-secret', 'AZURE_CLIENT_SECRET')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Management Endpoint', 'AZURE_ENDPOINT', 'https://management.azure.com'),
      nonSecret('tenantId', 'Tenant ID', 'AZURE_TENANT_ID'),
      nonSecret('clientId', 'Client ID', 'AZURE_CLIENT_ID'),
      nonSecret('subscriptionId', 'Subscription ID', 'AZURE_SUBSCRIPTION_ID'),
    ],
    scopes: ['Billing.Read', 'Consumption.Read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'pax8',
    displayName: 'Pax8',
    category: 'Marketplace',
    authMode: 'oauth2',
    capabilities: [],
    description: 'Marketplace subscriptions, SKU aliases, and customer product mapping.',
    endpoint: 'https://api.pax8.com',
    requiredSecrets: [secret('clientSecret', 'Client Secret', 'mspharmony-pax8-client-secret', 'PAX8_CLIENT_SECRET')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'PAX8_ENDPOINT', 'https://api.pax8.com'),
      nonSecret('clientId', 'Client ID', 'PAX8_CLIENT_ID'),
    ],
    scopes: ['companies.read', 'subscriptions.read', 'products.read'],
    syncFrequency: 'daily',
    webhookSupported: true,
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
  };
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
