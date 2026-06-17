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
  SlidersHorizontal,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
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

type View = 'reconcile' | 'integrations' | 'mappings' | 'reports' | 'imports' | 'agreements' | 'audit';
type IssueStatus = 'matched' | 'needs-review' | 'not-billable' | 'ready' | 'approved' | 'blocked' | 'skipped';
type IntegrationStatus = 'connected' | 'degraded' | 'not-configured';
type IntegrationTab = 'credentials' | 'sync';
type ReportSection = 'raw-sync';
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

type RawSyncRow = Record<string, string | number | boolean | null>;

type RawSyncDetailsResponse = {
  integrationId: IntegrationId;
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
  runs: RawSyncRun[];
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
  vendor: string;
  devices: ReconciliationDevice[];
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
type DimensionMap = Record<string, DimensionValue>;

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
    unmappedSnapshots: number;
  };
  accountMappings: AccountMapping[];
  accountCandidates: AccountMappingCandidate[];
  productMappings: ProductMapping[];
  productCandidates: ProductMappingCandidate[];
  customerOptions: MappingCustomerOption[];
};

type IntegrationAction = 'test' | 'sync';
type IntegrationActionKey = `${IntegrationId}:${IntegrationAction}`;
const liveIntegrationIds: ReadonlySet<IntegrationId> = new Set(['connectwise', 'cove', 'ncentral']);
const mappingIntegrationIds: ReadonlySet<IntegrationId> = new Set(['cove', 'ncentral']);

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
  { label: 'Cove data', value: 'Latest sync', icon: Database, state: 'done' },
  { label: 'ConnectWise', value: 'Additions', icon: FileUp, state: 'done' },
  { label: 'Map products', value: '58 checks', icon: Link2, state: 'active' },
  { label: 'Client review', value: '6 groups', icon: Users, state: 'ready' },
  { label: 'Approve', value: '$4,361 exposure', icon: ClipboardCheck, state: 'idle' },
];

const navItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'reconcile', label: 'Reconcile', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'imports', label: 'Imports', icon: Upload },
  { id: 'agreements', label: 'Agreements', icon: Building2 },
  { id: 'audit', label: 'Audit', icon: History },
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
};

const reportSections: Array<{ id: ReportSection; label: string; enabled: boolean; description: string }> = [
  {
    id: 'raw-sync',
    label: 'Raw Sync Viewer',
    enabled: true,
    description: 'Inspect saved raw sync rows by integration and sync date',
  },
];

const vendors = ['All', 'Microsoft', 'SentinelOne', 'Pax8', 'Datto', 'Cove Backup'];
const noAgreementSyncValue = '__no_agreement_sync__';

const integrationSettingsStates: IntegrationSettingsState[] = [];

const demoIntegrationValidations = validateIntegrationRegistry(integrationSettingsStates);

function hasLiveIntegrationActions(integrationId: IntegrationId) {
  return liveIntegrationIds.has(integrationId);
}

function hasMappingWorkspace(integrationId: IntegrationId) {
  return mappingIntegrationIds.has(integrationId);
}

function buildIntegrations(runtimeIntegrations?: RuntimeIntegrationSummary[]): Integration[] {
  const definitions = runtimeIntegrations ?? integrationSettingsRegistry.map((definition) => ({
    ...definition,
    nonSecrets: {},
    secretSource: undefined,
    keyVaultUrl: undefined,
    operationalStatus: undefined,
    validation: demoIntegrationValidations.find((item) => item.integrationId === definition.integrationId),
  }));

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
  return Boolean(value && navItems.some((item) => item.id === value));
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

  return Array.from(groups.entries()).map(([customer, clientIssues]) => {
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
      agreementId: firstIssue.agreementId,
      issues: clientIssues,
      vendors: Array.from(new Set(clientIssues.map((issue) => issue.vendor))),
      exposure: clientIssues.reduce((total, issue) => total + issue.amount, 0),
      changeCount: clientIssues.length,
      readyCount: clientIssues.filter((issue) => issue.status === 'ready').length,
      blockedCount: clientIssues.filter((issue) => issue.status === 'blocked').length,
      needsReviewCount: clientIssues.filter((issue) => issue.status === 'needs-review').length,
    };
  });
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

async function fetchRawSyncRuns(integrationId: IntegrationId) {
  const response = await fetch(`/api/reports/raw-sync-runs?integrationId=${encodeURIComponent(integrationId)}`);
  const body = await responseJson(response);
  const runs = Array.isArray(body.runs) ? (body.runs as RawSyncRun[]) : [];

  if (!response.ok) {
    throw new Error(String(body.error ?? `Raw sync run load failed with HTTP ${response.status}.`));
  }

  return {
    reportType: 'raw-sync',
    integrationId,
    runs,
  } satisfies RawSyncRunsResponse;
}

async function fetchRawSyncDetails(integrationId: IntegrationId, syncRunId: string) {
  const response = await fetch(
    `/api/reports/raw-sync-runs/${encodeURIComponent(syncRunId)}/details?integrationId=${encodeURIComponent(integrationId)}`,
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Raw sync detail load failed with HTTP ${response.status}.`));
  }

  return body as unknown as RawSyncDetailsResponse;
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

function syncRequestBodyForIntegration(integrationId: IntegrationId) {
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

  return 'Connection OK.';
}

function formatIntegrationSyncSuccess(integrationId: IntegrationId, body: Record<string, unknown>) {
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

  const recordsWritten = numberField(body, 'recordsWritten')?.toLocaleString() ?? '0';
  const recordsRead = numberField(body, 'recordsRead')?.toLocaleString() ?? '0';
  return `Sync complete. Stored ${recordsWritten} of ${recordsRead} records.`;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reconcileIssuesFromRun(run: ReconciliationRunResponse): ReconcileIssue[] {
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
      vendor: integrationName(run.vendorId),
      product: line.productName,
      family: line.lineType === 'usage-add-on' ? 'Usage add-on' : 'Base count',
      serviceCode: line.productCode,
      lineType: line.lineType,
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
      lastSeen: run.syncRunId ? `Cove sync ${shortId(run.syncRunId)}` : 'No completed Cove sync',
      audit: [
        `Cove proposed quantity: ${line.proposedQuantity.toLocaleString()} ${line.unit}.`,
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

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function App() {
  const [view, setView] = useState<View>(() => initialView());
  const [issues, setIssues] = useState<ReconcileIssue[]>([]);
  const [expandedClientNames, setExpandedClientNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('All');
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
  const [rawSyncRuns, setRawSyncRuns] = useState<RawSyncRun[]>([]);
  const [selectedRawSyncRunId, setSelectedRawSyncRunId] = useState<string>('');
  const [rawSyncDetails, setRawSyncDetails] = useState<RawSyncDetailsResponse | null>(null);
  const [rawSyncLoadState, setRawSyncLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [rawSyncMessage, setRawSyncMessage] = useState('Select an integration to view saved raw sync rows.');
  const [rawSyncColumnFilters, setRawSyncColumnFilters] = useState<Record<string, string>>({});
  const [selectedMappingIntegrationId, setSelectedMappingIntegrationId] = useState<IntegrationId>('cove');
  const [mappingState, setMappingState] = useState<MappingStateResponse | null>(null);
  const [usageOverrides, setUsageOverrides] = useState<UsageOverride[]>([]);
  const [ncentralFilters, setNcentralFilters] = useState<NcentralFilter[]>([]);
  const [ncentralFilterMappings, setNcentralFilterMappings] = useState<NcentralFilterMapping[]>([]);
  const [mappingLoadState, setMappingLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [mappingMessage, setMappingMessage] = useState('Load an integration to review account and product mappings.');
  const [busyMappingAction, setBusyMappingAction] = useState<string | null>(null);
  const [reconciliationLoadState, setReconciliationLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [reconciliationMessage, setReconciliationMessage] = useState('Loading Cove reconciliation...');
  const [reconciliationProductOptions, setReconciliationProductOptions] = useState<ReconciliationProductOption[]>([]);
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

  const loadRawSyncRuns = async (integrationId: IntegrationId) => {
    setRawSyncLoadState('loading');
    setRawSyncMessage('Loading raw sync dates...');
    setRawSyncRuns([]);
    setSelectedRawSyncRunId('');
    setRawSyncDetails(null);
    setRawSyncColumnFilters({});

    try {
      const response = await fetchRawSyncRuns(integrationId);
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

  const loadRawSyncDetails = async (integrationId: IntegrationId, syncRunId: string) => {
    setRawSyncLoadState('loading');
    setRawSyncMessage('Loading raw sync details...');
    setRawSyncDetails(null);
    setRawSyncColumnFilters({});

    try {
      const details = await fetchRawSyncDetails(integrationId, syncRunId);
      setRawSyncDetails(details);
      setRawSyncLoadState('ready');
      setRawSyncMessage(`Loaded ${details.summary.rowCount.toLocaleString()} raw sync rows.`);
    } catch (error) {
      setRawSyncDetails(null);
      setRawSyncLoadState('failed');
      setRawSyncMessage(error instanceof Error ? error.message : 'Unable to load raw sync details.');
    }
  };

  const loadMappings = async (integrationId: IntegrationId) => {
    setMappingLoadState('loading');
    setMappingMessage('Loading mapping state...');

    try {
      const state = await fetchMappingState(integrationId);
      setMappingState(state);
      setMappingLoadState('ready');
      setMappingMessage(
        `Loaded ${state.summary.accountMappings.toLocaleString()} account mappings and ${state.summary.productMappings.toLocaleString()} product mappings.`,
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

  const loadCoveReconciliation = async () => {
    setReconciliationLoadState('loading');
    setReconciliationMessage('Comparing latest Cove sync against ConnectWise additions...');

    try {
      const run = await fetchReconciliationRun('cove');
      const nextIssues = reconcileIssuesFromRun(run);
      const nextReviewIssues = nextIssues.filter(isReviewableIssue);
      const firstSelectedIssue = nextReviewIssues[0] ?? nextIssues[0];
      setIssues(nextIssues);
      setReconciliationProductOptions(run.productOptions ?? []);
      setExpandedClientNames(firstSelectedIssue?.customer ? [firstSelectedIssue.customer] : []);
      setReconciliationLoadState('ready');
      setReconciliationMessage(
        nextReviewIssues.length > 0
          ? `Found ${nextReviewIssues.length.toLocaleString()} Cove discrepanc${
              nextReviewIssues.length === 1 ? 'y' : 'ies'
            } across ${nextIssues.length.toLocaleString()} product checks from ${(run.snapshotCount ?? 0).toLocaleString()} synced snapshots.`
          : run.syncRunId
            ? `No Cove discrepancies found in the latest sync (${(run.snapshotCount ?? 0).toLocaleString()} snapshots, ${nextIssues.length.toLocaleString()} product checks).`
            : 'No completed Cove sync is available yet.',
      );
      return run;
    } catch (error) {
      setIssues([]);
      setReconciliationProductOptions([]);
      setExpandedClientNames([]);
      setReconciliationLoadState('failed');
      setReconciliationMessage(error instanceof Error ? error.message : 'Unable to load Cove reconciliation.');
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
    void loadCoveReconciliation();
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
    if (view !== 'reports' || !selectedRawSyncIntegrationId) {
      return;
    }

    void loadRawSyncRuns(selectedRawSyncIntegrationId);
  }, [selectedRawSyncIntegrationId, view]);

  useEffect(() => {
    if (view !== 'reports' || !selectedRawSyncIntegrationId || !selectedRawSyncRunId) {
      return;
    }

    void loadRawSyncDetails(selectedRawSyncIntegrationId, selectedRawSyncRunId);
  }, [selectedRawSyncIntegrationId, selectedRawSyncRunId, view]);

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
    setAgreementAdditionsMessage('Loading active agreement additions...');

    try {
      const response = await fetchAgreementAdditions(client.agreementId);
      setAgreementAdditions(response.additions);
      setAgreementAdditionsLoadState('ready');
      setAgreementAdditionsMessage(
        response.additions.length > 0
          ? `Loaded ${response.additions.length.toLocaleString()} active additions.`
          : 'No active additions found for this agreement.',
      );
    } catch (error) {
      setAgreementAdditions([]);
      setAgreementAdditionsLoadState('failed');
      setAgreementAdditionsMessage(error instanceof Error ? error.message : 'Unable to load agreement additions.');
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
      const refreshedIntegration = latest?.integrations.find((integration) => integration.integrationId === payload.integrationId);
      if (refreshedIntegration) {
        setSelectedIntegration(buildIntegrations([refreshedIntegration])[0] ?? null);
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

  const syncIntegration = async (integrationId: IntegrationId) => {
    const actionKey: IntegrationActionKey = `${integrationId}:sync`;
    setBusyIntegrationAction(actionKey);
    setIntegrationActionMessages((messages) => ({
      ...messages,
      [integrationId]: 'Starting sync...',
    }));

    try {
      const response = await fetch(`/api/integrations/${integrationId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequestBodyForIntegration(integrationId)),
      });
      const body = await responseJson(response);

      if (!response.ok) {
        throw new Error(String(body.error ?? `Sync failed with HTTP ${response.status}.`));
      }

      setIntegrationActionMessages((messages) => ({
        ...messages,
        [integrationId]: formatIntegrationSyncSuccess(integrationId, body),
      }));
      await refreshRuntimeIntegrations();
      if (integrationId === 'connectwise') {
        if (selectedRawSyncIntegrationId === 'connectwise') {
          await loadRawSyncRuns('connectwise');
        }
      }
      if (integrationId === 'cove' && selectedRawSyncIntegrationId === 'cove') {
        await loadRawSyncRuns('cove');
      }
      if (integrationId === 'cove') {
        await loadCoveReconciliation();
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
        await loadRawSyncDetails(selectedRawSyncIntegrationId, selectedRawSyncRunId);
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
      if (integrationId === 'cove') {
        await loadCoveReconciliation();
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
      if (integrationId === 'cove') {
        await loadCoveReconciliation();
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
      await loadCoveReconciliation();
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
      await loadCoveReconciliation();
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

        <nav className="nav-list">
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

        <main className="content">
          {view === 'reconcile' && (
            <ReconcileView
              approveClient={approveClient}
              approveIssue={approveIssue}
              clientGroups={clientGroups}
              expandedClientNames={expandedClientNames}
              filteredIssues={filteredIssues}
              issues={issues}
              needsReviewOnly={needsReviewOnly}
              onManualOverride={setManualOverrideIssue}
              onOpenAgreementAdditions={(client) => void openAgreementAdditionsModal(client)}
              onOpenTicket={openTicketModal}
              onRefreshReconciliation={loadCoveReconciliation}
              pendingCount={pendingCount}
              query={query}
              reconciliationLoadState={reconciliationLoadState}
              reconciliationMessage={reconciliationMessage}
              setExpandedClientNames={setExpandedClientNames}
              setNeedsReviewOnly={setNeedsReviewOnly}
              setQuery={setQuery}
              setVendorFilter={setVendorFilter}
              skipIssue={skipIssue}
              totalExposure={totalExposure}
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
              onRefresh={() => refreshMappingWorkspace(selectedMappingIntegrationId)}
              onNcentralFilterMappingSave={saveNcentralFilterMapping}
              onUsageOverrideCreate={saveUsageOverride}
              onUsageOverrideDeactivate={deactivateUsageOverride}
              selectedIntegrationId={selectedMappingIntegrationId}
              usageOverrides={usageOverrides}
            />
          )}
          {view === 'reports' && (
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
                setRawSyncRuns([]);
                setSelectedRawSyncRunId('');
                setRawSyncDetails(null);
                setRawSyncColumnFilters({});
                setRawSyncMessage(integrationId ? 'Loading raw sync dates...' : 'Select an integration to view saved raw sync rows.');
              }}
              onSyncRunChange={setSelectedRawSyncRunId}
              runs={rawSyncRuns}
              selectedIntegrationId={selectedRawSyncIntegrationId}
              selectedSyncRunId={selectedRawSyncRunId}
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
    default:
      return 'Reconciliation command center';
  }
}

function ReconcileView(props: {
  approveClient: (customer: string) => void;
  approveIssue: (issueId: string) => void;
  clientGroups: ClientGroup[];
  expandedClientNames: string[];
  filteredIssues: ReconcileIssue[];
  issues: ReconcileIssue[];
  needsReviewOnly: boolean;
  onManualOverride: (issue: ReconcileIssue) => void;
  onOpenAgreementAdditions: (client: ClientGroup) => void;
  onOpenTicket: (client: ClientGroup) => void;
  onRefreshReconciliation: () => Promise<ReconciliationRunResponse | null>;
  pendingCount: number;
  query: string;
  reconciliationLoadState: 'loading' | 'ready' | 'failed';
  reconciliationMessage: string;
  setExpandedClientNames: (value: string[] | ((currentNames: string[]) => string[])) => void;
  setNeedsReviewOnly: (value: boolean) => void;
  setQuery: (value: string) => void;
  setVendorFilter: (value: string) => void;
  skipIssue: (issueId: string) => void;
  totalExposure: number;
  vendorFilter: string;
}) {
  const {
    approveClient,
    approveIssue,
    clientGroups,
    expandedClientNames,
    filteredIssues,
    issues,
    needsReviewOnly,
    onManualOverride,
    onOpenAgreementAdditions,
    onOpenTicket,
    onRefreshReconciliation,
    pendingCount,
    query,
    reconciliationLoadState,
    reconciliationMessage,
    setExpandedClientNames,
    setNeedsReviewOnly,
    setQuery,
    setVendorFilter,
    skipIssue,
    totalExposure,
    vendorFilter,
  } = props;
  const [expandedProductLists, setExpandedProductLists] = useState<Record<string, boolean>>({});
  const [vendorDataSelection, setVendorDataSelection] = useState<VendorDataSelection | null>(null);
  const filteredReviewCount = filteredIssues.filter(isReviewableIssue).length;
  const workflowSteps = workflow.map((step) => {
    if (step.label === 'Map products') return { ...step, value: `${filteredIssues.length} checks` };
    if (step.label === 'Client review') return { ...step, value: `${clientGroups.length} groups` };
    if (step.label === 'Approve') return { ...step, value: `${formatCurrency(totalExposure)} exposure` };
    return step;
  });
  return (
    <>
      <section className="integrations-live-bar" aria-label="Live reconciliation status">
        <div>
          <span className={`live-dot ${reconciliationLoadState}`} />
          <strong>
            {reconciliationLoadState === 'failed'
              ? 'Cove reconciliation issue'
              : reconciliationLoadState === 'loading'
                ? 'Comparing Cove'
                : 'Cove vs ConnectWise'}
          </strong>
          <span>{reconciliationMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{pendingCount.toLocaleString()} open</span>
          <button
            className="button secondary compact"
            disabled={reconciliationLoadState === 'loading'}
            onClick={() => void onRefreshReconciliation()}
            type="button"
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </section>

      <section className="metric-grid reconcile-metric-grid" aria-label="Billing reconciliation summary">
        <MetricCard icon={CircleDollarSign} label="Unresolved exposure" tone="money" value={formatCurrency(totalExposure)} />
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
          {vendors.map((vendor) => (
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

      <section className="workspace-grid">
        <div className="work-surface client-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Client review groups</span>
              <h2>{filteredReviewCount} review items across {clientGroups.length} clients</h2>
            </div>
            <div className="review-group-actions">
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
                <strong>{pendingCount === 0 ? 'No Cove discrepancies to review.' : 'No client groups match these filters.'}</strong>
                <span>
                  {pendingCount === 0
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
                        const vendorDevices = vendorDevicesFromIssues(allVendorIssues);

                        return (
                          <section className="vendor-license-group" key={vendor}>
                            <div className="vendor-license-header">
                              <strong>{vendor}</strong>
                              <div className="vendor-license-header-meta">
                                <button
                                  className="vendor-data-link"
                                  onClick={() =>
                                    setVendorDataSelection({
                                      customer: client.customer,
                                      vendor,
                                      devices: vendorDevices,
                                    })
                                  }
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

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="vendor-data-modal" role="dialog" aria-modal="true" aria-labelledby="vendor-data-title">
        <div className="modal-header">
          <div>
            <h2 id="vendor-data-title">
              <Database size={18} />
              Vendor Data
            </h2>
            <p>{selection.customer} / {selection.vendor}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="vendor-device-list" aria-label={`${selection.vendor} raw device data for ${selection.customer}`}>
          {selection.devices.length === 0 ? (
            <div className="empty-state">
              <Database size={20} />
              <strong>No vendor device rows were attached to this customer.</strong>
            </div>
          ) : null}

          {selection.devices.map((device) => (
            <article className="vendor-device-row" key={device.id}>
              <div className="vendor-device-hostname">
                <span>Hostname</span>
                <strong>{deviceDisplayName(device)}</strong>
              </div>
              <div className="vendor-device-detail">
                <span>Device Details</span>
                <strong title={deviceDetailSummary(device)}>{deviceDetailSummary(device)}</strong>
                <em>
                  {device.productName} / qty {device.quantity.toLocaleString()} /{' '}
                  {formatDateTime(device.observedAt) ?? 'Unknown date'}
                </em>
              </div>
            </article>
          ))}
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
}) {
  const { additions, loadState, message, onClose, selection } = props;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="agreement-additions-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-additions-title">
        <div className="modal-header">
          <div>
            <h2 id="agreement-additions-title">
              <FileSpreadsheet size={18} />
              Agreement Additions
            </h2>
            <p>{selection.customer} / {selection.agreement}</p>
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
            <strong>{loadState === 'loading' ? 'Loading active additions...' : 'No active additions to show.'}</strong>
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
  onSync: (integrationId: IntegrationId) => void;
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

      {integrations.map((integration) => (
        <article className="integration-card" key={integration.id}>
          <div className="integration-main">
            <div className="integration-title-row">
              <h2>{integration.name}</h2>
              <span className="integration-chip">{integration.category}</span>
              <span className={`integration-status ${integration.status}`}>{integrationStatusLabel(integration.status)}</span>
              <span className="auth-chip">
                <KeyRound size={13} />
                {integration.auth}
              </span>
            </div>
            <p>{integration.description}</p>

            <div className="integration-stats" aria-label={`${integration.name} integration status`}>
              <IntegrationStat label="Last sync" value={integration.lastSync ?? 'Never'} />
              <IntegrationStat label="Last test" value={integration.lastTest ?? 'Never'} />
              <IntegrationStat label="Frequency" value={integration.frequency ?? 'Manual'} />
              <IntegrationStat label="Records" value={integration.records ?? '0'} />
            </div>

            <div className="scope-list runtime-list" aria-label={`${integration.name} runtime details`}>
              <span>Secrets: {integration.secretSource === 'key-vault' ? 'Key Vault' : 'Environment'}</span>
              {integration.lastSyncStatus ? <span>Last sync: {integration.lastSyncStatus}</span> : null}
            </div>

            <div className="scope-list" aria-label={`${integration.name} scopes`}>
              {integration.scopes.map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>

            {integration.missingSecrets.length + integration.missingNonSecrets.length > 0 ? (
              <div className="scope-list warning-list" aria-label={`${integration.name} missing settings`}>
                {[...integration.missingSecrets, ...integration.missingNonSecrets].map((setting) => (
                  <span key={setting}>Missing {setting}</span>
                ))}
              </div>
            ) : null}

            <div className="integration-actions">
              {integration.enabled ? (
                <>
                  {hasLiveIntegrationActions(integration.id) ? (
                    <>
                      <button
                        className="button secondary compact"
                        disabled={busyAction === `${integration.id}:sync`}
                        onClick={() => onSync(integration.id)}
                        type="button"
                      >
                        <RefreshCcw size={16} />
                        {busyAction === `${integration.id}:sync` ? 'Syncing' : 'Sync now'}
                      </button>
                      <button
                        className="button secondary compact"
                        disabled={busyAction === `${integration.id}:test`}
                        onClick={() => onTest(integration.id)}
                        type="button"
                      >
                        <Plug size={16} />
                        {busyAction === `${integration.id}:test` ? 'Testing' : 'Test connection'}
                      </button>
                    </>
                  ) : null}
                  <button className="button secondary compact" onClick={() => onConfigure(integration)} type="button">
                    <KeyRound size={16} />
                    Configure
                  </button>
                  {hasMappingWorkspace(integration.id) ? (
                    <button className="button secondary compact" onClick={() => onOpenMappings(integration.id)} type="button">
                      <Link2 size={16} />
                      Mapping
                    </button>
                  ) : null}
                  <button className="button ghost compact" type="button">
                    <ExternalLink size={16} />
                    API Docs
                  </button>
                </>
              ) : (
                <>
                  {hasLiveIntegrationActions(integration.id) ? (
                    <>
                      <button
                        className="button secondary compact"
                        disabled={busyAction === `${integration.id}:sync`}
                        onClick={() => onSync(integration.id)}
                        type="button"
                      >
                        <RefreshCcw size={16} />
                        {busyAction === `${integration.id}:sync` ? 'Syncing' : 'Sync now'}
                      </button>
                    <button
                      className="button secondary compact"
                      disabled={busyAction === `${integration.id}:test`}
                      onClick={() => onTest(integration.id)}
                      type="button"
                    >
                      <Plug size={16} />
                      {busyAction === `${integration.id}:test` ? 'Testing' : 'Test connection'}
                    </button>
                    </>
                  ) : null}
                  <button className="button secondary compact" onClick={() => onConfigure(integration)} type="button">
                    <KeyRound size={16} />
                    Configure to enable
                  </button>
                  {hasMappingWorkspace(integration.id) ? (
                    <button className="button secondary compact" onClick={() => onOpenMappings(integration.id)} type="button">
                      <Link2 size={16} />
                      Mapping
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {actionMessages[integration.id] ? (
              <p className="config-note integration-action-message">{actionMessages[integration.id]}</p>
            ) : null}
          </div>

          <span
            aria-label={`${integrationStatusLabel(integration.status)} ${integration.name}`}
            className={integration.enabled ? 'toggle-switch on' : 'toggle-switch'}
            role="status"
          >
            <span />
          </span>
        </article>
      ))}
    </section>
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
  const customerOptions = mappingState?.customerOptions ?? [];
  const selectedOverrideCustomer = customerOptions.find((option) => option.customerId === overrideCustomerId);
  const overrideAgreementOptions = selectedOverrideCustomer?.agreements ?? [];
  const selectedIntegrationName =
    integrations.find((integration) => integration.id === selectedIntegrationId)?.name ?? 'Integration';
  const suggestedAccountCount = accountCandidates.filter(
    (candidate) => candidate.status === 'approved' && candidate.customerId,
  ).length;

  useEffect(() => {
    setProductTargetSelections({});
    setProductTargetOverrides({});
    setShowProductCatalogOptions({});
    setProductCatalogResults({});
    setProductCatalogMessages({});
    setProductCatalogLoading({});
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
              <h2>{productGroups.length.toLocaleString()} Cove product groups</h2>
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
                <span>Cove server, workstation, and storage add-on candidates appear after ConnectWise products are synced.</span>
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
              <NcentralFilterMappingRow busyAction={busyAction} key={mapping.id} mapping={mapping} onSave={onSave} />
            ))}
          </div>
        </div>

        <div>
          <h3>Overlay tags</h3>
          <div className="ncentral-filter-list">
            {overlayMappings.map((mapping) => (
              <NcentralFilterMappingRow busyAction={busyAction} key={mapping.id} mapping={mapping} onSave={onSave} />
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
  mapping: NcentralFilterMapping;
  onSave: (payload: Partial<NcentralFilterMapping>) => Promise<void>;
}) {
  const { busyAction, mapping, onSave } = props;
  const actionKey = `ncentral-filter:${mapping.id}`;

  return (
    <article className="ncentral-filter-row">
      <div>
        <strong>{mapping.displayName}</strong>
        <span>{mapping.filterName}</span>
      </div>
      <span className={`status-pill ${mapping.active ? 'approved' : 'needs-review'}`}>
        {mapping.active ? 'Active' : 'Inactive'}
      </span>
      <em>{mapping.mappingType === 'product' ? mapping.vendorProductKey : mapping.tagKey}</em>
      <button
        className="button secondary compact"
        disabled={busyAction === actionKey}
        onClick={() => void onSave({ ...mapping, active: !mapping.active })}
        type="button"
      >
        {mapping.active ? 'Disable' : 'Enable'}
      </button>
    </article>
  );
}

type ProductMappingRow = ProductMapping | ProductMappingCandidate;

type ProductMappingGroup = {
  vendorId: IntegrationId;
  vendorProductKey: string;
  vendorProductName: string;
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
        rows: [],
      };
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
    groups.map((group) => [
      group.vendorProductKey,
      group.rows
        .filter((row) => 'active' in row && row.active && row.status === 'approved')
        .map((row) => row.target.connectwiseProductCode),
    ]),
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

function ReportsView(props: {
  columnFilters: Record<string, string>;
  details: RawSyncDetailsResponse | null;
  integrations: Integration[];
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onColumnFilterChange: (column: string, value: string) => void;
  onIntegrationChange: (integrationId: IntegrationId | '') => void;
  onSyncRunChange: (syncRunId: string) => void;
  runs: RawSyncRun[];
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
    onIntegrationChange,
    onSyncRunChange,
    runs,
    selectedIntegrationId,
    selectedSyncRunId,
  } = props;
  const selectedRun = runs.find((run) => run.id === selectedSyncRunId);
  const rows = details?.rows ?? [];
  const columns = details?.columns ?? [];
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
            <table className="report-detail-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>
                      <div className="report-column-header">
                        <span>{column}</span>
                        <input
                          aria-label={`Filter ${column}`}
                          onChange={(event) => onColumnFilterChange(column, event.target.value)}
                          placeholder="Filter"
                          type="text"
                          value={columnFilters[column] ?? ''}
                        />
                      </div>
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
