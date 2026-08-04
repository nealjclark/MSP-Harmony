export type IntegrationId =
  | 'connectwise'
  | 'connectwise-cpq'
  | 'dell-premier'
  | 'sales-mailbox'
  | 'azure-openai'
  | 'wisepay'
  | 'cove'
  | 'ncentral'
  | 'cavelo'
  | 'sentinelone'
  | 'proofpoint'
  | 'datto'
  | 'microsoft-365'
  | 'opentext-appriver'
  | 'huntress'
  | 'microsoft-azure'
  | 'ingram-micro'
  | 'nerdio'
  | 'pax8'
  | 'custom-table';

export type IntegrationAuthMode = 'api-key' | 'oauth2' | 'token' | 'basic' | 'none';
export type IntegrationCapability = 'live-api' | 'mapping' | 'invoice-import' | 'payment-link' | 'sales';
export type IntegrationConfiguredStatus = 'connected' | 'degraded' | 'not-configured';
export type IntegrationDataIngestionMethod = 'live-api' | 'csv' | 'excel' | 'json';
export type IntegrationDataSourceType =
  | 'user-license-detail'
  | 'customer-product-breakdown'
  | 'reseller-product-total'
  | 'device-count'
  | 'invoice'
  | 'license-count';
export type IntegrationNonSecretInputType = 'text' | 'textarea' | 'checkbox' | 'select';
export type IntegrationSyncFrequency = 'hourly' | 'daily' | 'weekly' | 'manual';
export type IntegrationTestResult = 'success' | 'failure' | 'untested';
export type PsaAgreementReconcileMode = 'merge-multiple-products' | 'separate-multiple-products';

export const detailOnlySyncSettingKey = 'detailOnlySync';
export const psaAgreementReconcileModeSettingKey = 'psaAgreementReconcileMode';
export const doNotSuggestNewAdditionsSettingKey = 'doNotSuggestNewAdditions';
export const enableApiSyncSettingKey = 'enableApiSync';
export const enableManualDetailImportsSettingKey = 'enableManualDetailImports';
export const enableInvoiceImportSettingKey = 'enableInvoiceImport';
export const monthlyReviewCwOnlyExcludedProductCodesSettingKey =
  'monthlyReviewCwOnlyExcludedProductCodes';

export type IntegrationApiOperationDefinition = {
  key: string;
  label: string;
  dataSourceKey?: string;
};

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
  section?: string;
  options?: Array<{ value: string; label: string }>;
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

const integrationApiOperations: Partial<Record<IntegrationId, IntegrationApiOperationDefinition[]>> = {
  connectwise: [{ key: 'agreement-report', label: 'Agreement report' }],
  cove: [{ key: 'usage-snapshots', label: 'Protected systems', dataSourceKey: 'cove-protected-systems' }],
  ncentral: [{ key: 'usage-snapshots', label: 'Filter and device counts', dataSourceKey: 'ncentral-device-filters' }],
  cavelo: [{ key: 'usage-snapshots', label: 'Organization agent counts', dataSourceKey: 'cavelo-organization-agents' }],
  sentinelone: [{ key: 'usage-snapshots', label: 'Site and agent counts', dataSourceKey: 'sentinelone-sites' }],
  proofpoint: [{ key: 'usage-snapshots', label: 'Customer user counts', dataSourceKey: 'proofpoint-domains' }],
  datto: [
    { key: 'datto-bcdr', label: 'BCDR protected agents', dataSourceKey: 'datto-bcdr-agents' },
    { key: 'datto-saas', label: 'SaaS Protection seats', dataSourceKey: 'datto-saas-seats' },
  ],
  'microsoft-365': [
    { key: 'm365-licenses', label: 'Subscription and license counts', dataSourceKey: 'microsoft365-product-totals' },
    { key: 'm365-users', label: 'User and assigned-license detail', dataSourceKey: 'microsoft365-user-licenses' },
  ],
  'opentext-appriver': [
    { key: 'subscription-snapshots', label: 'Customer subscription snapshots', dataSourceKey: 'appriver-customer-products' },
  ],
  huntress: [
    { key: 'usage-snapshots', label: 'Organization product usage', dataSourceKey: 'huntress-organization-product-usage' },
  ],
  'microsoft-azure': [
    { key: 'azure-cost-usage', label: 'Cost and resource usage', dataSourceKey: 'azure-subscription-consumption' },
  ],
  'ingram-micro': [
    { key: 'ingram-invoices', label: 'Microsoft invoice reports', dataSourceKey: 'ingram-azure-invoices' },
  ],
  nerdio: [
    { key: 'nerdio-invoices', label: 'Invoice charges', dataSourceKey: 'nerdio-invoice-charges' },
    { key: 'nerdio-live-usage', label: 'Live AVD/CPC usage', dataSourceKey: 'nerdio-live-usage' },
  ],
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
    optionalNonSecrets: [
      optionalNonSecret(
        'siteUrl',
        'ConnectWise Site URL',
        'CONNECTWISE_SITE_URL',
        undefined,
        'text',
        'Browser URL used for opportunity deep links.',
      ),
      optionalNonSecret(
        monthlyReviewCwOnlyExcludedProductCodesSettingKey,
        'Monthly Review CW-only exceptions',
        'CONNECTWISE_MONTHLY_REVIEW_CW_ONLY_EXCLUDED_PRODUCT_CODES',
        undefined,
        'textarea',
        'One exact ConnectWise product code per line. These additions remain available to linked-count rules and vendor matches, but do not appear as standalone CW-only rows.',
        'Monthly Review',
      ),
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
    description: 'Uses the configured WisePay URL and API key to construct PayNow links for ConnectWise invoice notifications.',
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
    optionalNonSecrets: mappingIntegrationOptions('COVE'),
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
    optionalNonSecrets: mappingIntegrationOptions('NCENTRAL', 'false', 'separate-multiple-products'),
    scopes: ['device-filters.read', 'devices.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'cavelo',
    displayName: 'Cavelo',
    category: 'Security',
    authMode: 'api-key',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'cavelo-organization-agents',
        'Organization agent counts',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Active, inactive, and total Cavelo endpoint agent counts by organization.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Endpoint security agent counts and invoice imports by Cavelo organization.',
    endpoint: 'https://api.prod.cavelodata.com/v1',
    requiredSecrets: [secret('apiKey', 'API Key', 'mspharmony-cavelo-api-key', 'CAVELO_API_KEY')],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'CAVELO_ENDPOINT', 'https://api.prod.cavelodata.com/v1'),
    ],
    optionalNonSecrets: mappingIntegrationOptions('CAVELO'),
    scopes: ['organizations.read', 'agents.read'],
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
    optionalNonSecrets: mappingIntegrationOptions('SENTINELONE'),
    scopes: ['sites.read', 'agents.read'],
    syncFrequency: 'hourly',
    webhookSupported: true,
  },
  {
    integrationId: 'proofpoint',
    displayName: 'Proofpoint Essentials',
    category: 'Email Security',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'proofpoint-domains',
        'Customer user counts',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Active billable email security users by customer with all associated domains combined.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Email security seat counts by customer domain from Proofpoint Essentials v1.',
    endpoint: '',
    requiredSecrets: [
      secret('username', 'Username', 'mspharmony-proofpoint-username', 'PROOFPOINT_USERNAME'),
      secret('password', 'Password', 'mspharmony-proofpoint-password', 'PROOFPOINT_PASSWORD'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Proofpoint Stack URL', 'PROOFPOINT_ENDPOINT'),
      nonSecret('organizationDomain', 'Partner Domain (or UUID)', 'PROOFPOINT_ORGANIZATION_DOMAIN'),
    ],
    optionalNonSecrets: [
      optionalNonSecret(
        'additionalEndpoints',
        'Additional Proofpoint Stacks',
        'PROOFPOINT_ADDITIONAL_ENDPOINTS',
        undefined,
        'textarea',
        'One per line as Stack URL | Partner Domain or UUID. The saved Key Vault username and password are reused for every stack.',
        'Additional Proofpoint stacks',
      ),
      ...mappingIntegrationOptions('PROOFPOINT'),
    ],
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
        'datto-bcdr-agents',
        'BCDR protected agents',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer-level BCDR protected-agent counts.',
      ),
      dataSource(
        'datto-saas-seats',
        'SaaS Protection seats',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        false,
        'Customer-level SaaS Protection product-line seat counts.',
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
    optionalNonSecrets: mappingIntegrationOptions('DATTO'),
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
    optionalNonSecrets: mappingIntegrationOptions('MICROSOFT365', 'true'),
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
    optionalNonSecrets: mappingIntegrationOptions('OPENTEXT_APPRIVER'),
    scopes: ['SecureCloud.Customers', 'SecureCloud.Usage'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'huntress',
    displayName: 'Huntress',
    category: 'Security',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'huntress-organization-product-usage',
        'Organization product usage',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
        true,
        true,
        'Organization-level Huntress product usage from the API, invoices, or exports.',
      ),
      resellerInvoiceTotals(),
    ],
    description: 'Managed security product usage by organization, defaulting to ITDR for live sync.',
    endpoint: 'https://api.huntress.io',
    requiredSecrets: [
      secret('apiKey', 'API Key', 'mspharmony-huntress-api-key', 'HUNTRESS_API_KEY'),
      secret('apiSecret', 'API Secret Key', 'mspharmony-huntress-api-secret', 'HUNTRESS_API_SECRET'),
    ],
    requiredNonSecrets: [nonSecret('endpoint', 'API Endpoint', 'HUNTRESS_ENDPOINT', 'https://api.huntress.io')],
    optionalNonSecrets: [
      optionalNonSecret(
        'productClasses',
        'Enabled product classes',
        'HUNTRESS_PRODUCT_CLASSES',
        'itdr',
        'text',
        'Comma-separated Huntress product classes to sync. Use itdr for the current workflow, or all to include every supported class.',
        'Huntress usage',
      ),
      ...mappingIntegrationOptions('HUNTRESS'),
    ],
    scopes: ['actor.read', 'organizations.read', 'agents.read', 'invoices.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'microsoft-azure',
    displayName: 'Microsoft Azure',
    category: 'Cloud',
    authMode: 'oauth2',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'azure-subscription-consumption',
        'Subscription consumption',
        'customer-product-breakdown',
        ['live-api', 'csv', 'excel'],
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
      nonSecret('tenantId', 'Managing Tenant ID', 'AZURE_TENANT_ID'),
      nonSecret('clientId', 'Application (Client) ID', 'AZURE_CLIENT_ID'),
    ],
    optionalNonSecrets: [
      optionalNonSecret(
        'subscriptionIds',
        'Subscription allowlist',
        'AZURE_SUBSCRIPTION_IDS',
        undefined,
        'textarea',
        'Optional comma- or line-separated subscription IDs. Leave blank to sync every subscription delegated through Azure Lighthouse.',
        'Azure Cost Management',
      ),
      optionalNonSecret(
        'lookbackDays',
        'Usage lookback days',
        'AZURE_LOOKBACK_DAYS',
        '35',
        'text',
        'Daily Cost Management window to refresh on each sync. Use at least 35 days to cover late adjustments.',
        'Azure Cost Management',
      ),
      ...mappingIntegrationOptions('AZURE'),
    ],
    scopes: ['Azure RBAC: Cost Management Reader', 'Azure Lighthouse delegated subscription access'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'connectwise-cpq',
    displayName: 'ConnectWise CPQ / Sell',
    category: 'Sales',
    authMode: 'api-key',
    capabilities: ['sales'],
    dataSources: [],
    description: 'Governed template reads, reviewable quote drafts, line selection, and ready-state transitions.',
    endpoint: 'https://sellapi.quosalsell.com',
    requiredSecrets: [
      secret('publicKey', 'Public Key', 'mspharmony-connectwise-cpq-public-key', 'CONNECTWISE_CPQ_PUBLIC_KEY'),
      secret('privateKey', 'Private Key', 'mspharmony-connectwise-cpq-private-key', 'CONNECTWISE_CPQ_PRIVATE_KEY'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'CONNECTWISE_CPQ_ENDPOINT', 'https://sellapi.quosalsell.com'),
      nonSecret('accessKey', 'Access Key', 'CONNECTWISE_CPQ_ACCESS_KEY'),
      nonSecret('templatesPath', 'Templates API Path', 'CONNECTWISE_CPQ_TEMPLATES_PATH', '/api/templates'),
      nonSecret('quotesPath', 'Quotes API Path', 'CONNECTWISE_CPQ_QUOTES_PATH', '/api/quotes'),
      nonSecret('quoteItemsPath', 'Quote Items API Path', 'CONNECTWISE_CPQ_QUOTE_ITEMS_PATH', '/api/quoteItems'),
      nonSecret('quoteTabsPath', 'Quote Tabs API Path', 'CONNECTWISE_CPQ_QUOTE_TABS_PATH', '/api/quoteTabs'),
      nonSecret('testCompanyId', 'Pilot Test Company ID', 'CONNECTWISE_CPQ_TEST_COMPANY_ID'),
    ],
    optionalNonSecrets: [
      optionalNonSecret(
        'siteUrl',
        'CPQ Site URL',
        'CONNECTWISE_CPQ_SITE_URL',
        undefined,
        'text',
        'Browser URL for CPQ quote deep links, such as https://bmb.quosalsell.com.',
      ),
      optionalNonSecret(
        'hardwareTabId',
        'Hardware Quote Tab ID',
        'CONNECTWISE_CPQ_HARDWARE_TAB_ID',
        undefined,
        'text',
        'Optional CPQ template tab identifier used when inserting Dell eQuote lines.',
      ),
    ],
    scopes: ['templates.read', 'quotes.read', 'quotes.write', 'quotes.status.write'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'dell-premier',
    displayName: 'Dell Premier Quote API',
    category: 'Sales',
    authMode: 'oauth2',
    capabilities: ['sales'],
    dataSources: [],
    description: 'Read-only retrieval of existing Dell Premier eQuotes and their hardware line items.',
    endpoint: 'https://apigtwb2c.us.dell.com',
    requiredSecrets: [
      secret('clientSecret', 'Client Secret', 'mspharmony-dell-premier-client-secret', 'DELL_PREMIER_CLIENT_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'DELL_PREMIER_ENDPOINT', 'https://apigtwb2c.us.dell.com'),
      nonSecret('tokenEndpoint', 'OAuth Token Endpoint', 'DELL_PREMIER_TOKEN_ENDPOINT'),
      nonSecret('clientId', 'Client ID', 'DELL_PREMIER_CLIENT_ID'),
      nonSecret('accountId', 'Premier Account ID', 'DELL_PREMIER_ACCOUNT_ID'),
      nonSecret('locale', 'Default Locale', 'DELL_PREMIER_LOCALE', 'en-us'),
      nonSecret('quotesPath', 'Quote API Path', 'DELL_PREMIER_QUOTES_PATH', '/quote'),
    ],
    scopes: ['quotes.read'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'sales-mailbox',
    displayName: 'Sales Quote Mailbox',
    category: 'Sales',
    authMode: 'oauth2',
    capabilities: ['sales'],
    dataSources: [],
    description: 'Dedicated Microsoft Graph application for scoped quote-request intake and same-thread replies.',
    endpoint: 'https://graph.microsoft.com',
    requiredSecrets: [
      secret('clientSecret', 'Client Secret', 'mspharmony-sales-mailbox-client-secret', 'SALES_MAILBOX_CLIENT_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Graph Endpoint', 'SALES_MAILBOX_GRAPH_ENDPOINT', 'https://graph.microsoft.com'),
      nonSecret('tenantId', 'Tenant ID', 'SALES_MAILBOX_TENANT_ID'),
      nonSecret('clientId', 'Client ID', 'SALES_MAILBOX_CLIENT_ID'),
      nonSecret('sharedMailbox', 'Shared Mailbox', 'SALES_SHARED_MAILBOX'),
    ],
    scopes: ['Mail.Read', 'Mail.Send'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'azure-openai',
    displayName: 'Azure OpenAI Quote Agent',
    category: 'Sales',
    authMode: 'none',
    capabilities: ['sales'],
    dataSources: [],
    description: 'Managed-identity access to a US Data Zone model deployment for strict quote-plan generation.',
    endpoint: '',
    requiredSecrets: [],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Azure OpenAI Endpoint', 'AZURE_OPENAI_ENDPOINT'),
      nonSecret('deployment', 'Model Deployment', 'AZURE_OPENAI_DEPLOYMENT'),
    ],
    scopes: ['https://cognitiveservices.azure.com/.default'],
    syncFrequency: 'manual',
    webhookSupported: false,
  },
  {
    integrationId: 'ingram-micro',
    displayName: 'Ingram Micro Cloud',
    category: 'Marketplace',
    authMode: 'basic',
    capabilities: ['live-api', 'mapping', 'invoice-import'],
    dataSources: [
      dataSource(
        'ingram-azure-invoices',
        'Microsoft invoice reports',
        'invoice',
        ['live-api', 'csv', 'excel'],
        true,
        true,
        'Ingram Microsoft invoice lines mapped by customer account, with subscription ID retained as evidence and product SKU used for billing selection.',
      ),
    ],
    description: 'Indirect-reseller Microsoft Azure, Windows 365, and Modern Work subscription invoices and cost evidence.',
    endpoint: 'https://api.cloud.im/marketplace/na',
    requiredSecrets: [
      secret('apiSecret', 'API Secret', 'mspharmony-ingram-api-secret', 'INGRAM_MICRO_API_SECRET'),
      secret(
        'subscriptionKey',
        'Subscription Key',
        'mspharmony-ingram-subscription-key',
        'INGRAM_MICRO_SUBSCRIPTION_KEY',
      ),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'API Endpoint', 'INGRAM_MICRO_ENDPOINT', 'https://api.cloud.im/marketplace/na'),
      nonSecret('apiUsername', 'API Username', 'INGRAM_MICRO_API_USERNAME'),
      nonSecret('marketplace', 'Marketplace', 'INGRAM_MICRO_MARKETPLACE', 'us'),
    ],
    optionalNonSecrets: [
      optionalNonSecret(
        'reportNamePrefix',
        'Invoice report prefix',
        'INGRAM_MICRO_REPORT_PREFIX',
        'Every Invoice - ',
        'text',
        'Only completed Excel reports whose names begin with this value are imported.',
        'Invoice reports',
      ),
      optionalNonSecret(
        'excludedCustomerNames',
        'Excluded customer names',
        'INGRAM_MICRO_EXCLUDED_CUSTOMERS',
        'BMB Solutions',
        'text',
        'Comma- or line-separated Ingram customer names to retain in the raw report archive but exclude from synchronized invoice lines.',
        'Invoice reports',
      ),
    ],
    scopes: ['reports.read', 'subscriptions.read'],
    syncFrequency: 'daily',
    webhookSupported: false,
  },
  {
    integrationId: 'nerdio',
    displayName: 'Nerdio Manager',
    category: 'Cloud',
    authMode: 'oauth2',
    capabilities: ['live-api', 'mapping'],
    dataSources: [
      dataSource(
        'nerdio-invoice-charges',
        'Invoice charges',
        'invoice',
        ['live-api', 'json'],
        true,
        true,
        'Actual Nerdio invoice charges, discounts, minimums, metrics, and license counts.',
      ),
      dataSource(
        'nerdio-live-usage',
        'Live AVD/CPC usage',
        'customer-product-breakdown',
        ['live-api', 'json'],
        true,
        false,
        'Current Nerdio account usage used as an optional billing count source.',
      ),
    ],
    description: 'Nerdio invoices and live AVD, Cloud PC, and Intune usage.',
    endpoint: 'https://nerdio.bmbsolutions.com',
    requiredSecrets: [
      secret('clientSecret', 'Client Secret', 'mspharmony-nerdio-client-secret', 'NERDIO_CLIENT_SECRET'),
    ],
    requiredNonSecrets: [
      nonSecret('endpoint', 'Nerdio URL', 'NERDIO_ENDPOINT', 'https://nerdio.bmbsolutions.com'),
      nonSecret('tenantId', 'Tenant ID', 'NERDIO_TENANT_ID'),
      nonSecret('clientId', 'Client ID', 'NERDIO_CLIENT_ID'),
      nonSecret('apiScope', 'API Scope', 'NERDIO_API_SCOPE'),
    ],
    optionalNonSecrets: [
      optionalNonSecret(
        'invoiceLookbackMonths',
        'Invoice lookback months',
        'NERDIO_INVOICE_LOOKBACK_MONTHS',
        '4',
        'text',
        'Invoice periods requested during each synchronization.',
        'Invoice history',
      ),
    ],
    scopes: ['Nerdio REST API RestClient application role'],
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
    optionalNonSecrets: mappingIntegrationOptions('PAX8'),
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
    optionalNonSecrets: mappingIntegrationOptions('CUSTOM_TABLE'),
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

export function getIntegrationDataSourceByKey(integrationId: IntegrationId, dataSourceKey: string | undefined) {
  return dataSourceKey
    ? listIntegrationDataSources(integrationId).find((source) => source.key === dataSourceKey)
    : undefined;
}

export function listIntegrationApiOperations(integrationId: IntegrationId) {
  return integrationApiOperations[integrationId] ?? [];
}

export function getIntegrationApiOperation(integrationId: IntegrationId, operationKey: string | undefined) {
  return operationKey
    ? listIntegrationApiOperations(integrationId).find((operation) => operation.key === operationKey)
    : undefined;
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
  return [
    ...definition.requiredNonSecrets,
    ...integrationChannelSettings(definition),
    ...(definition.optionalNonSecrets ?? []),
  ];
}

export function listIntegrationChannelSettings(definition: IntegrationSettingsDefinition) {
  return integrationChannelSettings(definition);
}

export function integrationChannelEnabled(
  nonSecrets: Record<string, string | undefined>,
  key: typeof enableApiSyncSettingKey | typeof enableManualDetailImportsSettingKey | typeof enableInvoiceImportSettingKey,
  fallback = false,
) {
  return typeof nonSecrets[key] === 'undefined' ? fallback : booleanSettingEnabled(nonSecrets[key]);
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

export function integrationPsaAgreementReconcileMode(
  nonSecrets: Record<string, string | undefined> = {},
  definition?: IntegrationSettingsDefinition,
): PsaAgreementReconcileMode {
  const configuredValue =
    nonSecrets[psaAgreementReconcileModeSettingKey] ??
    definition?.optionalNonSecrets?.find((setting) => setting.key === psaAgreementReconcileModeSettingKey)?.defaultValue;

  return configuredValue === 'separate-multiple-products' ? 'separate-multiple-products' : 'merge-multiple-products';
}

export function parseMonthlyReviewCwOnlyExcludedProductCodes(value: string | undefined) {
  return [
    ...new Set(
      (value ?? '')
        .split(/[\r\n,;]+/)
        .map((productCode) => productCode.trim())
        .filter(Boolean),
    ),
  ];
}

export function integrationDoNotSuggestNewAdditions(
  nonSecrets: Record<string, string | undefined> = {},
  definition?: IntegrationSettingsDefinition,
): boolean {
  const configuredValue =
    nonSecrets[doNotSuggestNewAdditionsSettingKey] ??
    definition?.optionalNonSecrets?.find((setting) => setting.key === doNotSuggestNewAdditionsSettingKey)?.defaultValue;

  return booleanSettingEnabled(configuredValue);
}

export function integrationSupportsPsaAgreementReconcileOptions(definition: IntegrationSettingsDefinition) {
  return definition.capabilities.includes('mapping');
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
  section?: string,
  options?: Array<{ value: string; label: string }>,
): IntegrationNonSecretDefinition {
  return {
    key,
    label,
    envVar,
    required: false,
    defaultValue,
    inputType,
    description,
    section,
    options,
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
    'Enabled workflows',
  );
}

function psaAgreementReconcileModeOption(
  envVar: string,
  defaultValue: PsaAgreementReconcileMode = 'merge-multiple-products',
) {
  return optionalNonSecret(
    psaAgreementReconcileModeSettingKey,
    'Agreement reconcile mode',
    envVar,
    defaultValue,
    'select',
    'Choose how multiple ConnectWise additions with the same product are reconciled. Separate mode names lines after the matched agreement addition and avoids double-counting one addition across overlapping mapped products.',
    'PSA Agreement Reconcile options',
    [
      {
        value: 'merge-multiple-products',
        label:
          defaultValue === 'merge-multiple-products'
            ? 'Merge multiple products (default)'
            : 'Merge multiple products',
      },
      {
        value: 'separate-multiple-products',
        label:
          defaultValue === 'separate-multiple-products'
            ? 'Separate multiple products (default)'
            : 'Separate multiple products',
      },
    ],
  );
}

function doNotSuggestNewAdditionsOption(envVar: string) {
  return optionalNonSecret(
    doNotSuggestNewAdditionsSettingKey,
    'Do not suggest New Additions',
    envVar,
    'false',
    'checkbox',
    'Only reconcile products that already exist on the agreement. Skip create-addition suggestions for customers without that product.',
    'PSA Agreement Reconcile options',
  );
}

function mappingIntegrationOptions(
  envVarPrefix: string,
  detailOnlyDefault = 'false',
  reconcileModeDefault: PsaAgreementReconcileMode = 'merge-multiple-products',
) {
  return [
    detailOnlySyncOption(`${envVarPrefix}_DETAIL_ONLY_SYNC`, detailOnlyDefault),
    psaAgreementReconcileModeOption(`${envVarPrefix}_PSA_AGREEMENT_RECONCILE_MODE`, reconcileModeDefault),
    doNotSuggestNewAdditionsOption(`${envVarPrefix}_DO_NOT_SUGGEST_NEW_ADDITIONS`),
  ];
}

function integrationChannelSettings(definition: IntegrationSettingsDefinition) {
  const envPrefix = definition.integrationId.replace(/-/g, '_').toUpperCase();
  const settings: IntegrationNonSecretDefinition[] = [];

  if (definition.capabilities.includes('live-api')) {
    settings.push(optionalNonSecret(
      enableApiSyncSettingKey,
      'Enable API Sync',
      `${envPrefix}_ENABLE_API_SYNC`,
      undefined,
      'checkbox',
      'Show API operations and allow this integration to run live synchronization.',
      'Enabled workflows',
    ));
  }

  if (definition.capabilities.includes('mapping')) {
    settings.push(optionalNonSecret(
      enableManualDetailImportsSettingKey,
      'Enable Manual Detail Imports',
      `${envPrefix}_ENABLE_MANUAL_DETAIL_IMPORTS`,
      undefined,
      'checkbox',
      'Show manual vendor datapoints and file-import tools for this integration.',
      'Enabled workflows',
    ));
  }

  if (definition.capabilities.includes('invoice-import')) {
    settings.push(optionalNonSecret(
      enableInvoiceImportSettingKey,
      'Enable Invoice Import',
      `${envPrefix}_ENABLE_INVOICE_IMPORT`,
      undefined,
      'checkbox',
      'Show invoice-import tools for this integration. Reporting-column mapping remains a later step.',
      'Enabled workflows',
    ));
  }

  return settings;
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
    return 'not-configured';
  }

  return lastTestResult === 'failure' ? 'degraded' : 'connected';
}

function hasValue(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function booleanSettingEnabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}
