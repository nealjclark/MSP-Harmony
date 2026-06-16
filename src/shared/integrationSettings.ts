export type IntegrationId =
  | 'connectwise'
  | 'cove'
  | 'sentinelone'
  | 'proofpoint'
  | 'datto'
  | 'microsoft-365'
  | 'microsoft-azure'
  | 'pax8';

export type IntegrationAuthMode = 'api-key' | 'oauth2' | 'token' | 'basic';
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
    integrationId: 'sentinelone',
    displayName: 'SentinelOne',
    category: 'Security',
    authMode: 'token',
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
    authMode: 'api-key',
    description: 'BCDR appliance and SaaS protection counts.',
    endpoint: 'https://api.datto.com',
    requiredSecrets: [
      secret('apiKey', 'API Key', 'mspharmony-datto-api-key', 'DATTO_API_KEY'),
      secret('apiSecret', 'API Secret', 'mspharmony-datto-api-secret', 'DATTO_API_SECRET'),
    ],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'DATTO_ENDPOINT', 'https://api.datto.com')],
    scopes: ['devices.read', 'saas.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-365',
    displayName: 'Microsoft 365',
    category: 'Productivity',
    authMode: 'oauth2',
    description: 'License counts through Microsoft Graph and Partner Center.',
    endpoint: 'https://graph.microsoft.com',
    requiredSecrets: [secret('clientSecret', 'Client Secret', 'mspharmony-microsoft365-client-secret', 'MICROSOFT365_CLIENT_SECRET')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Graph Endpoint', 'MICROSOFT365_ENDPOINT', 'https://graph.microsoft.com'),
      nonSecret('tenantId', 'Tenant ID', 'MICROSOFT365_TENANT_ID'),
      nonSecret('clientId', 'Client ID', 'MICROSOFT365_CLIENT_ID'),
    ],
    scopes: ['Directory.Read.All', 'Organization.Read.All', 'PartnerCenter.Read.All'],
    syncFrequency: 'daily',
    webhookSupported: true,
  },
  {
    integrationId: 'microsoft-azure',
    displayName: 'Microsoft Azure',
    category: 'Cloud',
    authMode: 'oauth2',
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
