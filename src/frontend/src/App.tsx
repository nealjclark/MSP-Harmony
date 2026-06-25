import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileUp,
  Filter,
  History,
  KeyRound,
  Layers3,
  Link2,
  ListChecks,
  MoreHorizontal,
  Package,
  Pencil,
  Plug,
  RefreshCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Upload,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  integrationSettingsRegistry,
  validateIntegrationRegistry,
  type IntegrationId,
  type IntegrationSettingsDefinition,
  type IntegrationNonSecretDefinition,
  type IntegrationSecretDefinition,
  type IntegrationSettingsState,
  type IntegrationSettingsValidation,
} from '../../shared/integrationSettings';

type View = 'reconcile' | 'integrations' | 'mappings' | 'reports' | 'imports' | 'agreements' | 'audit' | 'settings';
type AppRole = 'Admin' | 'Approver' | 'Analyst';
type ManagedUserStatus = 'active' | 'disabled';
type IssueStatus = 'matched' | 'needs-review' | 'not-billable' | 'ready' | 'approved' | 'blocked' | 'skipped';
type IntegrationStatus = 'connected' | 'degraded' | 'not-configured';
type IntegrationTab = 'credentials' | 'sync';
type ReportSection = 'raw-sync' | 'product-profitability';
type MappingStatus = 'candidate' | 'approved' | 'needs-review' | 'rejected';

type ReconcileIssue = {
  id: string;
  vendorId: IntegrationId;
  clientId: string;
  agreementId: string;
  accountId?: string;
  customer: string;
  agreement: string;
  vendor: string;
  product: string;
  family: string;
  serviceCode: string;
  lineType: 'base-count' | 'usage-add-on';
  measuredSourceCount: number;
  sourceCount: number;
  invoiceCount: number;
  proposedCount: number;
  amount: number;
  unit: string;
  confidence: number;
  owner: string;
  age: string;
  reason: string;
  status: IssueStatus;
  recommendation: string;
  lastSeen: string;
  audit: string[];
  devices: ReconciliationDevice[];
  adjustments: ReconciliationAdjustment[];
};

type ProductRule = {
  product: string;
  vendor: string;
  cwCode: string;
  basis: string;
  bundle: string;
  rule: string;
  confidence: number;
};

type ClientProfile = {
  customer: string;
  accountId: string;
  agreement: string;
  owner: string;
  primaryDriver: string;
  seats: number;
  devices: number;
  stackHealth: 'stable' | 'watch' | 'blocked';
  dependencyRules: string[];
  stacks: Array<{
    name: string;
    driver: string;
    products: string[];
    summary: string;
  }>;
};

type ClientGroup = {
  customer: string;
  customerId: string;
  agreementId: string;
  agreement: string;
  accountId: string;
  owner: string;
  primaryDriver: string;
  seats: number;
  devices: number;
  stackHealth: ClientProfile['stackHealth'];
  dependencyRules: string[];
  stacks: ClientProfile['stacks'];
  issues: ReconcileIssue[];
  vendors: string[];
  exposure: number;
  changeCount: number;
  readyCount: number;
  blockedCount: number;
  needsReviewCount: number;
};

type Integration = {
  id: IntegrationId;
  name: string;
  category: string;
  status: IntegrationStatus;
  auth: string;
  description: string;
  lastSync?: string;
  lastTest?: string;
  lastSyncStatus?: string;
  frequency?: string;
  records?: string;
  secretSource?: string;
  keyVaultUrl?: string;
  scopes: string[];
  enabled: boolean;
  endpoint: string;
  nonSecrets: Record<string, string | undefined>;
  requiredSecrets: IntegrationSecretDefinition[];
  requiredNonSecrets: IntegrationNonSecretDefinition[];
  missingSecrets: string[];
  missingNonSecrets: string[];
  webhookSupported: boolean;
  lastTestedAt?: string;
};

type IntegrationSettingsPayload = {
  integrationId: IntegrationId;
  nonSecrets: Record<string, string>;
  secrets: Record<string, string>;
};

type RuntimeIntegrationSummary = IntegrationSettingsDefinition & {
  nonSecrets?: Record<string, string | undefined>;
  validation?: IntegrationSettingsValidation;
  secretSource?: string;
  keyVaultUrl?: string;
  operationalStatus?: {
    lastSyncAt?: string;
    lastSyncCompletedAt?: string;
    lastSyncStatus?: string;
    lastSyncRecordsRead?: number;
    lastSyncRecordsWritten?: number;
    lastSyncError?: string;
    storedRecordCount?: number;
  };
};

type RuntimeIntegrationsResponse = {
  integrations: RuntimeIntegrationSummary[];
  nonSecretStorage: 'database' | 'not-configured';
  missingDatabaseSettings: string[];
};

type ManagedAppUser = {
  id: string;
  aadUserId?: string;
  email: string;
  displayName?: string;
  role: AppRole;
  status: ManagedUserStatus;
  lastSeenAt?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type ManagedUsersResponse = {
  users: ManagedAppUser[];
  roles: AppRole[];
  statuses: ManagedUserStatus[];
};

type RawSyncRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
};

type RawSyncDataset = 'users' | 'licenses';

type RawSyncRow = Record<string, string | number | boolean | null>;

type RawSyncDetailsResponse = {
  integrationId: IntegrationId;
  dataset?: RawSyncDataset;
  syncRun: RawSyncRun;
  columns: string[];
  rows: RawSyncRow[];
  summary: {
    rowCount: number;
    companyCount: number;
    agreementCount: number;
    productCount: number;
  };
};

type RawSyncRunsResponse = {
  reportType: ReportSection;
  integrationId: IntegrationId;
  dataset?: RawSyncDataset;
  runs: RawSyncRun[];
};

type ProductProfitabilityMonth = {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
};

type ProductProfitabilityIntegrationSeries = {
  integrationId: string;
  integrationName: string;
  months: ProductProfitabilityMonth[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  productCount: number;
  missingCostRows: number;
};

type ProductProfitabilityReportResponse = {
  reportType: 'product-profitability';
  generatedAt: string;
  currency: 'USD';
  startMonth: string;
  endMonth: string;
  months: string[];
  summary: {
    integrationCount: number;
    productCount: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    missingCostRows: number;
  };
  integrations: ProductProfitabilityIntegrationSeries[];
};

type ReconciliationLineStatus = 'matched' | 'needs-review' | 'not-billable';

type ReconciliationDevice = {
  id: string;
  vendorProductKey?: string;
  productCode: string;
  productName: string;
  quantity: number;
  observedAt: string;
  dimensions: DimensionMap;
};

type ReconciliationAdjustment = {
  id: string;
  vendorId: IntegrationId;
  customerId?: string;
  agreementId?: string;
  productCode: string;
  productName?: string;
  lineType: string;
  adjustmentType: 'less-count';
  quantity: number;
  reason?: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ReconciliationProductOption = {
  vendorProductKey: string;
  productCode: string;
  productName: string;
};

type ReconciliationRunMeta = {
  syncRunId?: string;
  generatedAt: string;
  snapshotCount?: number;
  agreementAdditionCount?: number;
  productCheckCount: number;
};

type AgreementAddition = {
  id: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: {
    amount: number;
    currency: string;
  };
  unitCost?: number;
  lessIncluded?: number;
  billedQuantity?: number;
  billCustomer?: string;
  effectiveDate?: string;
  taxableFlag?: string;
  invoiceDescription?: string;
  purchaseItemFlag?: string;
  specialOrderFlag?: string;
  uom?: string;
  extPrice?: number;
  extCost?: number;
  sequenceNumber?: number;
  margin?: number;
  prorateCost?: number;
  proratePrice?: number;
  extendedProrateCost?: number;
  extendedProratePrice?: number;
  prorateCurrentPeriodFlag?: string;
  description?: string;
  additionStatus: string;
  updatedAt?: string;
};

type AgreementAdditionsResponse = {
  agreementId: string;
  additions: AgreementAddition[];
};

type AgreementAdditionsSelection = {
  customer: string;
  agreementId: string;
  agreement: string;
  accountId: string;
};

type VendorDataSelection = {
  customer: string;
  vendorId: IntegrationId;
  vendor: string;
  status: 'loading' | 'ready' | 'failed';
  syncSummary?: string;
  message?: string;
  columns: string[];
  rows: RawSyncRow[];
};

type VendorDataColumn = {
  label: string;
  primary?: boolean;
  format?: 'date';
  value: (device: ReconciliationDevice) => DimensionValue | Array<string | number | boolean>;
};

type ReconciliationLineResponse = {
  id: string;
  vendorId: string;
  clientId: string;
  agreementId: string;
  customerName?: string;
  agreementName?: string;
  connectWiseCompanyId?: string;
  connectWiseAgreementId?: string;
  productCode: string;
  productName: string;
  lineType: 'base-count' | 'usage-add-on';
  sourceQuantity: number;
  agreementQuantity: number;
  proposedQuantity: number;
  delta: number;
  unit: string;
  unitPrice?: {
    amount: number;
    currency: string;
  };
  financialImpact: {
    amount: number;
    currency: string;
  };
  status: ReconciliationLineStatus;
  writeAction?: 'update-addition' | 'create-addition' | 'review-required';
  reason: string;
  evidence: Array<{
    label: string;
    value: string | number;
  }>;
  devices?: ReconciliationDevice[];
  adjustments?: ReconciliationAdjustment[];
};

type ReconciliationRunResponse = {
  vendorId: IntegrationId;
  generatedAt: string;
  syncRunId?: string;
  snapshotCount?: number;
  agreementAdditionCount?: number;
  productOptions?: ReconciliationProductOption[];
  lines: ReconciliationLineResponse[];
  totals: {
    matched: number;
    needsReview: number;
    notBillable: number;
    financialImpact: {
      amount: number;
      currency: string;
    };
  };
};

type MappingEvidence = {
  label: string;
  value: string | number | boolean;
};

type AccountMappingCandidate = {
  vendorId: IntegrationId;
  externalAccountId: string;
  externalAccountName: string;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  status: MappingStatus;
  confidence: string;
  matchScore: number;
  activeRecommended: boolean;
  reason: string;
  evidence: MappingEvidence[];
};

type AccountMapping = AccountMappingCandidate & {
  id: string;
  mappingSource: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  lastSeenAt?: string;
};

type MappingCustomerOption = {
  customerId: string;
  connectWiseCompanyId?: string;
  customerName: string;
  aliases: string[];
  agreements: Array<{
    agreementId: string;
    agreementName: string;
    status: string;
    additionCount: number;
    productCodes: string[];
  }>;
};

type ProductMappingTarget = {
  connectwiseProductCode: string;
  connectwiseProductName: string;
  unitPrice?: number;
};

type ProductBundleComponent = {
  vendorProductKey: string;
  vendorProductName: string;
};

type ProductBundle = {
  id: string;
  vendorId: IntegrationId;
  bundleKey: string;
  bundleName: string;
  components: ProductBundleComponent[];
  target: ProductMappingTarget;
  quantityStrategy: 'max-component-quantity';
  status: MappingStatus;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ProductCatalogTarget = ProductMappingTarget & {
  connectwiseProductId?: string;
  source: 'local' | 'connectwise';
};

type ProductCatalogSearchResponse = {
  query: string;
  targets: ProductCatalogTarget[];
  source: 'local' | 'connectwise';
  warning?: string;
};

type DimensionValue = string | number | boolean | null | undefined;
type DimensionMap = Record<string, DimensionValue | Array<string | number | boolean>>;

type UsageOverride = {
  id: string;
  vendorId: IntegrationId;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  sourceVendorProductKey: string;
  targetVendorProductKey: string;
  dimensionFilters: DimensionMap;
  targetDimensions: DimensionMap;
  reason?: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type UsageOverridesResponse = {
  vendorId: IntegrationId;
  overrides: UsageOverride[];
};

type NcentralFilter = {
  filterId: string;
  filterName: string;
  description?: string;
};

type NcentralFilterMapping = {
  id: string;
  filterId?: string;
  filterName: string;
  mappingType: 'product' | 'overlay';
  vendorProductKey?: string;
  displayName: string;
  tagKey?: string;
  priority: number;
  status: MappingStatus;
  active: boolean;
};

type NcentralFilterMappingsResponse = {
  integrationId: 'ncentral';
  mappings: NcentralFilterMapping[];
};

type NcentralFiltersResponse = {
  integrationId: 'ncentral';
  filters: NcentralFilter[];
};

type CreateUsageOverridePayload = {
  customerId?: string;
  agreementId?: string;
  sourceVendorProductKey: string;
  targetVendorProductKey: string;
  dimensionFilters?: DimensionMap;
  targetDimensions?: DimensionMap;
  reason?: string;
};

type CreateReconciliationAdjustmentPayload = {
  customerId?: string;
  agreementId?: string;
  productCode: string;
  productName?: string;
  lineType?: string;
  adjustmentType: 'less-count';
  quantity: number;
  reason?: string;
};

type ProductMappingCandidate = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
  status: MappingStatus;
  confidence: string;
  target: ProductMappingTarget;
  matchScore: number;
  additionCount: number;
  customerCount?: number;
  reason: string;
  evidence: MappingEvidence[];
};

type ProductMapping = ProductMappingCandidate & {
  id: string;
  targetIndex: number;
  mappingSource: string;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
};

type MappingStateResponse = {
  vendorId: IntegrationId;
  summary: {
    accountMappings: number;
    approvedAccountMappings: number;
    accountCandidates: number;
    accountCandidatesNeedingReview: number;
    productMappings: number;
    approvedProductMappings: number;
    productCandidates: number;
    productBundles: number;
    unmappedSnapshots: number;
  };
  accountMappings: AccountMapping[];
  accountCandidates: AccountMappingCandidate[];
  productMappings: ProductMapping[];
  productCandidates: ProductMappingCandidate[];
  productBundles: ProductBundle[];
  customerOptions: MappingCustomerOption[];
};

type ProductMappingCustomerAddition = {
  id: string;
  connectWiseAdditionId?: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  additionStatus: string;
  updatedAt?: string;
};

type ProductMappingCustomer = {
  externalAccountId: string;
  externalAccountName: string;
  vendorQuantity: number;
  observedAt?: string;
  customerId?: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  agreementStatus?: string;
  additions: ProductMappingCustomerAddition[];
};

type ProductMappingCustomerReview = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
  customerCount: number;
  customers: ProductMappingCustomer[];
};

type IntegrationAction = 'test' | 'sync' | 'sync-users' | 'sync-licenses';
type IntegrationActionKey = `${IntegrationId}:${IntegrationAction}`;
const liveIntegrationIds: ReadonlySet<IntegrationId> = new Set([
  'connectwise',
  'cove',
  'ncentral',
  'microsoft-365',
  'opentext-appriver',
]);
const mappingIntegrationIds: ReadonlySet<IntegrationId> = new Set([
  'cove',
  'ncentral',
  'microsoft-365',
  'opentext-appriver',
]);

const clientProfiles: Record<string, ClientProfile> = {};

const productRules: ProductRule[] = [
  {
    product: 'Microsoft 365 Business Premium',
    vendor: 'Microsoft',
    cwCode: 'M365-BP',
    basis: 'User license',
    bundle: 'Modern Workplace',
    rule: 'Bill active seats, exclude shared mailboxes',
    confidence: 96,
  },
  {
    product: 'Complete Endpoint Protection',
    vendor: 'SentinelOne',
    cwCode: 'S1-COMPLETE',
    basis: 'Managed endpoint',
    bundle: 'Security Stack',
    rule: 'Pin ConnectWise count when vendor lags under 7 days',
    confidence: 91,
  },
  {
    product: 'SaaS Protection - Shared Mailbox',
    vendor: 'Datto',
    cwCode: 'DATTO-SMBX',
    basis: 'Mailbox',
    bundle: 'Cloud Continuity',
    rule: 'Require manual review on mailbox type changes',
    confidence: 78,
  },
  {
    product: 'Auvik Network Monitoring',
    vendor: 'Pax8',
    cwCode: 'AUVIK-SITE',
    basis: 'Site',
    bundle: 'Network Operations',
    rule: 'Roll up device-level invoices into site count',
    confidence: 99,
  },
  {
    product: 'Teams Phone Standard',
    vendor: 'Microsoft',
    cwCode: 'TEAMS-PHONE',
    basis: 'User license',
    bundle: 'Modern Workplace',
    rule: 'Exclude trial and grace period users',
    confidence: 84,
  },
];

const imports = [
  { file: 'microsoft-june-invoice.csv', vendor: 'Microsoft', rows: 624, matched: 602, exceptions: 22, status: 'Review' },
  { file: 'sentinelone-usage.csv', vendor: 'SentinelOne', rows: 311, matched: 298, exceptions: 13, status: 'Ready' },
  { file: 'pax8-marketplace.csv', vendor: 'Pax8', rows: 842, matched: 836, exceptions: 6, status: 'Ready' },
  { file: 'datto-saas.csv', vendor: 'Datto', rows: 188, matched: 171, exceptions: 17, status: 'Review' },
];

const agreements = [
  { customer: 'Northstar Dental Group', agreement: 'Managed Services - Premium', products: 31, exposure: 1540, nextAction: 'Approve M365 seats' },
  { customer: 'Harbor Ridge Logistics', agreement: 'Security Stack Bundle', products: 18, exposure: -925, nextAction: 'Review vendor credit' },
  { customer: 'Clearwater Legal', agreement: 'Cloud Continuity', products: 12, exposure: 396, nextAction: 'Resolve mailbox mapping' },
  { customer: 'Cedar Valley Schools', agreement: 'Education Security', products: 24, exposure: 610, nextAction: 'Confirm campus scope' },
];

const syncRuns = [
  { source: 'ConnectWise additions', time: '8:41 AM', result: '1,824 records', status: 'Complete' },
  { source: 'Microsoft commercial invoice', time: '8:18 AM', result: '624 rows', status: 'Review' },
  { source: 'SentinelOne usage', time: '7:52 AM', result: '311 rows', status: 'Complete' },
  { source: 'Datto SaaS export', time: 'Yesterday', result: '188 rows', status: 'Review' },
];

const workflow = [
  { label: 'Vendor data', value: 'Latest sync', icon: Database, state: 'done' },
  { label: 'CW Data', value: 'Last sync', icon: FileUp, state: 'done' },
  { label: 'Discrepancies', value: '0 review', icon: Link2, state: 'active' },
  { label: 'Client review', value: '6 groups', icon: Users, state: 'ready' },
  { label: 'Unresolved exposure', value: '$0', icon: CircleDollarSign, state: 'idle' },
];

const navItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'reconcile', label: 'Reconcile', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'imports', label: 'Imports', icon: Upload },
  { id: 'agreements', label: 'Agreements', icon: Building2 },
  { id: 'audit', label: 'Audit', icon: History },
];

const utilityNavItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'settings', label: 'Settings', icon: Settings },
];

const defaultView: View = 'reconcile';

const viewPaths: Record<View, string> = {
  reconcile: '/reconcile',
  integrations: '/integrations',
  mappings: '/mappings',
  reports: '/reports',
  imports: '/imports',
  agreements: '/agreements',
  audit: '/audit',
  settings: '/settings',
};

const reportSections: Array<{ id: ReportSection; label: string; enabled: boolean; description: string }> = [
  {
    id: 'raw-sync',
    label: 'Raw Sync Viewer',
    enabled: true,
    description: 'Inspect saved raw sync rows by integration and sync date',
  },
  {
    id: 'product-profitability',
    label: 'Product Profitability',
    enabled: true,
    description: 'Track net product profit by active integration across the last 12 months',
  },
];

const reconciliationVendorIds: IntegrationId[] = ['cove', 'ncentral', 'microsoft-365', 'opentext-appriver'];
const reconciliationVendors = ['All', 'Cove Data Protection', 'N-able N-central', 'Microsoft 365', 'AppRiver - OpenText'];
const noAgreementSyncValue = '__no_agreement_sync__';

const integrationSettingsStates: IntegrationSettingsState[] = [];

const demoIntegrationValidations = validateIntegrationRegistry(integrationSettingsStates);

function hasLiveIntegrationActions(integrationId: IntegrationId) {
  return liveIntegrationIds.has(integrationId);
}

function hasMappingWorkspace(integrationId: IntegrationId) {
  return mappingIntegrationIds.has(integrationId);
}

function isImplementedIntegration(integrationId: IntegrationId) {
  return liveIntegrationIds.has(integrationId);
}

function sortIntegrationsForDisplay(integrations: Integration[]) {
  const statusRank: Record<IntegrationStatus, number> = {
    connected: 0,
    degraded: 1,
    'not-configured': 2,
  };

  return [...integrations].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    const statusDifference = statusRank[left.status] - statusRank[right.status];
    return statusDifference || left.name.localeCompare(right.name);
  });
}

function buildIntegrations(runtimeIntegrations?: RuntimeIntegrationSummary[]): Integration[] {
  const runtimeById = new Map((runtimeIntegrations ?? []).map((integration) => [integration.integrationId, integration]));
  const definitions = integrationSettingsRegistry.map((definition) => {
    const runtime = runtimeById.get(definition.integrationId);

    return {
      ...runtime,
      ...definition,
      nonSecrets: runtime?.nonSecrets ?? {},
      secretSource: runtime?.secretSource,
      keyVaultUrl: runtime?.keyVaultUrl,
      operationalStatus: runtime?.operationalStatus,
      validation:
        runtime?.validation ??
        demoIntegrationValidations.find((item) => item.integrationId === definition.integrationId),
    };
  });

  return definitions.map((definition) => {
    const validation = definition.validation;
    const operationalStatus = definition.operationalStatus;
    const records =
      typeof operationalStatus?.storedRecordCount === 'number'
        ? operationalStatus.storedRecordCount
        : operationalStatus?.lastSyncRecordsWritten;

    return {
      id: definition.integrationId,
      name: definition.displayName,
      category: definition.category,
      status: validation?.configuredStatus ?? 'not-configured',
      auth: formatAuthMode(definition.authMode),
      description: definition.description,
      lastSync: formatDateTime(operationalStatus?.lastSyncCompletedAt ?? operationalStatus?.lastSyncAt),
      lastTest: formatDateTime(validation?.lastTestedAt),
      lastSyncStatus: operationalStatus?.lastSyncStatus,
      frequency: formatFrequency(definition.syncFrequency),
      records: typeof records === 'number' ? records.toLocaleString() : undefined,
      secretSource: definition.secretSource,
      keyVaultUrl: definition.keyVaultUrl,
      scopes: definition.scopes,
      enabled: validation?.configuredStatus !== 'not-configured',
      endpoint: definition.endpoint,
      nonSecrets: definition.nonSecrets ?? {},
      requiredSecrets: definition.requiredSecrets,
      requiredNonSecrets: definition.requiredNonSecrets,
      missingSecrets: validation?.missingSecrets.map((setting) => setting.label) ?? [],
      missingNonSecrets: validation?.missingNonSecrets.map((setting) => setting.label) ?? [],
      webhookSupported: definition.webhookSupported,
      lastTestedAt: validation?.lastTestedAt,
    };
  });
}

function formatCurrency(value: number) {
  const prefix = value < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(value).toLocaleString()}`;
}

function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    currency: 'USD',
    maximumFractionDigits: 1,
    notation: 'compact',
    style: 'currency',
  }).format(value);
}

function formatMoneyAmount(value?: { amount: number; currency: string }) {
  if (!value) return '-';
  const prefix = value.amount < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(value.amount).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatMoneyValue(value: number) {
  return formatMoneyAmount({ amount: value, currency: 'USD' });
}

function formatAuthMode(value: string) {
  if (value === 'api-key') return 'api key';
  return value;
}

function formatFrequency(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function integrationName(integrationId: IntegrationId) {
  return integrationSettingsRegistry.find((integration) => integration.integrationId === integrationId)?.displayName ?? integrationId;
}

function formatDateTime(value?: string) {
  if (!value) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMonthLabel(value: string, includeYear = false) {
  const parsed = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
  };
  if (includeYear) {
    options.year = '2-digit';
  }

  return parsed.toLocaleString([], options);
}

function formatMonthRange(months: string[]) {
  if (months.length === 0) {
    return 'No months';
  }

  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? formatMonthLabel(first, true) : `${formatMonthLabel(first, true)} - ${formatMonthLabel(last, true)}`;
}

function formatSyncSummary(syncDate: string | undefined, count: number | undefined, unit: string) {
  const dateLabel = syncDate ?? 'No sync date';
  const countLabel = typeof count === 'number' ? `${count.toLocaleString()} ${unit}` : 'No count';
  return `${dateLabel} / ${countLabel}`;
}

function rawSyncDatasetForVendorData(integrationId: IntegrationId): RawSyncDataset | undefined {
  return integrationId === 'microsoft-365' ? 'users' : undefined;
}

function formatVendorRawSyncSummary(details: RawSyncDetailsResponse) {
  const timestamp = formatDateTime(details.syncRun.completedAt ?? details.syncRun.startedAt) ?? 'Unknown sync date';
  return `${timestamp} / ${details.rows.length.toLocaleString()} raw rows`;
}

function rawSyncRowsForClient(rows: RawSyncRow[], client: ClientGroup) {
  const customerIdMatches = rows.filter((row) => String(row.CustomerId ?? '') === client.customerId);
  if (customerIdMatches.length > 0) {
    return customerIdMatches;
  }

  const targetCustomer = normalizeRawSyncCustomerLabel(client.customer);
  return rows.filter((row) =>
    rawSyncCustomerLabels(row).some((label) => normalizeRawSyncCustomerLabel(label) === targetCustomer),
  );
}

function rawSyncCustomerLabels(row: RawSyncRow) {
  return [
    row.Customer,
    row.AppRiverCustomer,
    row.NcentralCustomer,
    row.CoveCustomer,
    row.TenantName,
  ]
    .map(rawSyncStringValue)
    .filter((value): value is string => Boolean(value));
}

function rawSyncStringValue(value: string | number | boolean | null | undefined) {
  return typeof value === 'undefined' || value === null ? undefined : String(value);
}

function normalizeRawSyncCustomerLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

type ExcelCellValue = string | number;

function exportExcelFile(filename: string, rows: Array<Record<string, ExcelCellValue>>) {
  if (rows.length === 0) {
    throw new Error('There is no reconciliation data to export.');
  }

  const columns = Object.keys(rows[0]);
  const workbook = createXlsxWorkbook(columns, rows, 'Reconciliation');
  const blob = new Blob([workbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createXlsxWorkbook(columns: string[], rows: Array<Record<string, ExcelCellValue>>, sheetName: string) {
  const sheetXml = worksheetXml(columns, rows);
  return createZipArchive([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXmlAttribute(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml },
  ]);
}

function worksheetXml(columns: string[], rows: Array<Record<string, ExcelCellValue>>) {
  const lastCell = `${columnName(columns.length)}${rows.length + 1}`;
  const autoFilterRef = `A1:${lastCell}`;
  const headerRow = rowXml(1, columns.map((column) => ({ value: column, style: 1 })));
  const dataRows = rows.map((row, rowIndex) =>
    rowXml(
      rowIndex + 2,
      columns.map((column) => ({ value: row[column] ?? '' })),
    ),
  );
  const widths = columns.map((column, index) => {
    const maxWidth = Math.min(
      64,
      Math.max(
        column.length,
        ...rows.map((row) => String(row[column] ?? '').length),
      ) + 2,
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${maxWidth}" customWidth="1"/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${widths.join('')}</cols>
  <sheetData>${headerRow}${dataRows.join('')}</sheetData>
  <autoFilter ref="${autoFilterRef}"/>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function rowXml(rowNumber: number, cells: Array<{ value: ExcelCellValue; style?: number }>) {
  return `<row r="${rowNumber}">${cells
    .map((cell, index) => cellXml(`${columnName(index + 1)}${rowNumber}`, cell.value, cell.style))
    .join('')}</row>`;
}

function cellXml(reference: string, value: ExcelCellValue, style = 0) {
  const styleAttribute = style > 0 ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  }

  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t>${escapeXmlText(String(value))}</t></is></c>`;
}

function columnName(index: number) {
  let column = '';
  let current = index;
  while (current > 0) {
    current -= 1;
    column = String.fromCharCode(65 + (current % 26)) + column;
    current = Math.floor(current / 26);
  }
  return column;
}

function escapeXmlText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function createZipArchive(files: Array<{ name: string; text: string }>) {
  const encoder = new TextEncoder();
  const localFileParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  const { date, time } = zipDateTime(new Date());
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const checksum = crc32(data);
    const localHeader = zipLocalHeader(nameBytes, data.length, checksum, time, date);
    localFileParts.push(localHeader, nameBytes, data);
    centralDirectoryParts.push(zipCentralDirectoryHeader(nameBytes, data.length, checksum, time, date, offset));
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = concatBytes(centralDirectoryParts);
  const endRecord = zipEndOfCentralDirectory(files.length, centralDirectory.length, offset);
  return concatBytes([...localFileParts, centralDirectory, endRecord]);
}

function zipLocalHeader(nameBytes: Uint8Array, size: number, checksum: number, time: number, date: number) {
  return bytesFromNumbers([
    0x50, 0x4b, 0x03, 0x04,
    ...uint16(20),
    ...uint16(0x0800),
    ...uint16(0),
    ...uint16(time),
    ...uint16(date),
    ...uint32(checksum),
    ...uint32(size),
    ...uint32(size),
    ...uint16(nameBytes.length),
    ...uint16(0),
  ]);
}

function zipCentralDirectoryHeader(
  nameBytes: Uint8Array,
  size: number,
  checksum: number,
  time: number,
  date: number,
  offset: number,
) {
  return concatBytes([
    bytesFromNumbers([
      0x50, 0x4b, 0x01, 0x02,
      ...uint16(20),
      ...uint16(20),
      ...uint16(0x0800),
      ...uint16(0),
      ...uint16(time),
      ...uint16(date),
      ...uint32(checksum),
      ...uint32(size),
      ...uint32(size),
      ...uint16(nameBytes.length),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(0),
      ...uint32(offset),
    ]),
    nameBytes,
  ]);
}

function zipEndOfCentralDirectory(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  return bytesFromNumbers([
    0x50, 0x4b, 0x05, 0x06,
    ...uint16(0),
    ...uint16(0),
    ...uint16(fileCount),
    ...uint16(fileCount),
    ...uint32(centralDirectorySize),
    ...uint32(centralDirectoryOffset),
    ...uint16(0),
  ]);
}

function zipDateTime(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

function uint16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function bytesFromNumbers(values: number[]) {
  return new Uint8Array(values);
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = crc32Table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function exportFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'reconciliation';
}

function formatReportRunLabel(run: RawSyncRun) {
  const timestamp = formatDateTime(run.completedAt ?? run.startedAt) ?? 'Unknown date';
  return `${timestamp} / ${run.status} / ${run.recordsWritten.toLocaleString()} rows`;
}

function formatReportCell(column: string, value: string | number | boolean | null | undefined) {
  if (value === null || typeof value === 'undefined') return '';

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  if (typeof value === 'number') {
    if (moneyReportColumns.has(column)) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  if (dateReportColumns.has(column)) {
    return formatDateTime(value) ?? value;
  }

  return value;
}

const moneyReportColumns = new Set([
  'unitPrice',
  'unitCost',
  'extPrice',
  'extCost',
  'margin',
  'prorateCost',
  'proratePrice',
  'extendedProrateCost',
  'extendedProratePrice',
]);

const dateReportColumns = new Set(['effectiveDate', '_info']);
const reportDefaultColumnWidth = 180;
const reportMinimumColumnWidth = 110;
const reportMaximumColumnWidth = 640;
const reportColumnKeyboardStep = 24;

type ReportColumnResizeState = {
  column: string;
  pointerId: number;
  startWidth: number;
  startX: number;
};

const profitabilityPalette = [
  '#0d8f80',
  '#3478a7',
  '#df604f',
  '#6b61c9',
  '#e4a42f',
  '#2f6f4e',
  '#9b5c2e',
  '#44546f',
  '#b54b72',
  '#5d7c2c',
];

function clampReportColumnWidth(width: number) {
  return Math.min(reportMaximumColumnWidth, Math.max(reportMinimumColumnWidth, Math.round(width)));
}

function profitabilityPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function statusLabel(status: IssueStatus) {
  switch (status) {
    case 'matched':
      return 'Matched';
    case 'needs-review':
      return 'Needs review';
    case 'not-billable':
      return 'Not billable';
    case 'ready':
      return 'Ready';
    case 'approved':
      return 'Approved';
    case 'blocked':
      return 'Blocked';
    case 'skipped':
      return 'Skipped';
    default:
      return status;
  }
}

function isReviewableIssue(issue: ReconcileIssue) {
  return issue.status === 'needs-review' || issue.status === 'blocked';
}

function issueMatchesSearchAndVendor(issue: ReconcileIssue, query: string, vendorFilter: string) {
  const searchable = `${issue.customer} ${issue.product} ${issue.vendor} ${issue.agreement}`.toLowerCase();
  return searchable.includes(query.toLowerCase()) && (vendorFilter === 'All' || issue.vendor === vendorFilter);
}

function compareCustomerNames(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function compareIssuesByCustomer(left: ReconcileIssue, right: ReconcileIssue) {
  return compareCustomerNames(left.customer, right.customer);
}

function initialView(): View {
  return viewFromLocation(window.location);
}

function viewFromLocation(location: Location): View {
  const queryView = new URLSearchParams(location.search).get('view');
  if (isView(queryView)) return queryView;

  const pathView = viewFromPath(location.pathname);
  return pathView ?? defaultView;
}

function viewFromPath(pathname: string): View | null {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const matchedEntry = Object.entries(viewPaths).find(([, path]) => path === normalizedPath);
  return matchedEntry ? (matchedEntry[0] as View) : normalizedPath === '/' ? defaultView : null;
}

function isView(value: string | null): value is View {
  return Boolean(value && [...navItems, ...utilityNavItems].some((item) => item.id === value));
}

function urlForView(view: View) {
  return viewPaths[view];
}

function currentRouteMatchesView(view: View) {
  const currentView = viewFromPath(window.location.pathname);
  const queryView = new URLSearchParams(window.location.search).get('view');
  return currentView === view && (!queryView || queryView === view);
}

function updateRouteForView(view: View) {
  if (currentRouteMatchesView(view)) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = urlForView(view);
  nextUrl.searchParams.delete('view');
  window.history.pushState({ view }, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

function groupIssuesByClient(issues: ReconcileIssue[]): ClientGroup[] {
  const groups = new Map<string, ReconcileIssue[]>();

  issues.forEach((issue) => {
    const existing = groups.get(issue.customer) ?? [];
    groups.set(issue.customer, [...existing, issue]);
  });

  return Array.from(groups.entries())
    .map(([customer, clientIssues]) => {
      const profile = clientProfiles[customer];
      const firstIssue = clientIssues[0];
      const fallbackProfile: ClientProfile = {
        customer,
        accountId: firstIssue.accountId ?? 'Unmapped',
        agreement: firstIssue.agreement,
        owner: firstIssue.owner,
        primaryDriver: 'Agreement additions',
        seats: Math.max(...clientIssues.map((issue) => issue.invoiceCount)),
        devices: Math.max(...clientIssues.map((issue) => issue.sourceCount)),
        stackHealth: clientIssues.some((issue) => issue.status === 'blocked') ? 'blocked' : 'watch',
        dependencyRules: ['Review related agreement additions before approving product-level changes.'],
        stacks: [
          {
            name: firstIssue.family,
            driver: 'Product count',
            products: clientIssues.map((issue) => issue.product),
            summary: 'No saved dependency profile exists yet for this client.',
          },
        ],
      };
      const clientProfile = profile ?? fallbackProfile;

      return {
        ...clientProfile,
        customerId: firstIssue.clientId,
        agreementId: firstIssue.agreementId,
        issues: clientIssues,
        vendors: Array.from(new Set(clientIssues.map((issue) => issue.vendor))),
        exposure: clientIssues.reduce((total, issue) => total + issue.amount, 0),
        changeCount: clientIssues.length,
        readyCount: clientIssues.filter((issue) => issue.status === 'ready').length,
        blockedCount: clientIssues.filter((issue) => issue.status === 'blocked').length,
        needsReviewCount: clientIssues.filter((issue) => issue.status === 'needs-review').length,
      };
    })
    .sort((left, right) => compareCustomerNames(left.customer, right.customer));
}

function groupIssuesByVendor(issues: ReconcileIssue[]) {
  const groups = new Map<string, ReconcileIssue[]>();
  issues.forEach((issue) => {
    const existing = groups.get(issue.vendor) ?? [];
    groups.set(issue.vendor, [...existing, issue]);
  });
  return Array.from(groups.entries());
}

async function fetchRuntimeIntegrations() {
  const response = await fetch('/api/integrations');

  if (!response.ok) {
    throw new Error(`Integration status load failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as Partial<RuntimeIntegrationsResponse>;
  return {
    integrations: body.integrations ?? [],
    nonSecretStorage: body.nonSecretStorage ?? 'not-configured',
    missingDatabaseSettings: body.missingDatabaseSettings ?? [],
  } satisfies RuntimeIntegrationsResponse;
}

async function fetchManagedUsers() {
  const response = await fetch('/api/users');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `User load failed with HTTP ${response.status}.`));
  }

  return body as unknown as ManagedUsersResponse;
}

async function createManagedUserRequest(payload: {
  email: string;
  displayName: string;
  role: AppRole;
  status: ManagedUserStatus;
}) {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `User save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { user: ManagedAppUser; created: boolean };
}

async function updateManagedUserRequest(
  userId: string,
  payload: {
    displayName: string;
    role: AppRole;
    status: ManagedUserStatus;
  },
) {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `User update failed with HTTP ${response.status}.`));
  }

  return body as unknown as { user: ManagedAppUser };
}

async function fetchRawSyncRuns(integrationId: IntegrationId, dataset?: RawSyncDataset) {
  const params = new URLSearchParams({
    integrationId,
  });
  if (integrationId === 'microsoft-365' && dataset) {
    params.set('dataset', dataset);
  }

  const response = await fetch(`/api/reports/raw-sync-runs?${params.toString()}`);
  const body = await responseJson(response);
  const runs = Array.isArray(body.runs) ? (body.runs as RawSyncRun[]) : [];

  if (!response.ok) {
    throw new Error(String(body.error ?? `Raw sync run load failed with HTTP ${response.status}.`));
  }

  return {
    reportType: 'raw-sync',
    integrationId,
    dataset: typeof body.dataset === 'string' ? (body.dataset as RawSyncDataset) : undefined,
    runs,
  } satisfies RawSyncRunsResponse;
}

async function fetchRawSyncDetails(
  integrationId: IntegrationId,
  syncRunId: string,
  dataset?: RawSyncDataset,
  options: { customerId?: string } = {},
) {
  const params = new URLSearchParams({
    integrationId,
  });
  if (integrationId === 'microsoft-365' && dataset) {
    params.set('dataset', dataset);
  }
  if (options.customerId) {
    params.set('customerId', options.customerId);
  }

  const response = await fetch(`/api/reports/raw-sync-runs/${encodeURIComponent(syncRunId)}/details?${params.toString()}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Raw sync detail load failed with HTTP ${response.status}.`));
  }

  return body as unknown as RawSyncDetailsResponse;
}

async function fetchProductProfitabilityReport() {
  const response = await fetch('/api/reports/product-profitability');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product profitability report load failed with HTTP ${response.status}.`));
  }

  return body as unknown as ProductProfitabilityReportResponse;
}

async function fetchAgreementAdditions(agreementId: string) {
  const response = await fetch(`/api/reconciliation/agreements/${encodeURIComponent(agreementId)}/additions`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Agreement additions load failed with HTTP ${response.status}.`));
  }

  return body as unknown as AgreementAdditionsResponse;
}

async function fetchMappingState(integrationId: IntegrationId) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Mapping load failed with HTTP ${response.status}.`));
  }

  return body as unknown as MappingStateResponse;
}

async function fetchProductMappingCustomers(integrationId: IntegrationId, vendorProductKey: string) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/products/${encodeURIComponent(vendorProductKey)}/customers`,
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product customer review load failed with HTTP ${response.status}.`));
  }

  return body as unknown as ProductMappingCustomerReview;
}

async function fetchReconciliationRun(integrationId: IntegrationId) {
  const response = await fetch(`/api/reconciliation/${encodeURIComponent(integrationId)}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Reconciliation failed with HTTP ${response.status}.`));
  }

  return body as unknown as ReconciliationRunResponse;
}

async function postMappingAction(integrationId: IntegrationId, action: 'automap' | 'apply' | 'approve-suggested') {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ actor: 'frontend' }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Mapping action failed with HTTP ${response.status}.`));
  }

  return body;
}

async function saveAccountMapping(
  integrationId: IntegrationId,
  externalAccountId: string,
  payload: {
    status: MappingStatus;
    customerId?: string;
    agreementId?: string;
    externalAccountName?: string;
  },
) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/accounts/${encodeURIComponent(externalAccountId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Account mapping save failed with HTTP ${response.status}.`));
  }
}

async function saveProductMapping(
  integrationId: IntegrationId,
  vendorProductKey: string,
  payload: {
    status: MappingStatus;
    targetProducts?: ProductMappingTarget[];
  },
) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/products/${encodeURIComponent(vendorProductKey)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product mapping save failed with HTTP ${response.status}.`));
  }
}

async function saveProductBundleRequest(
  integrationId: IntegrationId,
  payload: {
    bundleKey?: string;
    bundleName: string;
    components: ProductBundleComponent[];
    targetProduct: ProductMappingTarget;
    active?: boolean;
  },
) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/bundles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product bundle save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { vendorId: IntegrationId; bundle: ProductBundle };
}

async function deactivateProductBundleRequest(integrationId: IntegrationId, bundleKey: string) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/bundles/${encodeURIComponent(bundleKey)}/deactivate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reviewedBy: 'frontend' }),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product bundle deactivation failed with HTTP ${response.status}.`));
  }
}

async function searchProductCatalog(integrationId: IntegrationId, query: string) {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('limit', '25');
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/product-catalog?${params.toString()}`,
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product catalog search failed with HTTP ${response.status}.`));
  }

  return body as unknown as ProductCatalogSearchResponse;
}

async function fetchUsageOverrides(integrationId: IntegrationId) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/overrides`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Usage overrides load failed with HTTP ${response.status}.`));
  }

  return body as unknown as UsageOverridesResponse;
}

async function createUsageOverrideRequest(integrationId: IntegrationId, payload: CreateUsageOverridePayload) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/overrides`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Usage override save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { vendorId: IntegrationId; override: UsageOverride };
}

async function deactivateUsageOverrideRequest(integrationId: IntegrationId, overrideId: string) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/overrides/${encodeURIComponent(overrideId)}/deactivate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reviewedBy: 'frontend' }),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Usage override deactivation failed with HTTP ${response.status}.`));
  }
}

async function fetchNcentralFilters() {
  const response = await fetch('/api/mappings/ncentral/ncentral-filters');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `N-central filter load failed with HTTP ${response.status}.`));
  }

  return body as unknown as NcentralFiltersResponse;
}

async function fetchNcentralFilterMappings() {
  const response = await fetch('/api/mappings/ncentral/filter-mappings');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `N-central filter mapping load failed with HTTP ${response.status}.`));
  }

  return body as unknown as NcentralFilterMappingsResponse;
}

async function saveNcentralFilterMappingRequest(payload: Partial<NcentralFilterMapping>) {
  const response = await fetch('/api/mappings/ncentral/filter-mappings', {
    method: payload.id ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `N-central filter mapping save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { integrationId: 'ncentral'; mapping: NcentralFilterMapping };
}

async function createReconciliationAdjustmentRequest(
  integrationId: IntegrationId,
  payload: CreateReconciliationAdjustmentPayload,
) {
  const response = await fetch(`/api/reconciliation/${encodeURIComponent(integrationId)}/adjustments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Reconciliation adjustment save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { vendorId: IntegrationId; adjustment: ReconciliationAdjustment };
}

async function responseJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function syncRequestBodyForIntegration(integrationId: IntegrationId, dataset?: RawSyncDataset) {
  if (integrationId === 'cove') {
    return {
      pageSize: 10000,
      maxPages: 1,
    };
  }

  if (integrationId === 'ncentral') {
    return {
      pageSize: 500,
      maxPages: 100,
    };
  }

  if (integrationId === 'microsoft-365') {
    return {
      dataset: dataset ?? 'users',
      pageSize: 100,
      maxPages: 25,
    };
  }

  if (integrationId === 'opentext-appriver') {
    return {
      pageSize: 1000,
      maxPages: 100,
      subscriptionPageSize: 100,
      subscriptionMaxPages: 25,
    };
  }

  return {
    pageSize: 100,
    maxPages: 50,
  };
}

function formatIntegrationTestSuccess(integrationId: IntegrationId, body: Record<string, unknown>) {
  if (integrationId === 'connectwise') {
    const companyCount = numberField(body, 'companyCount')?.toLocaleString() ?? 'unknown';
    return `Connection OK. ConnectWise returned ${companyCount} companies.`;
  }

  if (integrationId === 'cove') {
    const partnerId = numberField(body, 'partnerId');
    return partnerId ? `Connection OK. Cove authenticated for partner ID ${partnerId}.` : 'Connection OK. Cove authenticated.';
  }

  if (integrationId === 'ncentral') {
    const filterCount = numberField(body, 'filterCount')?.toLocaleString() ?? '0';
    return `Connection OK. N-central returned ${filterCount} filters.`;
  }

  if (integrationId === 'microsoft-365') {
    const tenantCount = numberField(body, 'tenantCount')?.toLocaleString() ?? '0';
    return `Connection OK. Microsoft Graph discovered ${tenantCount} customer tenants and read licenses from the first tenant.`;
  }

  if (integrationId === 'opentext-appriver') {
    const customerCount = numberField(body, 'customerCount')?.toLocaleString() ?? '0';
    const firstCustomerSubscriptionCount = numberField(body, 'firstCustomerSubscriptionCount')?.toLocaleString() ?? '0';
    return `Connection OK. AppRiver returned ${customerCount} customers and ${firstCustomerSubscriptionCount} subscriptions for the first customer.`;
  }

  return 'Connection OK.';
}

function formatIntegrationSyncSuccess(integrationId: IntegrationId, body: Record<string, unknown>) {
  if (body.status === 'queued' || body.queued === true) {
    if (integrationId === 'opentext-appriver') {
      const customersRead = numberField(body, 'customersRead')?.toLocaleString() ?? '0';
      const queuedCustomers = numberField(body, 'queuedCustomers')?.toLocaleString() ?? '0';
      const skippedPartnerCustomers = numberField(body, 'skippedPartnerCustomers')?.toLocaleString() ?? '0';
      if (customersRead !== '0' || queuedCustomers !== '0' || skippedPartnerCustomers !== '0') {
        return `Queued AppRiver sync. Gathered ${customersRead} customers and queued ${queuedCustomers} for serial processing (${skippedPartnerCustomers} partner customers skipped).`;
      }
    }

    if (integrationId === 'microsoft-365') {
      const dataset = body.dataset === 'licenses' ? 'license' : 'user';
      return `Queued Microsoft 365 ${dataset} sync. Results will appear after the background worker finishes.`;
    }

    return `Queued ${integrationName(integrationId)} sync. Results will appear after the background worker finishes.`;
  }

  if (integrationId === 'connectwise') {
    const recordsWritten =
      numberField(body, 'additionsWritten')?.toLocaleString() ??
      numberField(body, 'recordsWritten')?.toLocaleString() ??
      '0';
    const recordsRead =
      numberField(body, 'additionsRead')?.toLocaleString() ??
      numberField(body, 'recordsRead')?.toLocaleString() ??
      '0';
    const agreementsRead = numberField(body, 'agreementsRead')?.toLocaleString() ?? 'unknown';
    return `Sync complete. Stored ${recordsWritten} of ${recordsRead} agreement additions across ${agreementsRead} agreements.`;
  }

  if (integrationId === 'cove') {
    const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
    const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
    const mapped = numberField(body, 'mappedSnapshots')?.toLocaleString() ?? '0';
    const unmapped = numberField(body, 'unmappedSnapshots')?.toLocaleString() ?? '0';
    const skipped = numberField(body, 'skippedSnapshots')?.toLocaleString() ?? '0';
    return `Sync complete. Stored ${recordsWritten} of ${recordsRead} Cove snapshots (${mapped} mapped, ${unmapped} unmapped, ${skipped} skipped).`;
  }

  if (integrationId === 'ncentral') {
    const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
    const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
    const mapped = numberField(body, 'mappedSnapshots')?.toLocaleString() ?? '0';
    const unmapped = numberField(body, 'unmappedSnapshots')?.toLocaleString() ?? '0';
    const enriched = numberField(body, 'detailEnrichedSnapshots')?.toLocaleString() ?? '0';
    return `Sync complete. Stored ${recordsWritten} of ${recordsRead} N-central devices (${mapped} mapped, ${unmapped} unmapped, ${enriched} check-ins enriched).`;
  }

  if (integrationId === 'microsoft-365') {
    const dataset = body.dataset === 'licenses' ? 'licenses' : 'users';
    const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
    const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
    const tenantsRead = numberField(body, 'tenantsRead')?.toLocaleString() ?? '0';
    if (dataset === 'licenses') {
      const companySubscriptionsRead = numberField(body, 'companySubscriptionsRead')?.toLocaleString() ?? '0';
      const failedTenants = numberField(body, 'failedTenants')?.toLocaleString() ?? '0';
      const failedProductSubscriptionTenants = numberField(body, 'failedProductSubscriptionTenants')?.toLocaleString() ?? '0';
      return `License sync complete. Stored ${recordsWritten} Microsoft 365 product subscription rows across ${tenantsRead} tenants (${recordsRead} SKU/subscription records read, ${companySubscriptionsRead} directory subscriptions, ${failedTenants} SKU failures, ${failedProductSubscriptionTenants} subscription-detail failures).`;
    }

    const usersRead = numberField(body, 'usersRead')?.toLocaleString() ?? '0';
    const mapped = numberField(body, 'mappedSnapshots')?.toLocaleString() ?? '0';
    const unmapped = numberField(body, 'unmappedSnapshots')?.toLocaleString() ?? '0';
    const failedTenants = numberField(body, 'failedTenants')?.toLocaleString() ?? '0';
    return `User sync complete. Stored ${recordsWritten} of ${recordsRead} Microsoft 365 assigned license rows across ${tenantsRead} tenants and ${usersRead} users (${mapped} mapped, ${unmapped} unmapped, ${failedTenants} tenant failures).`;
  }

  if (integrationId === 'opentext-appriver') {
    const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
    const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
    const customersRead = numberField(body, 'customersRead')?.toLocaleString() ?? '0';
    const mapped = numberField(body, 'mappedSnapshots')?.toLocaleString() ?? '0';
    const unmapped = numberField(body, 'unmappedSnapshots')?.toLocaleString() ?? '0';
    const failedSubscriptions = numberField(body, 'failedSubscriptions')?.toLocaleString() ?? '0';
    return `Sync complete. Stored ${recordsWritten} of ${recordsRead} AppRiver subscription rows across ${customersRead} customers (${mapped} mapped, ${unmapped} unmapped, ${failedSubscriptions} subscription failures).`;
  }

  const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
  const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
  return `Sync complete. Stored ${recordsWritten} of ${recordsRead} records.`;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reconcileIssuesFromRun(run: ReconciliationRunResponse): ReconcileIssue[] {
  const sourceName = integrationName(run.vendorId);
  return run.lines.map((line) => {
    const customer = line.customerName ?? `Customer ${shortId(line.clientId)}`;
    const agreement = line.agreementName ?? `Agreement ${shortId(line.agreementId)}`;
    const actionLabel =
      line.status === 'matched'
        ? 'No change needed; vendor and ConnectWise counts match.'
        : line.status === 'not-billable'
          ? 'Track source usage only; no ConnectWise billable addition is generated.'
          : line.writeAction === 'create-addition'
            ? 'Create a ConnectWise agreement addition after review.'
            : line.writeAction === 'update-addition'
              ? 'Update the ConnectWise agreement addition after review.'
              : 'Review the matching ConnectWise additions before writing changes.';
    const confidence =
      line.status === 'matched' ? 99 : line.status === 'not-billable' ? 95 : line.writeAction === 'review-required' ? 70 : 90;

    return {
      id: line.id,
      vendorId: run.vendorId,
      clientId: line.clientId,
      agreementId: line.agreementId,
      accountId: line.connectWiseCompanyId,
      customer,
      agreement,
      vendor: sourceName,
      product: line.productName,
      family: line.lineType === 'usage-add-on' ? 'Usage add-on' : 'Base count',
      serviceCode: line.productCode,
      lineType: line.lineType,
      measuredSourceCount: line.sourceQuantity,
      sourceCount: line.proposedQuantity,
      invoiceCount: line.agreementQuantity,
      proposedCount: line.proposedQuantity,
      amount: line.financialImpact.amount,
      unit: line.unit,
      confidence,
      owner: 'Finance',
      age: 'Current run',
      reason: line.reason,
      status: line.status,
      recommendation: actionLabel,
      lastSeen: run.syncRunId ? `${sourceName} sync ${shortId(run.syncRunId)}` : `No completed ${sourceName} sync`,
      audit: [
        `${sourceName} proposed quantity: ${line.proposedQuantity.toLocaleString()} ${line.unit}.`,
        line.sourceQuantity !== line.proposedQuantity
          ? `Measured source usage: ${line.sourceQuantity.toLocaleString()}.`
          : undefined,
        `ConnectWise agreement quantity: ${line.agreementQuantity.toLocaleString()} ${line.unit}.`,
        ...line.evidence.map((item) => `${item.label}: ${item.value}.`),
      ].filter((entry): entry is string => Boolean(entry)),
      devices: line.devices ?? [],
      adjustments: line.adjustments ?? [],
    };
  });
}

function buildReconciliationExportRows(
  issues: ReconcileIssue[],
  additionsByAgreement: Map<string, AgreementAddition[]>,
  selectedSourceName: string,
) {
  return [...issues]
    .sort(
      (left, right) =>
        left.customer.localeCompare(right.customer) ||
        left.agreement.localeCompare(right.agreement) ||
        left.vendor.localeCompare(right.vendor) ||
        left.product.localeCompare(right.product),
    )
    .map((issue) => {
      const agreementAdditions = additionsByAgreement.get(issue.agreementId) ?? [];
      const matchedAdditions = agreementAdditions.filter((addition) => productCodesMatch(addition.productCode, issue.serviceCode));
      const otherAdditions = agreementAdditions.filter((addition) => !productCodesMatch(addition.productCode, issue.serviceCode));
      const lessCountAdjustments = issue.adjustments.filter(
        (adjustment) => adjustment.active && adjustment.adjustmentType === 'less-count',
      );
      const manualLessCount = lessCountAdjustments.reduce((total, adjustment) => total + adjustment.quantity, 0);
      const cwLessIncluded = matchedAdditions.reduce((total, addition) => total + (addition.lessIncluded ?? 0), 0);

      return {
        'Selected Reconciliation': selectedSourceName,
        Customer: issue.customer,
        Agreement: issue.agreement,
        Vendor: issue.vendor,
        Product: issue.product,
        'Product Code': issue.serviceCode,
        'Line Type': issue.family,
        Unit: issue.unit,
        'Vendor Measured Count': issue.measuredSourceCount,
        'Manual Less Count': manualLessCount,
        'Manual Less Count Reasons': lessCountAdjustments.map((adjustment) => adjustment.reason).filter(Boolean).join('; '),
        'Proposed Count After Less Count': issue.proposedCount,
        'CW Count': issue.invoiceCount,
        Delta: issue.proposedCount - issue.invoiceCount,
        'Financial Impact': issue.amount,
        Status: statusLabel(issue.status),
        Recommendation: issue.recommendation,
        Reason: issue.reason,
        Evidence: issue.audit.join(' | '),
        'Vendor Device Rows': issue.devices.length,
        'CW Addition IDs': matchedAdditions.map((addition) => addition.connectWiseAdditionId).join('; '),
        'CW Addition Products': matchedAdditions.map(formatAgreementAdditionLabel).join('; '),
        'CW Addition Quantity': sumAgreementAdditionField(matchedAdditions, 'quantity'),
        'CW Less Included': cwLessIncluded,
        'CW Billed Quantity': sumAgreementAdditionField(matchedAdditions, 'billedQuantity'),
        'CW Unit Price': matchedAdditions.map((addition) => formatMoneyAmount(addition.unitPrice)).join('; '),
        'CW Unit Cost': formatOptionalNumberList(matchedAdditions.map((addition) => addition.unitCost)),
        'CW Bill Customer': formatOptionalStringList(matchedAdditions.map((addition) => addition.billCustomer)),
        'CW UOM': formatOptionalStringList(matchedAdditions.map((addition) => addition.uom)),
        'CW Effective Date': formatOptionalStringList(matchedAdditions.map((addition) => addition.effectiveDate)),
        'CW Taxable': formatOptionalStringList(matchedAdditions.map((addition) => addition.taxableFlag)),
        'CW Purchase Item': formatOptionalStringList(matchedAdditions.map((addition) => addition.purchaseItemFlag)),
        'CW Special Order': formatOptionalStringList(matchedAdditions.map((addition) => addition.specialOrderFlag)),
        'CW Prorate Current Period': formatOptionalStringList(
          matchedAdditions.map((addition) => addition.prorateCurrentPeriodFlag),
        ),
        'CW Invoice Description': formatOptionalStringList(matchedAdditions.map((addition) => addition.invoiceDescription)),
        'CW Description': formatOptionalStringList(matchedAdditions.map((addition) => addition.description)),
        'CW Addition Status': formatOptionalStringList(matchedAdditions.map((addition) => addition.additionStatus)),
        'CW Addition Updated': formatOptionalStringList(
          matchedAdditions.map((addition) => formatDateTime(addition.updatedAt) ?? undefined),
        ),
        'Other CW Agreement Additions': otherAdditions.map(formatAgreementAdditionLabel).join('; '),
      };
    });
}

function productCodesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function formatAgreementAdditionLabel(addition: AgreementAddition) {
  const details = [
    `qty ${addition.quantity}`,
    typeof addition.lessIncluded === 'number' ? `less ${addition.lessIncluded}` : undefined,
    addition.unitPrice ? `price ${formatMoneyAmount(addition.unitPrice)}` : undefined,
    addition.billCustomer ? `bill ${addition.billCustomer}` : undefined,
  ].filter(Boolean);

  return `${addition.productName} (${addition.productCode}${addition.connectWiseAdditionId ? ` / ${addition.connectWiseAdditionId}` : ''})${
    details.length > 0 ? ` - ${details.join(', ')}` : ''
  }`;
}

function sumAgreementAdditionField(additions: AgreementAddition[], field: 'quantity' | 'billedQuantity') {
  return additions.reduce((total, addition) => total + (addition[field] ?? 0), 0);
}

function formatOptionalStringList(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join('; ');
}

function formatOptionalNumberList(values: Array<number | undefined>) {
  return values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => value.toString())
    .join('; ');
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function App() {
  const [view, setView] = useState<View>(() => initialView());
  const [issues, setIssues] = useState<ReconcileIssue[]>([]);
  const [expandedClientNames, setExpandedClientNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [selectedReconciliationIntegrationId, setSelectedReconciliationIntegrationId] = useState<IntegrationId | ''>('');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(true);
  const [productFilter, setProductFilter] = useState('All products');
  const [autoPost, setAutoPost] = useState(false);
  const [ticketClient, setTicketClient] = useState<ClientGroup | null>(null);
  const [ticketIssueIds, setTicketIssueIds] = useState<string[]>([]);
  const [ticketNotes, setTicketNotes] = useState('');
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [integrationTab, setIntegrationTab] = useState<IntegrationTab>('credentials');
  const [integrationSaveMessage, setIntegrationSaveMessage] = useState<string | null>(null);
  const [savingIntegrationId, setSavingIntegrationId] = useState<IntegrationId | null>(null);
  const [runtimeIntegrations, setRuntimeIntegrations] = useState<RuntimeIntegrationSummary[] | null>(null);
  const [integrationRuntimeMeta, setIntegrationRuntimeMeta] = useState<{
    nonSecretStorage: RuntimeIntegrationsResponse['nonSecretStorage'];
    missingDatabaseSettings: string[];
    lastLoadedAt?: string;
  }>({
    nonSecretStorage: 'not-configured',
    missingDatabaseSettings: [],
  });
  const [integrationLoadState, setIntegrationLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [integrationLoadMessage, setIntegrationLoadMessage] = useState<string>('Loading live integration status...');
  const [integrationActionMessages, setIntegrationActionMessages] = useState<Partial<Record<IntegrationId, string>>>({});
  const [busyIntegrationAction, setBusyIntegrationAction] = useState<IntegrationActionKey | null>(null);
  const [reportSection, setReportSection] = useState<ReportSection>('raw-sync');
  const [selectedRawSyncIntegrationId, setSelectedRawSyncIntegrationId] = useState<IntegrationId | ''>('');
  const [selectedRawSyncDataset, setSelectedRawSyncDataset] = useState<RawSyncDataset>('users');
  const [rawSyncRuns, setRawSyncRuns] = useState<RawSyncRun[]>([]);
  const [selectedRawSyncRunId, setSelectedRawSyncRunId] = useState<string>('');
  const [rawSyncDetails, setRawSyncDetails] = useState<RawSyncDetailsResponse | null>(null);
  const [rawSyncLoadState, setRawSyncLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [rawSyncMessage, setRawSyncMessage] = useState('Select an integration to view saved raw sync rows.');
  const [rawSyncColumnFilters, setRawSyncColumnFilters] = useState<Record<string, string>>({});
  const [productProfitabilityReport, setProductProfitabilityReport] =
    useState<ProductProfitabilityReportResponse | null>(null);
  const [productProfitabilityLoadState, setProductProfitabilityLoadState] =
    useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [productProfitabilityMessage, setProductProfitabilityMessage] = useState(
    'Load net profit by active integration.',
  );
  const [selectedMappingIntegrationId, setSelectedMappingIntegrationId] = useState<IntegrationId>('cove');
  const [mappingState, setMappingState] = useState<MappingStateResponse | null>(null);
  const [usageOverrides, setUsageOverrides] = useState<UsageOverride[]>([]);
  const [ncentralFilters, setNcentralFilters] = useState<NcentralFilter[]>([]);
  const [ncentralFilterMappings, setNcentralFilterMappings] = useState<NcentralFilterMapping[]>([]);
  const [mappingLoadState, setMappingLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [mappingMessage, setMappingMessage] = useState('Load an integration to review account and product mappings.');
  const [busyMappingAction, setBusyMappingAction] = useState<string | null>(null);
  const [reconciliationLoadState, setReconciliationLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [reconciliationMessage, setReconciliationMessage] = useState('Choose a vendor.');
  const [reconciliationRunMeta, setReconciliationRunMeta] = useState<ReconciliationRunMeta | null>(null);
  const [reconciliationProductOptions, setReconciliationProductOptions] = useState<ReconciliationProductOption[]>([]);
  const [exportingReconciliationReport, setExportingReconciliationReport] = useState(false);
  const [agreementAdditionsByAgreement, setAgreementAdditionsByAgreement] = useState<Record<string, AgreementAddition[]>>({});
  const [agreementAdditionsSelection, setAgreementAdditionsSelection] = useState<AgreementAdditionsSelection | null>(null);
  const [agreementAdditions, setAgreementAdditions] = useState<AgreementAddition[]>([]);
  const [agreementAdditionsLoadState, setAgreementAdditionsLoadState] = useState<'loading' | 'ready' | 'failed'>('ready');
  const [agreementAdditionsMessage, setAgreementAdditionsMessage] = useState('');
  const [manualOverrideIssue, setManualOverrideIssue] = useState<ReconcileIssue | null>(null);
  const [manualOverrideMessage, setManualOverrideMessage] = useState('');
  const [savingManualOverride, setSavingManualOverride] = useState(false);

  const navigateToView = (nextView: View) => {
    setView(nextView);
    updateRouteForView(nextView);
  };

  const refreshRuntimeIntegrations = async () => {
    setIntegrationLoadState('loading');
    setIntegrationLoadMessage('Refreshing live integration status...');

    try {
      const response = await fetchRuntimeIntegrations();
      setRuntimeIntegrations(response.integrations);
      setIntegrationRuntimeMeta({
        nonSecretStorage: response.nonSecretStorage,
        missingDatabaseSettings: response.missingDatabaseSettings,
        lastLoadedAt: new Date().toISOString(),
      });
      setIntegrationLoadState('ready');
      setIntegrationLoadMessage('Live integration status loaded.');
      return response;
    } catch (error) {
      setRuntimeIntegrations(null);
      setIntegrationRuntimeMeta({
        nonSecretStorage: 'not-configured',
        missingDatabaseSettings: [],
      });
      setIntegrationLoadState('failed');
      setIntegrationLoadMessage(error instanceof Error ? error.message : 'Unable to load live integration status.');
      return null;
    }
  };

  const loadRawSyncRuns = async (integrationId: IntegrationId, dataset: RawSyncDataset = 'users') => {
    setRawSyncLoadState('loading');
    setRawSyncMessage('Loading raw sync dates...');
    setRawSyncRuns([]);
    setSelectedRawSyncRunId('');
    setRawSyncDetails(null);
    setRawSyncColumnFilters({});

    try {
      const response = await fetchRawSyncRuns(integrationId, dataset);
      setRawSyncRuns(response.runs);
      setRawSyncLoadState('ready');
      setRawSyncMessage(
        response.runs.length > 0
          ? 'Select a sync date to load raw rows.'
          : `No raw sync runs found for ${integrationName(integrationId)} yet.`,
      );
      return response;
    } catch (error) {
      setRawSyncRuns([]);
      setRawSyncDetails(null);
      setSelectedRawSyncRunId('');
      setRawSyncLoadState('failed');
      setRawSyncMessage(error instanceof Error ? error.message : 'Unable to load raw sync dates.');
      return null;
    }
  };

  const loadRawSyncDetails = async (integrationId: IntegrationId, syncRunId: string, dataset: RawSyncDataset = 'users') => {
    setRawSyncLoadState('loading');
    setRawSyncMessage('Loading raw sync details...');
    setRawSyncDetails(null);
    setRawSyncColumnFilters({});

    try {
      const details = await fetchRawSyncDetails(integrationId, syncRunId, dataset);
      setRawSyncDetails(details);
      setRawSyncLoadState('ready');
      setRawSyncMessage(`Loaded ${details.summary.rowCount.toLocaleString()} raw sync rows.`);
    } catch (error) {
      setRawSyncDetails(null);
      setRawSyncLoadState('failed');
      setRawSyncMessage(error instanceof Error ? error.message : 'Unable to load raw sync details.');
    }
  };

  const refreshRawSyncReport = async () => {
    if (!selectedRawSyncIntegrationId) {
      setRawSyncLoadState('idle');
      setRawSyncMessage('Select an integration to view saved raw sync rows.');
      return;
    }

    const selectedSyncRunId = selectedRawSyncRunId;
    setRawSyncLoadState('loading');
    setRawSyncMessage(selectedSyncRunId ? 'Refreshing selected sync...' : 'Refreshing sync dates...');

    try {
      const response = await fetchRawSyncRuns(selectedRawSyncIntegrationId, selectedRawSyncDataset);
      setRawSyncRuns(response.runs);

      if (!selectedSyncRunId) {
        setRawSyncDetails(null);
        setRawSyncLoadState('ready');
        setRawSyncMessage(
          response.runs.length > 0
            ? 'Select a sync date to load raw rows.'
            : `No raw sync runs found for ${integrationName(selectedRawSyncIntegrationId)} yet.`,
        );
        return;
      }

      const selectedStillExists = response.runs.some((run) => run.id === selectedSyncRunId);
      if (!selectedStillExists) {
        setSelectedRawSyncRunId('');
        setRawSyncDetails(null);
        setRawSyncColumnFilters({});
        setRawSyncLoadState('ready');
        setRawSyncMessage('The selected sync run is no longer available. Select another sync date.');
        return;
      }

      const details = await fetchRawSyncDetails(selectedRawSyncIntegrationId, selectedSyncRunId, selectedRawSyncDataset);
      setRawSyncDetails(details);
      setRawSyncColumnFilters({});
      setRawSyncLoadState('ready');
      setRawSyncMessage(`Refreshed ${details.summary.rowCount.toLocaleString()} raw sync rows.`);
    } catch (error) {
      setRawSyncLoadState('failed');
      setRawSyncMessage(error instanceof Error ? error.message : 'Unable to refresh raw sync status.');
    }
  };

  const loadProductProfitabilityReport = async () => {
    setProductProfitabilityLoadState('loading');
    setProductProfitabilityMessage('Loading product profitability...');

    try {
      const report = await fetchProductProfitabilityReport();
      setProductProfitabilityReport(report);
      setProductProfitabilityLoadState('ready');
      setProductProfitabilityMessage(
        report.integrations.length > 0
          ? `Loaded ${report.summary.integrationCount.toLocaleString()} active integrations across ${report.months.length.toLocaleString()} months.`
          : 'No active integrations have profitability data yet.',
      );
      return report;
    } catch (error) {
      setProductProfitabilityReport(null);
      setProductProfitabilityLoadState('failed');
      setProductProfitabilityMessage(error instanceof Error ? error.message : 'Unable to load product profitability.');
      return null;
    }
  };

  const loadCustomerVendorData = async (
    client: ClientGroup,
    vendorId: IntegrationId,
    vendor: string,
  ): Promise<VendorDataSelection> => {
    const dataset = rawSyncDatasetForVendorData(vendorId);
    let syncRunId =
      vendorId === selectedReconciliationIntegrationId
        ? reconciliationRunMeta?.syncRunId
        : undefined;

    if (!syncRunId) {
      const runsResponse = await fetchRawSyncRuns(vendorId, dataset);
      syncRunId = runsResponse.runs[0]?.id;
    }

    if (!syncRunId) {
      throw new Error(`No completed ${integrationName(vendorId)} raw sync is available yet.`);
    }

    const details = await fetchRawSyncDetails(vendorId, syncRunId, dataset, {
      customerId: client.customerId,
    });
    const rows = rawSyncRowsForClient(details.rows, client);
    const columns = details.columns.filter((column) => column !== 'CustomerId');

    return {
      customer: client.customer,
      vendorId,
      vendor,
      status: 'ready',
      syncSummary: formatVendorRawSyncSummary(details),
      message:
        rows.length > 0
          ? `${rows.length.toLocaleString()} raw sync rows loaded for ${client.customer}.`
          : `No raw sync rows found for ${client.customer} in this sync run.`,
      columns,
      rows,
    };
  };

  const loadMappings = async (integrationId: IntegrationId) => {
    setMappingLoadState('loading');
    setMappingMessage('Loading mapping state...');

    try {
      const state = await fetchMappingState(integrationId);
      setMappingState(state);
      setMappingLoadState('ready');
      setMappingMessage(
        `Loaded ${state.summary.accountMappings.toLocaleString()} account mappings, ${state.summary.productMappings.toLocaleString()} product mappings, and ${(state.summary.productBundles ?? 0).toLocaleString()} product bundles.`,
      );
      return state;
    } catch (error) {
      setMappingState(null);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load mappings.');
      return null;
    }
  };

  const loadUsageOverrides = async (integrationId: IntegrationId) => {
    try {
      const response = await fetchUsageOverrides(integrationId);
      setUsageOverrides(response.overrides);
      return response;
    } catch (error) {
      setUsageOverrides([]);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load usage overrides.');
      return null;
    }
  };

  const loadNcentralFilterWorkspace = async () => {
    try {
      const [filtersResponse, mappingsResponse] = await Promise.all([
        fetchNcentralFilters().catch(() => ({ integrationId: 'ncentral' as const, filters: [] })),
        fetchNcentralFilterMappings(),
      ]);
      setNcentralFilters(filtersResponse.filters);
      setNcentralFilterMappings(mappingsResponse.mappings);
    } catch (error) {
      setNcentralFilters([]);
      setNcentralFilterMappings([]);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load N-central filter mappings.');
    }
  };

  const refreshMappingWorkspace = async (integrationId: IntegrationId) => {
    const state = await loadMappings(integrationId);
    await loadUsageOverrides(integrationId);
    if (integrationId === 'ncentral') {
      await loadNcentralFilterWorkspace();
    } else {
      setNcentralFilters([]);
      setNcentralFilterMappings([]);
    }
    return state;
  };

  const loadVendorReconciliation = async (integrationId: IntegrationId) => {
    const sourceName = integrationName(integrationId);
    setReconciliationLoadState('loading');
    setReconciliationMessage(`Comparing latest ${sourceName} sync against ConnectWise additions...`);

    try {
      const run = await fetchReconciliationRun(integrationId);
      const nextIssues = reconcileIssuesFromRun(run);
      const nextReviewIssues = nextIssues.filter(isReviewableIssue);
      const firstSelectedIssue =
        [...nextReviewIssues].sort(compareIssuesByCustomer)[0] ?? [...nextIssues].sort(compareIssuesByCustomer)[0];
      setIssues(nextIssues);
      setReconciliationRunMeta({
        syncRunId: run.syncRunId,
        generatedAt: run.generatedAt,
        snapshotCount: run.snapshotCount,
        agreementAdditionCount: run.agreementAdditionCount,
        productCheckCount: nextIssues.length,
      });
      setReconciliationProductOptions(run.productOptions ?? []);
      setExpandedClientNames(firstSelectedIssue?.customer ? [firstSelectedIssue.customer] : []);
      setReconciliationLoadState('ready');
      setReconciliationMessage(
        nextReviewIssues.length > 0
          ? `${nextReviewIssues.length.toLocaleString()} discrepancies ready for review.`
          : run.syncRunId
            ? `No ${sourceName} discrepancies found in the latest sync.`
            : `No completed ${sourceName} sync is available yet.`,
      );
      return run;
    } catch (error) {
      setIssues([]);
      setReconciliationRunMeta(null);
      setReconciliationProductOptions([]);
      setExpandedClientNames([]);
      setReconciliationLoadState('failed');
      setReconciliationMessage(error instanceof Error ? error.message : `Unable to load ${sourceName} reconciliation.`);
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    refreshRuntimeIntegrations().then(() => {
      if (cancelled) {
        return;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromLocation(window.location));
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (view !== 'reports' || reportSection !== 'raw-sync' || !selectedRawSyncIntegrationId) {
      return;
    }

    void loadRawSyncRuns(selectedRawSyncIntegrationId, selectedRawSyncDataset);
  }, [reportSection, selectedRawSyncDataset, selectedRawSyncIntegrationId, view]);

  useEffect(() => {
    if (view !== 'reports' || reportSection !== 'raw-sync' || !selectedRawSyncIntegrationId || !selectedRawSyncRunId) {
      return;
    }

    void loadRawSyncDetails(selectedRawSyncIntegrationId, selectedRawSyncRunId, selectedRawSyncDataset);
  }, [reportSection, selectedRawSyncDataset, selectedRawSyncIntegrationId, selectedRawSyncRunId, view]);

  useEffect(() => {
    if (view !== 'reports' || reportSection !== 'product-profitability') {
      return;
    }

    void loadProductProfitabilityReport();
  }, [reportSection, view]);

  useEffect(() => {
    if (view !== 'mappings') {
      return;
    }

    void refreshMappingWorkspace(selectedMappingIntegrationId);
  }, [selectedMappingIntegrationId, view]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const matchesSearchAndVendor = issueMatchesSearchAndVendor(issue, query, vendorFilter);
      const matchesStatus = !needsReviewOnly || isReviewableIssue(issue);
      return matchesSearchAndVendor && matchesStatus;
    });
  }, [issues, needsReviewOnly, query, vendorFilter]);

  const clientGroups = useMemo(() => groupIssuesByClient(filteredIssues), [filteredIssues]);
  const integrations = useMemo(() => buildIntegrations(runtimeIntegrations ?? undefined), [runtimeIntegrations]);
  const pendingCount = issues.filter(isReviewableIssue).length;
  const selectedReconciliationIntegration = integrations.find((integration) => integration.id === selectedReconciliationIntegrationId);
  const connectWiseIntegration = integrations.find((integration) => integration.id === 'connectwise');
  const vendorDataSummary = formatSyncSummary(
    selectedReconciliationIntegration?.lastSync,
    reconciliationRunMeta?.snapshotCount,
    'snapshots',
  );
  const connectWiseSyncSummary = connectWiseIntegration?.lastSync
    ? `Last sync ${connectWiseIntegration.lastSync}`
    : 'No sync date';
  const totalExposure = issues
    .filter(isReviewableIssue)
    .reduce((total, issue) => total + issue.amount, 0);
  const visibleRules = productRules.filter((rule) => {
    if (productFilter === 'All products') return true;
    if (productFilter === 'Bundled') return rule.bundle !== 'None';
    if (productFilter === 'Pinned') return rule.rule.toLowerCase().includes('pin');
    return rule.confidence < 90;
  });

  useEffect(() => {
    const validClientNames = new Set(clientGroups.map((client) => client.customer));
    setExpandedClientNames((currentNames) => currentNames.filter((clientName) => validClientNames.has(clientName)));
  }, [clientGroups]);

  const approveIssue = (issueId: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        issue.id === issueId ? { ...issue, status: 'approved', owner: 'Finance' } : issue,
      ),
    );
  };

  const approveClient = (customer: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        issue.customer === customer && (issue.status === 'ready' || issue.status === 'needs-review')
          ? { ...issue, status: 'approved', owner: 'Finance' }
          : issue,
      ),
    );
  };

  const skipIssue = (issueId: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        issue.id === issueId ? { ...issue, status: 'skipped', owner: 'Finance' } : issue,
      ),
    );
  };

  const exportSelectedReconciliationReport = async () => {
    if (!selectedReconciliationIntegrationId || issues.length === 0) {
      window.alert('Choose a vendor with reconciliation data before exporting a report.');
      return;
    }

    setExportingReconciliationReport(true);

    try {
      const sourceName = integrationName(selectedReconciliationIntegrationId);
      const agreementIds = [...new Set(issues.map((issue) => issue.agreementId))];
      const nextCache: Record<string, AgreementAddition[]> = {};
      const additionEntries = await Promise.all(
        agreementIds.map(async (agreementId) => {
          const cached = agreementAdditionsByAgreement[agreementId];
          if (cached) {
            return [agreementId, cached] as const;
          }

          const response = await fetchAgreementAdditions(agreementId);
          nextCache[agreementId] = response.additions;
          return [agreementId, response.additions] as const;
        }),
      );

      if (Object.keys(nextCache).length > 0) {
        setAgreementAdditionsByAgreement((current) => ({ ...current, ...nextCache }));
      }

      const allSelectedReconciliationIssues = issues;
      const rows = buildReconciliationExportRows(allSelectedReconciliationIssues, new Map(additionEntries), sourceName);
      exportExcelFile(`msp-harmony-${safeFilePart(sourceName)}-reconciliation-${exportFileDate()}.xlsx`, rows);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to export reconciliation report.');
    } finally {
      setExportingReconciliationReport(false);
    }
  };

  const openTicketModal = (client: ClientGroup) => {
    const fullClient =
      groupIssuesByClient(issues.filter((issue) => issue.customer === client.customer && isReviewableIssue(issue)))[0] ??
      client;
    setTicketClient(fullClient);
    setTicketIssueIds([]);
    setTicketNotes('');
  };

  const closeTicketModal = () => {
    setTicketClient(null);
    setTicketIssueIds([]);
    setTicketNotes('');
  };

  const openAgreementAdditionsModal = async (client: ClientGroup) => {
    const selection = {
      customer: client.customer,
      agreementId: client.agreementId,
      agreement: client.agreement,
      accountId: client.accountId,
    };
    setAgreementAdditionsSelection(selection);
    setAgreementAdditions([]);
    setAgreementAdditionsLoadState('loading');
    setAgreementAdditionsMessage('Loading CW data...');

    try {
      const response = await fetchAgreementAdditions(client.agreementId);
      setAgreementAdditions(response.additions);
      setAgreementAdditionsByAgreement((current) => ({
        ...current,
        [client.agreementId]: response.additions,
      }));
      setAgreementAdditionsLoadState('ready');
      setAgreementAdditionsMessage(
        response.additions.length > 0
          ? `Loaded ${response.additions.length.toLocaleString()} active CW additions.`
          : 'No active CW additions found for this agreement.',
      );
    } catch (error) {
      setAgreementAdditions([]);
      setAgreementAdditionsLoadState('failed');
      setAgreementAdditionsMessage(error instanceof Error ? error.message : 'Unable to load CW data.');
    }
  };

  const closeAgreementAdditionsModal = () => {
    setAgreementAdditionsSelection(null);
    setAgreementAdditions([]);
    setAgreementAdditionsLoadState('ready');
    setAgreementAdditionsMessage('');
  };

  const toggleTicketIssue = (issueId: string) => {
    setTicketIssueIds((currentIds) =>
      currentIds.includes(issueId)
        ? currentIds.filter((currentId) => currentId !== issueId)
        : [...currentIds, issueId],
    );
  };

  const createInvestigationTicket = () => {
    if (ticketIssueIds.length === 0) return;
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        ticketIssueIds.includes(issue.id) ? { ...issue, status: 'blocked', owner: 'Investigation' } : issue,
      ),
    );
    closeTicketModal();
  };

  const openIntegrationModal = (integration: Integration) => {
    setSelectedIntegration(integration);
    setIntegrationTab('credentials');
    setIntegrationSaveMessage(null);
  };

  const closeIntegrationModal = () => {
    setSelectedIntegration(null);
    setIntegrationSaveMessage(null);
  };

  const saveIntegrationSettings = async (payload: IntegrationSettingsPayload) => {
    setSavingIntegrationId(payload.integrationId);
    setIntegrationSaveMessage('Saving settings to PostgreSQL and writing secret fields to Azure Key Vault...');

    try {
      const response = await fetch(`/api/integrations/${payload.integrationId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await responseJson(response);

      if (!response.ok) {
        throw new Error(String(body.error ?? `Settings save failed with HTTP ${response.status}.`));
      }

      const storage =
        body.nonSecretStorage === 'database'
          ? 'Non-secret settings were saved to PostgreSQL.'
          : 'Database settings are not configured yet, so non-secret fields still need .env or PostgreSQL.';
      const writtenSecrets = Array.isArray(body.writtenKeyVaultSecretNames)
        ? body.writtenKeyVaultSecretNames.length
        : 0;
      const secretMessage =
        writtenSecrets > 0
          ? `${writtenSecrets} Key Vault secret${writtenSecrets === 1 ? '' : 's'} updated.`
          : 'No secret values were changed.';
      setIntegrationSaveMessage(`Saved. ${secretMessage} ${storage}`);
      const latest = await refreshRuntimeIntegrations();
      const refreshedIntegration = buildIntegrations(latest?.integrations).find((integration) => integration.id === payload.integrationId);
      if (refreshedIntegration) {
        setSelectedIntegration(refreshedIntegration);
      }
    } catch (error) {
      setIntegrationSaveMessage(error instanceof Error ? `Save failed: ${error.message}` : 'Save failed.');
    } finally {
      setSavingIntegrationId(null);
    }
  };

  const testIntegration = async (integrationId: IntegrationId) => {
    const actionKey: IntegrationActionKey = `${integrationId}:test`;
    setBusyIntegrationAction(actionKey);
    setIntegrationActionMessages((messages) => ({
      ...messages,
      [integrationId]: 'Testing connection...',
    }));

    try {
      const response = await fetch(`/api/integrations/${integrationId}/test`, {
        method: 'POST',
      });
      const body = await responseJson(response);

      if (!response.ok) {
        throw new Error(String(body.error ?? `Test failed with HTTP ${response.status}.`));
      }

      setIntegrationActionMessages((messages) => ({
        ...messages,
        [integrationId]: formatIntegrationTestSuccess(integrationId, body),
      }));
      await refreshRuntimeIntegrations();
    } catch (error) {
      setIntegrationActionMessages((messages) => ({
        ...messages,
        [integrationId]: error instanceof Error ? error.message : 'Connection test failed.',
      }));
    } finally {
      setBusyIntegrationAction(null);
    }
  };

  const syncIntegration = async (integrationId: IntegrationId, dataset?: RawSyncDataset) => {
    const actionKey: IntegrationActionKey =
      integrationId === 'microsoft-365' && dataset === 'licenses'
        ? `${integrationId}:sync-licenses`
        : integrationId === 'microsoft-365'
          ? `${integrationId}:sync-users`
          : `${integrationId}:sync`;
    setBusyIntegrationAction(actionKey);
    setIntegrationActionMessages((messages) => ({
      ...messages,
      [integrationId]:
        integrationId === 'microsoft-365' && dataset === 'licenses'
          ? 'Starting Microsoft 365 license sync...'
          : integrationId === 'microsoft-365'
            ? 'Starting Microsoft 365 user sync...'
            : 'Starting sync...',
    }));

    try {
      const response = await fetch(`/api/integrations/${integrationId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequestBodyForIntegration(integrationId, dataset)),
      });
      const body = await responseJson(response);
      const queuedSync = body.status === 'queued' || body.queued === true;

      if (!response.ok) {
        throw new Error(String(body.error ?? `Sync failed with HTTP ${response.status}.`));
      }

      setIntegrationActionMessages((messages) => ({
        ...messages,
        [integrationId]: formatIntegrationSyncSuccess(integrationId, body),
      }));
      await refreshRuntimeIntegrations();
      if (!queuedSync && selectedRawSyncIntegrationId === integrationId) {
        await loadRawSyncRuns(integrationId, selectedRawSyncDataset);
      }
      if (!queuedSync && integrationId === selectedReconciliationIntegrationId && reconciliationVendorIds.includes(integrationId)) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setIntegrationActionMessages((messages) => ({
        ...messages,
        [integrationId]: error instanceof Error ? error.message : 'Sync failed.',
      }));
    } finally {
      setBusyIntegrationAction(null);
    }
  };

  const runMappingAction = async (action: 'automap' | 'apply' | 'approve-suggested') => {
    setBusyMappingAction(action);
    setMappingMessage(
      action === 'automap'
        ? 'Refreshing automap suggestions...'
        : action === 'approve-suggested'
          ? 'Approving suggested customer mappings...'
          : 'Applying approved mappings to snapshots...',
    );

    try {
      const body = await postMappingAction(selectedMappingIntegrationId, action);
      const summary =
        action === 'automap'
          ? `Automap complete. Suggested ${numberField(body, 'suggestedMappings') ?? 0}, needs review ${numberField(body, 'reviewMappings') ?? 0}, already mapped ${numberField(body, 'skippedExisting') ?? 0}.`
          : action === 'approve-suggested'
            ? `Approved ${numberField(body, 'approvedAccountMappings') ?? 0} suggested customer mappings.`
            : `Applied mappings. Updated ${numberField(body, 'accountSnapshotsUpdated') ?? 0} account links and ${numberField(body, 'productSnapshotsUpdated') ?? 0} product links.`;
      setMappingMessage(summary);
      await loadMappings(selectedMappingIntegrationId);
      if (selectedRawSyncIntegrationId === selectedMappingIntegrationId && selectedRawSyncRunId) {
        await loadRawSyncDetails(selectedRawSyncIntegrationId, selectedRawSyncRunId, selectedRawSyncDataset);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Mapping action failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const approveAccountCandidate = async (candidate: AccountMappingCandidate) => {
    if (!candidate.customerId) {
      setMappingMessage('This account candidate needs a customer before approval.');
      return;
    }

    setBusyMappingAction(`account:${candidate.externalAccountId}`);
    try {
      await saveAccountMapping(candidate.vendorId, candidate.externalAccountId, {
        status: 'approved',
        customerId: candidate.customerId,
        agreementId: candidate.agreementId,
        externalAccountName: candidate.externalAccountName,
      });
      await loadMappings(candidate.vendorId);
      setMappingMessage(`Approved mapping for ${candidate.externalAccountName}.`);
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Account mapping approval failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveManualAccountMapping = async (
    account: AccountMappingCandidate,
    customerId: string,
    agreementId: string,
  ) => {
    if (!customerId) {
      setMappingMessage('Choose a ConnectWise customer before saving.');
      return false;
    }

    setBusyMappingAction(`account:${account.externalAccountId}`);
    try {
      await saveAccountMapping(account.vendorId, account.externalAccountId, {
        status: 'approved',
        customerId,
        agreementId: agreementId === noAgreementSyncValue ? undefined : agreementId,
        externalAccountName: account.externalAccountName,
      });
      await loadMappings(account.vendorId);
      setMappingMessage(`Mapped ${account.externalAccountName}.`);
      return true;
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Manual account mapping failed.');
      return false;
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveProductTargets = async (
    integrationId: IntegrationId,
    vendorProductKey: string,
    targetProducts: ProductMappingTarget[],
  ) => {
    if (targetProducts.length === 0) {
      setMappingMessage('Choose at least one ConnectWise product before saving.');
      return;
    }

    setBusyMappingAction(`product:${vendorProductKey}`);
    try {
      await saveProductMapping(integrationId, vendorProductKey, {
        status: 'approved',
        targetProducts,
      });
      await loadMappings(integrationId);
      setMappingMessage(`Saved ${targetProducts.length} product target${targetProducts.length === 1 ? '' : 's'} for ${vendorProductKey}.`);
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Product mapping save failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveProductBundle = async (
    integrationId: IntegrationId,
    payload: {
      bundleKey?: string;
      bundleName: string;
      components: ProductBundleComponent[];
      targetProduct: ProductMappingTarget;
    },
  ) => {
    setBusyMappingAction(payload.bundleKey ? `bundle:${payload.bundleKey}` : 'bundle:new');
    try {
      await saveProductBundleRequest(integrationId, {
        ...payload,
        active: true,
      });
      await loadMappings(integrationId);
      setMappingMessage(`Saved bundle mapping for ${payload.bundleName}.`);
      if (integrationId === selectedReconciliationIntegrationId && reconciliationVendorIds.includes(integrationId)) {
        await loadVendorReconciliation(integrationId);
      }
      return true;
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Product bundle save failed.');
      return false;
    } finally {
      setBusyMappingAction(null);
    }
  };

  const deactivateProductBundle = async (integrationId: IntegrationId, bundleKey: string) => {
    const actionKey = `bundle:${bundleKey}`;
    setBusyMappingAction(actionKey);
    try {
      await deactivateProductBundleRequest(integrationId, bundleKey);
      await loadMappings(integrationId);
      setMappingMessage('Product bundle disabled.');
      if (integrationId === selectedReconciliationIntegrationId && reconciliationVendorIds.includes(integrationId)) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Product bundle deactivation failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveNcentralFilterMapping = async (payload: Partial<NcentralFilterMapping>) => {
    setBusyMappingAction(payload.id ? `ncentral-filter:${payload.id}` : 'ncentral-filter:new');
    setMappingMessage('Saving N-central filter mapping...');

    try {
      await saveNcentralFilterMappingRequest(payload);
      await loadNcentralFilterWorkspace();
      setMappingLoadState('ready');
      setMappingMessage('N-central filter mapping saved.');
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to save N-central filter mapping.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveUsageOverride = async (integrationId: IntegrationId, payload: CreateUsageOverridePayload) => {
    setBusyMappingAction('override:create');
    try {
      await createUsageOverrideRequest(integrationId, payload);
      await loadUsageOverrides(integrationId);
      setMappingMessage('Saved usage override.');
      if (integrationId === selectedReconciliationIntegrationId && reconciliationVendorIds.includes(integrationId)) {
        await loadVendorReconciliation(integrationId);
      }
      return true;
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Usage override save failed.');
      return false;
    } finally {
      setBusyMappingAction(null);
    }
  };

  const deactivateUsageOverride = async (integrationId: IntegrationId, overrideId: string) => {
    const actionKey = `override:${overrideId}`;
    setBusyMappingAction(actionKey);
    try {
      await deactivateUsageOverrideRequest(integrationId, overrideId);
      await loadUsageOverrides(integrationId);
      setMappingMessage('Usage override removed.');
      if (integrationId === selectedReconciliationIntegrationId && reconciliationVendorIds.includes(integrationId)) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Usage override removal failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveLessCountAdjustment = async (issue: ReconcileIssue, quantity: number, reason: string) => {
    setSavingManualOverride(true);
    setManualOverrideMessage('Saving Less Count adjustment...');

    try {
      await createReconciliationAdjustmentRequest(issue.vendorId, {
        customerId: issue.clientId,
        agreementId: issue.agreementId,
        productCode: issue.serviceCode,
        productName: issue.product,
        lineType: issue.lineType,
        adjustmentType: 'less-count',
        quantity,
        reason,
      });
      setManualOverrideMessage('Less Count adjustment saved.');
      await loadVendorReconciliation(issue.vendorId);
      setManualOverrideIssue(null);
      return true;
    } catch (error) {
      setManualOverrideMessage(error instanceof Error ? error.message : 'Less Count adjustment failed.');
      return false;
    } finally {
      setSavingManualOverride(false);
    }
  };

  const remapReconciliationDevice = async (
    issue: ReconcileIssue,
    device: ReconciliationDevice,
    targetVendorProductKey: string,
  ) => {
    const sourceVendorProductKey = device.vendorProductKey;
    if (!sourceVendorProductKey) {
      setManualOverrideMessage('This device does not have a source product key to remap.');
      return false;
    }

    const dimensionFilters = deviceIdentityFilter(device);
    if (Object.keys(dimensionFilters).length === 0) {
      setManualOverrideMessage('This device needs a hostname, account ID, or other stable identifier before it can be remapped.');
      return false;
    }

    setSavingManualOverride(true);
    setManualOverrideMessage('Saving device remap...');

    try {
      await createUsageOverrideRequest(issue.vendorId, {
        customerId: issue.clientId,
        agreementId: issue.agreementId,
        sourceVendorProductKey,
        targetVendorProductKey,
        dimensionFilters,
        reason: `Remapped from ${device.productName} in reconciliation review.`,
      });
      setManualOverrideMessage('Device remap saved.');
      await loadVendorReconciliation(issue.vendorId);
      setManualOverrideIssue(null);
      return true;
    } catch (error) {
      setManualOverrideMessage(error instanceof Error ? error.message : 'Device remap failed.');
      return false;
    } finally {
      setSavingManualOverride(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Layers3 size={22} />
          </div>
          <div>
            <strong>MSP Harmony</strong>
            <span>Billing operations</span>
          </div>
        </div>

        <nav className="nav-list nav-list-primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <div className="nav-group" key={item.id}>
                <a
                  aria-current={view === item.id ? 'page' : undefined}
                  className={view === item.id ? 'nav-item active' : 'nav-item'}
                  href={urlForView(item.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateToView(item.id);
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </a>
                {item.id === 'reports' && view === 'reports' ? (
                  <div className="nav-submenu" role="group" aria-label="Reports submenu">
                    {reportSections.map((report) => (
                      <button
                        className={reportSection === report.id ? 'nav-subitem active' : 'nav-subitem'}
                        disabled={!report.enabled}
                        key={report.id}
                        onClick={() => setReportSection(report.id)}
                        title={report.description}
                        type="button"
                      >
                        {report.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <nav className="nav-list nav-list-utility" aria-label="Application settings">
          {utilityNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                aria-current={view === item.id ? 'page' : undefined}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                href={urlForView(item.id)}
                key={item.id}
                onClick={(event) => {
                  event.preventDefault();
                  navigateToView(item.id);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="title-block">
            <span className="section-kicker">Vendor counts + ConnectWise additions</span>
            <h1>{view === 'reconcile' ? 'Reconciliation command center' : pageTitle(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="button secondary" type="button">
              <Upload size={18} />
              Import invoices
            </button>
          </div>
        </header>

        <main className={view === 'reconcile' ? 'content reconcile-content' : 'content'}>
          {view === 'reconcile' && (
            <ReconcileView
              approveClient={approveClient}
              approveIssue={approveIssue}
              clientGroups={clientGroups}
              connectWiseSyncSummary={connectWiseSyncSummary}
              exportingReport={exportingReconciliationReport}
              expandedClientNames={expandedClientNames}
              filteredIssues={filteredIssues}
              issues={issues}
              needsReviewOnly={needsReviewOnly}
              onExportReport={exportSelectedReconciliationReport}
              onManualOverride={setManualOverrideIssue}
              onOpenAgreementAdditions={(client) => void openAgreementAdditionsModal(client)}
              onOpenTicket={openTicketModal}
              onLoadVendorData={loadCustomerVendorData}
              onRefreshReconciliation={() =>
                selectedReconciliationIntegrationId
                  ? loadVendorReconciliation(selectedReconciliationIntegrationId)
                  : Promise.resolve(null)
              }
              onReconciliationSourceChange={(integrationId) => {
                setSelectedReconciliationIntegrationId(integrationId);
                setVendorFilter('All');
                void loadVendorReconciliation(integrationId);
              }}
              pendingCount={pendingCount}
              query={query}
              reconciliationLoadState={reconciliationLoadState}
              reconciliationMessage={reconciliationMessage}
              selectedReconciliationIntegrationId={selectedReconciliationIntegrationId}
              setExpandedClientNames={setExpandedClientNames}
              setNeedsReviewOnly={setNeedsReviewOnly}
              setQuery={setQuery}
              setVendorFilter={setVendorFilter}
              skipIssue={skipIssue}
              totalExposure={totalExposure}
              vendorDataSummary={vendorDataSummary}
              vendorFilter={vendorFilter}
            />
          )}
          {view === 'integrations' && (
            <IntegrationsView
              actionMessages={integrationActionMessages}
              busyAction={busyIntegrationAction}
              loadMessage={integrationLoadMessage}
              loadState={integrationLoadState}
              runtimeMeta={integrationRuntimeMeta}
              integrations={integrations}
              onConfigure={openIntegrationModal}
              onOpenMappings={(integrationId) => {
                setSelectedMappingIntegrationId(integrationId);
                setMappingState(null);
                setUsageOverrides([]);
                setMappingMessage('Loading mapping state...');
                navigateToView('mappings');
              }}
              onRefresh={refreshRuntimeIntegrations}
              onSync={syncIntegration}
              onTest={testIntegration}
            />
          )}
          {view === 'mappings' && (
            <MappingsView
              busyAction={busyMappingAction}
              integrations={integrations}
              loadMessage={mappingMessage}
              loadState={mappingLoadState}
              mappingState={mappingState}
              ncentralFilterMappings={ncentralFilterMappings}
              ncentralFilters={ncentralFilters}
              onAccountApprove={approveAccountCandidate}
              onAccountManualSave={saveManualAccountMapping}
              onApproveSuggested={() => runMappingAction('approve-suggested')}
              onAutomap={() => runMappingAction('automap')}
              onIntegrationChange={(integrationId) => {
                setSelectedMappingIntegrationId(integrationId);
                setMappingState(null);
                setUsageOverrides([]);
                setMappingMessage('Loading mapping state...');
              }}
              onProductTargetsSave={saveProductTargets}
              onProductBundleDeactivate={deactivateProductBundle}
              onProductBundleSave={saveProductBundle}
              onRefresh={() => refreshMappingWorkspace(selectedMappingIntegrationId)}
              onNcentralFilterMappingSave={saveNcentralFilterMapping}
              onUsageOverrideCreate={saveUsageOverride}
              onUsageOverrideDeactivate={deactivateUsageOverride}
              selectedIntegrationId={selectedMappingIntegrationId}
              usageOverrides={usageOverrides}
            />
          )}
          {view === 'reports' && reportSection === 'raw-sync' && (
            <ReportsView
              columnFilters={rawSyncColumnFilters}
              details={rawSyncDetails}
              integrations={integrations}
              loadMessage={rawSyncMessage}
              loadState={rawSyncLoadState}
              onColumnFilterChange={(column, value) =>
                setRawSyncColumnFilters((filters) => ({
                  ...filters,
                  [column]: value,
                }))
              }
              onIntegrationChange={(integrationId) => {
                setSelectedRawSyncIntegrationId(integrationId);
                setSelectedRawSyncDataset('users');
                setRawSyncRuns([]);
                setSelectedRawSyncRunId('');
                setRawSyncDetails(null);
                setRawSyncColumnFilters({});
                setRawSyncMessage(integrationId ? 'Loading raw sync dates...' : 'Select an integration to view saved raw sync rows.');
              }}
              onDatasetChange={(dataset) => {
                setSelectedRawSyncDataset(dataset);
                setRawSyncDetails(null);
                setRawSyncColumnFilters({});
                setRawSyncMessage(selectedRawSyncRunId ? 'Loading raw sync details...' : 'Select a sync date to load raw rows.');
              }}
              onRefresh={refreshRawSyncReport}
              onSyncRunChange={setSelectedRawSyncRunId}
              runs={rawSyncRuns}
              selectedDataset={selectedRawSyncDataset}
              selectedIntegrationId={selectedRawSyncIntegrationId}
              selectedSyncRunId={selectedRawSyncRunId}
            />
          )}
          {view === 'reports' && reportSection === 'product-profitability' && (
            <ProductProfitabilityReportView
              loadMessage={productProfitabilityMessage}
              loadState={productProfitabilityLoadState}
              onRefresh={loadProductProfitabilityReport}
              report={productProfitabilityReport}
            />
          )}
          {view === 'imports' && <ImportsView />}
          {view === 'agreements' && (
            <AgreementsView
              autoPost={autoPost}
              productFilter={productFilter}
              setAutoPost={setAutoPost}
              setProductFilter={setProductFilter}
              visibleRules={visibleRules}
            />
          )}
          {view === 'audit' && <AuditView issues={issues} />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      {ticketClient && (
        <TicketModal
          client={ticketClient}
          notes={ticketNotes}
          onClose={closeTicketModal}
          onCreate={createInvestigationTicket}
          onNotesChange={setTicketNotes}
          onToggleIssue={toggleTicketIssue}
          selectedIssueIds={ticketIssueIds}
        />
      )}
      {agreementAdditionsSelection && (
        <AgreementAdditionsModal
          additions={agreementAdditions}
          loadState={agreementAdditionsLoadState}
          message={agreementAdditionsMessage}
          onClose={closeAgreementAdditionsModal}
          selection={agreementAdditionsSelection}
          syncSummary={connectWiseSyncSummary}
        />
      )}
      {selectedIntegration && (
          <IntegrationModal
            integration={selectedIntegration}
            onSave={saveIntegrationSettings}
            onClose={closeIntegrationModal}
            onTabChange={setIntegrationTab}
            saving={savingIntegrationId === selectedIntegration.id}
            saveMessage={integrationSaveMessage}
            tab={integrationTab}
          />
      )}
      {manualOverrideIssue && (
        <ManualOverrideModal
          issue={manualOverrideIssue}
          message={manualOverrideMessage}
          onClose={() => {
            setManualOverrideIssue(null);
            setManualOverrideMessage('');
          }}
          onLessCountSave={saveLessCountAdjustment}
          onDeviceRemap={remapReconciliationDevice}
          productOptions={reconciliationProductOptions}
          saving={savingManualOverride}
        />
      )}
    </div>
  );
}

function pageTitle(view: View) {
  switch (view) {
    case 'integrations':
      return 'Integrations';
    case 'mappings':
      return 'Mappings';
    case 'reports':
      return 'Reporting';
    case 'imports':
      return 'Invoice imports';
    case 'agreements':
      return 'Agreement workspace';
    case 'audit':
      return 'Audit history';
    case 'settings':
      return 'Settings';
    default:
      return 'Reconciliation command center';
  }
}

type ManagedUserDraft = {
  displayName: string;
  role: AppRole;
  status: ManagedUserStatus;
};

function SettingsView() {
  const [users, setUsers] = useState<ManagedAppUser[]>([]);
  const [roles, setRoles] = useState<AppRole[]>(['Admin', 'Approver', 'Analyst']);
  const [statuses, setStatuses] = useState<ManagedUserStatus[]>(['active', 'disabled']);
  const [drafts, setDrafts] = useState<Record<string, ManagedUserDraft>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('Loading users...');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    email: '',
    displayName: '',
    role: 'Analyst' as AppRole,
    status: 'active' as ManagedUserStatus,
  });

  const activeAdmins = users.filter((user) => user.role === 'Admin' && user.status === 'active').length;
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const disabledUsers = users.filter((user) => user.status === 'disabled').length;

  const applyUsersResponse = (response: ManagedUsersResponse) => {
    setUsers(response.users);
    setRoles(response.roles.length > 0 ? response.roles : ['Admin', 'Approver', 'Analyst']);
    setStatuses(response.statuses.length > 0 ? response.statuses : ['active', 'disabled']);
    setDrafts(draftsFromUsers(response.users));
  };

  const refreshUsers = async () => {
    setLoadState('loading');
    setMessage('Refreshing users...');

    try {
      const response = await fetchManagedUsers();
      applyUsersResponse(response);
      setLoadState('ready');
      setMessage('User access list loaded.');
    } catch (error) {
      setLoadState('failed');
      setMessage(error instanceof Error ? error.message : 'Unable to load users.');
    }
  };

  useEffect(() => {
    void refreshUsers();
  }, []);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingKey('new');
    setMessage('Saving user...');

    try {
      const result = await createManagedUserRequest(newUser);
      const nextUsers = upsertUser(users, result.user);
      setUsers(nextUsers);
      setDrafts(draftsFromUsers(nextUsers));
      setNewUser({
        email: '',
        displayName: '',
        role: 'Analyst',
        status: 'active',
      });
      setLoadState('ready');
      setMessage(result.created ? 'User added.' : 'Existing user updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save user.');
    } finally {
      setSavingKey(null);
    }
  };

  const saveUser = async (user: ManagedAppUser) => {
    const draft = drafts[user.id];
    if (!draft) {
      return;
    }

    setSavingKey(user.id);
    setMessage(`Saving ${user.email}...`);

    try {
      const result = await updateManagedUserRequest(user.id, draft);
      const nextUsers = upsertUser(users, result.user);
      setUsers(nextUsers);
      setDrafts(draftsFromUsers(nextUsers));
      setLoadState('ready');
      setMessage(`${result.user.email} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update user.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section className="settings-page" aria-label="Application settings">
      <div className="integrations-live-bar">
        <div>
          <span className={`live-dot ${loadState}`} />
          <strong>{loadState === 'ready' ? 'User access' : loadState === 'loading' ? 'Refreshing' : 'Access issue'}</strong>
          <span>{message}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{activeUsers.toLocaleString()} active</span>
          <span>{activeAdmins.toLocaleString()} admins</span>
          <span>{disabledUsers.toLocaleString()} disabled</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void refreshUsers()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <form className="settings-user-form" onSubmit={createUser}>
        <div>
          <span className="section-kicker">Access control</span>
          <h2>Add or update a user</h2>
        </div>
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
            placeholder="person@company.com"
            required
            type="email"
            value={newUser.email}
          />
        </label>
        <label>
          <span>Name</span>
          <input
            autoComplete="name"
            onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))}
            placeholder="Display name"
            value={newUser.displayName}
          />
        </label>
        <label>
          <span>Role</span>
          <select
            onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as AppRole }))}
            value={newUser.role}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            onChange={(event) =>
              setNewUser((current) => ({ ...current, status: event.target.value as ManagedUserStatus }))
            }
            value={newUser.status}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {managedUserStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary compact" disabled={savingKey === 'new'} type="submit">
          <UserPlus size={16} />
          {savingKey === 'new' ? 'Saving' : 'Add User'}
        </button>
      </form>

      <section className="settings-panel" aria-label="Users and roles">
        <div className="settings-panel-header">
          <div>
            <span className="section-kicker">Users</span>
            <h2>Roles and status</h2>
          </div>
          <p>Admins can manage settings, integrations, mappings, syncs, and user access.</p>
        </div>

        {users.length === 0 && loadState !== 'loading' ? (
          <div className="empty-state">
            <Users size={22} />
            <strong>No application users found.</strong>
            <span>Add an Admin user before inviting the rest of the team.</span>
          </div>
        ) : (
          <div className="settings-user-table-scroll">
            <table className="settings-user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const draft = drafts[user.id] ?? draftFromUser(user);
                  const changed = userDraftChanged(user, draft);

                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="settings-user-identity">
                          <input
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [user.id]: {
                                  ...draft,
                                  displayName: event.target.value,
                                },
                              }))
                            }
                            placeholder={user.email}
                            value={draft.displayName}
                          />
                          <span>{user.email}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [user.id]: {
                                ...draft,
                                role: event.target.value as AppRole,
                              },
                            }))
                          }
                          value={draft.role}
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [user.id]: {
                                ...draft,
                                status: event.target.value as ManagedUserStatus,
                              },
                            }))
                          }
                          value={draft.status}
                        >
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {managedUserStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{formatDateTime(user.lastSeenAt) ?? 'Never'}</td>
                      <td>{formatDateTime(user.updatedAt) ?? '-'}</td>
                      <td>
                        <button
                          className="button secondary compact"
                          disabled={!changed || savingKey === user.id}
                          onClick={() => void saveUser(user)}
                          type="button"
                        >
                          <Check size={16} />
                          {savingKey === user.id ? 'Saving' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function draftFromUser(user: ManagedAppUser): ManagedUserDraft {
  return {
    displayName: user.displayName ?? '',
    role: user.role,
    status: user.status,
  };
}

function draftsFromUsers(users: ManagedAppUser[]) {
  return users.reduce<Record<string, ManagedUserDraft>>((drafts, user) => {
    drafts[user.id] = draftFromUser(user);
    return drafts;
  }, {});
}

function userDraftChanged(user: ManagedAppUser, draft: ManagedUserDraft) {
  return (
    (user.displayName ?? '') !== draft.displayName.trim() ||
    user.role !== draft.role ||
    user.status !== draft.status
  );
}

function upsertUser(users: ManagedAppUser[], user: ManagedAppUser) {
  const nextUsers = users.some((existing) => existing.id === user.id)
    ? users.map((existing) => (existing.id === user.id ? user : existing))
    : [...users, user];

  return nextUsers.sort(compareManagedUsers);
}

function compareManagedUsers(left: ManagedAppUser, right: ManagedAppUser) {
  if (left.status !== right.status) {
    return left.status === 'active' ? -1 : 1;
  }

  return left.email.localeCompare(right.email);
}

function managedUserStatusLabel(status: ManagedUserStatus) {
  return status === 'active' ? 'Active' : 'Disabled';
}

function ReconcileView(props: {
  approveClient: (customer: string) => void;
  approveIssue: (issueId: string) => void;
  clientGroups: ClientGroup[];
  connectWiseSyncSummary: string;
  exportingReport: boolean;
  expandedClientNames: string[];
  filteredIssues: ReconcileIssue[];
  issues: ReconcileIssue[];
  needsReviewOnly: boolean;
  onExportReport: () => Promise<void>;
  onLoadVendorData: (client: ClientGroup, vendorId: IntegrationId, vendor: string) => Promise<VendorDataSelection>;
  onManualOverride: (issue: ReconcileIssue) => void;
  onOpenAgreementAdditions: (client: ClientGroup) => void;
  onOpenTicket: (client: ClientGroup) => void;
  onRefreshReconciliation: () => Promise<ReconciliationRunResponse | null>;
  onReconciliationSourceChange: (integrationId: IntegrationId) => void;
  pendingCount: number;
  query: string;
  reconciliationLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  reconciliationMessage: string;
  selectedReconciliationIntegrationId: IntegrationId | '';
  setExpandedClientNames: (value: string[] | ((currentNames: string[]) => string[])) => void;
  setNeedsReviewOnly: (value: boolean) => void;
  setQuery: (value: string) => void;
  setVendorFilter: (value: string) => void;
  skipIssue: (issueId: string) => void;
  totalExposure: number;
  vendorDataSummary: string;
  vendorFilter: string;
}) {
  const {
    approveClient,
    approveIssue,
    clientGroups,
    connectWiseSyncSummary,
    exportingReport,
    expandedClientNames,
    filteredIssues,
    issues,
    needsReviewOnly,
    onExportReport,
    onLoadVendorData,
    onManualOverride,
    onOpenAgreementAdditions,
    onOpenTicket,
    onRefreshReconciliation,
    onReconciliationSourceChange,
    pendingCount,
    query,
    reconciliationLoadState,
    reconciliationMessage,
    selectedReconciliationIntegrationId,
    setExpandedClientNames,
    setNeedsReviewOnly,
    setQuery,
    setVendorFilter,
    skipIssue,
    totalExposure,
    vendorDataSummary,
    vendorFilter,
  } = props;
  const [expandedProductLists, setExpandedProductLists] = useState<Record<string, boolean>>({});
  const [vendorDataSelection, setVendorDataSelection] = useState<VendorDataSelection | null>(null);
  const filteredReviewCount = filteredIssues.filter(isReviewableIssue).length;
  const selectedSourceName = selectedReconciliationIntegrationId
    ? integrationName(selectedReconciliationIntegrationId)
    : 'Choose a vendor';
  const workflowSteps = workflow.map((step) => {
    if (step.label === 'Vendor data') return { ...step, value: vendorDataSummary };
    if (step.label === 'CW Data') return { ...step, value: connectWiseSyncSummary };
    if (step.label === 'Discrepancies') return { ...step, value: `${pendingCount.toLocaleString()} review` };
    if (step.label === 'Client review') return { ...step, value: `${clientGroups.length} groups` };
    if (step.label === 'Unresolved exposure') return { ...step, value: formatCurrency(totalExposure) };
    return step;
  });
  const openVendorData = async (client: ClientGroup, vendorId: IntegrationId, vendor: string) => {
    setVendorDataSelection({
      customer: client.customer,
      vendorId,
      vendor,
      status: 'loading',
      syncSummary: vendorDataSummary,
      message: `Loading all raw sync rows for ${client.customer}...`,
      columns: [],
      rows: [],
    });

    try {
      setVendorDataSelection(await onLoadVendorData(client, vendorId, vendor));
    } catch (error) {
      setVendorDataSelection({
        customer: client.customer,
        vendorId,
        vendor,
        status: 'failed',
        syncSummary: vendorDataSummary,
        message: error instanceof Error ? error.message : 'Unable to load vendor data.',
        columns: [],
        rows: [],
      });
    }
  };

  return (
    <>
      <section className="integrations-live-bar reconciliation-live-bar" aria-label="Live reconciliation status">
        <div>
          <span className={`live-dot ${reconciliationLoadState}`} />
          <strong>
            {reconciliationLoadState === 'failed'
              ? `${selectedSourceName} reconciliation issue`
              : reconciliationLoadState === 'loading'
                ? `Comparing ${selectedSourceName}`
                : selectedReconciliationIntegrationId
                  ? `${selectedSourceName} vs ConnectWise`
                  : selectedSourceName}
          </strong>
          {reconciliationLoadState !== 'ready' || !selectedReconciliationIntegrationId ? (
            <span>{reconciliationMessage}</span>
          ) : null}
        </div>
        <div className="integrations-live-meta">
          <div className="segmented-control compact-source-control" role="group" aria-label="Reconciliation source">
            {reconciliationVendorIds.map((integrationId) => (
              <button
                className={selectedReconciliationIntegrationId === integrationId ? 'active' : ''}
                disabled={reconciliationLoadState === 'loading'}
                key={integrationId}
                onClick={() => onReconciliationSourceChange(integrationId)}
                type="button"
              >
                {integrationName(integrationId)}
              </button>
            ))}
          </div>
          <span>{pendingCount.toLocaleString()} open</span>
          <button
            className="button secondary compact"
            disabled={reconciliationLoadState === 'loading' || !selectedReconciliationIntegrationId}
            onClick={() => void onRefreshReconciliation()}
            type="button"
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </section>

      <section className="workflow-band" aria-label="Reconciliation workflow">
        {workflowSteps.map((step) => {
          const Icon = step.icon;
          return (
            <div className={`workflow-step ${step.state}`} key={step.label}>
              <div className="workflow-icon">
                <Icon size={18} />
              </div>
              <div>
                <span>{step.label}</span>
                <strong>{step.value}</strong>
              </div>
              {step.label !== 'Post' && <ChevronRight className="workflow-arrow" size={18} />}
            </div>
          );
        })}
      </section>

      <section className="workspace-grid">
        <div className="work-surface client-surface">
          <section className="toolbar" aria-label="Queue filters">
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="Search customers, products, vendors, and agreements"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search client, product, agreement"
                type="search"
                value={query}
              />
            </label>

            <div className="segmented-control" role="group" aria-label="Vendor filter">
              {reconciliationVendors.map((vendor) => (
                <button
                  className={vendorFilter === vendor ? 'active' : ''}
                  key={vendor}
                  onClick={() => setVendorFilter(vendor)}
                  type="button"
                >
                  {vendor}
                </button>
              ))}
            </div>

            <label className="switch-control">
              <input
                checked={needsReviewOnly}
                onChange={(event) => setNeedsReviewOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Needs review</span>
            </label>
          </section>

          <div className="surface-header">
            <div>
              <span className="section-kicker">Client review groups</span>
              <h2>{filteredReviewCount} review items across {clientGroups.length} clients</h2>
            </div>
            <div className="review-group-actions">
              <button
                className="button secondary compact"
                disabled={
                  exportingReport ||
                  reconciliationLoadState === 'loading' ||
                  !selectedReconciliationIntegrationId ||
                  issues.length === 0
                }
                onClick={() => void onExportReport()}
                type="button"
              >
                <Download size={16} />
                {exportingReport ? 'Exporting' : 'Export report'}
              </button>
              <button
                className="button secondary compact"
                disabled={clientGroups.length === 0}
                onClick={() => setExpandedClientNames(clientGroups.map((client) => client.customer))}
                type="button"
              >
                Expand all
              </button>
              <button
                className="button secondary compact"
                disabled={expandedClientNames.length === 0}
                onClick={() => setExpandedClientNames([])}
                type="button"
              >
                Collapse all
              </button>
            </div>
          </div>

          <div className="client-group-list">
            {clientGroups.length === 0 && (
              <div className="empty-state">
                <Search size={20} />
                <strong>
                  {!selectedReconciliationIntegrationId
                    ? 'Choose a vendor to run reconciliation.'
                    : pendingCount === 0
                      ? `No ${selectedSourceName} discrepancies to review.`
                      : 'No client groups match these filters.'}
                </strong>
                <span>
                  {!selectedReconciliationIntegrationId
                    ? 'Pick a vendor above when you are ready to compare vendor counts with CW data.'
                    : pendingCount === 0
                    ? reconciliationMessage
                    : 'Adjust the vendor, status, or exposure filters to bring product checks back.'}
                </span>
              </div>
            )}

            {clientGroups.map((client) => {
              const isSelected = expandedClientNames.includes(client.customer);
              return (
                <article className={isSelected ? 'client-group selected' : 'client-group'} key={client.customer}>
                  <div className="client-group-header">
                    <div className="client-title-area">
                      <button
                        className="client-title-button"
                        onClick={() =>
                          setExpandedClientNames((currentNames) =>
                            currentNames.includes(client.customer)
                              ? currentNames.filter((clientName) => clientName !== client.customer)
                              : [client.customer],
                          )
                        }
                        type="button"
                      >
                        <ChevronRight className={isSelected ? 'chevron open' : 'chevron'} size={18} />
                        <Building2 size={19} />
                        <span>
                          <strong>{client.customer}</strong>
                        </span>
                      </button>
                      <button
                        className="agreement-link-button"
                        onClick={() => onOpenAgreementAdditions(client)}
                        type="button"
                      >
                        {client.agreement}
                      </button>
                    </div>

                    <div className="client-group-meta">
                      <span>{client.vendors.length} vendors</span>
                      <span className="status-pill ready">{client.needsReviewCount} review</span>
                      <strong>{formatCurrency(client.exposure)}</strong>
                      <button className="button secondary compact" onClick={() => onOpenTicket(client)} type="button">
                        <ListChecks size={16} />
                        Ticket
                      </button>
                      <button
                        className="button primary compact"
                        onClick={() => approveClient(client.customer)}
                        type="button"
                      >
                        <BadgeCheck size={16} />
                        Approve client
                      </button>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="client-license-stack">
                      {groupIssuesByVendor(client.issues).map(([vendor, vendorIssues]) => {
                        const productListKey = `${client.customer}::${vendor}`;
                        const isExpanded = Boolean(expandedProductLists[productListKey]);
                        const allVendorIssues = issues.filter(
                          (issue) => issue.customer === client.customer && issue.vendor === vendor,
                        );
                        const hiddenCount = Math.max(0, allVendorIssues.length - vendorIssues.length);
                        const matchedCount = allVendorIssues.filter((issue) => issue.status === 'matched').length;
                        const visibleVendorIssues = isExpanded ? allVendorIssues : vendorIssues;
                        const vendorId = allVendorIssues[0]?.vendorId ?? selectedReconciliationIntegrationId;

                        return (
                          <section className="vendor-license-group" key={vendor}>
                            <div className="vendor-license-header">
                              <strong>{vendor}</strong>
                              <div className="vendor-license-header-meta">
                                <button
                                  className="vendor-data-link"
                                  disabled={!vendorId}
                                  onClick={() => {
                                    if (vendorId) {
                                      void openVendorData(client, vendorId, vendor);
                                    }
                                  }}
                                  type="button"
                                >
                                  <Database size={14} />
                                  Vendor Data
                                </button>
                                <span>{visibleVendorIssues.length} product checks</span>
                              </div>
                            </div>
                            <div className="license-table" role="table" aria-label={`${client.customer} ${vendor} license checks`}>
                              <div className="license-row heading" role="row">
                                <span>Product</span>
                                <span>Vendor count</span>
                                <span>CW Count</span>
                                <span>Delta</span>
                                <span>Impact</span>
                                <span>Status</span>
                                <span>Actions</span>
                              </div>
                              {visibleVendorIssues.map((issue) => {
                                const delta = issue.sourceCount - issue.invoiceCount;
                                const canApproveOrSkip = isReviewableIssue(issue) || issue.status === 'ready';
                                const passiveActionLabel =
                                  issue.status === 'approved' ? 'Approved' : issue.status === 'skipped' ? 'Skipped' : 'No change';
                                return (
                                  <div className="license-row" key={issue.id} role="row">
                                    <span className="license-product">
                                      <strong>{issue.product}</strong>
                                      <em>{issue.serviceCode} / {issue.family}</em>
                                    </span>
                                    <span>{issue.sourceCount}</span>
                                    <span>{issue.invoiceCount}</span>
                                    <span className={delta >= 0 ? 'delta positive' : 'delta negative'}>
                                      {delta > 0 ? `+${delta}` : delta}
                                    </span>
                                    <span>{formatCurrency(issue.amount)}</span>
                                    <span className={`status-pill ${issue.status}`}>{statusLabel(issue.status)}</span>
                                    <span className="license-actions">
                                      {canApproveOrSkip ? (
                                        <>
                                          <label className="approval-checkbox" title="Approve suggested change">
                                            <input
                                              checked={issue.status === 'approved'}
                                              onChange={() => approveIssue(issue.id)}
                                              type="checkbox"
                                            />
                                          </label>
                                          <button
                                            className="button secondary compact table-action-button"
                                            onClick={() => skipIssue(issue.id)}
                                            title="Skip change"
                                            type="button"
                                          >
                                            Skip
                                          </button>
                                        </>
                                      ) : (
                                        <span className="no-change-action">{passiveActionLabel}</span>
                                      )}
                                      <button
                                        className="icon-button table-icon"
                                        onClick={() => onManualOverride(issue)}
                                        title="Manual override"
                                        type="button"
                                      >
                                        <MoreHorizontal size={16} />
                                      </button>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {hiddenCount > 0 ? (
                              <div className="product-list-footer">
                                <button
                                  className="product-list-toggle"
                                  onClick={() =>
                                    setExpandedProductLists((current) => ({
                                      ...current,
                                      [productListKey]: !isExpanded,
                                    }))
                                  }
                                  type="button"
                                >
                                  {isExpanded ? 'Show discrepancies only' : 'Show all products'}
                                </button>
                                <span>
                                  {allVendorIssues.length.toLocaleString()} total
                                  {matchedCount > 0 ? ` / ${matchedCount.toLocaleString()} matched` : ''}
                                </span>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

      </section>
      {vendorDataSelection ? (
        <VendorDataModal onClose={() => setVendorDataSelection(null)} selection={vendorDataSelection} />
      ) : null}
    </>
  );
}

function VendorDataModal(props: { onClose: () => void; selection: VendorDataSelection }) {
  const { onClose, selection } = props;
  const minTableWidth = Math.max(980, selection.columns.length * 150);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="vendor-data-modal" role="dialog" aria-modal="true" aria-labelledby="vendor-data-title">
        <div className="modal-header">
          <div>
            <h2 id="vendor-data-title">
              <Database size={18} />
              Vendor Data
            </h2>
            <p>
              {selection.customer} / {selection.vendor}
              {selection.syncSummary ? ` / ${selection.syncSummary}` : ''}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="vendor-device-list" aria-label={`${selection.vendor} raw sync data for ${selection.customer}`}>
          {selection.status !== 'ready' ? (
            <div className="empty-state">
              <Database size={20} />
              <strong>{selection.status === 'loading' ? 'Loading vendor data.' : 'Unable to load vendor data.'}</strong>
              {selection.message ? <span>{selection.message}</span> : null}
            </div>
          ) : null}

          {selection.status === 'ready' && selection.rows.length === 0 ? (
            <div className="empty-state">
              <Database size={20} />
              <strong>No raw sync rows found for this customer.</strong>
              {selection.message ? <span>{selection.message}</span> : null}
            </div>
          ) : null}

          {selection.status === 'ready' && selection.rows.length > 0 ? (
            <div className="vendor-device-table-scroll">
              <table className="vendor-raw-sync-table" style={{ minWidth: `${minTableWidth}px` }}>
                <thead>
                  <tr>
                    {selection.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selection.rows.map((row, index) => (
                    <tr key={`${String(row.id ?? row.SubscriptionKey ?? row.ProductKey ?? 'row')}-${index}`}>
                      {selection.columns.map((column) => {
                        const value = formatReportCell(column, row[column]);
                        return <td key={column} title={value}>{value}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AgreementAdditionsModal(props: {
  additions: AgreementAddition[];
  loadState: 'loading' | 'ready' | 'failed';
  message: string;
  onClose: () => void;
  selection: AgreementAdditionsSelection;
  syncSummary: string;
}) {
  const { additions, loadState, message, onClose, selection, syncSummary } = props;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="agreement-additions-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-additions-title">
        <div className="modal-header">
          <div>
            <h2 id="agreement-additions-title">
              <FileSpreadsheet size={18} />
              CW Data
            </h2>
            <p>{selection.customer} / {selection.agreement} / {syncSummary}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className={`agreement-additions-status ${loadState}`}>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <span>{message}</span>
        </div>

        {additions.length === 0 ? (
          <div className="empty-state agreement-additions-empty">
            <FileSpreadsheet size={20} />
            <strong>{loadState === 'loading' ? 'Loading CW data...' : 'No active CW additions to show.'}</strong>
          </div>
        ) : (
          <div className="agreement-additions-table-scroll">
            <table className="agreement-additions-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Code</th>
                  <th>CW ID</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {additions.map((addition) => (
                  <tr key={addition.id}>
                    <td>{addition.productName}</td>
                    <td>{addition.productCode}</td>
                    <td>{addition.connectWiseAdditionId}</td>
                    <td>{addition.quantity.toLocaleString()}</td>
                    <td>{formatMoneyAmount(addition.unitPrice)}</td>
                    <td>{addition.additionStatus}</td>
                    <td>{formatDateTime(addition.updatedAt) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ProductCustomerReviewModal(props: {
  loadState: 'loading' | 'ready' | 'failed';
  message: string;
  onClose: () => void;
  onSelectCustomer: (externalAccountId: string) => void;
  review: ProductMappingCustomerReview;
  selectedCustomerId: string;
}) {
  const { loadState, message, onClose, onSelectCustomer, review, selectedCustomerId } = props;
  const selectedCustomer =
    review.customers.find((customer) => customer.externalAccountId === selectedCustomerId) ??
    review.customers[0];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="product-customer-review-modal" role="dialog" aria-modal="true" aria-labelledby="product-customer-review-title">
        <div className="modal-header">
          <div>
            <h2 id="product-customer-review-title">
              <Users size={18} />
              Product Customers
            </h2>
            <p>{review.vendorProductName} / {review.vendorProductKey}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className={`agreement-additions-status ${loadState}`}>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <span>{message}</span>
        </div>

        <div className="product-customer-review-layout">
          <nav className="product-customer-nav" aria-label="Customers with vendor product">
            <div className="product-customer-nav-header">
              <strong>{review.customerCount.toLocaleString()} customers</strong>
            </div>
            {review.customers.length === 0 ? (
              <div className="empty-state product-customer-empty">
                <Users size={20} />
                <strong>{loadState === 'loading' ? 'Loading customers...' : 'No customers found.'}</strong>
              </div>
            ) : null}
            {review.customers.map((customer) => (
              <button
                className={customer.externalAccountId === selectedCustomer?.externalAccountId ? 'product-customer-nav-item selected' : 'product-customer-nav-item'}
                key={customer.externalAccountId}
                onClick={() => onSelectCustomer(customer.externalAccountId)}
                type="button"
              >
                <strong>{customer.externalAccountName}</strong>
                <span>
                  {customer.vendorQuantity.toLocaleString()} vendor
                  {' / '}
                  {customer.additions.length.toLocaleString()} CW additions
                </span>
              </button>
            ))}
          </nav>

          <section className="product-customer-detail" aria-label="Mapped customer agreement additions">
            {!selectedCustomer ? (
              <div className="empty-state product-customer-empty">
                <FileSpreadsheet size={20} />
                <strong>{loadState === 'loading' ? 'Loading mapped agreement additions...' : 'Select a customer.'}</strong>
              </div>
            ) : (
              <>
                <div className="product-customer-detail-header">
                  <div>
                    <span className="section-kicker">Mapped customer</span>
                    <h3>{selectedCustomer.customerName ?? selectedCustomer.externalAccountName}</h3>
                    <p>
                      {selectedCustomer.agreementName ?? 'No approved mapped agreement'}
                      {selectedCustomer.agreementStatus ? ` / ${selectedCustomer.agreementStatus}` : ''}
                    </p>
                  </div>
                  <div className="product-customer-detail-metrics">
                    <IntegrationStat label="Vendor qty" value={selectedCustomer.vendorQuantity.toLocaleString()} />
                    <IntegrationStat label="CW additions" value={selectedCustomer.additions.length.toLocaleString()} />
                    <IntegrationStat label="Seen" value={formatDateTime(selectedCustomer.observedAt) ?? '-'} />
                  </div>
                </div>

                {selectedCustomer.additions.length === 0 ? (
                  <div className="empty-state product-customer-empty">
                    <FileSpreadsheet size={20} />
                    <strong>No active ConnectWise additions on the mapped agreement.</strong>
                    <span>{selectedCustomer.agreementName ? 'The mapped agreement exists, but no active additions were found.' : 'Map this vendor customer to its monthly agreement to review additions.'}</span>
                  </div>
                ) : (
                  <div className="agreement-additions-table-scroll product-customer-additions-scroll">
                    <table className="agreement-additions-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Code</th>
                          <th>CW ID</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Status</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCustomer.additions.map((addition) => (
                          <tr key={addition.id}>
                            <td>{addition.productName}</td>
                            <td>{addition.productCode}</td>
                            <td>{addition.connectWiseAdditionId ?? '-'}</td>
                            <td>{addition.quantity.toLocaleString()}</td>
                            <td>{typeof addition.unitPrice === 'number' ? formatMoneyValue(addition.unitPrice) : '-'}</td>
                            <td>{addition.additionStatus}</td>
                            <td>{formatDateTime(addition.updatedAt) ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function MetricCard(props: {
  icon: typeof Activity;
  label: string;
  tone: 'warn' | 'money' | 'ready' | 'approved';
  value: string;
}) {
  const Icon = props.icon;
  return (
    <article className={`metric-card ${props.tone}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function TicketModal(props: {
  client: ClientGroup;
  notes: string;
  onClose: () => void;
  onCreate: () => void;
  onNotesChange: (notes: string) => void;
  onToggleIssue: (issueId: string) => void;
  selectedIssueIds: string[];
}) {
  const { client, notes, onClose, onCreate, onNotesChange, onToggleIssue, selectedIssueIds } = props;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="ticket-modal-title">
              <ListChecks size={18} />
              Create Investigation Ticket
            </h2>
            <p>Select licenses to investigate for {client.customer}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="ticket-license-list" aria-label="Licenses to investigate">
          {client.issues.map((issue) => (
            <label className="ticket-license-option" key={issue.id}>
              <input
                checked={selectedIssueIds.includes(issue.id)}
                onChange={() => onToggleIssue(issue.id)}
                type="checkbox"
              />
              <span>
                <strong>{issue.product}</strong>
                <em>
                  {issue.vendor} / vendor {issue.sourceCount}
                  {' -> '}
                  ConnectWise {issue.invoiceCount}
                </em>
              </span>
            </label>
          ))}
        </div>

        <label className="ticket-notes">
          <span>Ticket Notes</span>
          <textarea
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Add details for the investigation ticket..."
            value={notes}
          />
        </label>

        <div className="modal-actions">
          <button className="button secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            disabled={selectedIssueIds.length === 0}
            onClick={onCreate}
            type="button"
          >
            <ListChecks size={17} />
            Create Ticket ({selectedIssueIds.length})
          </button>
        </div>
      </section>
    </div>
  );
}

function ManualOverrideModal(props: {
  issue: ReconcileIssue;
  message: string;
  onClose: () => void;
  onDeviceRemap: (
    issue: ReconcileIssue,
    device: ReconciliationDevice,
    targetVendorProductKey: string,
  ) => Promise<boolean>;
  onLessCountSave: (issue: ReconcileIssue, quantity: number, reason: string) => Promise<boolean>;
  productOptions: ReconciliationProductOption[];
  saving: boolean;
}) {
  const { issue, message, onClose, onDeviceRemap, onLessCountSave, productOptions, saving } = props;
  const [lessCount, setLessCount] = useState('1');
  const [lessCountReason, setLessCountReason] = useState('');
  const [remapTargets, setRemapTargets] = useState<Record<string, string>>({});
  const lessCountValue = Number(lessCount);
  const canSaveLessCount = Number.isFinite(lessCountValue) && lessCountValue > 0 && !saving;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="manual-override-modal" role="dialog" aria-modal="true" aria-labelledby="manual-override-title">
        <div className="modal-header">
          <div>
            <h2 id="manual-override-title">
              <SlidersHorizontal size={18} />
              Manual Override
            </h2>
            <p>{issue.customer} / {issue.product}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="manual-summary">
          <IntegrationStat label="Vendor count" value={issue.sourceCount.toLocaleString()} />
          <IntegrationStat label="ConnectWise" value={issue.invoiceCount.toLocaleString()} />
          <IntegrationStat label="Proposed" value={issue.proposedCount.toLocaleString()} />
          <IntegrationStat label="Impact" value={formatCurrency(issue.amount)} />
        </div>

        <section className="manual-section" aria-label="Less Count adjustment">
          <div className="manual-section-header">
            <span className="section-kicker">Less Count</span>
            <strong>{issue.adjustments.length.toLocaleString()} active</strong>
          </div>
          <div className="less-count-form">
            <label>
              <span>Count</span>
              <input
                min="1"
                onChange={(event) => setLessCount(event.target.value)}
                step="1"
                type="number"
                value={lessCount}
              />
            </label>
            <label>
              <span>Reason</span>
              <input
                onChange={(event) => setLessCountReason(event.target.value)}
                placeholder="Included at no charge"
                value={lessCountReason}
              />
            </label>
            <button
              className="button primary compact"
              disabled={!canSaveLessCount}
              onClick={() => void onLessCountSave(issue, lessCountValue, lessCountReason)}
              type="button"
            >
              <Check size={16} />
              Save Less Count
            </button>
          </div>
          {issue.adjustments.length > 0 ? (
            <div className="adjustment-chip-list" aria-label="Active less-count adjustments">
              {issue.adjustments.map((adjustment) => (
                <span key={adjustment.id}>
                  Less {adjustment.quantity.toLocaleString()}
                  {adjustment.reason ? ` / ${adjustment.reason}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="manual-section" aria-label="Source device remapping">
          <div className="manual-section-header">
            <span className="section-kicker">Source devices</span>
            <strong>{issue.devices.length.toLocaleString()} rows</strong>
          </div>
          <div className="manual-device-list">
            {issue.devices.length === 0 ? (
              <div className="empty-state">
                <Database size={20} />
                <strong>No source devices were attached to this count.</strong>
              </div>
            ) : null}

            {issue.devices.map((device) => {
              const targetOptions = productOptions.filter((option) => option.vendorProductKey !== device.vendorProductKey);
              const selectedTarget = remapTargets[device.id] ?? '';
              return (
                <article className="manual-device-row" key={device.id}>
                  <div>
                    <strong>{deviceDisplayName(device)}</strong>
                    <span>{device.productName}</span>
                  </div>
                  <div>
                    <strong>{device.quantity.toLocaleString()}</strong>
                    <span>{formatDateTime(device.observedAt) ?? 'Unknown date'}</span>
                  </div>
                  <div>
                    <strong>{deviceDetailSummary(device)}</strong>
                    <span>{usageOverrideFilterLabel(deviceIdentityFilter(device))}</span>
                  </div>
                  <div className="manual-device-actions">
                    <select
                      onChange={(event) =>
                        setRemapTargets((current) => ({
                          ...current,
                          [device.id]: event.target.value,
                        }))
                      }
                      value={selectedTarget}
                    >
                      <option value="">Select product</option>
                      {targetOptions.map((option) => (
                        <option key={option.vendorProductKey} value={option.vendorProductKey}>
                          {option.productName}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary compact"
                      disabled={!selectedTarget || saving}
                      onClick={() => void onDeviceRemap(issue, device, selectedTarget)}
                      type="button"
                    >
                      Remap
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {message ? <p className="config-note manual-message">{message}</p> : null}
      </section>
    </div>
  );
}

function IntegrationsView(props: {
  actionMessages: Partial<Record<IntegrationId, string>>;
  busyAction: IntegrationActionKey | null;
  loadMessage: string;
  loadState: 'loading' | 'ready' | 'failed';
  runtimeMeta: {
    nonSecretStorage: RuntimeIntegrationsResponse['nonSecretStorage'];
    missingDatabaseSettings: string[];
    lastLoadedAt?: string;
  };
  integrations: Integration[];
  onConfigure: (integration: Integration) => void;
  onOpenMappings: (integrationId: IntegrationId) => void;
  onRefresh: () => Promise<RuntimeIntegrationsResponse | null>;
  onSync: (integrationId: IntegrationId, dataset?: RawSyncDataset) => void;
  onTest: (integrationId: IntegrationId) => void;
}) {
  const {
    actionMessages,
    busyAction,
    integrations,
    loadMessage,
    loadState,
    onConfigure,
    onOpenMappings,
    onRefresh,
    onSync,
    onTest,
    runtimeMeta,
  } = props;
  const connectedCount = integrations.filter((integration) => integration.status === 'connected').length;
  const degradedCount = integrations.filter((integration) => integration.status === 'degraded').length;
  const activeIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => isImplementedIntegration(integration.id) && integration.enabled),
  );
  const availableIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => isImplementedIntegration(integration.id) && !integration.enabled),
  );
  const comingSoonIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => !isImplementedIntegration(integration.id)),
  );

  return (
    <section className="integrations-page" aria-label="Vendor API integrations">
      <div className="integrations-live-bar">
        <div>
          <span className={`live-dot ${loadState}`} />
          <strong>{loadState === 'ready' ? 'Live backend' : loadState === 'loading' ? 'Refreshing' : 'Backend issue'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{connectedCount} connected</span>
          <span>{degradedCount} degraded</span>
          <span>Settings: {runtimeMeta.nonSecretStorage === 'database' ? 'PostgreSQL' : 'Not persisted'}</span>
          <span>Last loaded {formatDateTime(runtimeMeta.lastLoadedAt) ?? 'never'}</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="integration-list" aria-label="Enabled integrations">
        {activeIntegrations.map((integration) => (
          <IntegrationCard
            actionMessage={actionMessages[integration.id]}
            busyAction={busyAction}
            integration={integration}
            key={integration.id}
            onConfigure={onConfigure}
            onOpenMappings={onOpenMappings}
            onSync={onSync}
            onTest={onTest}
          />
        ))}
      </div>

      {availableIntegrations.length > 0 ? (
        <details className="integration-drawer" open>
          <summary>
            <div>
              <strong>Available Integrations</strong>
              <span>{availableIntegrations.length} ready to configure</span>
            </div>
            <ChevronRight className="drawer-chevron" size={18} />
          </summary>
          <div className="integration-drawer-body">
            {availableIntegrations.map((integration) => (
              <IntegrationCard
                actionMessage={actionMessages[integration.id]}
                busyAction={busyAction}
                integration={integration}
                key={integration.id}
                onConfigure={onConfigure}
                onOpenMappings={onOpenMappings}
                onSync={onSync}
                onTest={onTest}
              />
            ))}
          </div>
        </details>
      ) : null}

      {comingSoonIntegrations.length > 0 ? (
        <details className="integration-drawer">
          <summary>
            <div>
              <strong>Coming Soon Integrations</strong>
              <span>{comingSoonIntegrations.length} disabled roadmap integrations</span>
            </div>
            <ChevronRight className="drawer-chevron" size={18} />
          </summary>
          <div className="integration-drawer-body">
            {comingSoonIntegrations.map((integration) => (
              <IntegrationCard comingSoon integration={integration} key={integration.id} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function IntegrationCard(props: {
  actionMessage?: string;
  busyAction?: IntegrationActionKey | null;
  comingSoon?: boolean;
  integration: Integration;
  onConfigure?: (integration: Integration) => void;
  onOpenMappings?: (integrationId: IntegrationId) => void;
  onSync?: (integrationId: IntegrationId, dataset?: RawSyncDataset) => void;
  onTest?: (integrationId: IntegrationId) => void;
}) {
  const { actionMessage, busyAction, comingSoon = false, integration, onConfigure, onOpenMappings, onSync, onTest } = props;
  const displayName = comingSoon ? `${integration.name} (Coming Soon)` : integration.name;
  const actionKeyPrefix = integration.id;
  const microsoft365SyncBusy =
    busyAction === `${actionKeyPrefix}:sync-users` || busyAction === `${actionKeyPrefix}:sync-licenses`;

  return (
    <article aria-disabled={comingSoon || undefined} className={comingSoon ? 'integration-card coming-soon' : 'integration-card'}>
      <div className="integration-main">
        <div className="integration-title-row">
          <h2>{displayName}</h2>
          <span className={comingSoon ? 'integration-chip coming-soon-chip' : 'integration-chip'}>{integration.category}</span>
          <span className={comingSoon ? 'integration-status disabled' : `integration-status ${integration.status}`}>
            {comingSoon ? 'Disabled' : integrationStatusLabel(integration.status)}
          </span>
          <span className="auth-chip">
            <KeyRound size={13} />
            {integration.auth}
          </span>
        </div>
        <p>{integration.description}</p>

        <div className="integration-stats" aria-label={`${integration.name} integration status`}>
          <IntegrationStat label="Last sync" value={comingSoon ? 'Unavailable' : integration.lastSync ?? 'Never'} />
          <IntegrationStat label="Last test" value={comingSoon ? 'Unavailable' : integration.lastTest ?? 'Never'} />
          <IntegrationStat label="Frequency" value={comingSoon ? 'TBD' : integration.frequency ?? 'Manual'} />
          <IntegrationStat label="Records" value={comingSoon ? '0' : integration.records ?? '0'} />
        </div>

        <div className="scope-list runtime-list" aria-label={`${integration.name} runtime details`}>
          {comingSoon ? (
            <span>Not implemented yet</span>
          ) : (
            <>
              <span>Secrets: {integration.secretSource === 'key-vault' ? 'Key Vault' : 'Environment'}</span>
              {integration.lastSyncStatus ? <span>Last sync: {integration.lastSyncStatus}</span> : null}
            </>
          )}
        </div>

        <div className="scope-list" aria-label={`${integration.name} scopes`}>
          {integration.scopes.map((scope) => (
            <span key={scope}>{scope}</span>
          ))}
        </div>

        {!comingSoon && integration.missingSecrets.length + integration.missingNonSecrets.length > 0 ? (
          <div className="scope-list warning-list" aria-label={`${integration.name} missing settings`}>
            {[...integration.missingSecrets, ...integration.missingNonSecrets].map((setting) => (
              <span key={setting}>Missing {setting}</span>
            ))}
          </div>
        ) : null}

        <div className="integration-actions">
          {comingSoon ? (
            <button className="button secondary compact" disabled type="button">
              Coming Soon
            </button>
          ) : (
            <>
              {hasLiveIntegrationActions(integration.id) ? (
                <>
                  {integration.id === 'microsoft-365' ? (
                    <>
                      <button
                        className="button secondary compact"
                        disabled={microsoft365SyncBusy}
                        onClick={() => onSync?.(integration.id, 'users')}
                        type="button"
                      >
                        <RefreshCcw size={16} />
                        {busyAction === `${actionKeyPrefix}:sync-users` ? 'Syncing users' : 'Sync Users'}
                      </button>
                      <button
                        className="button secondary compact"
                        disabled={microsoft365SyncBusy}
                        onClick={() => onSync?.(integration.id, 'licenses')}
                        type="button"
                      >
                        <RefreshCcw size={16} />
                        {busyAction === `${actionKeyPrefix}:sync-licenses` ? 'Syncing licenses' : 'Sync Licenses'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="button secondary compact"
                      disabled={busyAction === `${actionKeyPrefix}:sync`}
                      onClick={() => onSync?.(integration.id)}
                      type="button"
                    >
                      <RefreshCcw size={16} />
                      {busyAction === `${actionKeyPrefix}:sync` ? 'Syncing' : 'Sync now'}
                    </button>
                  )}
                  <button
                    className="button secondary compact"
                    disabled={busyAction === `${actionKeyPrefix}:test`}
                    onClick={() => onTest?.(integration.id)}
                    type="button"
                  >
                    <Plug size={16} />
                    {busyAction === `${actionKeyPrefix}:test` ? 'Testing' : 'Test connection'}
                  </button>
                </>
              ) : null}
              <button className="button secondary compact" onClick={() => onConfigure?.(integration)} type="button">
                <KeyRound size={16} />
                {integration.enabled ? 'Configure' : 'Configure to enable'}
              </button>
              {hasMappingWorkspace(integration.id) ? (
                <button className="button secondary compact" onClick={() => onOpenMappings?.(integration.id)} type="button">
                  <Link2 size={16} />
                  Mapping
                </button>
              ) : null}
              {integration.enabled ? (
                <button className="button ghost compact" type="button">
                  <ExternalLink size={16} />
                  API Docs
                </button>
              ) : null}
            </>
          )}
        </div>
        {actionMessage ? <p className="config-note integration-action-message">{actionMessage}</p> : null}
      </div>

      <span
        aria-label={`${comingSoon ? 'Disabled' : integrationStatusLabel(integration.status)} ${displayName}`}
        className={comingSoon ? 'toggle-switch disabled' : integration.enabled ? 'toggle-switch on' : 'toggle-switch'}
        role="status"
      >
        <span />
      </span>
    </article>
  );
}

function IntegrationStat(props: { label: string; value: string }) {
  return (
    <div className="integration-stat">
      <Zap size={14} />
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function integrationStatusLabel(status: IntegrationStatus) {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'degraded':
      return 'Degraded';
    case 'not-configured':
      return 'Not Configured';
    default:
      return status;
  }
}

function MappingsView(props: {
  busyAction: string | null;
  integrations: Integration[];
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  mappingState: MappingStateResponse | null;
  ncentralFilterMappings: NcentralFilterMapping[];
  ncentralFilters: NcentralFilter[];
  onAccountApprove: (candidate: AccountMappingCandidate) => void;
  onAccountManualSave: (account: AccountMappingCandidate, customerId: string, agreementId: string) => Promise<boolean>;
  onApproveSuggested: () => void;
  onAutomap: () => void;
  onIntegrationChange: (integrationId: IntegrationId) => void;
  onProductTargetsSave: (
    integrationId: IntegrationId,
    vendorProductKey: string,
    targetProducts: ProductMappingTarget[],
  ) => Promise<void>;
  onProductBundleDeactivate: (integrationId: IntegrationId, bundleKey: string) => Promise<void>;
  onProductBundleSave: (
    integrationId: IntegrationId,
    payload: {
      bundleKey?: string;
      bundleName: string;
      components: ProductBundleComponent[];
      targetProduct: ProductMappingTarget;
    },
  ) => Promise<boolean>;
  onRefresh: () => Promise<MappingStateResponse | null>;
  onNcentralFilterMappingSave: (payload: Partial<NcentralFilterMapping>) => Promise<void>;
  onUsageOverrideCreate: (integrationId: IntegrationId, payload: CreateUsageOverridePayload) => Promise<boolean>;
  onUsageOverrideDeactivate: (integrationId: IntegrationId, overrideId: string) => Promise<void>;
  selectedIntegrationId: IntegrationId;
  usageOverrides: UsageOverride[];
}) {
  const {
    busyAction,
    integrations,
    loadMessage,
    loadState,
    mappingState,
    ncentralFilterMappings,
    ncentralFilters,
    onAccountApprove,
    onAccountManualSave,
    onApproveSuggested,
    onAutomap,
    onIntegrationChange,
    onProductTargetsSave,
    onProductBundleDeactivate,
    onProductBundleSave,
    onRefresh,
    onNcentralFilterMappingSave,
    onUsageOverrideCreate,
    onUsageOverrideDeactivate,
    selectedIntegrationId,
    usageOverrides,
  } = props;
  const [showMappedAccounts, setShowMappedAccounts] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualAgreementId, setManualAgreementId] = useState('');
  const [productTargetSelections, setProductTargetSelections] = useState<Record<string, string[]>>({});
  const [productTargetOverrides, setProductTargetOverrides] = useState<Record<string, ProductMappingTarget>>({});
  const [showProductCatalogOptions, setShowProductCatalogOptions] = useState<Record<string, boolean>>({});
  const [productCatalogQueries, setProductCatalogQueries] = useState<Record<string, string>>({});
  const [productCatalogResults, setProductCatalogResults] = useState<Record<string, ProductCatalogTarget[]>>({});
  const [productCatalogMessages, setProductCatalogMessages] = useState<Record<string, string>>({});
  const [productCatalogLoading, setProductCatalogLoading] = useState<Record<string, boolean>>({});
  const [productCustomerReview, setProductCustomerReview] = useState<ProductMappingCustomerReview | null>(null);
  const [productCustomerReviewLoadState, setProductCustomerReviewLoadState] = useState<'loading' | 'ready' | 'failed'>('ready');
  const [productCustomerReviewMessage, setProductCustomerReviewMessage] = useState('');
  const [selectedProductCustomerId, setSelectedProductCustomerId] = useState('');
  const [editingBundleKey, setEditingBundleKey] = useState<string | null>(null);
  const [bundleName, setBundleName] = useState('');
  const [bundleComponentKeys, setBundleComponentKeys] = useState<string[]>([]);
  const [bundleTarget, setBundleTarget] = useState<ProductMappingTarget | null>(null);
  const [bundleCatalogQuery, setBundleCatalogQuery] = useState('');
  const [bundleCatalogResults, setBundleCatalogResults] = useState<ProductCatalogTarget[]>([]);
  const [bundleCatalogMessage, setBundleCatalogMessage] = useState('');
  const [bundleCatalogLoading, setBundleCatalogLoading] = useState(false);
  const [overrideCustomerId, setOverrideCustomerId] = useState('');
  const [overrideAgreementId, setOverrideAgreementId] = useState('');
  const [overrideSourceProductKey, setOverrideSourceProductKey] = useState('cove-workstation');
  const [overrideTargetProductKey, setOverrideTargetProductKey] = useState('cove-server');
  const [overrideHostname, setOverrideHostname] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const accountMappings = mappingState?.accountMappings ?? [];
  const accountCandidates = mappingState?.accountCandidates ?? [];
  const accountRows = showMappedAccounts ? [...accountMappings, ...accountCandidates] : accountCandidates;
  const productRows = [
    ...(mappingState?.productMappings ?? []),
    ...(mappingState?.productCandidates ?? []),
  ];
  const productGroups = useMemo(() => buildProductGroups(productRows), [productRows]);
  const productSelectionDefaults = useMemo(() => buildProductSelectionDefaults(productGroups), [productGroups]);
  const productBundles = mappingState?.productBundles ?? [];
  const bundleProductOptions = useMemo(
    () =>
      productGroups
        .map((group) => ({
          vendorProductKey: group.vendorProductKey,
          vendorProductName: group.vendorProductName,
          rowCount: Math.max(...group.rows.map((row) => row.additionCount), 0),
        }))
        .sort(
          (left, right) =>
            left.vendorProductName.localeCompare(right.vendorProductName) ||
            left.vendorProductKey.localeCompare(right.vendorProductKey),
        ),
    [productGroups],
  );
  const customerOptions = mappingState?.customerOptions ?? [];
  const selectedOverrideCustomer = customerOptions.find((option) => option.customerId === overrideCustomerId);
  const overrideAgreementOptions = selectedOverrideCustomer?.agreements ?? [];
  const selectedIntegrationName =
    integrations.find((integration) => integration.id === selectedIntegrationId)?.name ?? 'Integration';
  const suggestedAccountCount = accountCandidates.filter(
    (candidate) => candidate.status === 'approved' && candidate.customerId,
  ).length;
  const bundleActionKey = editingBundleKey ? `bundle:${editingBundleKey}` : 'bundle:new';
  const bundleTargetOptions = dedupeProductTargets(
    bundleTarget ? [bundleTarget, ...bundleCatalogResults] : bundleCatalogResults,
  );

  const resetBundleForm = () => {
    setEditingBundleKey(null);
    setBundleName('');
    setBundleComponentKeys([]);
    setBundleTarget(null);
    setBundleCatalogQuery('');
    setBundleCatalogResults([]);
    setBundleCatalogMessage('');
    setBundleCatalogLoading(false);
  };

  useEffect(() => {
    setProductTargetSelections({});
    setProductTargetOverrides({});
    setShowProductCatalogOptions({});
    setProductCatalogResults({});
    setProductCatalogMessages({});
    setProductCatalogLoading({});
    setProductCustomerReview(null);
    setProductCustomerReviewLoadState('ready');
    setProductCustomerReviewMessage('');
    setSelectedProductCustomerId('');
    resetBundleForm();
  }, [mappingState?.vendorId, mappingState?.summary.productMappings, mappingState?.summary.productCandidates]);

  const openAccountEditor = (row: AccountMappingCandidate) => {
    const customerId = row.customerId ?? '';
    const customer = customerOptions.find((option) => option.customerId === customerId);
    setEditingAccountId(row.externalAccountId);
    setManualCustomerId(customerId);
    setManualAgreementId(
      row.agreementId && customer?.agreements.some((agreement) => agreement.agreementId === row.agreementId)
        ? row.agreementId
        : row.customerId && !row.agreementId
          ? noAgreementSyncValue
          : customer?.agreements[0]?.agreementId ?? '',
    );
  };

  const selectManualCustomer = (customerId: string) => {
    const customer = customerOptions.find((option) => option.customerId === customerId);
    setManualCustomerId(customerId);
    setManualAgreementId(customer ? customer.agreements[0]?.agreementId ?? noAgreementSyncValue : '');
  };

  const selectOverrideCustomer = (customerId: string) => {
    const customer = customerOptions.find((option) => option.customerId === customerId);
    setOverrideCustomerId(customerId);
    setOverrideAgreementId(customer?.agreements[0]?.agreementId ?? '');
  };

  const saveOverride = async () => {
    const dimensionFilters = overrideHostname.trim() ? { hostname: overrideHostname.trim() } : {};
    const saved = await onUsageOverrideCreate(selectedIntegrationId, {
      customerId: overrideCustomerId || undefined,
      agreementId: overrideAgreementId || undefined,
      sourceVendorProductKey: overrideSourceProductKey,
      targetVendorProductKey: overrideTargetProductKey,
      dimensionFilters,
      reason: overrideReason.trim() || undefined,
    });

    if (saved) {
      setOverrideHostname('');
      setOverrideReason('');
    }
  };

  const productSelectionFor = (vendorProductKey: string) =>
    productTargetSelections[vendorProductKey] ?? productSelectionDefaults[vendorProductKey] ?? [];

  const openProductCustomerReview = async (group: ProductMappingGroup) => {
    setProductCustomerReview({
      vendorId: group.vendorId,
      vendorProductKey: group.vendorProductKey,
      vendorProductName: group.vendorProductName,
      customerCount: group.customerCount,
      customers: [],
    });
    setSelectedProductCustomerId('');
    setProductCustomerReviewLoadState('loading');
    setProductCustomerReviewMessage('Loading customers and mapped agreement additions...');

    try {
      const review = await fetchProductMappingCustomers(group.vendorId, group.vendorProductKey);
      setProductCustomerReview(review);
      setSelectedProductCustomerId(review.customers[0]?.externalAccountId ?? '');
      setProductCustomerReviewLoadState('ready');
      setProductCustomerReviewMessage(
        `Loaded ${review.customerCount.toLocaleString()} customer${review.customerCount === 1 ? '' : 's'} with this vendor product.`,
      );
    } catch (error) {
      setProductCustomerReviewLoadState('failed');
      setProductCustomerReviewMessage(error instanceof Error ? error.message : 'Unable to load product customer review.');
    }
  };

  const closeProductCustomerReview = () => {
    setProductCustomerReview(null);
    setProductCustomerReviewLoadState('ready');
    setProductCustomerReviewMessage('');
    setSelectedProductCustomerId('');
  };

  const toggleProductTarget = (vendorProductKey: string, target: ProductMappingTarget) => {
    const targetCode = target.connectwiseProductCode;
    setProductTargetOverrides((current) => ({
      ...current,
      [productTargetOverrideKey(vendorProductKey, targetCode)]: target,
    }));
    setProductTargetSelections((current) => {
      const selected = current[vendorProductKey] ?? productSelectionDefaults[vendorProductKey] ?? [];
      const next = selected.includes(targetCode)
        ? selected.filter((code) => code !== targetCode)
        : [...selected, targetCode];

      return {
        ...current,
        [vendorProductKey]: next,
      };
    });
  };

  const toggleBundleComponent = (vendorProductKey: string) => {
    setBundleComponentKeys((current) =>
      current.includes(vendorProductKey)
        ? current.filter((currentKey) => currentKey !== vendorProductKey)
        : [...current, vendorProductKey],
    );
  };

  const editBundle = (bundle: ProductBundle) => {
    setEditingBundleKey(bundle.bundleKey);
    setBundleName(bundle.bundleName);
    setBundleComponentKeys(bundle.components.map((component) => component.vendorProductKey));
    setBundleTarget(bundle.target);
    setBundleCatalogQuery(bundle.target.connectwiseProductCode);
    setBundleCatalogResults([]);
    setBundleCatalogMessage('');
  };

  const runBundleCatalogSearch = async () => {
    const query = bundleCatalogQuery.trim();
    if (!query) {
      setBundleCatalogMessage('Enter a product code or name to search ConnectWise.');
      return;
    }

    setBundleCatalogLoading(true);
    setBundleCatalogMessage('');
    try {
      const response = await searchProductCatalog(selectedIntegrationId, query);
      setBundleCatalogResults(response.targets);
      setBundleCatalogMessage(
        response.warning ?? `${response.targets.length} catalog item${response.targets.length === 1 ? '' : 's'} found.`,
      );
    } catch (error) {
      setBundleCatalogResults([]);
      setBundleCatalogMessage(error instanceof Error ? error.message : 'Product catalog search failed.');
    } finally {
      setBundleCatalogLoading(false);
    }
  };

  const saveBundle = async () => {
    const components = bundleComponentKeys.flatMap((vendorProductKey) => {
      const option = bundleProductOptions.find((candidate) => candidate.vendorProductKey === vendorProductKey);
      return option
        ? [
            {
              vendorProductKey: option.vendorProductKey,
              vendorProductName: option.vendorProductName,
            },
          ]
        : [];
    });

    if (!bundleName.trim()) {
      setBundleCatalogMessage('Bundle name is required.');
      return;
    }

    if (components.length < 2) {
      setBundleCatalogMessage('Choose at least two vendor products.');
      return;
    }

    if (!bundleTarget) {
      setBundleCatalogMessage('Choose a ConnectWise bundle product.');
      return;
    }

    const saved = await onProductBundleSave(selectedIntegrationId, {
      bundleKey: editingBundleKey ?? undefined,
      bundleName: bundleName.trim(),
      components,
      targetProduct: bundleTarget,
    });

    if (saved) {
      resetBundleForm();
    }
  };

  const runProductCatalogSearch = async (integrationId: IntegrationId, vendorProductKey: string) => {
    const query = productCatalogQueries[vendorProductKey]?.trim() ?? '';
    if (!query) {
      setProductCatalogMessages((current) => ({
        ...current,
        [vendorProductKey]: 'Enter a product code or name to search ConnectWise.',
      }));
      return;
    }

    setProductCatalogLoading((current) => ({ ...current, [vendorProductKey]: true }));
    setProductCatalogMessages((current) => ({ ...current, [vendorProductKey]: '' }));
    try {
      const response = await searchProductCatalog(integrationId, query);
      setProductCatalogResults((current) => ({
        ...current,
        [vendorProductKey]: response.targets,
      }));
      setProductCatalogMessages((current) => ({
        ...current,
        [vendorProductKey]: response.warning ?? `${response.targets.length} catalog item${response.targets.length === 1 ? '' : 's'} found.`,
      }));
    } catch (error) {
      setProductCatalogResults((current) => ({ ...current, [vendorProductKey]: [] }));
      setProductCatalogMessages((current) => ({
        ...current,
        [vendorProductKey]: error instanceof Error ? error.message : 'Product catalog search failed.',
      }));
    } finally {
      setProductCatalogLoading((current) => ({ ...current, [vendorProductKey]: false }));
    }
  };

  return (
    <section className="mappings-page" aria-label="Mapping review">
      <div className="integrations-live-bar">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Mapping issue' : loadState === 'loading' ? 'Loading mappings' : 'Mapping workspace'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <label className="mapping-integration-select">
            <span>Integration</span>
            <select
              onChange={(event) => onIntegrationChange(event.target.value as IntegrationId)}
              value={selectedIntegrationId}
            >
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={onAutomap} type="button">
            <Zap size={16} />
            {busyAction === 'automap' ? 'Automapping' : 'Run automap'}
          </button>
          <button
            className="button primary compact"
            disabled={Boolean(busyAction) || suggestedAccountCount === 0}
            onClick={onApproveSuggested}
            title={suggestedAccountCount === 0 ? 'No suggested customer mappings are ready to approve.' : 'Approve all suggested customer mappings.'}
            type="button"
          >
            <Link2 size={16} />
            {busyAction === 'approve-suggested' ? 'Approving' : `Approve suggested (${suggestedAccountCount})`}
          </button>
        </div>
      </div>

      <section className="metric-grid mapping-metrics" aria-label="Mapping summary">
        <MetricCard icon={Users} label="Mapped clients" tone="approved" value={formatCount(mappingState?.summary.approvedAccountMappings ?? 0)} />
        <MetricCard icon={ClipboardCheck} label="Client review" tone="warn" value={formatCount(mappingState?.summary.accountCandidatesNeedingReview ?? 0)} />
        <MetricCard icon={Package} label="Mapped products" tone="ready" value={formatCount(mappingState?.summary.approvedProductMappings ?? 0)} />
        <MetricCard icon={Database} label="Unmapped products" tone="money" value={formatCount(mappingState?.summary.productCandidates ?? 0)} />
      </section>

      {selectedIntegrationId === 'ncentral' ? (
        <NcentralFilterMappingPanel
          busyAction={busyAction}
          filters={ncentralFilters}
          mappings={ncentralFilterMappings}
          onSave={onNcentralFilterMappingSave}
        />
      ) : null}

      <section className="mapping-review-grid">
        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Account mapping</span>
              <h2>
                {showMappedAccounts
                  ? `${accountRows.length.toLocaleString()} vendor accounts`
                  : `${accountCandidates.length.toLocaleString()} unmapped vendor accounts`}
              </h2>
            </div>
            <label className="switch-control compact-switch">
              <input
                checked={showMappedAccounts}
                onChange={(event) => setShowMappedAccounts(event.target.checked)}
                type="checkbox"
              />
              Show mapped customers
            </label>
          </div>

          <div className="mapping-review-list">
            <div className="mapping-review-header account" role="row">
              <span>{selectedIntegrationName} customer</span>
              <span aria-hidden="true" />
              <span>ConnectWise customer / agreement</span>
              <span>Status</span>
              <span>Score</span>
              <span>Actions</span>
            </div>
            {accountRows.length === 0 ? (
              <div className="empty-state">
                <Users size={20} />
                <strong>No account mappings found.</strong>
                <span>Run automap after a vendor sync to generate client candidates.</span>
              </div>
            ) : null}

            {accountRows.map((row) => {
              const actionKey = `account:${row.externalAccountId}`;
              const isCandidate = !('id' in row);
              const isMapped = !isCandidate && row.status === 'approved' && 'active' in row && row.active;
              const isSuggested = isCandidate && row.status === 'approved';
              const canApproveCandidate = isCandidate && Boolean(row.customerId);
              const isEditing = editingAccountId === row.externalAccountId;
              const selectedCustomer = customerOptions.find((option) => option.customerId === manualCustomerId);
              const selectedAgreementOptions = selectedCustomer?.agreements ?? [];
              return (
                <Fragment key={`${row.externalAccountId}-${row.agreementId ?? 'none'}-${isCandidate ? 'candidate' : 'saved'}`}>
                  <article className="mapping-review-row account">
                    <div>
                      <strong>{row.externalAccountName}</strong>
                      <span>{row.externalAccountId}</span>
                    </div>
                    <ArrowRight size={16} />
                    <div>
                      <strong>{row.customerName ?? 'No customer match'}</strong>
                      <span>{row.agreementName ?? (row.customerId ? 'No Agreement Sync' : 'No agreement selected')}</span>
                    </div>
                    <span className={`status-pill ${mappingStatusClass(row.status, isCandidate)}`}>
                      {mappingStatusLabel(row.status, isCandidate)}
                    </span>
                    <strong>{Math.round(row.matchScore)}%</strong>
                    <span className="mapping-actions">
                      {canApproveCandidate ? (
                        <button
                          className="icon-button table-icon"
                          disabled={!row.customerId || busyAction === actionKey}
                          onClick={() => onAccountApprove(row)}
                          title={isSuggested ? 'Map suggested customer' : 'Approve this reviewed mapping'}
                          type="button"
                        >
                          <Check size={16} />
                        </button>
                      ) : null}
                      <button
                        className="icon-button table-icon"
                        disabled={busyAction === actionKey}
                        onClick={() => openAccountEditor(row)}
                        title={isMapped ? 'Edit mapped customer' : 'Edit mapping'}
                        type="button"
                      >
                        <Pencil size={16} />
                      </button>
                    </span>
                  </article>
                  {isEditing ? (
                    <div className="mapping-edit-panel">
                      <label>
                        <span>ConnectWise customer</span>
                        <select
                          onChange={(event) => selectManualCustomer(event.target.value)}
                          value={manualCustomerId}
                        >
                          <option value="">Select customer</option>
                          {customerOptions.map((customer) => (
                            <option key={customer.customerId} value={customer.customerId}>
                              {customer.connectWiseCompanyId
                                ? `${customer.customerName} (#${customer.connectWiseCompanyId})`
                                : customer.customerName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Agreement</span>
                        <select
                          disabled={!manualCustomerId}
                          onChange={(event) => setManualAgreementId(event.target.value)}
                          value={manualAgreementId}
                        >
                          <option value="">Select agreement</option>
                          <option value={noAgreementSyncValue}>No Agreement Sync</option>
                          {selectedAgreementOptions.map((agreement) => (
                            <option key={agreement.agreementId} value={agreement.agreementId}>
                              {agreement.agreementName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="mapping-edit-actions">
                        <button
                          className="button primary compact"
                          disabled={!manualCustomerId || !manualAgreementId || busyAction === actionKey}
                          onClick={async () => {
                            const saved = await onAccountManualSave(row, manualCustomerId, manualAgreementId);
                            if (saved) {
                              setEditingAccountId(null);
                            }
                          }}
                          type="button"
                        >
                          Save mapping
                        </button>
                        <button
                          className="button secondary compact"
                          disabled={busyAction === actionKey}
                          onClick={() => setEditingAccountId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </div>

        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Product mapping</span>
              <h2>{productGroups.length.toLocaleString()} {selectedIntegrationName} product groups</h2>
            </div>
          </div>

          <div className="mapping-review-list">
            <div className="mapping-review-header product" role="row">
              <span>{selectedIntegrationName} product</span>
              <span aria-hidden="true" />
              <span>ConnectWise product</span>
              <span>Status</span>
              <span>Score</span>
              <span>Actions</span>
            </div>
            {productGroups.length === 0 ? (
              <div className="empty-state">
                <Package size={20} />
                <strong>No product mappings found.</strong>
                <span>Product candidates appear after vendor usage and ConnectWise products are synced.</span>
              </div>
            ) : null}

            {productGroups.map((group) => {
              const actionKey = `product:${group.vendorProductKey}`;
              const selectedCodes = productSelectionFor(group.vendorProductKey);
              const rowTargetsByCode = new Map(
                group.rows.map((row) => [row.target.connectwiseProductCode, row.target] as const),
              );
              const selectedTargets = selectedCodes
                .map(
                  (code) =>
                    rowTargetsByCode.get(code) ??
                    productTargetOverrides[productTargetOverrideKey(group.vendorProductKey, code)],
                )
                .filter((target): target is ProductMappingTarget => Boolean(target));
              const selectedRows = selectedTargets.map((target) =>
                productRowForTarget(group, target, group.rows.find((row) => row.target.connectwiseProductCode === target.connectwiseProductCode)),
              );
              const availableRows = group.rows.filter((row) => !selectedCodes.includes(row.target.connectwiseProductCode));
              const catalogOptionsOpen = Boolean(showProductCatalogOptions[group.vendorProductKey]);
              const catalogResultRows = (productCatalogResults[group.vendorProductKey] ?? [])
                .filter(
                  (target) =>
                    !selectedCodes.includes(target.connectwiseProductCode) &&
                    !group.rows.some((row) => row.target.connectwiseProductCode === target.connectwiseProductCode),
                )
                .map((target) => productRowForTarget(group, target));
              const visibleRows = catalogOptionsOpen
                ? dedupeProductRows([...selectedRows, ...catalogResultRows, ...availableRows])
                : selectedRows;
              const bestScore = Math.max(...group.rows.map((row) => row.matchScore), 0);
              const approvedCount = group.rows.filter((row) => 'active' in row && row.active && row.status === 'approved').length;
              return (
                <article className="mapping-review-row product product-group-row" key={group.vendorProductKey}>
                  <div>
                    <strong>{group.vendorProductName}</strong>
                    <span>{group.vendorProductKey}</span>
                    <button
                      className="product-customer-count-button"
                      disabled={group.customerCount === 0 || productCustomerReviewLoadState === 'loading'}
                      onClick={() => void openProductCustomerReview(group)}
                      title={group.customerCount === 0 ? 'No synced customers currently have this vendor product.' : 'Review customers and mapped agreement additions'}
                      type="button"
                    >
                      <Users size={14} />
                      {group.customerCount.toLocaleString()} customer{group.customerCount === 1 ? '' : 's'}
                    </button>
                  </div>
                  <ArrowRight size={16} />
                  <div className="product-target-list">
                    {visibleRows.length === 0 ? (
                      <span className="product-target-empty">No ConnectWise product selected.</span>
                    ) : null}
                    {visibleRows.map((row) => {
                      const targetCode = row.target.connectwiseProductCode;
                      const isMapped = 'active' in row && row.active && row.status === 'approved';
                      return (
                        <label className="product-target-option" key={targetCode}>
                          <input
                            checked={selectedCodes.includes(targetCode)}
                            onChange={() => toggleProductTarget(group.vendorProductKey, row.target)}
                            type="checkbox"
                          />
                          <span>
                            <strong>{row.target.connectwiseProductName}</strong>
                            <em>
                              {targetCode} - {productRowSourceLabel(row)}
                              {isMapped ? ' - mapped' : ''}
                            </em>
                          </span>
                        </label>
                      );
                    })}
                    {catalogOptionsOpen ? (
                      <div className="product-catalog-search">
                        <label>
                          <span>Search ConnectWise product catalog</span>
                          <div className="product-catalog-search-row">
                            <input
                              onChange={(event) =>
                                setProductCatalogQueries((current) => ({
                                  ...current,
                                  [group.vendorProductKey]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void runProductCatalogSearch(group.vendorId, group.vendorProductKey);
                                }
                              }}
                              placeholder="Product code or name"
                              value={productCatalogQueries[group.vendorProductKey] ?? ''}
                            />
                            <button
                              className="button secondary compact"
                              disabled={Boolean(productCatalogLoading[group.vendorProductKey])}
                              onClick={() => void runProductCatalogSearch(group.vendorId, group.vendorProductKey)}
                              type="button"
                            >
                              <Search size={14} />
                              {productCatalogLoading[group.vendorProductKey] ? 'Searching' : 'Search'}
                            </button>
                          </div>
                        </label>
                        {productCatalogMessages[group.vendorProductKey] ? (
                          <span className="product-catalog-message">{productCatalogMessages[group.vendorProductKey]}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      className="button secondary compact product-catalog-toggle"
                      onClick={() =>
                        setShowProductCatalogOptions((current) => ({
                          ...current,
                          [group.vendorProductKey]: !catalogOptionsOpen,
                        }))
                      }
                      type="button"
                    >
                      {catalogOptionsOpen ? 'Hide catalog items' : `Search / add catalog items (${availableRows.length} suggestions)`}
                    </button>
                  </div>
                  <span className={`status-pill ${approvedCount > 0 ? 'approved' : 'ready'}`}>
                    {approvedCount > 0 ? `${approvedCount} mapped` : 'Suggested'}
                  </span>
                  <strong>{Math.round(bestScore)}%</strong>
                  <span className="mapping-actions">
                    <button
                      className="button primary compact"
                      disabled={busyAction === actionKey || selectedTargets.length === 0}
                      onClick={() => void onProductTargetsSave(group.vendorId, group.vendorProductKey, selectedTargets)}
                      title="Save selected ConnectWise product targets"
                      type="button"
                    >
                      <Check size={16} />
                      Save
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {selectedIntegrationId === 'opentext-appriver' ? (
        <section className="work-surface product-bundle-surface" aria-label="AppRiver product bundles">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Bundles</span>
              <h2>{productBundles.filter((bundle) => bundle.active).length.toLocaleString()} active AppRiver bundles</h2>
            </div>
            {editingBundleKey ? (
              <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={resetBundleForm} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className="product-bundle-form">
            <label>
              <span>{editingBundleKey ? 'Editing bundle' : 'Bundle name'}</span>
              <input
                onChange={(event) => setBundleName(event.target.value)}
                placeholder="Zix Advanced Email Suite"
                value={bundleName}
              />
            </label>

            <div className="product-bundle-components" aria-label="Vendor bundle products">
              {bundleProductOptions.map((option) => (
                <label className="product-bundle-component-option" key={option.vendorProductKey}>
                  <input
                    checked={bundleComponentKeys.includes(option.vendorProductKey)}
                    onChange={() => toggleBundleComponent(option.vendorProductKey)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{option.vendorProductName}</strong>
                    <em>{option.vendorProductKey}</em>
                  </span>
                </label>
              ))}
            </div>

            <div className="product-bundle-target">
              <label>
                <span>ConnectWise product</span>
                <div className="product-catalog-search-row">
                  <input
                    onChange={(event) => setBundleCatalogQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void runBundleCatalogSearch();
                      }
                    }}
                    placeholder="Bundle product code or name"
                    value={bundleCatalogQuery}
                  />
                  <button
                    className="button secondary compact"
                    disabled={bundleCatalogLoading}
                    onClick={() => void runBundleCatalogSearch()}
                    type="button"
                  >
                    <Search size={14} />
                    {bundleCatalogLoading ? 'Searching' : 'Search'}
                  </button>
                </div>
              </label>
              {bundleCatalogMessage ? <span className="product-catalog-message">{bundleCatalogMessage}</span> : null}
              <div className="product-bundle-target-list">
                {bundleTargetOptions.map((target) => (
                  <label className="product-target-option" key={target.connectwiseProductCode}>
                    <input
                      checked={bundleTarget?.connectwiseProductCode === target.connectwiseProductCode}
                      onChange={() => setBundleTarget(target)}
                      type="radio"
                    />
                    <span>
                      <strong>{target.connectwiseProductName}</strong>
                      <em>{target.connectwiseProductCode}</em>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="product-bundle-actions">
              <button
                className="button primary compact"
                disabled={
                  Boolean(busyAction) ||
                  !bundleName.trim() ||
                  bundleComponentKeys.length < 2 ||
                  !bundleTarget
                }
                onClick={() => void saveBundle()}
                type="button"
              >
                <Package size={16} />
                {busyAction === bundleActionKey
                  ? 'Saving'
                  : editingBundleKey
                    ? 'Update bundle'
                    : 'Save bundle'}
              </button>
              {editingBundleKey ? (
                <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={resetBundleForm} type="button">
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          <div className="product-bundle-list">
            {productBundles.length === 0 ? (
              <div className="empty-state">
                <Package size={20} />
                <strong>No AppRiver bundles saved.</strong>
              </div>
            ) : null}
            {productBundles.map((bundle) => (
              <article className="product-bundle-row" key={bundle.bundleKey}>
                <div>
                  <strong>{bundle.bundleName}</strong>
                  <span>{bundle.bundleKey}</span>
                </div>
                <ArrowRight size={16} />
                <div>
                  <strong>{bundle.target.connectwiseProductName}</strong>
                  <span>{bundle.target.connectwiseProductCode}</span>
                </div>
                <span className={`status-pill ${bundle.active ? 'approved' : 'blocked'}`}>
                  {bundle.active ? 'Active' : 'Disabled'}
                </span>
                <span>{bundle.components.length.toLocaleString()} products</span>
                <div className="product-bundle-row-actions">
                  <button
                    className="button secondary compact"
                    disabled={Boolean(busyAction)}
                    onClick={() => editBundle(bundle)}
                    type="button"
                  >
                    <Pencil size={15} />
                    Edit
                  </button>
                  <button
                    className="button secondary compact"
                    disabled={!bundle.active || busyAction === `bundle:${bundle.bundleKey}`}
                    onClick={() => void onProductBundleDeactivate(selectedIntegrationId, bundle.bundleKey)}
                    type="button"
                  >
                    Disable
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="work-surface usage-overrides-surface" aria-label="Usage overrides">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Usage overrides</span>
            <h2>{usageOverrides.length.toLocaleString()} active overrides</h2>
          </div>
        </div>

        <div className="usage-override-form">
          <label>
            <span>Customer</span>
            <select onChange={(event) => selectOverrideCustomer(event.target.value)} value={overrideCustomerId}>
              <option value="">Any mapped customer</option>
              {customerOptions.map((customer) => (
                <option key={customer.customerId} value={customer.customerId}>
                  {customer.customerName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Agreement</span>
            <select
              disabled={!overrideCustomerId || overrideAgreementOptions.length === 0}
              onChange={(event) => setOverrideAgreementId(event.target.value)}
              value={overrideAgreementId}
            >
              <option value="">Any agreement</option>
              {overrideAgreementOptions.map((agreement) => (
                <option key={agreement.agreementId} value={agreement.agreementId}>
                  {agreement.agreementName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <select
              onChange={(event) => setOverrideSourceProductKey(event.target.value)}
              value={overrideSourceProductKey}
            >
              {usageOverrideProductOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>To</span>
            <select
              onChange={(event) => setOverrideTargetProductKey(event.target.value)}
              value={overrideTargetProductKey}
            >
              {usageOverrideProductOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Hostname</span>
            <input
              onChange={(event) => setOverrideHostname(event.target.value)}
              placeholder="Optional exact match"
              value={overrideHostname}
            />
          </label>
          <label>
            <span>Reason</span>
            <input
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Billing note"
              value={overrideReason}
            />
          </label>
          <button
            className="button primary compact"
            disabled={
              Boolean(busyAction) ||
              !overrideSourceProductKey ||
              !overrideTargetProductKey ||
              overrideSourceProductKey === overrideTargetProductKey
            }
            onClick={() => void saveOverride()}
            type="button"
          >
            <Check size={16} />
            Save override
          </button>
        </div>

        <div className="usage-override-list">
          {usageOverrides.length === 0 ? (
            <div className="empty-state">
              <SlidersHorizontal size={20} />
              <strong>No active usage overrides.</strong>
            </div>
          ) : null}

          {usageOverrides.map((override) => (
            <article className="usage-override-row" key={override.id}>
              <div>
                <strong>{override.customerName ?? 'Any mapped customer'}</strong>
                <span>{override.agreementName ?? 'Any agreement'}</span>
              </div>
              <ArrowRight size={16} />
              <div>
                <strong>
                  {usageOverrideProductLabel(override.sourceVendorProductKey)} to{' '}
                  {usageOverrideProductLabel(override.targetVendorProductKey)}
                </strong>
                <span>
                  {usageOverrideFilterLabel(override.dimensionFilters)}
                  {override.reason ? ` / ${override.reason}` : ''}
                </span>
              </div>
              <button
                className="icon-button table-icon"
                disabled={busyAction === `override:${override.id}`}
                onClick={() => void onUsageOverrideDeactivate(selectedIntegrationId, override.id)}
                title="Deactivate override"
                type="button"
              >
                <X size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>

      {productCustomerReview ? (
        <ProductCustomerReviewModal
          loadState={productCustomerReviewLoadState}
          message={productCustomerReviewMessage}
          onClose={closeProductCustomerReview}
          onSelectCustomer={setSelectedProductCustomerId}
          review={productCustomerReview}
          selectedCustomerId={selectedProductCustomerId}
        />
      ) : null}
    </section>
  );
}

function mappingStatusLabel(status: MappingStatus, isCandidate = false) {
  if (isCandidate && (status === 'approved' || status === 'candidate')) return 'Suggested';
  if (status === 'needs-review') return 'Needs review';
  if (status === 'approved') return 'Mapped';
  if (status === 'rejected') return 'Rejected';
  return 'Suggested';
}

function mappingStatusClass(status: MappingStatus, isCandidate: boolean) {
  if (status === 'rejected') return 'blocked';
  if (isCandidate && (status === 'approved' || status === 'candidate')) return 'ready';
  if (status === 'approved') return 'approved';
  return 'needs-review';
}

const usageOverrideProductOptions = [
  { key: 'cove-workstation', label: 'Cove Workstation Backup' },
  { key: 'cove-server', label: 'Cove Server Backup' },
  { key: 'cove-server-storage-addon', label: 'Cove Server Storage Add-on' },
];

function usageOverrideProductLabel(key: string) {
  return usageOverrideProductOptions.find((option) => option.key === key)?.label ?? key;
}

function usageOverrideFilterLabel(filters: DimensionMap) {
  const entries = Object.entries(filters).filter(([, value]) => typeof value !== 'undefined' && value !== null && value !== '');
  if (entries.length === 0) {
    return 'All matching usage rows';
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function vendorDevicesFromIssues(issues: ReconcileIssue[]) {
  const devicesById = new Map<string, ReconciliationDevice>();

  issues.forEach((issue) => {
    issue.devices.forEach((device) => {
      if (!devicesById.has(device.id)) {
        devicesById.set(device.id, device);
      }
    });
  });

  return Array.from(devicesById.values()).sort(
    (left, right) =>
      left.productName.localeCompare(right.productName) ||
      deviceDisplayName(left).localeCompare(deviceDisplayName(right)) ||
      left.id.localeCompare(right.id),
  );
}

const ncentralVendorDataColumns: VendorDataColumn[] = [
  { label: 'Device Name', primary: true, value: deviceDisplayName },
  { label: 'ID', value: deviceIdentityLabel },
  { label: 'Type', value: deviceTypeLabel },
  { label: 'Product', value: (device) => device.productName },
  { label: 'OS', value: deviceOsLabel },
  { label: 'Last Check-In', format: 'date', value: deviceLastCheckIn },
  { label: 'Tags', value: deviceTagLabel },
];

const appRiverVendorDataColumns: VendorDataColumn[] = [
  { label: 'Subscription', primary: true, value: (device) => device.dimensions.productName ?? device.productName },
  { label: 'Product Code', value: (device) => device.dimensions.productCode ?? device.productCode },
  { label: 'Quantity', value: (device) => device.dimensions.subscriptionQuantity ?? device.quantity },
  { label: 'Assigned', value: (device) => device.dimensions.assignedLicenses },
  { label: 'Unassigned', value: (device) => device.dimensions.unassignedLicenses },
  { label: 'Term', value: (device) => device.dimensions.subscriptionTerm },
  { label: 'Billing', value: (device) => device.dimensions.billingFrequency },
  { label: 'Domain', value: (device) => device.dimensions.domain },
  { label: 'Commitment End', format: 'date', value: (device) => device.dimensions.commitmentEndDate },
  { label: 'Expiration', format: 'date', value: (device) => device.dimensions.expirationDate },
];

const coveVendorDataColumns: VendorDataColumn[] = [
  { label: 'System', primary: true, value: deviceDisplayName },
  { label: 'Type', value: deviceTypeLabel },
  { label: 'Product', value: (device) => device.productName },
  { label: 'Selected GB', value: (device) => device.dimensions.selectedStorageGb },
  { label: 'Used GB', value: (device) => device.dimensions.usedStorageGb },
  { label: 'Last Complete', format: 'date', value: (device) => device.dimensions.lastComplete },
  { label: 'Account', value: (device) => device.dimensions.accountId },
];

const microsoft365VendorDataColumns: VendorDataColumn[] = [
  { label: 'User', primary: true, value: deviceDisplayName },
  { label: 'SKU', value: (device) => device.dimensions.skuPartNumber ?? device.dimensions.skuName ?? device.productName },
  { label: 'Product', value: (device) => device.productName },
  { label: 'Tenant', value: (device) => device.dimensions.tenantName },
  { label: 'State', value: (device) => device.dimensions.userState ?? device.dimensions.accountEnabled },
  { label: 'Consumed', value: (device) => device.dimensions.consumedUnits },
  { label: 'Enabled', value: (device) => device.dimensions.enabledUnits },
  { label: 'Observed', format: 'date', value: (device) => device.observedAt },
];

const genericVendorDataColumns: VendorDataColumn[] = [
  { label: 'Name', primary: true, value: deviceDisplayName },
  { label: 'Product', value: (device) => device.productName },
  { label: 'Code', value: (device) => device.productCode },
  { label: 'Quantity', value: (device) => device.quantity },
  { label: 'Observed', format: 'date', value: (device) => device.observedAt },
];

function vendorDataColumns(selection: VendorDataSelection) {
  if (selection.vendorId === 'opentext-appriver') return appRiverVendorDataColumns;
  if (selection.vendorId === 'microsoft-365') return microsoft365VendorDataColumns;
  if (selection.vendorId === 'cove') return coveVendorDataColumns;
  if (selection.vendorId === 'ncentral') return ncentralVendorDataColumns;
  return genericVendorDataColumns;
}

function formatVendorDataColumnValue(column: VendorDataColumn, device: ReconciliationDevice): string {
  const value = column.value(device);

  if (column.format === 'date') {
    const formatted = formatDateTime(typeof value === 'string' || typeof value === 'number' ? String(value) : undefined);
    return formatted ?? formatVendorDataValue(value);
  }

  return formatVendorDataValue(value);
}

function formatVendorDataValue(value: DimensionValue | Array<string | number | boolean>): string {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '-';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((entry) => formatVendorDataValue(entry)).join(', ') : '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  return value;
}

function deviceIdentityFilter(device: ReconciliationDevice): DimensionMap {
  const identityKeys = [
    'hostname',
    'deviceName',
    'computerName',
    'deviceId',
    'serialNumber',
    'accountId',
    'externalId',
    'userPrincipalName',
    'email',
  ];

  for (const key of identityKeys) {
    const value = device.dimensions[key];
    if (typeof value !== 'undefined' && value !== null && value !== '') {
      return { [key]: value };
    }
  }

  return {};
}

function deviceDisplayName(device: ReconciliationDevice) {
  const dimensions = device.dimensions;
  return String(
    dimensions.hostname ??
      dimensions.deviceName ??
      dimensions.computerName ??
      dimensions.userPrincipalName ??
      dimensions.email ??
      dimensions.accountId ??
      device.id,
  );
}

function deviceDetailSummary(device: ReconciliationDevice) {
  const dimensions = device.dimensions;
  const details = [
    dimensions.protectedSystemType,
    dimensions.physicality,
    typeof dimensions.selectedStorageGb === 'number' ? `${dimensions.selectedStorageGb.toLocaleString()} GB selected` : undefined,
    dimensions.os ?? dimensions.operatingSystem,
  ].filter(Boolean);

  return details.length > 0 ? details.join(' / ') : device.productCode;
}

function deviceIdentityLabel(device: ReconciliationDevice) {
  const dimensions = device.dimensions;
  const id =
    dimensions.ncentralDeviceId ??
    dimensions.deviceId ??
    dimensions.serialNumber ??
    dimensions.accountId ??
    dimensions.externalId;

  return typeof id === 'undefined' || id === null || id === '' ? device.id : `ID ${String(id)}`;
}

function deviceTypeLabel(device: ReconciliationDevice) {
  const dimensions = device.dimensions;
  const productType = humanizeIdentifier(dimensions.ncentralProductType ?? dimensions.protectedSystemType);
  const deviceClass = humanizeIdentifier(dimensions.deviceClass ?? dimensions.physicality);

  if (productType && deviceClass && productType.toLowerCase() !== deviceClass.toLowerCase()) {
    return `${productType} / ${deviceClass}`;
  }

  return productType || deviceClass || deviceDetailSummary(device);
}

function deviceProductCodeLabel(device: ReconciliationDevice) {
  return device.productCode === device.productName ? '' : device.productCode;
}

function deviceOsLabel(device: ReconciliationDevice) {
  const value = device.dimensions.operatingSystem ?? device.dimensions.os;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '-';
}

function deviceLastCheckIn(device: ReconciliationDevice) {
  const value = device.dimensions.lastApplianceCheckinTime ?? device.dimensions.lastCheckIn;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function deviceTagLabel(device: ReconciliationDevice) {
  const tags = device.dimensions.overlayTags;
  if (Array.isArray(tags)) {
    return tags.length > 0 ? tags.join(', ') : '-';
  }

  return typeof tags === 'string' && tags.trim() ? tags : '-';
}

function humanizeIdentifier(value: DimensionMap[string]) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  return String(value)
    .replace(/^ncentral-/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function NcentralFilterMappingPanel(props: {
  busyAction: string | null;
  filters: NcentralFilter[];
  mappings: NcentralFilterMapping[];
  onSave: (payload: Partial<NcentralFilterMapping>) => Promise<void>;
}) {
  const { busyAction, filters, mappings, onSave } = props;
  const [mappingType, setMappingType] = useState<NcentralFilterMapping['mappingType']>('overlay');
  const [filterName, setFilterName] = useState('');
  const [filterId, setFilterId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [vendorProductKey, setVendorProductKey] = useState('');
  const [tagKey, setTagKey] = useState('');
  const [priority, setPriority] = useState(100);
  const productMappings = mappings.filter((mapping) => mapping.mappingType === 'product');
  const overlayMappings = mappings.filter((mapping) => mapping.mappingType === 'overlay');

  const selectFilter = (value: string) => {
    const filter = filters.find((item) => item.filterId === value);
    setFilterId(filter?.filterId ?? '');
    setFilterName(filter?.filterName ?? '');
    if (filter && !displayName) {
      setDisplayName(filter.filterName);
    }
  };

  const submitNewMapping = async () => {
    await onSave({
      filterId: filterId || undefined,
      filterName,
      mappingType,
      displayName: displayName || filterName,
      vendorProductKey: mappingType === 'product' ? vendorProductKey : undefined,
      tagKey: mappingType === 'overlay' ? tagKey : undefined,
      priority,
      status: 'approved',
      active: true,
    });
    setFilterId('');
    setFilterName('');
    setDisplayName('');
    setVendorProductKey('');
    setTagKey('');
    setPriority(100);
  };

  return (
    <section className="work-surface ncentral-filter-panel" aria-label="N-central filter mapping">
      <div className="surface-header">
        <div>
          <span className="section-kicker">N-central filters</span>
          <h2>{mappings.length.toLocaleString()} billing and overlay filters</h2>
        </div>
        <span className="status-pill ready">{filters.length.toLocaleString()} discovered</span>
      </div>

      <div className="ncentral-filter-grid">
        <div>
          <h3>Product filters</h3>
          <div className="ncentral-filter-list">
            {productMappings.map((mapping) => (
              <NcentralFilterMappingRow busyAction={busyAction} filters={filters} key={mapping.id} mapping={mapping} onSave={onSave} />
            ))}
          </div>
        </div>

        <div>
          <h3>Overlay tags</h3>
          <div className="ncentral-filter-list">
            {overlayMappings.map((mapping) => (
              <NcentralFilterMappingRow busyAction={busyAction} filters={filters} key={mapping.id} mapping={mapping} onSave={onSave} />
            ))}
          </div>
        </div>
      </div>

      <div className="ncentral-filter-form">
        <label>
          <span>Type</span>
          <select onChange={(event) => setMappingType(event.target.value as NcentralFilterMapping['mappingType'])} value={mappingType}>
            <option value="overlay">Overlay tag</option>
            <option value="product">Product</option>
          </select>
        </label>
        <label>
          <span>Discovered filter</span>
          <select onChange={(event) => selectFilter(event.target.value)} value={filterId}>
            <option value="">Manual filter name</option>
            {filters.map((filter) => (
              <option key={filter.filterId} value={filter.filterId}>
                {filter.filterName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Filter name</span>
          <input onChange={(event) => setFilterName(event.target.value)} placeholder="Exact N-central filter name" value={filterName} />
        </label>
        <label>
          <span>Display name</span>
          <input onChange={(event) => setDisplayName(event.target.value)} placeholder="Shown in MSP Harmony" value={displayName} />
        </label>
        {mappingType === 'product' ? (
          <label>
            <span>Product key</span>
            <input onChange={(event) => setVendorProductKey(event.target.value)} placeholder="ncentral-custom-product" value={vendorProductKey} />
          </label>
        ) : (
          <label>
            <span>Tag key</span>
            <input onChange={(event) => setTagKey(event.target.value)} placeholder="custom-tag" value={tagKey} />
          </label>
        )}
        <label>
          <span>Priority</span>
          <input onChange={(event) => setPriority(Number(event.target.value))} type="number" value={priority} />
        </label>
        <button
          className="button primary compact"
          disabled={
            Boolean(busyAction) ||
            !filterName.trim() ||
            !displayName.trim() ||
            (mappingType === 'product' ? !vendorProductKey.trim() : !tagKey.trim())
          }
          onClick={() => void submitNewMapping()}
          type="button"
        >
          <Filter size={16} />
          Add filter
        </button>
      </div>
    </section>
  );
}

function NcentralFilterMappingRow(props: {
  busyAction: string | null;
  filters: NcentralFilter[];
  mapping: NcentralFilterMapping;
  onSave: (payload: Partial<NcentralFilterMapping>) => Promise<void>;
}) {
  const { busyAction, filters, mapping, onSave } = props;
  const actionKey = `ncentral-filter:${mapping.id}`;
  const [editing, setEditing] = useState(false);
  const [filterId, setFilterId] = useState(mapping.filterId ?? '');
  const [filterName, setFilterName] = useState(mapping.filterName);
  const [displayName, setDisplayName] = useState(mapping.displayName);
  const [priority, setPriority] = useState(mapping.priority);
  const [vendorProductKey, setVendorProductKey] = useState(mapping.vendorProductKey ?? '');
  const [tagKey, setTagKey] = useState(mapping.tagKey ?? '');

  const selectFilter = (value: string) => {
    const filter = filters.find((item) => item.filterId === value);
    setFilterId(filter?.filterId ?? '');
    setFilterName(filter?.filterName ?? '');
  };

  const cancelEdit = () => {
    setEditing(false);
    setFilterId(mapping.filterId ?? '');
    setFilterName(mapping.filterName);
    setDisplayName(mapping.displayName);
    setPriority(mapping.priority);
    setVendorProductKey(mapping.vendorProductKey ?? '');
    setTagKey(mapping.tagKey ?? '');
  };

  const saveEdit = async () => {
    await onSave({
      ...mapping,
      filterId: filterId || undefined,
      filterName,
      displayName,
      priority,
      vendorProductKey: mapping.mappingType === 'product' ? vendorProductKey : undefined,
      tagKey: mapping.mappingType === 'overlay' ? tagKey : undefined,
    });
    setEditing(false);
  };

  return (
    <article className={editing ? 'ncentral-filter-row editing' : 'ncentral-filter-row'}>
      <div className="ncentral-filter-row-main">
        <div>
          <strong>{mapping.displayName}</strong>
          <span>{mapping.filterName}</span>
          <small>{mapping.filterId ? `Filter ID ${mapping.filterId}` : 'Filter resolves by exact name'}</small>
        </div>
        <span className={`status-pill ${mapping.active ? 'approved' : 'needs-review'}`}>
          {mapping.active ? 'Active' : 'Inactive'}
        </span>
        <em>{mapping.mappingType === 'product' ? mapping.vendorProductKey : mapping.tagKey}</em>
        <div className="ncentral-filter-row-actions">
          <button className="button secondary compact" disabled={busyAction === actionKey} onClick={() => setEditing(true)} type="button">
            <Pencil size={15} />
            Edit
          </button>
          <button
            className="button secondary compact"
            disabled={busyAction === actionKey}
            onClick={() => void onSave({ ...mapping, active: !mapping.active })}
            type="button"
          >
            {mapping.active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="ncentral-filter-edit-panel">
          <label>
            <span>Discovered filter</span>
            <select onChange={(event) => selectFilter(event.target.value)} value={filterId}>
              <option value="">Manual filter name</option>
              {filters.map((filter) => (
                <option key={filter.filterId} value={filter.filterId}>
                  {filter.filterName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Filter name</span>
            <input onChange={(event) => setFilterName(event.target.value)} value={filterName} />
          </label>
          <label>
            <span>Display name</span>
            <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          {mapping.mappingType === 'product' ? (
            <label>
              <span>Product key</span>
              <input onChange={(event) => setVendorProductKey(event.target.value)} value={vendorProductKey} />
            </label>
          ) : (
            <label>
              <span>Tag key</span>
              <input onChange={(event) => setTagKey(event.target.value)} value={tagKey} />
            </label>
          )}
          <label>
            <span>Priority</span>
            <input onChange={(event) => setPriority(Number(event.target.value))} type="number" value={priority} />
          </label>
          <div className="ncentral-filter-edit-actions">
            <button
              className="button primary compact"
              disabled={
                busyAction === actionKey ||
                !filterName.trim() ||
                !displayName.trim() ||
                (mapping.mappingType === 'product' ? !vendorProductKey.trim() : !tagKey.trim())
              }
              onClick={() => void saveEdit()}
              type="button"
            >
              Save
            </button>
            <button className="button secondary compact" disabled={busyAction === actionKey} onClick={cancelEdit} type="button">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

type ProductMappingRow = ProductMapping | ProductMappingCandidate;

type ProductMappingGroup = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
  customerCount: number;
  rows: ProductMappingRow[];
};

function productTargetOverrideKey(vendorProductKey: string, targetCode: string) {
  return `${vendorProductKey}:${targetCode}`;
}

function productRowForTarget(
  group: ProductMappingGroup,
  target: ProductMappingTarget,
  existingRow?: ProductMappingRow,
): ProductMappingRow {
  return (
    existingRow ?? {
      vendorId: group.vendorId,
      vendorProductKey: group.vendorProductKey,
      vendorProductName: group.vendorProductName,
      status: 'candidate',
      confidence: 'manual',
      target,
      matchScore: 100,
      additionCount: 0,
      reason: 'Selected from ConnectWise product catalog.',
      evidence: [{ label: 'Catalog selected', value: true }],
    }
  );
}

function dedupeProductRows(rows: ProductMappingRow[]) {
  const byCode = new Map<string, ProductMappingRow>();
  for (const row of rows) {
    const code = row.target.connectwiseProductCode;
    if (!byCode.has(code) || ('id' in row && !('id' in byCode.get(code)!))) {
      byCode.set(code, row);
    }
  }

  return [...byCode.values()];
}

function dedupeProductTargets(targets: ProductMappingTarget[]) {
  const byCode = new Map<string, ProductMappingTarget>();
  for (const target of targets) {
    if (!byCode.has(target.connectwiseProductCode)) {
      byCode.set(target.connectwiseProductCode, target);
    }
  }

  return [...byCode.values()];
}

function productRowSourceLabel(row: ProductMappingRow) {
  if (row.reason === 'Selected from ConnectWise product catalog.') {
    return 'catalog item';
  }

  return `${row.additionCount.toLocaleString()} additions`;
}

function buildProductGroups(rows: ProductMappingRow[]): ProductMappingGroup[] {
  const groups = new Map<string, ProductMappingGroup>();

  for (const row of rows) {
    const group =
      groups.get(row.vendorProductKey) ??
      {
        vendorId: row.vendorId,
        vendorProductKey: row.vendorProductKey,
        vendorProductName: row.vendorProductName,
        customerCount: 0,
        rows: [],
      };
    group.customerCount = Math.max(group.customerCount, row.customerCount ?? 0);
    const existingIndex = group.rows.findIndex(
      (item) => item.target.connectwiseProductCode === row.target.connectwiseProductCode,
    );

    if (existingIndex === -1) {
      group.rows.push(row);
    } else if ('id' in row && !('id' in group.rows[existingIndex])) {
      group.rows[existingIndex] = row;
    }

    groups.set(row.vendorProductKey, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort(
        (left, right) =>
          Number('id' in right) - Number('id' in left) ||
          right.additionCount - left.additionCount ||
          right.matchScore - left.matchScore ||
          left.target.connectwiseProductCode.localeCompare(right.target.connectwiseProductCode),
      ),
    }))
    .sort((left, right) => left.vendorProductKey.localeCompare(right.vendorProductKey));
}

function buildProductSelectionDefaults(groups: ProductMappingGroup[]) {
  return Object.fromEntries(
    groups.map((group) => {
      const approvedTargets = group.rows
        .filter((row) => 'active' in row && row.active && row.status === 'approved')
        .map((row) => row.target.connectwiseProductCode);
      const fallbackTarget = approvedTargets.length > 0 ? undefined : group.rows[0]?.target.connectwiseProductCode;

      return [
        group.vendorProductKey,
        approvedTargets.length > 0 ? approvedTargets : fallbackTarget ? [fallbackTarget] : [],
      ];
    }),
  );
}

function IntegrationModal(props: {
  integration: Integration;
  onClose: () => void;
  onSave: (payload: IntegrationSettingsPayload) => Promise<void>;
  onTabChange: (tab: IntegrationTab) => void;
  saving: boolean;
  saveMessage: string | null;
  tab: IntegrationTab;
}) {
  const { integration, onClose, onSave, onTabChange, saving, saveMessage, tab } = props;
  const tabLabels: Array<{ id: IntegrationTab; label: string }> = [
    { id: 'credentials', label: 'Credentials' },
    { id: 'sync', label: 'Sync' },
  ];
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const nonSecrets = Object.fromEntries(
      integration.requiredNonSecrets.map((setting) => [
        setting.key,
        String(formData.get(`nonSecret:${setting.key}`) ?? '').trim(),
      ]),
    );
    const secrets = Object.fromEntries(
      integration.requiredSecrets.map((setting) => [
        setting.key,
        String(formData.get(`secret:${setting.key}`) ?? '').trim(),
      ]),
    );

    void onSave({
      integrationId: integration.id,
      nonSecrets,
      secrets,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="integration-modal-title">Configure {integration.name}</h2>
            <p>Secret fields are sent to the backend and stored in Azure Key Vault.</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="integration-tabs" role="tablist" aria-label="Integration settings">
            {tabLabels.map((item) => (
              <button
                aria-selected={tab === item.id}
                className={tab === item.id ? 'active' : ''}
                key={item.id}
                onClick={() => onTabChange(item.id)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="integration-modal-body">
          {tab === 'credentials' && (
            <>
              {integration.requiredNonSecrets.map((setting) => (
                <label className="config-field" key={setting.key}>
                  <span>{setting.label}</span>
                  <input
                    defaultValue={
                      integration.nonSecrets[setting.key] ??
                      setting.defaultValue ??
                      (setting.key === 'endpoint' ? integration.endpoint : '')
                    }
                    name={`nonSecret:${setting.key}`}
                  />
                </label>
              ))}
              <div className="scope-list config-setting-list" aria-label={`${integration.name} Key Vault secrets`}>
                {integration.requiredSecrets.map((setting) => (
                  <span key={setting.key}>Key Vault: {setting.keyVaultSecretName}</span>
                ))}
              </div>
              {integration.requiredSecrets.map((setting) => (
                <label className="config-field" key={setting.key}>
                  <span>{setting.label}</span>
                  <input name={`secret:${setting.key}`} placeholder="Leave blank to keep the existing Key Vault value" type="password" />
                </label>
              ))}
              <p className="config-note">
                {integration.missingSecrets.length + integration.missingNonSecrets.length > 0
                  ? `Missing: ${[...integration.missingSecrets, ...integration.missingNonSecrets].join(', ')}`
                  : 'All required settings are present. Blank secret fields keep the current Key Vault value.'}
              </p>
            </>
          )}

          {tab === 'sync' && (
            <>
              <label className="config-field">
                <span>Sync frequency</span>
                <select defaultValue={integration.frequency ?? 'Daily'}>
                  <option>Hourly</option>
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Manual</option>
                </select>
              </label>
              <p className="config-note">
                Last sync {integration.lastSync ?? 'never'} / Last test {integration.lastTest ?? 'never'} / Records{' '}
                {integration.records ?? '0'}
              </p>
            </>
          )}

          </div>

          {saveMessage ? (
            <p className={saveMessage.startsWith('Save failed') ? 'config-note modal-save-note error' : 'config-note modal-save-note'}>
              {saveMessage}
            </p>
          ) : null}

          <div className="modal-actions">
            <button className="button secondary" disabled={saving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button primary" disabled={saving} type="submit">
              {saving ? (
                <>
                  <RefreshCcw size={17} />
                  Saving
                </>
              ) : (
                <>
                  <KeyRound size={17} />
                  Save credentials
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ProductProfitabilityReportView(props: {
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onRefresh: () => Promise<ProductProfitabilityReportResponse | null>;
  report: ProductProfitabilityReportResponse | null;
}) {
  const { loadMessage, loadState, onRefresh, report } = props;
  const months = report?.months ?? [];
  const integrations = report?.integrations ?? [];
  const chartWidth = 920;
  const chartHeight = 360;
  const plot = {
    left: 72,
    right: 24,
    top: 24,
    bottom: 54,
  };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = chartHeight - plot.top - plot.bottom;
  const values = integrations.flatMap((integration) => integration.months.map((month) => month.profit));
  const rawMin = values.length > 0 ? Math.min(0, ...values) : 0;
  const rawMax = values.length > 0 ? Math.max(0, ...values) : 1;
  const rawRange = rawMax - rawMin || 1;
  const valueMin = rawMin - rawRange * 0.08;
  const valueMax = rawMax + rawRange * 0.08;
  const valueRange = valueMax - valueMin || 1;
  const xForMonth = (index: number) =>
    plot.left + (months.length <= 1 ? plotWidth / 2 : (index / (months.length - 1)) * plotWidth);
  const yForValue = (value: number) => plot.top + ((valueMax - value) / valueRange) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => valueMax - (valueRange * index) / 4);
  const zeroY = yForValue(0);
  const chartLines = integrations.map((integration, index) => {
    const color = profitabilityPalette[index % profitabilityPalette.length];
    const points = months.map((month, monthIndex) => {
      const monthValue = integration.months.find((item) => item.month === month)?.profit ?? 0;
      return {
        month,
        value: monthValue,
        x: xForMonth(monthIndex),
        y: yForValue(monthValue),
      };
    });

    return {
      color,
      integration,
      path: profitabilityPath(points),
      points,
    };
  });

  return (
    <section className="reports-page product-profitability-page" aria-label="Product profitability report">
      <div className="integrations-live-bar report-reminder">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Report issue' : loadState === 'loading' ? 'Loading' : 'Product profitability'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{report ? formatMonthRange(report.months) : 'Most recent 12 months'}</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            {loadState === 'loading' ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="metric-grid report-metrics" aria-label="Product profitability summary">
        <MetricCard icon={CircleDollarSign} label="Net profit" tone="money" value={formatMoneyValue(report?.summary.totalProfit ?? 0)} />
        <MetricCard icon={BarChart3} label="Revenue" tone="ready" value={formatMoneyValue(report?.summary.totalRevenue ?? 0)} />
        <MetricCard icon={Activity} label="Cost" tone="warn" value={formatMoneyValue(report?.summary.totalCost ?? 0)} />
        <MetricCard icon={Plug} label="Active integrations" tone="approved" value={formatCount(report?.summary.integrationCount ?? 0)} />
      </section>

      <section className="work-surface report-surface profitability-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">{report ? formatMonthRange(report.months) : 'Profit trend'}</span>
            <h2>Month-to-month net profit by integration</h2>
          </div>
          <span className="status-pill approved">{formatCount(report?.summary.productCount ?? 0)} products</span>
        </div>

        {!report || integrations.length === 0 ? (
          <div className="empty-state report-empty">
            <FileSpreadsheet size={20} />
            <strong>No profitability data loaded.</strong>
            <span>Active integrations need mapped products and ConnectWise addition history with price or cost data.</span>
          </div>
        ) : (
          <>
            <div className="profitability-chart-wrap">
              <svg
                aria-label="Monthly net profit by integration"
                className="profitability-chart"
                role="img"
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              >
                {yTicks.map((tick) => {
                  const y = yForValue(tick);
                  return (
                    <g className="profitability-grid-line" key={tick.toFixed(2)}>
                      <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
                      <text x={plot.left - 10} y={y + 4}>
                        {formatCurrencyCompact(tick)}
                      </text>
                    </g>
                  );
                })}
                <line className="profitability-zero-line" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
                {months.map((month, index) => {
                  const showLabel = index === 0 || index === months.length - 1 || index % 2 === 1;
                  const x = xForMonth(index);
                  return (
                    <g className="profitability-month-tick" key={month}>
                      <line x1={x} x2={x} y1={plot.top} y2={plot.top + plotHeight} />
                      {showLabel ? (
                        <text x={x} y={chartHeight - 18}>
                          {formatMonthLabel(month, index === 0 || index === months.length - 1)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {chartLines.map((line) => (
                  <path
                    className="profitability-line"
                    d={line.path}
                    key={line.integration.integrationId}
                    stroke={line.color}
                  />
                ))}
                {chartLines.flatMap((line) =>
                  line.points.map((point) => (
                    <circle
                      className="profitability-point"
                      cx={point.x}
                      cy={point.y}
                      fill={line.color}
                      key={`${line.integration.integrationId}-${point.month}`}
                      r={3.5}
                    >
                      <title>
                        {line.integration.integrationName} / {formatMonthLabel(point.month, true)} / {formatMoneyValue(point.value)}
                      </title>
                    </circle>
                  )),
                )}
              </svg>
            </div>

            <div className="profitability-legend" aria-label="Chart legend">
              {chartLines.map((line) => (
                <div className="profitability-legend-item" key={line.integration.integrationId}>
                  <span className="profitability-legend-swatch" style={{ backgroundColor: line.color }} />
                  <strong>{line.integration.integrationName}</strong>
                  <span>{formatMoneyValue(line.integration.totalProfit)}</span>
                </div>
              ))}
            </div>

            <div className="profitability-table-scroll">
              <table className="profitability-table">
                <thead>
                  <tr>
                    <th>Integration</th>
                    <th>Revenue</th>
                    <th>Cost</th>
                    <th>Net profit</th>
                    <th>Products</th>
                    <th>Missing cost rows</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.map((integration) => (
                    <tr key={integration.integrationId}>
                      <td>{integration.integrationName}</td>
                      <td>{formatMoneyValue(integration.totalRevenue)}</td>
                      <td>{formatMoneyValue(integration.totalCost)}</td>
                      <td>{formatMoneyValue(integration.totalProfit)}</td>
                      <td>{formatCount(integration.productCount)}</td>
                      <td>{formatCount(integration.missingCostRows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function ReportsView(props: {
  columnFilters: Record<string, string>;
  details: RawSyncDetailsResponse | null;
  integrations: Integration[];
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onColumnFilterChange: (column: string, value: string) => void;
  onDatasetChange: (dataset: RawSyncDataset) => void;
  onIntegrationChange: (integrationId: IntegrationId | '') => void;
  onRefresh: () => Promise<void>;
  onSyncRunChange: (syncRunId: string) => void;
  runs: RawSyncRun[];
  selectedDataset: RawSyncDataset;
  selectedIntegrationId: IntegrationId | '';
  selectedSyncRunId: string;
}) {
  const {
    columnFilters,
    details,
    integrations,
    loadMessage,
    loadState,
    onColumnFilterChange,
    onDatasetChange,
    onIntegrationChange,
    onRefresh,
    onSyncRunChange,
    runs,
    selectedDataset,
    selectedIntegrationId,
    selectedSyncRunId,
  } = props;
  const selectedRun = runs.find((run) => run.id === selectedSyncRunId);
  const rows = details?.rows ?? [];
  const columns = details?.columns ?? [];
  const columnsKey = columns.join('\u001f');
  const [reportColumnWidths, setReportColumnWidths] = useState<Record<string, number>>({});
  const [reportColumnResize, setReportColumnResize] = useState<ReportColumnResizeState | null>(null);
  const reportColumnWidth = (column: string) => reportColumnWidths[column] ?? reportDefaultColumnWidth;
  const reportTableMinWidth = Math.max(
    720,
    columns.reduce((totalWidth, column) => totalWidth + reportColumnWidth(column), 0),
  );
  const activeColumnFilters = Object.entries(columnFilters)
    .map(([column, value]) => [column, value.trim().toLowerCase()] as const)
    .filter(([, value]) => value.length > 0);
  const visibleRows =
    activeColumnFilters.length > 0
      ? rows.filter((row) =>
          activeColumnFilters.every(([column, filter]) =>
            String(formatReportCell(column, row[column])).toLowerCase().includes(filter),
          ),
        )
      : rows;

  useEffect(() => {
    const availableColumns = new Set(columns);
    setReportColumnWidths((currentWidths) => {
      const nextWidths = Object.fromEntries(
        Object.entries(currentWidths).filter(([column]) => availableColumns.has(column)),
      );
      return Object.keys(nextWidths).length === Object.keys(currentWidths).length ? currentWidths : nextWidths;
    });
    setReportColumnResize((currentResize) =>
      currentResize && availableColumns.has(currentResize.column) ? currentResize : null,
    );
  }, [columnsKey]);

  const setReportColumnWidth = (column: string, width: number) => {
    const nextWidth = clampReportColumnWidth(width);
    setReportColumnWidths((currentWidths) =>
      currentWidths[column] === nextWidth ? currentWidths : { ...currentWidths, [column]: nextWidth },
    );
  };

  const startReportColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setReportColumnResize({
      column,
      pointerId: event.pointerId,
      startWidth: reportColumnWidth(column),
      startX: event.clientX,
    });
  };

  const moveReportColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!reportColumnResize || reportColumnResize.column !== column || reportColumnResize.pointerId !== event.pointerId) {
      return;
    }

    setReportColumnWidth(column, reportColumnResize.startWidth + event.clientX - reportColumnResize.startX);
  };

  const stopReportColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!reportColumnResize || reportColumnResize.column !== column || reportColumnResize.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setReportColumnResize(null);
  };

  const resetReportColumnWidth = (column: string) => {
    setReportColumnWidths((currentWidths) => {
      if (typeof currentWidths[column] === 'undefined') {
        return currentWidths;
      }

      const { [column]: _removed, ...nextWidths } = currentWidths;
      return nextWidths;
    });
  };

  const handleReportColumnResizeKeyDown = (column: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setReportColumnWidth(column, reportColumnWidth(column) + direction * reportColumnKeyboardStep);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      resetReportColumnWidth(column);
    }
  };

  return (
    <section className="reports-page" aria-label="Reporting">
      <div className="integrations-live-bar report-reminder">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Report issue' : loadState === 'loading' ? 'Loading' : 'Raw sync viewer'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>Select an integration, then choose a sync date to inspect captured rows.</span>
          <button
            className="button secondary compact"
            disabled={!selectedIntegrationId || loadState === 'loading'}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshCcw size={16} />
            {loadState === 'loading' ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="toolbar reports-toolbar" aria-label="Report filters">
        <label className="config-field report-select">
          <span>Integration</span>
          <select
            onChange={(event) => onIntegrationChange(event.target.value as IntegrationId | '')}
            value={selectedIntegrationId}
          >
            <option value="">Select integration</option>
            {integrations.map((integration) => (
              <option key={integration.id} value={integration.id}>
                {integration.name}
              </option>
            ))}
          </select>
        </label>

        {selectedIntegrationId === 'microsoft-365' ? (
          <label className="config-field report-select">
            <span>Dataset</span>
            <select
              disabled={loadState === 'loading'}
              onChange={(event) => onDatasetChange(event.target.value as RawSyncDataset)}
              value={selectedDataset}
            >
              <option value="users">M365 Users</option>
              <option value="licenses">M365 Licenses</option>
            </select>
          </label>
        ) : null}

        <label className="config-field report-select">
          <span>SyncDate</span>
          <select
            disabled={!selectedIntegrationId || runs.length === 0 || loadState === 'loading'}
            onChange={(event) => onSyncRunChange(event.target.value)}
            value={selectedSyncRunId}
          >
            <option value="">
              {!selectedIntegrationId ? 'Select integration first' : runs.length === 0 ? 'No sync dates found' : 'Select SyncDate'}
            </option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {formatReportRunLabel(run)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="metric-grid report-metrics" aria-label="Raw sync report summary">
        <MetricCard icon={Database} label="Synced rows" tone="ready" value={formatCount(details?.summary.rowCount ?? 0)} />
        <MetricCard icon={Users} label="Companies" tone="warn" value={formatCount(details?.summary.companyCount ?? 0)} />
        <MetricCard icon={Building2} label="Agreements" tone="approved" value={formatCount(details?.summary.agreementCount ?? 0)} />
        <MetricCard icon={Package} label="Products" tone="money" value={formatCount(details?.summary.productCount ?? 0)} />
      </section>

      <section className="work-surface report-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">
              {selectedRun ? `${selectedRun.status} / ${formatDateTime(selectedRun.completedAt ?? selectedRun.startedAt)}` : 'No sync selected'}
            </span>
            <h2>
              {visibleRows.length.toLocaleString()} of {rows.length.toLocaleString()} raw sync rows
            </h2>
          </div>
          <span className={`status-pill ${selectedRun?.status === 'complete' ? 'approved' : 'needs-review'}`}>
            {selectedRun?.status ?? 'No run'}
          </span>
        </div>

        {columns.length === 0 ? (
          <div className="empty-state report-empty">
            <FileSpreadsheet size={20} />
            <strong>No raw sync details loaded.</strong>
            <span>Select an integration and SyncDate to inspect captured rows.</span>
          </div>
        ) : (
          <div className="report-table-scroll">
            <table
              className={reportColumnResize ? 'report-detail-table resizing' : 'report-detail-table'}
              style={{ minWidth: `${reportTableMinWidth}px` }}
            >
              <colgroup>
                {columns.map((column) => (
                  <col key={column} style={{ width: `${reportColumnWidth(column)}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>
                      <div className="report-column-header">
                        <span title={column}>{column}</span>
                        <input
                          aria-label={`Filter ${column}`}
                          onChange={(event) => onColumnFilterChange(column, event.target.value)}
                          placeholder="Filter"
                          type="text"
                          value={columnFilters[column] ?? ''}
                        />
                      </div>
                      <button
                        aria-label={`Resize ${column} column`}
                        className={
                          reportColumnResize?.column === column
                            ? 'report-column-resizer active'
                            : 'report-column-resizer'
                        }
                        onDoubleClick={() => resetReportColumnWidth(column)}
                        onKeyDown={(event) => handleReportColumnResizeKeyDown(column, event)}
                        onPointerCancel={(event) => stopReportColumnResize(column, event)}
                        onPointerDown={(event) => startReportColumnResize(column, event)}
                        onPointerMove={(event) => moveReportColumnResize(column, event)}
                        onPointerUp={(event) => stopReportColumnResize(column, event)}
                        title="Drag to resize"
                        type="button"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={`${String(row.id ?? 'row')}-${index}`}>
                    {columns.map((column) => (
                      <td key={column}>{formatReportCell(column, row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function ImportsView() {
  return (
    <section className="view-grid imports-view">
      <div className="work-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Import batch 14</span>
            <h2>Vendor invoice intake</h2>
          </div>
          <button className="button primary compact" type="button">
            <FileUp size={17} />
            Upload file
          </button>
        </div>

        <div className="import-drop">
          <FileSpreadsheet size={28} />
          <div>
            <strong>1,965 invoice rows normalized</strong>
            <span>Four vendor files matched against ConnectWise product codes.</span>
          </div>
          <button className="icon-button" title="Download normalized import" type="button">
            <Download size={18} />
          </button>
        </div>

        <div className="import-table">
          {imports.map((item) => (
            <div className="import-row" key={item.file}>
              <span className="vendor-badge">{item.vendor}</span>
              <div>
                <strong>{item.file}</strong>
                <span>{formatCount(item.rows)} rows</span>
              </div>
              <div className="match-bar">
                <span style={{ width: `${(item.matched / item.rows) * 100}%` }} />
              </div>
              <strong>{item.exceptions} exceptions</strong>
              <span className={item.status === 'Ready' ? 'status-pill ready' : 'status-pill needs-review'}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="work-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Column map</span>
            <h2>Invoice fields</h2>
          </div>
          <button className="icon-button" title="Filter mappings" type="button">
            <Filter size={18} />
          </button>
        </div>
        <div className="mapping-list">
          {[
            ['Tenant Name', 'Customer alias', '98%'],
            ['SKU', 'Product code', '94%'],
            ['Quantity', 'Billed count', '100%'],
            ['Unit Price', 'Cost basis', '91%'],
            ['Mailbox Type', 'Billing class', '76%'],
          ].map(([source, target, score]) => (
            <div className="mapping-row" key={source}>
              <span>{source}</span>
              <ArrowRight size={16} />
              <strong>{target}</strong>
              <em>{score}</em>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgreementsView(props: {
  autoPost: boolean;
  productFilter: string;
  setAutoPost: (value: boolean) => void;
  setProductFilter: (value: string) => void;
  visibleRules: ProductRule[];
}) {
  const { autoPost, productFilter, setAutoPost, setProductFilter, visibleRules } = props;
  const productFilters = ['All products', 'Bundled', 'Pinned', 'Needs mapping'];

  return (
    <>
      <section className="toolbar agreements-toolbar" aria-label="Agreement controls">
        <div className="segmented-control wide" role="group" aria-label="Product rule filter">
          {productFilters.map((filter) => (
            <button
              className={productFilter === filter ? 'active' : ''}
              key={filter}
              onClick={() => setProductFilter(filter)}
              type="button"
            >
              {filter}
            </button>
          ))}
        </div>
        <label className="switch-control">
          <input checked={autoPost} onChange={(event) => setAutoPost(event.target.checked)} type="checkbox" />
          <span>Auto-post approved zero variance</span>
        </label>
      </section>

      <section className="view-grid agreements-view">
        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Customer agreements</span>
              <h2>Open billing work</h2>
            </div>
            <button className="button secondary compact" type="button">
              <Users size={17} />
              Assign owner
            </button>
          </div>
          <div className="agreement-list">
            {agreements.map((agreement) => (
              <div className="agreement-row" key={agreement.customer}>
                <div>
                  <strong>{agreement.customer}</strong>
                  <span>{agreement.agreement}</span>
                </div>
                <span>{agreement.products} products</span>
                <strong>{formatCurrency(agreement.exposure)}</strong>
                <em>{agreement.nextAction}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Product rules</span>
              <h2>Catalog mapping</h2>
            </div>
            <button className="icon-button" title="Add product rule" type="button">
              <Package size={18} />
            </button>
          </div>
          <div className="rule-table">
            {visibleRules.map((rule) => (
              <div className="rule-row" key={rule.product}>
                <div>
                  <strong>{rule.product}</strong>
                  <span>{rule.vendor} / {rule.cwCode}</span>
                </div>
                <span>{rule.basis}</span>
                <span>{rule.bundle}</span>
                <em>{rule.rule}</em>
                <strong>{rule.confidence}%</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function AuditView(props: { issues: ReconcileIssue[] }) {
  const { issues } = props;
  return (
    <section className="view-grid audit-view">
      <div className="work-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Sync runs</span>
            <h2>Source activity</h2>
          </div>
          <button className="icon-button" title="Export audit trail" type="button">
            <Download size={18} />
          </button>
        </div>
        <div className="sync-list">
          {syncRuns.map((run) => (
            <div className="sync-row" key={run.source}>
              <Zap size={17} />
              <div>
                <strong>{run.source}</strong>
                <span>{run.time}</span>
              </div>
              <span>{run.result}</span>
              <span className={run.status === 'Complete' ? 'status-pill approved' : 'status-pill needs-review'}>
                {run.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="work-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Approval ledger</span>
            <h2>Immutable history</h2>
          </div>
          <button className="button secondary compact" type="button">
            <ListChecks size={17} />
            Batch view
          </button>
        </div>
        <div className="timeline">
          {issues.map((issue) => (
            <div className="timeline-row" key={issue.id}>
              <span className={`timeline-marker ${issue.status}`} />
              <div>
                <strong>{issue.customer}</strong>
                <span>{issue.product}</span>
              </div>
              <em>{issue.lastSeen}</em>
              <span className={`status-pill ${issue.status}`}>{statusLabel(issue.status)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default App;
