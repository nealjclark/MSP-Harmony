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
  Clock3,
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
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
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
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  integrationHasAnyCapability,
  integrationHasCapability,
  integrationDetailOnlySyncEnabled,
  integrationDoNotSuggestNewAdditions,
  getIntegrationSettingsDefinition,
  integrationSettingsRegistry,
  validateIntegrationRegistry,
  doNotSuggestNewAdditionsSettingKey,
  type IntegrationCapability,
  type IntegrationDataSourceDefinition,
  type IntegrationDataSourceType,
  type IntegrationId,
  type IntegrationSettingsDefinition,
  type IntegrationNonSecretDefinition,
  type IntegrationSecretDefinition,
  type IntegrationSettingsState,
  type IntegrationSettingsValidation,
} from '../../shared/integrationSettings';
import {
  isVendorDatapointId,
  type CreateVendorDatapointInput,
  type InvoiceTableColumnMap as SharedInvoiceTableColumnMap,
  type ManualImportSyncMode,
  type UpdateVendorDatapointInput,
  type VendorDatapointRecord,
  type VendorKey,
} from '../../shared/vendorDatapoints';
import {
  formatLaborFilterSummary,
  integrationSupportsLaborMapping,
  type ConnectWiseBoardOption,
  type ConnectWiseStatusOption,
  type ConnectWiseSubTypeOption,
  type ConnectWiseTypeOption,
  type LaborMappingRecord,
} from '../../shared/laborMappings';
import {
  formatInvestigationTicketStatusLabel,
  integrationSupportsInvestigationTicketMapping,
  INVESTIGATION_TICKET_STATUS_DEFAULT,
  type InvestigationTicketMappingRecord,
  type InvestigationTicketRecord,
  type InvestigationTicketTimeEntry,
} from '../../shared/investigationTicketMappings';
import {
  columnMapSatisfiesSourceType,
  columnMappingHeaderOptions,
  importRequiresQuantityColumn,
  invoiceTableFieldDefinitions,
  invoiceTableFieldGroups,
  matchVendorDatapointByHeaders,
  mergeInvoiceTableColumnMap,
  mappedColumnHeaders,
  mergeKnownHeaders,
  quantityColumnSelectOptions,
  suggestInvoiceTableColumnMap,
} from '../../shared/invoiceTableMapping';
import { readWorkbookObjectRows } from './importWorkbook';
import {
  preferredReconciliationCountSource,
  type ReconciliationCountSource,
} from './preferredReconciliationCountSource';
import {
  defaultCommunicationSettings,
  defaultInvoiceNoticeTemplates,
  invoiceNoticeTypeLabels,
  invoiceNoticeTypePillLabels,
  invoiceNoticeTypeRanges,
  invoiceNoticeTypes,
  isValidEmail,
  normalizeInvoiceNoticeType,
  noticeTypeForDaysPastDue,
  validateEmailList,
  type CommunicationSettings,
  type InvoiceNoticeTemplate,
  type InvoiceNoticeTemplates,
  type InvoiceNoticeType,
} from '../../shared/communicationSettings';

type View = 'reconcile' | 'discrepancies' | 'integrations' | 'mappings' | 'reports' | 'invoices' | 'agreements' | 'settings';
type SettingsSection = 'user-management' | 'integrations' | 'email-communication' | 'audit-logs';
type AppRole = 'Admin' | 'Approver' | 'Analyst';
type ManagedUserStatus = 'active' | 'disabled';
type InvoiceWorkspaceTab = 'overdue' | 'monthly' | 'standard';
type OverdueInvoiceSortKey = 'customerName' | 'pastDueStatus' | 'invoiceCount' | 'pastDueBalance' | 'agingBalance';
type SortDirection = 'asc' | 'desc';
type IssueStatus =
  | 'matched'
  | 'needs-review'
  | 'not-billable'
  | 'unmapped'
  | 'ready'
  | 'approved'
  | 'updated'
  | 'blocked'
  | 'skipped';
type IntegrationStatus = 'connected' | 'degraded' | 'not-configured';
type IntegrationTab = 'api' | 'invoice';
type ReportSection = 'raw-sync' | 'product-profitability' | 'customer-license';
type MappingStatus = 'candidate' | 'approved' | 'needs-review' | 'rejected';
type MappingSectionId = 'labor' | 'investigation-tickets' | 'reconciliation-options' | 'ncentral' | 'customer' | 'product' | 'linked-counts' | 'bundles' | 'usage-overrides';
type AppliedReconciliationUpdate = {
  quantityDelta: number;
  lessIncludedDelta?: number;
  appliedAt: string;
};

type ReconciliationMatchedAgreementAddition = {
  id: string;
  agreementId?: string;
  agreementName?: string;
  connectWiseAgreementId?: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: {
    amount: number;
    currency: string;
  };
  lessIncluded?: number;
  billedQuantity?: number;
  additionStatus?: string;
  updatedAt?: string;
};

type ReconciliationVendorOption = {
  id: VendorKey;
  name: string;
  sourceKind: 'sync' | 'import';
  lastRefreshedLabel?: string;
  canSync: boolean;
  syncIntegrationId?: IntegrationId;
};

type CompareFreshnessRow = {
  id: string;
  name: string;
  sourceKind: 'sync' | 'import';
  lastRefreshedLabel: string;
  canSync: boolean;
  syncIntegrationId?: IntegrationId;
};

type ReconcileIssue = {
  id: string;
  vendorId: VendorKey;
  clientId: string;
  agreementId: string;
  accountId?: string;
  customer: string;
  agreement: string;
  vendor: string;
  product: string;
  family: string;
  serviceCode: string;
  lineType: 'base-count' | 'usage-add-on' | 'unmapped-vendor';
  measuredSourceCount: number;
  sourceCount: number;
  linkedCount?: ReconciliationLinkedCount;
  vendorInvoiceCount?: number;
  vendorInvoiceLineCount?: number;
  invoiceImportId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceCount: number;
  proposedCount: number;
  selectedCountSource: ReconciliationCountSource;
  manualOverrideTotal?: number;
  manualOverrideTotalTouched?: boolean;
  baseStatus: IssueStatus;
  amount: number;
  unitPriceAmount?: number;
  unitPriceCurrency?: string;
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
  matchedAgreementAdditions: ReconciliationMatchedAgreementAddition[];
  connectWiseAdditionId?: string;
  vendorProductKey?: string;
  writeAction?: 'update-addition' | 'create-addition' | 'review-required';
  proposedLessIncluded?: number;
  lessIncludedTouched?: boolean;
  appliedUpdate?: AppliedReconciliationUpdate;
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
  capabilities: IntegrationCapability[];
  dataSources: IntegrationDataSourceDefinition[];
  description: string;
  lastSync?: string;
  lastSyncStatus?: string;
  records?: string;
  enabled: boolean;
  endpoint: string;
  nonSecrets: Record<string, string | undefined>;
  requiredSecrets: IntegrationSecretDefinition[];
  requiredNonSecrets: IntegrationNonSecretDefinition[];
  optionalNonSecrets: IntegrationNonSecretDefinition[];
  missingSecrets: string[];
  missingNonSecrets: string[];
  webhookSupported: boolean;
};

type IntegrationSettingsPayload = {
  integrationId: IntegrationId;
  nonSecrets: Record<string, string>;
  secrets: Record<string, string>;
};

type RuntimeIntegrationSummary = IntegrationSettingsDefinition & {
  nonSecrets?: Record<string, string | undefined>;
  validation?: IntegrationSettingsValidation;
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
type DattoSyncTarget = 'datto-saas' | 'datto-saas-bcdr';
type IntegrationSyncTarget = RawSyncDataset | DattoSyncTarget;
type DattoMappingDataset = 'saas' | 'bcdr';
type HuntressMappingDataset = 'edr' | 'itdr' | 'sat' | 'siem' | 'ispm' | 'siem-extended-retention';

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
  laborHours?: number;
  laborCost?: number;
};

type ProductProfitabilityIntegrationSeries = {
  integrationId: string;
  integrationName: string;
  months: ProductProfitabilityMonth[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalLaborHours?: number;
  totalLaborCost?: number;
  productCount: number;
  missingCostRows: number;
};

type ProductProfitabilityLaborMonth = {
  month: string;
  hours: number;
  cost?: number;
  ticketCount: number;
};

type ProductProfitabilityLaborRow = {
  vendorId: string;
  vendorName: string;
  label: string;
  months: ProductProfitabilityLaborMonth[];
  totalHours: number;
  totalCost?: number;
  ticketCount: number;
};

type ProductProfitabilityReportResponse = {
  reportType: 'product-profitability';
  generatedAt: string;
  currency: 'USD';
  startMonth: string;
  endMonth: string;
  months: string[];
  billingBasis?: 'latest-addition-per-month';
  laborHourlyRate?: number;
  summary: {
    integrationCount: number;
    productCount: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    totalLaborHours?: number;
    totalLaborCost?: number;
    missingCostRows: number;
  };
  labor?: {
    months: ProductProfitabilityLaborMonth[];
    rows: ProductProfitabilityLaborRow[];
    warning?: string;
  };
  integrations: ProductProfitabilityIntegrationSeries[];
};

type SavedProductProfitabilityReportSummary = {
  id: string;
  name: string;
  vendorIds: string[];
  createdAt: string;
  createdBy: string | null;
};

type SavedProductProfitabilityReportResponse = SavedProductProfitabilityReportSummary & {
  report: ProductProfitabilityReportResponse;
};

type CustomerLicenseVendorId = Extract<IntegrationId, 'cove' | 'ncentral' | 'microsoft-365' | 'opentext-appriver'>;
type CustomerLicenseReportVendorId = CustomerLicenseVendorId | 'all';

type CustomerLicenseCustomerOption = {
  customerId: string;
  connectWiseCompanyId?: string;
  customerName: string;
  agreementCount: number;
  mappedVendorIds: CustomerLicenseVendorId[];
};

type CustomerLicenseCustomersResponse = {
  customers: CustomerLicenseCustomerOption[];
};

type CustomerLicenseDetailValue = string | number | boolean | null;
type CustomerLicenseDetailRow = Record<string, CustomerLicenseDetailValue>;

type CustomerLicenseMonthCount = {
  month: string;
  count: number;
};

type CustomerLicenseProductSection = {
  productKey: string;
  productCode?: string;
  productName: string;
  vendor: {
    integrationId: CustomerLicenseVendorId;
    integrationName: string;
  };
  currentCount: number;
  months: CustomerLicenseMonthCount[];
  detailColumns: string[];
  detailRows: CustomerLicenseDetailRow[];
};

type CustomerLicenseInventoryItem = {
  key: string;
  product: CustomerLicenseProductSection;
  row: CustomerLicenseDetailRow;
};

type CustomerLicenseReportResponse = {
  reportType: 'customer-license';
  generatedAt: string;
  customer: {
    customerId: string;
    connectWiseCompanyId?: string;
    customerName: string;
  };
  vendor: {
    integrationId: CustomerLicenseReportVendorId;
    integrationName: string;
  };
  startMonth: string;
  endMonth: string;
  months: string[];
  summary: {
    productCount: number;
    vendorCount: number;
    totalCurrentCount: number;
    detailRowCount: number;
    microsoftUserDetailCount: number;
  };
  products: CustomerLicenseProductSection[];
};

type DiscrepancyBasis = 'user' | 'device';
type DiscrepancySeverity = 'matched' | 'warning' | 'critical' | 'unavailable';
type DiscrepancyFilterValue = 'all' | DiscrepancySeverity;

type DiscrepancyComparisonPair = {
  id: string;
  label: string;
  basis: DiscrepancyBasis;
  leftVendorId: string;
  leftVendorName: string;
  rightVendorId: string;
  rightVendorName: string;
  matchingStrategy: 'normalized-hostname' | 'email-upn' | 'aggregate-count';
  productFamily: string;
  aggregateOnly: boolean;
};

type DiscrepancyItem = {
  id: string;
  identity: string;
  displayName: string;
  vendorId: string;
  productKey?: string;
  productName?: string;
  domain?: string;
  observedAt?: string;
  details: Record<string, string | number | boolean | null>;
};

type DiscrepancyRow = {
  id: string;
  customer: {
    customerId?: string;
    connectWiseCompanyId?: string;
    customerName: string;
  };
  comparisonPair: DiscrepancyComparisonPair;
  basis: DiscrepancyBasis;
  productFamily: string;
  domain?: string;
  leftCount: number;
  rightCount: number;
  delta: number;
  status: DiscrepancySeverity;
  stale: boolean;
  aggregateOnly: boolean;
  unavailableReason?: string;
  missingFromLeft: DiscrepancyItem[];
  missingFromRight: DiscrepancyItem[];
  referenceItems: DiscrepancyItem[];
  syncTimestamps: {
    left?: string;
    right?: string;
  };
};

type DiscrepancyReportResponse = {
  reportType: 'discrepancies';
  generatedAt: string;
  filters: {
    customerId?: string;
    basis?: DiscrepancyBasis;
    severity?: DiscrepancySeverity;
    includeMatched: boolean;
  };
  summary: {
    comparisonCount: number;
    rowCount: number;
    openDiscrepancyCount: number;
    warningCount: number;
    criticalCount: number;
    unavailableCount: number;
    matchedCount: number;
    deviceGapCount: number;
    userGapCount: number;
    staleSourceCount: number;
    customerCount: number;
  };
  comparisonPairs: DiscrepancyComparisonPair[];
  customers: Array<{
    customerId: string;
    connectWiseCompanyId?: string;
    customerName: string;
  }>;
  rows: DiscrepancyRow[];
};

type ReconciliationLineStatus = 'matched' | 'needs-review' | 'not-billable' | 'unmapped';

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

type ReconciliationLinkedCountSource = {
  sourceType: 'vendor-product' | 'connectwise-addition' | 'filtered-dataset';
  label: string;
  quantity: number;
  rowCount: number;
  vendorId?: IntegrationId;
  vendorProductKey?: string;
  dataset?: RawSyncDataset;
  productCode?: string;
};

type ReconciliationLinkedCount = {
  ruleId: string;
  ruleName: string;
  sourceVendorProductKey: string;
  quantity: number;
  sources: ReconciliationLinkedCountSource[];
};

type ReconciliationRunMeta = {
  syncRunId?: string;
  generatedAt: string;
  snapshotCount?: number;
  agreementAdditionCount?: number;
  latestInvoice?: InvoiceImportSummary;
  productCheckCount: number;
};

type InvoiceImportSummary = {
  id: string;
  vendorId: VendorKey;
  fileName: string;
  invoiceNumber?: string;
  importedAt: string;
  invoiceDate?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  rowCount: number;
  matchedRows: number;
  exceptionRows: number;
  status: 'ready' | 'review';
};

type InvoiceImportMode = 'overwrite' | 'merge';
type InvoiceTableColumnMap = SharedInvoiceTableColumnMap;

type InvoiceImportsResponse = {
  imports: InvoiceImportSummary[];
};

type DetectedInvoiceVendor = {
  vendorId: IntegrationId;
  vendorName: string;
  confidence: 'high' | 'medium';
  reason: string;
};

type InvoiceImportResponse = {
  detectedVendor?: DetectedInvoiceVendor;
  import: InvoiceImportSummary;
  importMode?: InvoiceImportMode;
};

type InvoiceExceptionSummary = {
  exceptionRows: number;
  missingCustomerRows: number;
  missingAgreementRows: number;
  missingProductRows: number;
  renewalExceptionRows: number;
  otherExceptionRows: number;
};

type InvoiceExceptionLine = {
  id: string;
  rawRowNumber: number;
  externalAccountId?: string;
  externalAccountName?: string;
  vendorProductKey?: string;
  vendorProductKeyCandidates: string[];
  productCode: string;
  productName: string;
  connectWiseProductCode?: string;
  connectWiseProductName?: string;
  chargeType?: string;
  quantity: number;
  billedAmount?: number;
  term?: string;
  billingFrequency?: string;
  invoiceDate?: string;
  primaryDomain?: string;
  missingCustomer: boolean;
  missingAgreement: boolean;
  missingProduct: boolean;
};

type InvoiceAccountExistingMapping = {
  customerId: string;
  customerName: string;
  agreementId?: string;
  agreementName?: string;
  status: string;
  active: boolean;
};

type InvoiceAccountException = {
  externalAccountId: string;
  externalAccountName: string;
  rowCount: number;
  quantity: number;
  missingCustomer: boolean;
  missingAgreement: boolean;
  missingProduct: boolean;
  currentMapping?: InvoiceAccountExistingMapping;
  sampleRows: InvoiceExceptionLine[];
};

type InvoiceProductExistingMapping = {
  connectWiseProductCode: string;
  connectWiseProductName: string;
  status: string;
  active: boolean;
};

type InvoiceProductException = {
  vendorProductKey: string;
  vendorProductKeyCandidates: string[];
  productCode: string;
  productName: string;
  term?: string;
  billingFrequency?: string;
  rowCount: number;
  quantity: number;
  missingProduct: boolean;
  existingMappings: InvoiceProductExistingMapping[];
  sampleRows: InvoiceExceptionLine[];
};

type InvoiceImportExceptionReview = {
  import: InvoiceImportSummary;
  summary: InvoiceExceptionSummary;
  accountExceptions: InvoiceAccountException[];
  productExceptions: InvoiceProductException[];
  lines: InvoiceExceptionLine[];
};

type InvoiceImportRefreshResponse = {
  import: InvoiceImportSummary;
  accountRowsUpdated: number;
  productRowsUpdated: number;
};

type OverdueInvoiceBucketId = '7-29-days' | '30-59-days' | '60-plus-days';

type InvoiceNotificationAuditSummary = {
  noticeType: InvoiceNoticeType;
  actor: string;
  occurredAt: string;
  subject: string;
  bodyPreview: string;
};

type OverdueInvoice = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceType: string;
  invoiceStatus: string;
  invoiceStatusClosed: boolean;
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  agreement?: {
    id?: string;
    name?: string;
    type?: string;
  };
  applyToType?: string;
  applyToId?: string;
  invoiceDate?: string;
  dueDate?: string;
  daysPastDue: number;
  total: number;
  balance: number;
  billingTerms?: string;
  emailTemplateId?: number;
  emailTemplateName?: string;
  bucketId: OverdueInvoiceBucketId;
  lastNotice?: InvoiceNotificationAuditSummary;
};

type OverdueInvoiceBucket = {
  id: OverdueInvoiceBucketId;
  label: string;
  noticeType: InvoiceNoticeType;
  invoices: OverdueInvoice[];
  invoiceCount: number;
  balanceTotal: number;
};

type OverdueInvoiceCustomerGroup = {
  customerKey: string;
  company: OverdueInvoice['company'];
  invoices: OverdueInvoice[];
  invoiceCount: number;
  balanceTotal: number;
  oldestDaysPastDue: number;
  noticeType: InvoiceNoticeType;
  bucketCounts: Record<OverdueInvoiceBucketId, number>;
  lastNotice?: InvoiceNotificationAuditSummary;
};

type OverdueInvoicesResponse = {
  generatedAt: string;
  summary: {
    reviewQueueCount: number;
    reviewQueueBalance: number;
    customerCount?: number;
    totalOpenBalanceCount: number;
    totalOpenBalanceAmount: number;
  };
  buckets: OverdueInvoiceBucket[];
  customerGroups?: OverdueInvoiceCustomerGroup[];
};

type AgreementInvoiceReference = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  total: number;
  balance: number;
  emailTemplateId?: number;
  invoiceType: string;
};

type MonthlyInvoiceCandidate = {
  agreementId: string;
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  agreementName: string;
  agreementType?: string;
  billAmount: number;
  billingTerms?: string;
  nextInvoiceDate?: string;
  invoiceTemplateName?: string;
  lastInvoice?: AgreementInvoiceReference;
  missingFields: string[];
};

type MonthlyInvoiceCandidatesResponse = {
  generatedAt: string;
  agreementCount: number;
  candidates: MonthlyInvoiceCandidate[];
};

type MonthlyInvoicePreview = {
  generatedAt: string;
  previewMode: 'stub';
  candidate: MonthlyInvoiceCandidate;
  payload: {
    invoiceType: 'Agreement';
    applyToType: 'Agreement';
    applyToId: string;
    companyName: string;
    agreementName: string;
    nextInvoiceDate?: string;
    billingTerms?: string;
    billAmount: number;
    invoiceTemplateName?: string;
  };
  warnings: string[];
};

type StandardInvoiceCandidate = {
  company: {
    id?: string;
    identifier?: string;
    name: string;
  };
  latestInvoice?: AgreementInvoiceReference;
  invoiceTypes: string[];
  openInvoiceCount: number;
  openBalanceAmount: number;
  overdueInvoiceCount: number;
};

type StandardInvoiceCandidatesResponse = {
  generatedAt: string;
  candidateCount: number;
  candidates: StandardInvoiceCandidate[];
};

type InvoiceWorkspaceCache = {
  version: 1;
  savedAt: string;
  invoiceImports: Record<string, InvoiceImportsResponse>;
  overdueInvoices?: OverdueInvoicesResponse;
  monthlyInvoiceCandidates?: MonthlyInvoiceCandidatesResponse;
  standardInvoiceCandidates?: StandardInvoiceCandidatesResponse;
};

type InvoiceWorkspaceLoadOptions = {
  forceRefresh?: boolean;
};

type InvoiceNotificationPreview = {
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceIds: string[];
  invoiceCount: number;
  invoices: InvoiceNotificationPreviewInvoice[];
  companyKey?: string;
  companyName: string;
  fromEmail?: string;
  recipientName: string;
  recipientEmail?: string;
  ccEmails: string[];
  bccEmails: string[];
  notes?: string;
  billingContact?: InvoiceBillingContact;
  agreementName?: string;
  noticeType: InvoiceNoticeType;
  daysPastDue: number;
  dueDate?: string;
  balance: number;
  totalBalance: number;
  emailTemplateId?: number;
  emailTemplateName?: string;
  emailTemplateNames: string[];
  paymentLink?: string;
  subject: string;
  bodyPreview: string;
  templateBody?: string;
};

type InvoiceBillingContact = {
  id: string;
  name: string;
  email?: string;
};

type InvoiceNotificationPreviewInvoice = {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  daysPastDue: number;
  balance: number;
  total: number;
  invoiceType: string;
  invoiceStatus?: string;
  agreementName?: string;
  paymentLink?: string;
};

type InvoiceNotificationResponse = {
  status: 'preview' | 'stubbed' | 'test-stubbed' | 'sent' | 'test-sent' | 'failed';
  generatedAt: string;
  preview: InvoiceNotificationPreview;
  audit?: InvoiceNotificationAuditSummary;
  deliveryError?: string;
};

type CommunicationSettingsResponse = {
  settings: CommunicationSettings;
};

type AuditSyncRun = {
  id: string;
  integrationId: IntegrationId | string;
  integrationName: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
  sourceLabel?: string;
};

type AuditEventRecord = {
  id: string;
  actor: string;
  eventType: string;
  eventLabel: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  summary: {
    title: string;
    subtitle: string;
    status: string;
  };
};

type AuditBatchRecord = {
  batchId: string;
  eventId: string;
  actor: string;
  occurredAt: string;
  status: string;
  updateCount: number;
  discardedCount: number;
  written: number;
  failed: number;
  discarded: number;
};

type AuditBatchItemRecord = {
  id: string;
  customerName?: string;
  agreementName?: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  currentLessIncluded?: number;
  proposedLessIncluded?: number;
  lessIncludedChanged: boolean;
  status: string;
  errorMessage?: string;
  writtenAt?: string;
};

type AuditBatchDetail = {
  batchId: string;
  actor: string;
  occurredAt: string;
  status: string;
  updateCount: number;
  discardedCount: number;
  written: number;
  failed: number;
  discarded: number;
  items: AuditBatchItemRecord[];
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
  lineType: 'base-count' | 'usage-add-on' | 'unmapped-vendor';
  sourceQuantity: number;
  invoiceQuantity?: number;
  invoiceLineCount?: number;
  invoiceImportId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
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
  linkedCount?: ReconciliationLinkedCount;
  status: ReconciliationLineStatus;
  writeAction?: 'update-addition' | 'create-addition' | 'review-required';
  reason: string;
  evidence: Array<{
    label: string;
    value: string | number;
  }>;
  matchedAgreementAdditions?: ReconciliationMatchedAgreementAddition[];
  connectWiseAdditionId?: string;
  vendorProductKey?: string;
  devices?: ReconciliationDevice[];
  adjustments?: ReconciliationAdjustment[];
};

type AgreementAdditionUpdatePayload = {
  sourceLineId: string;
  vendorId: VendorKey;
  customerId: string;
  customerName: string;
  agreementId: string;
  agreementName: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  currentLessIncluded: number;
  quantity: number;
  manualQuantity?: number;
  lessIncluded?: number;
  apiQuantity: number;
  invoiceQuantity?: number;
  selectedSource: ReconciliationCountSource;
};

type AgreementAdditionUpdateResultItem = {
  itemId?: string;
  sourceLineId: string;
  connectWiseAdditionId: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  currentLessIncluded: number;
  proposedLessIncluded?: number;
  lessIncludedChanged: boolean;
  status: 'written' | 'failed' | 'discarded';
  error?: string;
};

type AgreementAdditionUpdateResponse = {
  batchId: string;
  status: 'written' | 'partial' | 'discarded';
  summary: {
    written: number;
    failed: number;
    discarded: number;
  };
  items: AgreementAdditionUpdateResultItem[];
};

type ReconciliationRunResponse = {
  vendorId: IntegrationId;
  generatedAt: string;
  syncRunId?: string;
  snapshotCount?: number;
  agreementAdditionCount?: number;
  latestInvoice?: InvoiceImportSummary;
  productOptions?: ReconciliationProductOption[];
  lines: ReconciliationLineResponse[];
  totals: {
    matched: number;
    needsReview: number;
    notBillable: number;
    unmapped: number;
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

type ProductLinkRuleSource =
  | {
      sourceType: 'vendor-product';
      vendorId: IntegrationId;
      vendorProductKey: string;
      vendorProductName?: string;
    }
  | {
      sourceType: 'connectwise-addition';
      productCode: string;
      productName?: string;
    }
  | {
      sourceType: 'filtered-dataset';
      vendorId: IntegrationId;
      dataset?: RawSyncDataset;
      label?: string;
      filter: ProductLinkRuleFilterNode;
      aggregation: ProductLinkRuleAggregation;
    };

type ProductLinkRuleFilterOperator =
  | 'contains'
  | 'not-contains'
  | 'equals'
  | 'not-equals'
  | 'starts-with'
  | 'ends-with'
  | 'is-empty'
  | 'is-not-empty';

type ProductLinkRuleFilterNode =
  | {
      nodeType: 'group';
      operator: 'and' | 'or';
      children: ProductLinkRuleFilterNode[];
    }
  | {
      nodeType: 'condition';
      field: string;
      operator: ProductLinkRuleFilterOperator;
      value?: string;
    };

type ProductLinkRuleAggregation =
  | {
      type: 'row-count';
    }
  | {
      type: 'column-sum';
      column: string;
    };

type ProductLinkRule = {
  id: string;
  vendorId: IntegrationId;
  sourceVendorProductKey: string;
  ruleName: string;
  sources: ProductLinkRuleSource[];
  status: MappingStatus;
  active: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ProductLinkRuleTestRow = {
  sourceType: ProductLinkRuleSource['sourceType'];
  sourceLabel: string;
  rowId: string;
  rowLabel: string;
  customerId?: string;
  agreementId?: string;
  externalAccountId?: string;
  productKey?: string;
  productCode?: string;
  productName?: string;
  quantity: number;
  observedAt?: string;
  details: DimensionMap;
};

type ProductLinkRuleTestSourceTotal = {
  sourceType: ProductLinkRuleSource['sourceType'];
  label: string;
  quantity: number;
  rowCount: number;
};

type ProductLinkRuleTestResult = {
  vendorId: IntegrationId;
  ruleId: string;
  ruleName: string;
  sourceVendorProductKey: string;
  customerId: string;
  customerName?: string;
  agreementId?: string;
  agreementName?: string;
  total: number;
  rows: ProductLinkRuleTestRow[];
  sourceTotals: ProductLinkRuleTestSourceTotal[];
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

type LinkedDatasetMetadata = {
  columns: string[];
  uniqueValuesByColumn: Record<string, string[]>;
  syncRunId?: string;
  rowCount: number;
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

type LaborMapping = LaborMappingRecord;

type LaborMappingsResponse = {
  integrationId: VendorKey;
  mappings: LaborMapping[];
};

type InvestigationTicketMapping = InvestigationTicketMappingRecord;

type InvestigationTicketMappingResponse = {
  integrationId: VendorKey;
  mapping: InvestigationTicketMapping | null;
};

type InvestigationTicketsResponse = {
  tickets: InvestigationTicketRecord[];
};

type InvestigationTicketTimeEntriesResponse = {
  ticket: InvestigationTicketRecord;
  timeEntries: InvestigationTicketTimeEntry[];
};

type LaborClassificationsResponse = {
  boards?: ConnectWiseBoardOption[];
  boardId?: number;
  types: ConnectWiseTypeOption[];
  subTypes: ConnectWiseSubTypeOption[];
  statuses?: ConnectWiseStatusOption[];
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
    linkedProductRules: number;
    unmappedSnapshots: number;
  };
  accountMappings: AccountMapping[];
  accountCandidates: AccountMappingCandidate[];
  productMappings: ProductMapping[];
  productCandidates: ProductMappingCandidate[];
  productBundles: ProductBundle[];
  productLinkRules: ProductLinkRule[];
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

type IntegrationAction = 'test' | 'sync' | 'sync-users' | 'sync-licenses' | 'sync-datto-saas' | 'sync-datto-saas-bcdr';
type IntegrationActionKey = `${IntegrationId}:${IntegrationAction}`;

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

const agreements = [
  { customer: 'Northstar Dental Group', agreement: 'Managed Services - Premium', products: 31, exposure: 1540, nextAction: 'Approve M365 seats' },
  { customer: 'Harbor Ridge Logistics', agreement: 'Security Stack Bundle', products: 18, exposure: -925, nextAction: 'Review vendor credit' },
  { customer: 'Clearwater Legal', agreement: 'Cloud Continuity', products: 12, exposure: 396, nextAction: 'Resolve mailbox mapping' },
  { customer: 'Cedar Valley Schools', agreement: 'Education Security', products: 24, exposure: 610, nextAction: 'Confirm campus scope' },
];

const workflow = [
  { label: 'Vendor API Data', value: 'Latest sync', icon: Database, state: 'done' },
  { label: 'Vendor Invoice', value: 'No invoice', icon: FileSpreadsheet, state: 'done' },
  { label: 'CW Data', value: 'Last sync', icon: FileUp, state: 'done' },
  { label: 'Discrepancies', value: '0 review', icon: Link2, state: 'active' },
  { label: 'Unresolved exposure', value: '$0', icon: CircleDollarSign, state: 'idle' },
];

const navItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'reconcile', label: 'Reconcile', icon: BarChart3 },
  { id: 'discrepancies', label: 'Discrepancies', icon: Link2 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'invoices', label: 'Invoices', icon: CircleDollarSign },
];

const utilityNavItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'settings', label: 'Settings', icon: Settings },
];

const defaultView: View = 'reconcile';
const defaultMappingIntegrationId: IntegrationId = 'cove';

const viewPaths: Record<Exclude<View, 'settings'>, string> = {
  reconcile: '/reconcile',
  discrepancies: '/discrepancies',
  integrations: '/integrations',
  mappings: '/mappings',
  reports: '/reports',
  invoices: '/invoices',
  agreements: '/agreements',
};

const defaultSettingsSection: SettingsSection = 'user-management';

const settingsSections: Array<{ id: SettingsSection; label: string; description: string }> = [
  {
    id: 'user-management',
    label: 'User Management',
    description: 'Manage application users, roles, and access status',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Integration credentials and configuration',
  },
  {
    id: 'email-communication',
    label: 'Email Communication',
    description: 'Invoice past-due email wording and billing BCC recipients',
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    description: 'Sync runs, approvals, and application activity history',
  },
];

const settingsSectionPaths: Record<SettingsSection, string> = {
  'user-management': '/settings/user-management',
  integrations: '/settings/integrations',
  'email-communication': '/settings/email-communication',
  'audit-logs': '/settings/audit-logs',
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
  {
    id: 'customer-license',
    label: 'Customer Licenses',
    enabled: true,
    description: 'Generate customer-facing license counts and product details on demand',
  },
];

const reconciliationVendorIds: IntegrationId[] = integrationSettingsRegistry
  .filter((integration) => integration.integrationId !== 'connectwise' && integration.capabilities.includes('mapping'))
  .map((integration) => integration.integrationId);
const customerLicenseVendorIds: CustomerLicenseReportVendorId[] = ['all', 'microsoft-365', 'cove', 'ncentral', 'opentext-appriver'];
const noAgreementSyncValue = '__no_agreement_sync__';

const integrationSettingsStates: IntegrationSettingsState[] = [];

const demoIntegrationValidations = validateIntegrationRegistry(integrationSettingsStates);

function hasLiveIntegrationActions(integrationId: IntegrationId) {
  return integrationHasCapability(integrationId, 'live-api');
}

function hasMappingWorkspace(integrationId: IntegrationId) {
  return integrationHasCapability(integrationId, 'mapping');
}

function hasLaborMappingWorkspace(vendorId: VendorKey) {
  return integrationSupportsLaborMapping(vendorId);
}

function hasInvestigationTicketMappingWorkspace(vendorId: VendorKey) {
  return integrationSupportsInvestigationTicketMapping(vendorId);
}

function hasAnyMappingWorkspace(vendorId: VendorKey) {
  if (isVendorDatapointId(vendorId)) {
    return true;
  }
  return (
    hasMappingWorkspace(vendorId) ||
    hasLaborMappingWorkspace(vendorId) ||
    hasInvestigationTicketMappingWorkspace(vendorId)
  );
}

function isImplementedIntegration(integrationId: IntegrationId) {
  return integrationHasAnyCapability(integrationId);
}

function hasRawSyncReportDataSignal(integration: Integration) {
  const records = Number.parseFloat((integration.records ?? '').replace(/,/g, ''));
  return Boolean(integration.lastSync || (Number.isFinite(records) && records > 0));
}

function isActiveApiIntegration(integration: Integration) {
  if (!isImplementedIntegration(integration.id)) {
    return false;
  }

  if (integration.status === 'not-configured') {
    return false;
  }

  if (hasLiveIntegrationActions(integration.id)) {
    return true;
  }

  return hasRawSyncReportDataSignal(integration);
}

function hasAvailableRawSyncReport(integration: Integration) {
  return hasRawSyncReportDataSignal(integration) || (hasLiveIntegrationActions(integration.id) && integration.enabled);
}

function isEnabledReconciliationDatapoint(datapoint: VendorDatapointRecord) {
  return datapoint.active && Boolean(datapoint.lastImportedAt) && !datapoint.linkedIntegrationId;
}

function isEnabledReconciliationIntegration(integration: Integration) {
  if (integration.id === 'connectwise' || !integrationHasCapability(integration.id, 'mapping')) {
    return false;
  }

  if (integration.status === 'not-configured' && !hasRawSyncReportDataSignal(integration)) {
    return false;
  }

  const definition = getIntegrationSettingsDefinition(integration.id);
  if (definition && integrationDetailOnlySyncEnabled(integration.nonSecrets, definition)) {
    return false;
  }

  return hasRawSyncReportDataSignal(integration);
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
      operationalStatus: runtime?.operationalStatus,
      validation:
        runtime?.validation ??
        demoIntegrationValidations.find((item) => item.integrationId === definition.integrationId),
    };
  });

  return definitions.map((definition) => {
    const validation = definition.validation;
    const operationalStatus = definition.operationalStatus;
    const records = operationalStatus?.lastSyncRecordsWritten;

    return {
      id: definition.integrationId,
      name: definition.displayName,
      category: definition.category,
      status: validation?.configuredStatus ?? 'not-configured',
      auth: formatAuthMode(definition.authMode),
      capabilities: definition.capabilities,
      dataSources: definition.dataSources,
      description: definition.description,
      lastSync: formatDateTime(operationalStatus?.lastSyncCompletedAt ?? operationalStatus?.lastSyncAt),
      lastSyncStatus: operationalStatus?.lastSyncStatus,
      records: typeof records === 'number' ? records.toLocaleString() : undefined,
      enabled: validation?.configuredStatus !== 'not-configured',
      endpoint: definition.endpoint,
      nonSecrets: definition.nonSecrets ?? {},
      requiredSecrets: definition.requiredSecrets,
      requiredNonSecrets: definition.requiredNonSecrets,
      optionalNonSecrets: definition.optionalNonSecrets ?? [],
      missingSecrets: validation?.missingSecrets.map((setting) => setting.label) ?? [],
      missingNonSecrets: validation?.missingNonSecrets.map((setting) => setting.label) ?? [],
      webhookSupported: definition.webhookSupported,
    };
  });
}

function checkboxSettingEnabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
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

function formatHoursValue(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}h`;
}

function formatHoursCompact(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    notation: 'compact',
  })}h`;
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

function formatOptionalCount(value: number | undefined) {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function validVendorInvoiceCount(issue: Pick<ReconcileIssue, 'vendorInvoiceCount'>) {
  return typeof issue.vendorInvoiceCount === 'number' && Number.isFinite(issue.vendorInvoiceCount)
    ? issue.vendorInvoiceCount
    : undefined;
}

function validLinkedCount(issue: Pick<ReconcileIssue, 'linkedCount'>) {
  return typeof issue.linkedCount?.quantity === 'number' && Number.isFinite(issue.linkedCount.quantity)
    ? issue.linkedCount.quantity
    : undefined;
}

function validManualOverrideTotal(issue: Pick<ReconcileIssue, 'manualOverrideTotal' | 'manualOverrideTotalTouched'>) {
  return issue.manualOverrideTotalTouched &&
    typeof issue.manualOverrideTotal === 'number' &&
    Number.isFinite(issue.manualOverrideTotal)
    ? issue.manualOverrideTotal
    : undefined;
}

function reconciliationCountSource(issue: ReconcileIssue): ReconciliationCountSource {
  const invoiceCount = validVendorInvoiceCount(issue);
  const manualTotal = validManualOverrideTotal(issue);
  if (issue.selectedCountSource === 'manual' && typeof manualTotal === 'number') {
    return 'manual';
  }

  if (issue.selectedCountSource === 'linked' && typeof validLinkedCount(issue) === 'number') {
    return 'linked';
  }

  return issue.selectedCountSource === 'invoice' && typeof invoiceCount === 'number' ? 'invoice' : 'api';
}

function reconciliationSelectedCount(issue: ReconcileIssue) {
  const countSource = reconciliationCountSource(issue);
  if (countSource === 'manual') {
    return validManualOverrideTotal(issue) ?? issue.sourceCount;
  }

  if (countSource === 'linked') {
    return validLinkedCount(issue) ?? issue.sourceCount;
  }

  return countSource === 'invoice' ? validVendorInvoiceCount(issue) ?? issue.sourceCount : issue.sourceCount;
}

function reconciliationDelta(issue: ReconcileIssue) {
  return reconciliationSelectedCount(issue) - issue.invoiceCount;
}

function reconciliationIssueImpact(issue: ReconcileIssue) {
  const delta = reconciliationDelta(issue);
  if (typeof issue.unitPriceAmount === 'number') {
    return delta * issue.unitPriceAmount;
  }

  const originalDelta = issue.proposedCount - issue.invoiceCount;
  return originalDelta === 0 ? issue.amount : issue.amount * (delta / originalDelta);
}

function currentLessIncluded(issue: ReconcileIssue) {
  return issue.matchedAgreementAdditions.reduce((total, addition) => total + (addition.lessIncluded ?? 0), 0);
}

function proposedLessIncluded(issue: ReconcileIssue) {
  return issue.lessIncludedTouched ? issue.proposedLessIncluded ?? 0 : currentLessIncluded(issue);
}

function selectedAgreementAddition(issue: ReconcileIssue) {
  if (issue.connectWiseAdditionId) {
    return (
      issue.matchedAgreementAdditions.find(
        (addition) => addition.connectWiseAdditionId === issue.connectWiseAdditionId,
      ) ?? issue.matchedAgreementAdditions[0]
    );
  }

  return issue.matchedAgreementAdditions.length === 1 ? issue.matchedAgreementAdditions[0] : undefined;
}

function formatMatchedAgreementAdditionContext(addition: ReconciliationMatchedAgreementAddition) {
  return [
    addition.productName,
    addition.agreementName ? `Agreement ${addition.agreementName}` : undefined,
    `CW ${addition.connectWiseAdditionId}`,
    `qty ${addition.quantity.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(' / ');
}

function cwCountLabel(issue: ReconcileIssue) {
  const lessIncluded = currentLessIncluded(issue);
  return lessIncluded > 0
    ? `${issue.invoiceCount.toLocaleString()} (less ${lessIncluded.toLocaleString()})`
    : issue.invoiceCount.toLocaleString();
}

function deltaLabel(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function lessIncludedDelta(issue: ReconcileIssue) {
  if (!issue.lessIncludedTouched) {
    return undefined;
  }

  return proposedLessIncluded(issue) - currentLessIncluded(issue);
}

function applyBlockReason(issue: ReconcileIssue) {
  if (issue.lineType === 'unmapped-vendor') {
    return 'Map this vendor product before applying.';
  }

  if (issue.writeAction === 'create-addition') {
    return 'Create-addition rows are handled manually in this flow.';
  }

  if (issue.matchedAgreementAdditions.length === 0) {
    return 'No active matching CW addition was found.';
  }

  if (issue.matchedAgreementAdditions.length > 1) {
    return 'Multiple active matching CW additions were found.';
  }

  return undefined;
}

function isApplyEligibleIssue(issue: ReconcileIssue) {
  return issue.status === 'approved' && !applyBlockReason(issue);
}

function buildAgreementAdditionUpdatePayload(
  issue: ReconcileIssue,
  options: { allowUnselected?: boolean } = {},
): AgreementAdditionUpdatePayload | undefined {
  const addition = selectedAgreementAddition(issue) ?? (options.allowUnselected ? issue.matchedAgreementAdditions[0] : undefined);
  if (!addition && !options.allowUnselected) {
    return undefined;
  }

  const payload: AgreementAdditionUpdatePayload = {
    sourceLineId: issue.id,
    vendorId: issue.vendorId,
    customerId: issue.clientId,
    customerName: issue.customer,
    agreementId: addition?.agreementId ?? issue.agreementId,
    agreementName: addition?.agreementName ?? issue.agreement,
    connectWiseAdditionId: addition?.connectWiseAdditionId ?? 'unselected',
    productCode: issue.serviceCode,
    productName: issue.product,
    currentQuantity: addition?.quantity ?? issue.invoiceCount,
    currentLessIncluded: addition?.lessIncluded ?? currentLessIncluded(issue),
    quantity: reconciliationSelectedCount(issue),
    manualQuantity: reconciliationCountSource(issue) === 'manual' ? reconciliationSelectedCount(issue) : undefined,
    apiQuantity: issue.sourceCount,
    invoiceQuantity: validVendorInvoiceCount(issue),
    selectedSource: reconciliationCountSource(issue),
  };

  if (issue.lessIncludedTouched) {
    payload.lessIncluded = proposedLessIncluded(issue);
  }

  return payload;
}

function restoredReconciliationStatus(issue: ReconcileIssue): IssueStatus {
  if (reconciliationDelta(issue) === 0) {
    return 'matched';
  }

  return issue.baseStatus === 'matched' || issue.baseStatus === 'approved' ? 'needs-review' : issue.baseStatus;
}

function formatMoneyValue(value: number) {
  return formatMoneyAmount({ amount: value, currency: 'USD' });
}

function formatAuthMode(value: string) {
  if (value === 'api-key') return 'api key';
  if (value === 'none') return 'invoice table';
  return value;
}

function integrationName(integrationId: IntegrationId) {
  return integrationSettingsRegistry.find((integration) => integration.integrationId === integrationId)?.displayName ?? integrationId;
}

function vendorDisplayName(vendorId: VendorKey, datapoints: VendorDatapointRecord[] = []) {
  const datapoint = datapoints.find((item) => item.vendorId === vendorId);
  if (datapoint) {
    return datapoint.displayName;
  }

  if (isVendorDatapointId(vendorId)) {
    return vendorId;
  }

  return integrationName(vendorId);
}

function datapointMappingVendorId(datapoint: VendorDatapointRecord): VendorKey {
  return datapoint.linkedIntegrationId ?? datapoint.vendorId;
}

function hasMappingWorkspaceForVendor(vendorId: VendorKey) {
  if (isVendorDatapointId(vendorId)) {
    return true;
  }

  return hasAnyMappingWorkspace(vendorId);
}

function isRegistryIntegrationId(vendorId: VendorKey): vendorId is IntegrationId {
  return !isVendorDatapointId(vendorId);
}

function customerLicenseVendorName(vendorId: CustomerLicenseReportVendorId) {
  return vendorId === 'all' ? 'All licenses' : integrationName(vendorId);
}

const customerLicenseServicePalette = [
  '#3478a7',
  '#0d8f80',
  '#6b61c9',
  '#df604f',
  '#b7791f',
  '#2f855a',
  '#805ad5',
  '#c53030',
  '#2b6cb0',
  '#718096',
];

function customerLicenseInventoryRows(report: CustomerLicenseReportResponse | null): CustomerLicenseInventoryItem[] {
  if (!report) {
    return [];
  }

  return report.products.flatMap((product) =>
    product.detailRows.map((row, rowIndex) => ({
      key: `${product.productKey}-${rowIndex}`,
      product,
      row,
    })),
  );
}

function detailText(row: CustomerLicenseDetailRow, ...columns: string[]) {
  for (const column of columns) {
    const value = row[column];
    if (typeof value === 'string' && value.trim().length > 0 && value.trim().toLowerCase() !== '[redacted]') {
      return String(formatLicenseReportCell(column, value));
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(formatLicenseReportCell(column, value));
    }
  }

  return '';
}

function buildCustomerLicenseChart(report: CustomerLicenseReportResponse | null) {
  if (!report) {
    return {
      services: [] as Array<{
        serviceId: string;
        serviceName: string;
        vendorName: string;
        color: string;
        currentCount: number;
        points: CustomerLicenseMonthCount[];
      }>,
      months: [] as string[],
      maxCount: 1,
    };
  }

  const services = report.products.map((product, index) => ({
    serviceId: product.productKey,
    serviceName: product.productName,
    vendorName: product.vendor.integrationName,
    color: customerLicenseServicePalette[index % customerLicenseServicePalette.length],
    currentCount: product.currentCount,
    points: report.months.map((month) => ({
      month,
      count: product.months.find((item) => item.month === month)?.count ?? 0,
    })),
  }));

  return {
    services,
    months: report.months,
    maxCount: Math.max(
      1,
      ...services.flatMap((service) => service.points.map((point) => point.count)),
    ),
  };
}

function customerLicenseLinePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
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

function formatInvoiceSummary(invoice: InvoiceImportSummary | undefined) {
  if (!invoice) {
    return 'No invoice';
  }

  const invoiceLabel = invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : 'Latest invoice';
  const dateLabel = formatDateOnly(invoice.invoiceDate) ?? formatDateTime(invoice.importedAt) ?? 'Unknown date';
  return `${invoiceLabel} / ${dateLabel} / ${invoice.rowCount.toLocaleString()} rows`;
}

function formatDateOnly(value?: string) {
  if (!value) return undefined;

  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
  });
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

function compareReportCellValues(
  column: string,
  leftValue: string | number | boolean | null | undefined,
  rightValue: string | number | boolean | null | undefined,
) {
  const leftBlank = leftValue === null || typeof leftValue === 'undefined' || leftValue === '';
  const rightBlank = rightValue === null || typeof rightValue === 'undefined' || rightValue === '';

  if (leftBlank || rightBlank) {
    if (leftBlank && rightBlank) return 0;
    return leftBlank ? 1 : -1;
  }

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return Number(leftValue) - Number(rightValue);
  }

  const leftDate = typeof leftValue === 'string' ? Date.parse(leftValue) : Number.NaN;
  const rightDate = typeof rightValue === 'string' ? Date.parse(rightValue) : Number.NaN;

  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
    return leftDate - rightDate;
  }

  return String(formatReportCell(column, leftValue)).localeCompare(String(formatReportCell(column, rightValue)), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function formatLicenseReportCell(column: string, value: CustomerLicenseDetailValue | undefined) {
  if (value === null || typeof value === 'undefined') return '';

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return formatLicenseCount(value);
  }

  if (licenseReportDateColumns.has(column)) {
    return formatDateTime(value) ?? value;
  }

  return value;
}

function formatLicenseCount(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 4,
  });
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
const licenseReportDateColumns = new Set([
  'ObservedAt',
  'CreationDate',
  'ExpirationDate',
  'LastComplete',
  'LastCheckIn',
  'CommitmentEndDate',
  'NextLifecycleAt',
]);
const reportDefaultColumnWidth = 180;
const reportMinimumColumnWidth = 110;
const reportMaximumColumnWidth = 640;
const reportColumnKeyboardStep = 24;
const vendorDataMinimumColumnWidth = 120;
const vendorDataMaximumColumnWidth = 760;

type ReportColumnResizeState = {
  column: string;
  pointerId: number;
  startWidth: number;
  startX: number;
};

type ReportSortDirection = 'asc' | 'desc';

type ReportSortState = {
  column: string;
  direction: ReportSortDirection;
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

function vendorDataDefaultColumnWidth(column: string) {
  const normalizedColumn = column.toLowerCase();
  if (
    normalizedColumn.includes('product') ||
    normalizedColumn.includes('subscription') ||
    normalizedColumn.includes('description')
  ) {
    return 260;
  }

  if (
    normalizedColumn.includes('customer') ||
    normalizedColumn.includes('tenant') ||
    normalizedColumn.includes('account')
  ) {
    return 220;
  }

  return 170;
}

function clampVendorDataColumnWidth(width: number) {
  return Math.min(vendorDataMaximumColumnWidth, Math.max(vendorDataMinimumColumnWidth, Math.round(width)));
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
    case 'unmapped':
      return 'Unmapped';
    case 'ready':
      return 'Ready';
    case 'approved':
      return 'Approved';
    case 'updated':
      return 'Updated';
    case 'blocked':
      return 'Blocked';
    case 'skipped':
      return 'Skipped';
    default:
      return status;
  }
}

function reconciliationStatusLabel(issue: ReconcileIssue) {
  if (issue.status === 'updated' && issue.appliedUpdate) {
    return `Updated (${appliedUpdateDeltaLabel(issue.appliedUpdate)})`;
  }

  return statusLabel(issue.status);
}

function appliedUpdateDeltaLabel(update: AppliedReconciliationUpdate) {
  const deltas = [deltaLabel(update.quantityDelta)];
  if (typeof update.lessIncludedDelta === 'number' && update.lessIncludedDelta !== 0) {
    deltas.push(`less ${deltaLabel(update.lessIncludedDelta)}`);
  }

  return deltas.join(', ');
}

function reconciliationCountSourceLabel(source: ReconciliationCountSource) {
  if (source === 'invoice') return 'Vendor Invoice';
  if (source === 'linked') return 'Linked Count';
  if (source === 'manual') return 'Manual Override';
  return 'Vendor API';
}

function linkedCountTitle(linkedCount: ReconciliationLinkedCount) {
  return `${linkedCount.ruleName}: ${linkedCount.sources
    .map((source) => `${source.label} ${source.quantity.toLocaleString()}`)
    .join('; ')}`;
}

function isReviewableIssue(issue: ReconcileIssue) {
  return issue.status === 'needs-review' || issue.status === 'unmapped' || issue.status === 'blocked';
}

function isReviewViewIssue(issue: ReconcileIssue) {
  return isReviewableIssue(issue) || issue.status === 'approved' || issue.status === 'updated';
}

function isZeroZeroReconciliationIssue(issue: ReconcileIssue) {
  return issue.sourceCount === 0 && issue.invoiceCount === 0;
}

function isProcessedReconciliationIssue(issue: ReconcileIssue) {
  return !isZeroZeroReconciliationIssue(issue);
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

function initialSettingsSection(): SettingsSection {
  const queryView = new URLSearchParams(window.location.search).get('view');
  if (queryView === 'audit') {
    return 'audit-logs';
  }

  return settingsSectionFromPath(window.location.pathname) ?? defaultSettingsSection;
}

function isVendorKey(value: string | null): value is VendorKey {
  return Boolean(value && (isIntegrationId(value) || isVendorDatapointId(value)));
}

function initialMappingIntegrationId(): VendorKey {
  return mappingIntegrationIdFromLocation(window.location) ?? defaultMappingIntegrationId;
}

function viewFromLocation(location: Location): View {
  const queryView = new URLSearchParams(location.search).get('view');
  if (queryView === 'audit') {
    return 'settings';
  }
  if (isView(queryView)) return queryView;

  const pathView = viewFromPath(location.pathname);
  return pathView ?? defaultView;
}

function viewFromPath(pathname: string): View | null {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/imports') {
    return 'invoices';
  }
  if (mappingIntegrationIdFromPath(normalizedPath)) {
    return 'mappings';
  }
  if (settingsSectionFromPath(normalizedPath) || normalizedPath === '/settings' || normalizedPath === '/audit') {
    return 'settings';
  }

  const matchedEntry = Object.entries(viewPaths).find(([, path]) => path === normalizedPath);
  return matchedEntry ? (matchedEntry[0] as View) : normalizedPath === '/' ? defaultView : null;
}

function settingsSectionFromPath(pathname: string): SettingsSection | null {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/audit') {
    return 'audit-logs';
  }
  if (normalizedPath === '/settings') {
    return defaultSettingsSection;
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 2 && segments[0] === 'settings' && isSettingsSection(segments[1])) {
    return segments[1];
  }

  return null;
}

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/';
}

function isView(value: string | null): value is View {
  return Boolean(value && (value === 'settings' || Object.prototype.hasOwnProperty.call(viewPaths, value)));
}

function isSettingsSection(value: string): value is SettingsSection {
  return Object.prototype.hasOwnProperty.call(settingsSectionPaths, value);
}

function isIntegrationId(value: string | null): value is IntegrationId {
  return Boolean(value && integrationSettingsRegistry.some((integration) => integration.integrationId === value));
}

function mappingIntegrationIdFromLocation(location: Location) {
  const queryVendor = new URLSearchParams(location.search).get('vendor');
  if (isIntegrationId(queryVendor)) {
    return queryVendor;
  }

  return mappingIntegrationIdFromPath(location.pathname);
}

function mappingIntegrationIdFromPath(pathname: string) {
  const segments = normalizePathname(pathname).split('/').filter(Boolean);
  if (segments.length !== 2 || segments[1] !== 'mappings') {
    return null;
  }

  try {
    const integrationId = decodeURIComponent(segments[0]);
    return isVendorKey(integrationId) ? integrationId : null;
  } catch {
    return null;
  }
}

function urlForSettingsSection(section: SettingsSection = defaultSettingsSection) {
  return settingsSectionPaths[section];
}

function urlForView(
  view: View,
  mappingIntegrationId: VendorKey = defaultMappingIntegrationId,
  settingsSection: SettingsSection = defaultSettingsSection,
) {
  if (view === 'mappings') {
    return `/${encodeURIComponent(mappingIntegrationId)}/mappings`;
  }
  if (view === 'settings') {
    return urlForSettingsSection(settingsSection);
  }

  return viewPaths[view];
}

function currentRouteMatchesView(
  view: View,
  mappingIntegrationId: VendorKey = defaultMappingIntegrationId,
  settingsSection: SettingsSection = defaultSettingsSection,
) {
  const currentView = viewFromPath(window.location.pathname);
  const queryView = new URLSearchParams(window.location.search).get('view');
  const expectedPath = normalizePathname(urlForView(view, mappingIntegrationId, settingsSection));
  return (
    currentView === view &&
    normalizePathname(window.location.pathname) === expectedPath &&
    (!queryView || queryView === view || (queryView === 'audit' && view === 'settings' && settingsSection === 'audit-logs'))
  );
}

function updateRouteForView(
  view: View,
  mappingIntegrationId: VendorKey = defaultMappingIntegrationId,
  settingsSection: SettingsSection = defaultSettingsSection,
) {
  if (currentRouteMatchesView(view, mappingIntegrationId, settingsSection)) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = urlForView(view, mappingIntegrationId, settingsSection);
  nextUrl.searchParams.delete('view');
  nextUrl.searchParams.delete('vendor');
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
        exposure: clientIssues.reduce((total, issue) => total + reconciliationIssueImpact(issue), 0),
        changeCount: clientIssues.length,
        readyCount: clientIssues.filter((issue) => issue.status === 'ready').length,
        blockedCount: clientIssues.filter((issue) => issue.status === 'blocked').length,
        needsReviewCount: clientIssues.filter((issue) => issue.status === 'needs-review' || issue.status === 'unmapped').length,
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

async function fetchVendorDatapoints() {
  const response = await fetch('/api/vendor-datapoints');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Vendor datapoint load failed with HTTP ${response.status}.`));
  }

  return (body as { datapoints: VendorDatapointRecord[] }).datapoints ?? [];
}

async function createVendorDatapointRequest(payload: CreateVendorDatapointInput) {
  const response = await fetch('/api/vendor-datapoints', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Vendor datapoint create failed with HTTP ${response.status}.`));
  }

  return (body as { datapoint: VendorDatapointRecord }).datapoint;
}

async function updateVendorDatapointRequest(datapointId: string, payload: UpdateVendorDatapointInput) {
  const response = await fetch(`/api/vendor-datapoints/${encodeURIComponent(datapointId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Vendor datapoint update failed with HTTP ${response.status}.`));
  }

  return (body as { datapoint: VendorDatapointRecord }).datapoint;
}

async function importVendorDatapointRequest(
  datapointId: string,
  payload: {
    fileName: string;
    content: string;
    columnMap?: InvoiceTableColumnMap;
    persistColumnMap?: boolean;
  },
) {
  const response = await fetch(`/api/vendor-datapoints/${encodeURIComponent(datapointId)}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Vendor datapoint import failed with HTTP ${response.status}.`));
  }

  return body as { datapoint: VendorDatapointRecord; import: InvoiceImportSummary };
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

async function fetchCommunicationSettings() {
  const response = await fetch('/api/settings/communication');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Communication settings load failed with HTTP ${response.status}.`));
  }

  return body as unknown as CommunicationSettingsResponse;
}

async function saveCommunicationSettingsRequest(payload: {
  invoiceFromEmail: string;
  invoiceBccEmails: string;
  invoiceNoticeTemplates: InvoiceNoticeTemplates;
  graphTenantId?: string;
  graphClientId?: string;
  sendAsMailbox?: string;
  graphClientSecret?: string;
}) {
  const response = await fetch('/api/settings/communication', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Communication settings save failed with HTTP ${response.status}.`));
  }

  return body as unknown as CommunicationSettingsResponse;
}

async function testCommunicationSettingsRequest(recipientEmail: string) {
  const response = await fetch('/api/settings/communication/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipientEmail }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Email delivery test failed with HTTP ${response.status}.`));
  }

  return body as unknown as CommunicationSettingsResponse & {
    ok: boolean;
    recipientEmail: string;
    sendAsMailbox: string;
  };
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
  integrationId: VendorKey,
  syncRunId: string,
  dataset?: RawSyncDataset,
  options: { customerId?: string; includeRawPayload?: boolean } = {},
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
  if (options.includeRawPayload) {
    params.set('includeRawPayload', 'true');
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

async function fetchSavedProductProfitabilityReports() {
  const response = await fetch('/api/reports/product-profitability/saved');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Saved profitability reports load failed with HTTP ${response.status}.`));
  }

  return (body as { reports?: SavedProductProfitabilityReportSummary[] }).reports ?? [];
}

async function fetchSavedProductProfitabilityReport(id: string) {
  const response = await fetch(`/api/reports/product-profitability/saved/${encodeURIComponent(id)}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Saved profitability report load failed with HTTP ${response.status}.`));
  }

  return body as unknown as SavedProductProfitabilityReportResponse;
}

async function saveProductProfitabilityReportSnapshot(payload: {
  name: string;
  vendorIds: string[];
  report: ProductProfitabilityReportResponse;
}) {
  const response = await fetch('/api/reports/product-profitability/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Save profitability report failed with HTTP ${response.status}.`));
  }

  return body as unknown as SavedProductProfitabilityReportSummary;
}

async function fetchDiscrepancyReport(options: {
  basis?: DiscrepancyBasis;
  severity?: DiscrepancySeverity;
  customerId?: string;
  includeMatched?: boolean;
} = {}) {
  const params = new URLSearchParams();
  if (options.basis) {
    params.set('basis', options.basis);
  }
  if (options.severity) {
    params.set('severity', options.severity);
  }
  if (options.customerId) {
    params.set('customerId', options.customerId);
  }
  if (options.includeMatched) {
    params.set('includeMatched', 'true');
  }

  const query = params.toString();
  const response = await fetch(`/api/reports/discrepancies${query ? `?${query}` : ''}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Discrepancy report load failed with HTTP ${response.status}.`));
  }

  return body as unknown as DiscrepancyReportResponse;
}

async function fetchCustomerLicenseCustomers() {
  const response = await fetch('/api/reports/customer-license/customers');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Customer license customer load failed with HTTP ${response.status}.`));
  }

  return body as unknown as CustomerLicenseCustomersResponse;
}

async function fetchCustomerLicenseReport(options: {
  customerId: string;
  vendorId: CustomerLicenseReportVendorId;
  monthCount?: number;
  includeMicrosoftUserDetails?: boolean;
}) {
  const params = new URLSearchParams({
    customerId: options.customerId,
    vendorId: options.vendorId,
  });
  if (options.monthCount) {
    params.set('monthCount', String(options.monthCount));
  }
  if ((options.vendorId === 'microsoft-365' || options.vendorId === 'all') && options.includeMicrosoftUserDetails) {
    params.set('includeMicrosoftUserDetails', 'true');
  }

  const response = await fetch(`/api/reports/customer-license?${params.toString()}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Customer license report failed with HTTP ${response.status}.`));
  }

  return body as unknown as CustomerLicenseReportResponse;
}

async function fetchAgreementAdditions(agreementId: string) {
  const response = await fetch(`/api/reconciliation/agreements/${encodeURIComponent(agreementId)}/additions`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Agreement additions load failed with HTTP ${response.status}.`));
  }

  return body as unknown as AgreementAdditionsResponse;
}

async function fetchInvoiceImports(vendorId?: VendorKey, datapointId?: string) {
  const params = new URLSearchParams();
  if (vendorId) {
    params.set('vendorId', vendorId);
  }
  if (datapointId) {
    params.set('datapointId', datapointId);
  }
  const response = await fetch(`/api/invoice-imports${params.toString() ? `?${params.toString()}` : ''}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice imports load failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceImportsResponse;
}

async function importInvoiceFile(file: File, importMode: InvoiceImportMode) {
  const content = await file.text();
  const response = await fetch('/api/invoice-imports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      content,
      importMode,
    }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice import failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceImportResponse;
}

async function importInvoiceTableFile(
  integrationId: VendorKey,
  file: File,
  columnMap: InvoiceTableColumnMap,
  sourceType: IntegrationDataSourceType,
  importMode: InvoiceImportMode,
  syncMode: ManualImportSyncMode,
  linkedIntegrationId?: IntegrationId,
) {
  const table = await readImportTableFile(file);
  const response = await fetch(`/api/invoice-imports/${encodeURIComponent(integrationId)}/table`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      content: table.content,
      columnMap,
      sourceType,
      importMode,
      syncMode,
      linkedIntegrationId,
    }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice table import failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceImportResponse;
}

async function deleteInvoiceImportRequest(vendorId: VendorKey, importId: string) {
  const response = await fetch(
    `/api/invoice-imports/${encodeURIComponent(vendorId)}/${encodeURIComponent(importId)}`,
    {
      method: 'DELETE',
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice import delete failed with HTTP ${response.status}.`));
  }

  return (body as { import: InvoiceImportSummary }).import;
}

async function fetchInvoiceImportExceptions(vendorId: VendorKey, importId: string) {
  const response = await fetch(
    `/api/invoice-imports/${encodeURIComponent(vendorId)}/${encodeURIComponent(importId)}/exceptions`,
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice exception review failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceImportExceptionReview;
}

async function refreshInvoiceImportMappingsRequest(vendorId: VendorKey, importId: string) {
  const response = await fetch(
    `/api/invoice-imports/${encodeURIComponent(vendorId)}/${encodeURIComponent(importId)}/refresh-mappings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actor: 'frontend' }),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice mapping refresh failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceImportRefreshResponse;
}

async function fetchAuditSyncRuns() {
  const response = await fetch('/api/audit/sync-runs');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Audit sync run load failed with HTTP ${response.status}.`));
  }

  return body as unknown as { runs: AuditSyncRun[] };
}

async function fetchAuditEvents(view: 'timeline' | 'batch' = 'timeline') {
  const params = new URLSearchParams({ view });
  const response = await fetch(`/api/audit/events?${params.toString()}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Audit event load failed with HTTP ${response.status}.`));
  }

  return body as unknown as
    | { view: 'timeline'; events: AuditEventRecord[] }
    | { view: 'batch'; batches: AuditBatchRecord[] };
}

async function fetchAuditEvent(eventId: string) {
  const response = await fetch(`/api/audit/events/${encodeURIComponent(eventId)}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Audit event detail failed with HTTP ${response.status}.`));
  }

  return body as unknown as { event: AuditEventRecord };
}

async function fetchAuditBatch(batchId: string) {
  const response = await fetch(`/api/audit/batches/${encodeURIComponent(batchId)}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Audit batch detail failed with HTTP ${response.status}.`));
  }

  return body as unknown as { batch: AuditBatchDetail };
}

async function fetchOverdueInvoices() {
  const response = await fetch('/api/invoices/overdue');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Overdue invoice load failed with HTTP ${response.status}.`));
  }

  return body as unknown as OverdueInvoicesResponse;
}

async function downloadInvoicePdf(invoice: Pick<OverdueInvoice, 'invoiceId' | 'invoiceNumber'>) {
  const response = await fetch(`/api/invoices/${encodeURIComponent(invoice.invoiceId)}/pdf`);

  if (!response.ok) {
    const body = await responseJson(response);
    throw new Error(String(body.error ?? `Invoice PDF download failed with HTTP ${response.status}.`));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeNumber = (invoice.invoiceNumber ?? invoice.invoiceId).replace(/[^\w.-]+/g, '_');
  link.href = url;
  link.download = `invoice-${safeNumber}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

async function postInvoiceNotification(input: {
  invoiceId?: string;
  invoiceIds?: string[];
  companyKey?: string;
  noticeType: InvoiceNoticeType;
  confirm?: boolean;
  testMode?: boolean;
  testRecipientEmail?: string;
  notes?: string;
}) {
  const response = await fetch('/api/invoices/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Invoice notification failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvoiceNotificationResponse;
}

async function fetchMonthlyInvoiceCandidates() {
  const response = await fetch('/api/invoices/monthly-agreements');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Monthly agreements load failed with HTTP ${response.status}.`));
  }

  return body as unknown as MonthlyInvoiceCandidatesResponse;
}

async function postMonthlyInvoicePreview(agreementId: string) {
  const response = await fetch('/api/invoices/monthly-preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ agreementId }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Monthly invoice preview failed with HTTP ${response.status}.`));
  }

  return body as unknown as MonthlyInvoicePreview;
}

async function fetchStandardInvoiceCandidates() {
  const response = await fetch('/api/invoices/standard');
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Standard invoices load failed with HTTP ${response.status}.`));
  }

  return body as unknown as StandardInvoiceCandidatesResponse;
}

async function fetchMappingState(integrationId: VendorKey) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Mapping load failed with HTTP ${response.status}.`));
  }

  return body as unknown as MappingStateResponse;
}

async function fetchProductMappingCustomers(integrationId: VendorKey, vendorProductKey: string) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/products/${encodeURIComponent(vendorProductKey)}/customers`,
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Product customer review load failed with HTTP ${response.status}.`));
  }

  return body as unknown as ProductMappingCustomerReview;
}

async function fetchReconciliationRun(vendorId: VendorKey) {
  const response = await fetch(`/api/reconciliation/${encodeURIComponent(vendorId)}/run`, {
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

async function applyAgreementAdditionUpdatesRequest(
  updates: AgreementAdditionUpdatePayload[],
  discardedUpdates: AgreementAdditionUpdatePayload[],
) {
  const response = await fetch('/api/reconciliation/connectwise/agreement-addition-updates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      updates,
      discardedUpdates,
    }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Agreement addition update failed with HTTP ${response.status}.`));
  }

  return body as unknown as AgreementAdditionUpdateResponse;
}

async function postMappingAction(integrationId: VendorKey, action: 'automap' | 'apply' | 'approve-suggested') {
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
  integrationId: VendorKey,
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
  integrationId: VendorKey,
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
  integrationId: VendorKey,
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

async function deactivateProductBundleRequest(integrationId: VendorKey, bundleKey: string) {
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

async function saveProductLinkRuleRequest(
  integrationId: VendorKey,
  payload: {
    id?: string;
    sourceVendorProductKey: string;
    ruleName: string;
    sources: ProductLinkRuleSource[];
    active?: boolean;
  },
) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/linked-products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, reviewedBy: 'frontend' }),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Linked count rule save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { vendorId: IntegrationId; rule: ProductLinkRule };
}

async function setProductLinkRuleActiveRequest(integrationId: VendorKey, ruleId: string, active: boolean) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/linked-products/${encodeURIComponent(ruleId)}/${active ? 'activate' : 'deactivate'}`,
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
    throw new Error(String(body.error ?? `Linked count rule update failed with HTTP ${response.status}.`));
  }
}

async function deleteProductLinkRuleRequest(integrationId: VendorKey, ruleId: string) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/linked-products/${encodeURIComponent(ruleId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Linked count rule deletion failed with HTTP ${response.status}.`));
  }
}

async function testProductLinkRuleRequest(
  integrationId: VendorKey,
  ruleId: string,
  payload: { customerId: string; agreementId?: string },
) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/linked-products/${encodeURIComponent(ruleId)}/test`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Linked count rule test failed with HTTP ${response.status}.`));
  }

  return body as unknown as ProductLinkRuleTestResult;
}

async function searchProductCatalog(integrationId: VendorKey, query: string) {
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

async function fetchUsageOverrides(integrationId: VendorKey) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/overrides`);
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Usage overrides load failed with HTTP ${response.status}.`));
  }

  return body as unknown as UsageOverridesResponse;
}

async function createUsageOverrideRequest(integrationId: VendorKey, payload: CreateUsageOverridePayload) {
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

async function saveAdditionPinRequest(
  vendorId: VendorKey,
  payload: {
    customerId: string;
    agreementId: string;
    vendorProductKey: string;
    connectWiseAdditionId: string;
    connectwiseProductCode: string;
    connectwiseProductName: string;
  },
) {
  const response = await fetch(`/api/reconciliation/${encodeURIComponent(vendorId)}/addition-pins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);

  if (!response.ok) {
    throw new Error(String(body.error ?? `Addition pin save failed with HTTP ${response.status}.`));
  }

  return body as { pin: { connectWiseAdditionId: string; vendorProductKey: string; mappingSource: string } };
}

async function deactivateUsageOverrideRequest(integrationId: VendorKey, overrideId: string) {
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

async function fetchLaborMappings(integrationId: VendorKey) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/labor-mappings`);
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Labor mapping load failed with HTTP ${response.status}.`));
  }

  return body as unknown as LaborMappingsResponse;
}

async function saveLaborMappingRequest(integrationId: VendorKey, payload: Partial<LaborMapping>) {
  const response = await fetch(`/api/mappings/${encodeURIComponent(integrationId)}/labor-mappings`, {
    method: payload.id ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Labor mapping save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { integrationId: VendorKey; mapping: LaborMapping };
}

async function fetchLaborClassifications(boardId?: number | null) {
  const params = new URLSearchParams();
  if (boardId != null) {
    params.set('boardId', String(boardId));
  }
  const query = params.toString();
  const response = await fetch(
    `/api/mappings/connectwise/labor-classifications${query ? `?${query}` : ''}`,
  );
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Labor classification load failed with HTTP ${response.status}.`));
  }

  return body as unknown as LaborClassificationsResponse;
}

async function fetchInvestigationTicketMapping(integrationId: VendorKey) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/investigation-ticket-mapping`,
  );
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Investigation ticket mapping load failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvestigationTicketMappingResponse;
}

async function saveInvestigationTicketMappingRequest(
  integrationId: VendorKey,
  payload: {
    boardId: number;
    boardName?: string | null;
    typeId: number;
    typeName?: string | null;
    subTypeId?: number | null;
    subTypeName?: string | null;
    statusId?: number | null | typeof INVESTIGATION_TICKET_STATUS_DEFAULT;
    statusName?: string | null;
    companyOverrideId?: number | null;
    companyOverrideName?: string | null;
  },
) {
  const response = await fetch(
    `/api/mappings/${encodeURIComponent(integrationId)}/investigation-ticket-mapping`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Investigation ticket mapping save failed with HTTP ${response.status}.`));
  }

  return body as unknown as { integrationId: VendorKey; mapping: InvestigationTicketMapping };
}

async function createInvestigationTicketsRequest(payload: {
  customerId?: string;
  customerName: string;
  agreementId?: string;
  agreementName?: string;
  companyId?: number;
  notes?: string;
  reconciliationMonth?: string;
  tickets: Array<{
    vendorId: VendorKey;
    vendorName: string;
    licenses: Array<Record<string, unknown>>;
  }>;
}) {
  const response = await fetch('/api/reconciliation/connectwise/investigation-tickets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Investigation ticket create failed with HTTP ${response.status}.`));
  }

  return body as unknown as {
    tickets: InvestigationTicketRecord[];
    failures: Array<{ vendorId: string; error: string }>;
  };
}

async function fetchInvestigationTickets(options: {
  vendorId: VendorKey;
  customerName?: string;
  reconciliationMonth?: string;
}) {
  const params = new URLSearchParams();
  params.set('vendorId', options.vendorId);
  if (options.customerName) {
    params.set('customerName', options.customerName);
  }
  if (options.reconciliationMonth) {
    params.set('reconciliationMonth', options.reconciliationMonth);
  }
  const response = await fetch(`/api/reconciliation/investigation-tickets?${params.toString()}`);
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Investigation ticket list failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvestigationTicketsResponse;
}

async function fetchInvestigationTicketTimeEntries(ticketId: string) {
  const response = await fetch(
    `/api/reconciliation/investigation-tickets/${encodeURIComponent(ticketId)}/time-entries`,
  );
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(body.error ?? `Ticket time entry load failed with HTTP ${response.status}.`));
  }

  return body as unknown as InvestigationTicketTimeEntriesResponse;
}

function currentReconciliationMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function investigationTicketPresenceKey(customerName: string, vendorId: VendorKey) {
  return `${customerName}::${vendorId}`;
}

async function loadInvestigationTicketPresence(vendorIds: VendorKey[]) {
  const uniqueVendorIds = [...new Set(vendorIds.filter(Boolean))];
  if (uniqueVendorIds.length === 0) {
    return {} as Record<string, number>;
  }

  const month = currentReconciliationMonth();
  const ticketGroups = await Promise.all(
    uniqueVendorIds.map(async (vendorId) => {
      try {
        const response = await fetchInvestigationTickets({
          vendorId,
          reconciliationMonth: month,
        });
        return response.tickets;
      } catch {
        return [] as InvestigationTicketRecord[];
      }
    }),
  );

  const presence: Record<string, number> = {};
  for (const tickets of ticketGroups) {
    for (const ticket of tickets) {
      if (!ticket.customerName) {
        continue;
      }
      const key = investigationTicketPresenceKey(ticket.customerName, ticket.vendorId);
      presence[key] = (presence[key] ?? 0) + 1;
    }
  }
  return presence;
}

async function createReconciliationAdjustmentRequest(
  integrationId: VendorKey,
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

const invoiceWorkspaceCacheStorageKey = 'msp-harmony:invoice-workspace:v1';
const invoiceWorkspaceCacheVersion = 1;
const allInvoiceImportsCacheKey = 'all';

function emptyInvoiceWorkspaceCache(): InvoiceWorkspaceCache {
  return {
    version: invoiceWorkspaceCacheVersion,
    savedAt: '',
    invoiceImports: {},
  };
}

function invoiceImportCacheKey(vendorId: VendorKey | '') {
  return vendorId || allInvoiceImportsCacheKey;
}

function readInvoiceWorkspaceCache(): InvoiceWorkspaceCache {
  if (typeof window === 'undefined') {
    return emptyInvoiceWorkspaceCache();
  }

  try {
    const rawCache = window.localStorage.getItem(invoiceWorkspaceCacheStorageKey);
    if (!rawCache) {
      return emptyInvoiceWorkspaceCache();
    }

    const parsed = JSON.parse(rawCache) as Partial<InvoiceWorkspaceCache>;
    if (parsed.version !== invoiceWorkspaceCacheVersion) {
      return emptyInvoiceWorkspaceCache();
    }

    return {
      version: invoiceWorkspaceCacheVersion,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      invoiceImports:
        parsed.invoiceImports && typeof parsed.invoiceImports === 'object' && !Array.isArray(parsed.invoiceImports)
          ? parsed.invoiceImports
          : {},
      overdueInvoices: parsed.overdueInvoices,
      monthlyInvoiceCandidates: parsed.monthlyInvoiceCandidates,
      standardInvoiceCandidates: parsed.standardInvoiceCandidates,
    };
  } catch {
    return emptyInvoiceWorkspaceCache();
  }
}

function writeInvoiceWorkspaceCache(updater: (cache: InvoiceWorkspaceCache) => InvoiceWorkspaceCache) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const nextCache = {
      ...updater(readInvoiceWorkspaceCache()),
      version: invoiceWorkspaceCacheVersion,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(invoiceWorkspaceCacheStorageKey, JSON.stringify(nextCache));
  } catch {
    try {
      window.localStorage.removeItem(invoiceWorkspaceCacheStorageKey);
    } catch {
      // Ignore unavailable storage and quota failures.
    }
  }
}

function sortInvoiceImports(imports: InvoiceImportSummary[]) {
  return [...imports].sort(
    (left, right) =>
      String(right.invoiceDate ?? '').localeCompare(String(left.invoiceDate ?? '')) ||
      String(right.importedAt ?? '').localeCompare(String(left.importedAt ?? '')),
  );
}

function readCachedInvoiceImports(vendorId: VendorKey | '') {
  return readInvoiceWorkspaceCache().invoiceImports[invoiceImportCacheKey(vendorId)] ?? null;
}

function cacheInvoiceImports(vendorId: VendorKey | '', response: InvoiceImportsResponse) {
  writeInvoiceWorkspaceCache((cache) => ({
    ...cache,
    invoiceImports: {
      ...cache.invoiceImports,
      [invoiceImportCacheKey(vendorId)]: {
        imports: sortInvoiceImports(response.imports),
      },
    },
  }));
}

function invalidateCachedInvoiceImports(vendorId?: VendorKey | '') {
  writeInvoiceWorkspaceCache((cache) => {
    const nextImports = { ...cache.invoiceImports };
    delete nextImports[allInvoiceImportsCacheKey];
    if (vendorId) {
      delete nextImports[invoiceImportCacheKey(vendorId)];
    }

    return {
      ...cache,
      invoiceImports: nextImports,
    };
  });
}

function updateCachedInvoiceImportSummary(invoiceImport: InvoiceImportSummary) {
  writeInvoiceWorkspaceCache((cache) => {
    const nextImports: Record<string, InvoiceImportsResponse> = {};

    for (const [key, response] of Object.entries(cache.invoiceImports)) {
      const hasImport = response.imports.some((item) => item.id === invoiceImport.id);
      const shouldIncludeIfMissing = key === allInvoiceImportsCacheKey || key === invoiceImport.vendorId;
      if (!hasImport && !shouldIncludeIfMissing) {
        nextImports[key] = response;
        continue;
      }

      const updatedImports = hasImport
        ? response.imports.map((item) => (item.id === invoiceImport.id ? invoiceImport : item))
        : [invoiceImport, ...response.imports];
      nextImports[key] = {
        imports: sortInvoiceImports(updatedImports),
      };
    }

    return {
      ...cache,
      invoiceImports: nextImports,
    };
  });
}

function readCachedOverdueInvoices() {
  const cached = readInvoiceWorkspaceCache().overdueInvoices ?? null;
  return cached ? normalizeOverdueInvoicesResponse(cached) : null;
}

function cacheOverdueInvoices(response: OverdueInvoicesResponse) {
  writeInvoiceWorkspaceCache((cache) => ({
    ...cache,
    overdueInvoices: normalizeOverdueInvoicesResponse(response),
  }));
}

function normalizeOverdueInvoicesResponse(response: OverdueInvoicesResponse): OverdueInvoicesResponse {
  const buckets = (response.buckets ?? []).map((bucket) => ({
    ...bucket,
    noticeType: normalizeInvoiceNoticeType(bucket.noticeType),
    invoices: (bucket.invoices ?? []).map((invoice) => ({
      ...invoice,
      lastNotice: invoice.lastNotice
        ? {
            ...invoice.lastNotice,
            noticeType: normalizeInvoiceNoticeType(invoice.lastNotice.noticeType, invoice.daysPastDue),
          }
        : undefined,
    })),
  }));
  const customerGroups = (response.customerGroups ?? []).map((customer) => {
    const oldestDaysPastDue = Math.max(
      customer.oldestDaysPastDue ?? 0,
      ...customer.invoices.map((invoice) => invoice.daysPastDue),
    );
    return {
      ...customer,
      oldestDaysPastDue,
      noticeType: normalizeInvoiceNoticeType(customer.noticeType, oldestDaysPastDue),
      lastNotice: customer.lastNotice
        ? {
            ...customer.lastNotice,
            noticeType: normalizeInvoiceNoticeType(customer.lastNotice.noticeType, oldestDaysPastDue),
          }
        : undefined,
    };
  });

  return {
    ...response,
    buckets,
    customerGroups,
  };
}

function readCachedMonthlyInvoiceCandidates() {
  return readInvoiceWorkspaceCache().monthlyInvoiceCandidates ?? null;
}

function cacheMonthlyInvoiceCandidates(response: MonthlyInvoiceCandidatesResponse) {
  writeInvoiceWorkspaceCache((cache) => ({
    ...cache,
    monthlyInvoiceCandidates: response,
  }));
}

function readCachedStandardInvoiceCandidates() {
  return readInvoiceWorkspaceCache().standardInvoiceCandidates ?? null;
}

function cacheStandardInvoiceCandidates(response: StandardInvoiceCandidatesResponse) {
  writeInvoiceWorkspaceCache((cache) => ({
    ...cache,
    standardInvoiceCandidates: response,
  }));
}

function syncRequestBodyForIntegration(integrationId: IntegrationId, target?: IntegrationSyncTarget) {
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

  if (integrationId === 'datto') {
    return {
      pageSize: 100,
      maxPages: 100,
      seatPageSize: 500,
      seatMaxPages: 100,
      includeBcdr: target !== 'datto-saas',
    };
  }

  if (integrationId === 'microsoft-365') {
    return {
      dataset: target === 'licenses' ? 'licenses' : 'users',
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

  if (integrationId === 'huntress') {
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

function syncActionKey(integrationId: IntegrationId, target?: IntegrationSyncTarget): IntegrationActionKey {
  if (integrationId === 'microsoft-365') {
    return target === 'licenses' ? `${integrationId}:sync-licenses` : `${integrationId}:sync-users`;
  }

  if (integrationId === 'datto') {
    return target === 'datto-saas' ? `${integrationId}:sync-datto-saas` : `${integrationId}:sync-datto-saas-bcdr`;
  }

  return `${integrationId}:sync`;
}

function syncStartingMessage(integrationId: IntegrationId, target?: IntegrationSyncTarget) {
  if (integrationId === 'microsoft-365') {
    return target === 'licenses' ? 'Starting Microsoft 365 license sync...' : 'Starting Microsoft 365 user sync...';
  }

  if (integrationId === 'datto') {
    return target === 'datto-saas' ? 'Starting Datto SaaS sync...' : 'Starting Datto SaaS + BCDR sync...';
  }

  return 'Starting sync...';
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

  if (integrationId === 'datto') {
    const bcdrAgentCount = numberField(body, 'bcdrAgentCount')?.toLocaleString() ?? '0';
    const saasDomainCount = numberField(body, 'saasDomainCount')?.toLocaleString() ?? '0';
    return `Connection OK. Datto returned ${bcdrAgentCount} BCDR agents and ${saasDomainCount} SaaS domains.`;
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

  if (integrationId === 'sentinelone') {
    const siteCount = numberField(body, 'siteCount')?.toLocaleString() ?? '0';
    const accountCount = numberField(body, 'accountCount')?.toLocaleString() ?? '0';
    return `Connection OK. SentinelOne returned ${accountCount} accounts and ${siteCount} sites.`;
  }

  if (integrationId === 'huntress') {
    const organizationCount = numberField(body, 'organizationCount')?.toLocaleString() ?? '0';
    const agentCount = numberField(body, 'agentCount')?.toLocaleString() ?? '0';
    const productClasses = Array.isArray(body.productClasses) ? body.productClasses.join(', ') : 'itdr';
    return `Connection OK. Huntress returned ${organizationCount} organizations and ${agentCount} agents. Product classes: ${productClasses}.`;
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

    if (integrationId === 'datto') {
      return body.includeBcdr === false
        ? 'Queued Datto SaaS sync. Results will appear after the background worker finishes.'
        : 'Queued Datto SaaS + BCDR sync. Results will appear after the background worker finishes.';
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
    const selectedCountSource = preferredReconciliationCountSource(
      line.sourceQuantity,
      line.invoiceQuantity,
      line.linkedCount?.quantity,
    );
    const actionLabel =
      line.status === 'matched'
        ? 'No change needed; vendor and ConnectWise counts match.'
        : line.status === 'not-billable'
          ? 'Track source usage only; no ConnectWise billable addition is generated.'
          : line.status === 'unmapped'
            ? 'Map this vendor product before reconciling or writing ConnectWise changes.'
            : line.writeAction === 'create-addition'
              ? 'Create a ConnectWise agreement addition after review.'
              : line.writeAction === 'update-addition'
                ? 'Update the ConnectWise agreement addition after review.'
                : 'Review the matching ConnectWise additions before writing changes.';
    const confidence =
      line.status === 'matched'
        ? 99
        : line.status === 'not-billable'
          ? 95
          : line.status === 'unmapped'
            ? 60
            : line.writeAction === 'review-required'
              ? 70
              : 90;

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
      family:
        line.lineType === 'usage-add-on'
          ? 'Usage add-on'
          : line.lineType === 'unmapped-vendor'
            ? 'Unmapped vendor product'
            : 'Base count',
      serviceCode: line.productCode,
      lineType: line.lineType,
      measuredSourceCount: line.sourceQuantity,
      sourceCount: line.sourceQuantity,
      linkedCount: line.linkedCount,
      vendorInvoiceCount: line.invoiceQuantity,
      vendorInvoiceLineCount: line.invoiceLineCount,
      invoiceImportId: line.invoiceImportId,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      invoiceCount: line.agreementQuantity,
      proposedCount: line.proposedQuantity,
      selectedCountSource,
      manualOverrideTotal: undefined,
      manualOverrideTotalTouched: false,
      baseStatus: line.status,
      amount: line.financialImpact.amount,
      unitPriceAmount: line.unitPrice?.amount,
      unitPriceCurrency: line.unitPrice?.currency,
      unit: line.unit,
      confidence,
      owner: 'Finance',
      age: 'Current run',
      reason: line.reason,
      status: line.status,
      recommendation: actionLabel,
      lastSeen: run.syncRunId ? `${sourceName} sync ${shortId(run.syncRunId)}` : `No completed ${sourceName} sync`,
      audit: [
        `${sourceName} API quantity: ${line.sourceQuantity.toLocaleString()} ${line.unit}.`,
        line.linkedCount
          ? `Linked count: ${line.linkedCount.quantity.toLocaleString()} (${line.linkedCount.ruleName}).`
          : undefined,
        line.linkedCount
          ? `Linked sources: ${line.linkedCount.sources.map((source) => `${source.label} ${source.quantity}`).join('; ')}.`
          : undefined,
        `ConnectWise agreement quantity: ${line.agreementQuantity.toLocaleString()} ${line.unit}.`,
        ...line.evidence.map((item) => `${item.label}: ${item.value}.`),
      ].filter((entry): entry is string => Boolean(entry)),
      devices: line.devices ?? [],
      adjustments: line.adjustments ?? [],
      matchedAgreementAdditions: line.matchedAgreementAdditions ?? [],
      connectWiseAdditionId: line.connectWiseAdditionId,
      vendorProductKey: line.vendorProductKey,
      writeAction: line.writeAction,
      proposedLessIncluded: undefined,
      lessIncludedTouched: false,
      appliedUpdate: undefined,
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
      const selectedCountSource = reconciliationCountSource(issue);
      const selectedCount = reconciliationSelectedCount(issue);

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
        'Linked Count': issue.linkedCount?.quantity ?? '',
        'Linked Count Rule': issue.linkedCount?.ruleName ?? '',
        'Linked Count Sources': issue.linkedCount?.sources.map((source) => `${source.label}: ${source.quantity}`).join('; ') ?? '',
        'Manual Less Count': manualLessCount,
        'Manual Less Count Reasons': lessCountAdjustments.map((adjustment) => adjustment.reason).filter(Boolean).join('; '),
        'Proposed Count After Less Count': issue.proposedCount,
        'Vendor Invoice Count': issue.vendorInvoiceCount ?? '',
        'Selected Count Source': reconciliationCountSourceLabel(selectedCountSource),
        'Manual Override Total': selectedCountSource === 'manual' ? selectedCount : '',
        'Selected Count To Approve': selectedCount,
        'Vendor Invoice Number': issue.invoiceNumber ?? '',
        'Vendor Invoice Date': issue.invoiceDate ?? '',
        'CW Count': issue.invoiceCount,
        Delta: reconciliationDelta(issue),
        'Financial Impact': reconciliationIssueImpact(issue),
        Status: reconciliationStatusLabel(issue),
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

function applyAgreementUpdateResultsToAdditions(
  additions: AgreementAddition[],
  resultsByAdditionId: Map<string, AgreementAdditionUpdateResultItem>,
) {
  if (resultsByAdditionId.size === 0) {
    return additions;
  }

  return additions.map((addition) => {
    const result = resultsByAdditionId.get(addition.connectWiseAdditionId);
    if (!result || result.status !== 'written') {
      return addition;
    }

    return {
      ...addition,
      quantity: result.proposedQuantity,
      lessIncluded: result.lessIncludedChanged ? result.proposedLessIncluded ?? 0 : addition.lessIncluded,
    };
  });
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => initialSettingsSection());
  const [issues, setIssues] = useState<ReconcileIssue[]>([]);
  const [expandedClientNames, setExpandedClientNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [selectedReconciliationIntegrationIds, setSelectedReconciliationIntegrationIds] = useState<VendorKey[]>([]);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(true);
  const [productFilter, setProductFilter] = useState('All products');
  const [autoPost, setAutoPost] = useState(false);
  const [ticketClient, setTicketClient] = useState<ClientGroup | null>(null);
  const [ticketIssueIds, setTicketIssueIds] = useState<string[]>([]);
  const [ticketNotes, setTicketNotes] = useState('');
  const [creatingInvestigationTicket, setCreatingInvestigationTicket] = useState(false);
  const [investigationTicketsSelection, setInvestigationTicketsSelection] = useState<{
    customer: string;
    vendorId: VendorKey;
    vendor: string;
  } | null>(null);
  const [investigationTicketPresence, setInvestigationTicketPresence] = useState<Record<string, number>>({});
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [integrationTab, setIntegrationTab] = useState<IntegrationTab>('api');
  const [integrationSaveMessage, setIntegrationSaveMessage] = useState<string | null>(null);
  const [savingIntegrationId, setSavingIntegrationId] = useState<IntegrationId | null>(null);
  const [runtimeIntegrations, setRuntimeIntegrations] = useState<RuntimeIntegrationSummary[] | null>(null);
  const [integrationLoadState, setIntegrationLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [integrationLoadMessage, setIntegrationLoadMessage] = useState<string>('Loading live integration status...');
  const [vendorDatapoints, setVendorDatapoints] = useState<VendorDatapointRecord[]>([]);
  const [vendorDatapointLoadState, setVendorDatapointLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [vendorDatapointMessage, setVendorDatapointMessage] = useState('Saved vendor datapoints with reusable column maps.');
  const [showCreateVendorDatapoint, setShowCreateVendorDatapoint] = useState(false);
  const [editingVendorDatapointId, setEditingVendorDatapointId] = useState<string | null>(null);
  const [selectedVendorDatapointId, setSelectedVendorDatapointId] = useState<string | null>(null);
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
  const [includeRawSyncRawPayload, setIncludeRawSyncRawPayload] = useState(false);
  const [productProfitabilityReport, setProductProfitabilityReport] =
    useState<ProductProfitabilityReportResponse | null>(null);
  const [productProfitabilityLoadState, setProductProfitabilityLoadState] =
    useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [productProfitabilityMessage, setProductProfitabilityMessage] = useState(
    'Click Generate to load net profit by mapped vendor.',
  );
  const [discrepancyReport, setDiscrepancyReport] = useState<DiscrepancyReportResponse | null>(null);
  const [discrepancyLoadState, setDiscrepancyLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [discrepancyMessage, setDiscrepancyMessage] = useState('Load vendor-to-vendor discrepancy checks.');
  const [selectedDiscrepancyBasis, setSelectedDiscrepancyBasis] = useState<'all' | DiscrepancyBasis>('all');
  const [selectedDiscrepancySeverity, setSelectedDiscrepancySeverity] = useState<DiscrepancyFilterValue>('all');
  const [selectedDiscrepancyPairId, setSelectedDiscrepancyPairId] = useState('all');
  const [selectedDiscrepancyCustomerId, setSelectedDiscrepancyCustomerId] = useState('all');
  const [includeMatchedDiscrepancies, setIncludeMatchedDiscrepancies] = useState(false);
  const [selectedDiscrepancyRow, setSelectedDiscrepancyRow] = useState<DiscrepancyRow | null>(null);
  const [customerLicenseCustomers, setCustomerLicenseCustomers] = useState<CustomerLicenseCustomerOption[]>([]);
  const [selectedCustomerLicenseCustomerId, setSelectedCustomerLicenseCustomerId] = useState('');
  const [selectedCustomerLicenseVendorId, setSelectedCustomerLicenseVendorId] = useState<CustomerLicenseReportVendorId>('all');
  const [includeMicrosoftUserDetails, setIncludeMicrosoftUserDetails] = useState(true);
  const [customerLicenseReport, setCustomerLicenseReport] = useState<CustomerLicenseReportResponse | null>(null);
  const [customerLicenseLoadState, setCustomerLicenseLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [customerLicenseMessage, setCustomerLicenseMessage] = useState('Load customers, then generate a customer license report.');
  const [selectedMappingIntegrationId, setSelectedMappingIntegrationId] = useState<VendorKey>(() => initialMappingIntegrationId());
  const [mappingState, setMappingState] = useState<MappingStateResponse | null>(null);
  const [usageOverrides, setUsageOverrides] = useState<UsageOverride[]>([]);
  const [ncentralFilters, setNcentralFilters] = useState<NcentralFilter[]>([]);
  const [ncentralFilterMappings, setNcentralFilterMappings] = useState<NcentralFilterMapping[]>([]);
  const [laborMappings, setLaborMappings] = useState<LaborMapping[]>([]);
  const [laborBoards, setLaborBoards] = useState<ConnectWiseBoardOption[]>([]);
  const [laborClassificationMessage, setLaborClassificationMessage] = useState('');
  const [investigationTicketMapping, setInvestigationTicketMapping] =
    useState<InvestigationTicketMapping | null>(null);
  const [mappingLoadState, setMappingLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [mappingMessage, setMappingMessage] = useState('Load an integration to review account and product mappings.');
  const [busyMappingAction, setBusyMappingAction] = useState<string | null>(null);
  const [reconciliationLoadState, setReconciliationLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [reconciliationMessage, setReconciliationMessage] = useState('Choose a vendor.');
  const [reconciliationRunMetaByVendor, setReconciliationRunMetaByVendor] =
    useState<Partial<Record<VendorKey, ReconciliationRunMeta>>>({});
  const [reconciliationProductOptionsByVendor, setReconciliationProductOptionsByVendor] =
    useState<Partial<Record<VendorKey, ReconciliationProductOption[]>>>({});
  const [reconciliationComparisonRequested, setReconciliationComparisonRequested] = useState(false);
  const [invoiceImports, setInvoiceImports] = useState<InvoiceImportSummary[]>([]);
  const [selectedInvoiceIntegrationId, setSelectedInvoiceIntegrationId] = useState<VendorKey | ''>('');
  const [invoiceImportLoadState, setInvoiceImportLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [invoiceImportMessage, setInvoiceImportMessage] = useState('Upload a vendor invoice CSV.');
  const [invoiceImportMode, setInvoiceImportMode] = useState<InvoiceImportMode>('overwrite');
  const [importingInvoice, setImportingInvoice] = useState(false);
  const [invoiceWorkspaceTab, setInvoiceWorkspaceTab] = useState<InvoiceWorkspaceTab>('overdue');
  const [showInvoiceImportPanel, setShowInvoiceImportPanel] = useState(false);
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoicesResponse | null>(null);
  const [overdueInvoiceLoadState, setOverdueInvoiceLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [overdueInvoiceMessage, setOverdueInvoiceMessage] = useState('Loading overdue invoices from ConnectWise.');
  const [invoiceNoticeResult, setInvoiceNoticeResult] = useState<InvoiceNotificationResponse | null>(null);
  const [invoiceNoticeMessage, setInvoiceNoticeMessage] = useState('');
  const [invoiceNoticeBusyKey, setInvoiceNoticeBusyKey] = useState<string | null>(null);
  const [selectedOverdueCustomerKeys, setSelectedOverdueCustomerKeys] = useState<string[]>([]);
  const [bulkNoticeCustomers, setBulkNoticeCustomers] = useState<OverdueInvoiceCustomerGroup[] | null>(null);
  const [bulkNoticeMessage, setBulkNoticeMessage] = useState('');
  const [bulkNoticeBusy, setBulkNoticeBusy] = useState(false);
  const [monthlyInvoiceCandidates, setMonthlyInvoiceCandidates] = useState<MonthlyInvoiceCandidatesResponse | null>(null);
  const [monthlyInvoiceLoadState, setMonthlyInvoiceLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [monthlyInvoiceMessage, setMonthlyInvoiceMessage] = useState('Loading monthly agreements from ConnectWise.');
  const [monthlyInvoicePreview, setMonthlyInvoicePreview] = useState<MonthlyInvoicePreview | null>(null);
  const [monthlyInvoicePreviewBusyId, setMonthlyInvoicePreviewBusyId] = useState<string | null>(null);
  const [standardInvoiceCandidates, setStandardInvoiceCandidates] = useState<StandardInvoiceCandidatesResponse | null>(null);
  const [standardInvoiceLoadState, setStandardInvoiceLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [standardInvoiceMessage, setStandardInvoiceMessage] = useState('Loading standard invoices from ConnectWise.');
  const [invoiceExceptionReview, setInvoiceExceptionReview] = useState<InvoiceImportExceptionReview | null>(null);
  const [invoiceExceptionCustomerOptions, setInvoiceExceptionCustomerOptions] = useState<MappingCustomerOption[]>([]);
  const [invoiceExceptionLoadState, setInvoiceExceptionLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [invoiceExceptionMessage, setInvoiceExceptionMessage] = useState('Select an invoice import to review exceptions.');
  const [busyInvoiceExceptionAction, setBusyInvoiceExceptionAction] = useState<string | null>(null);
  const [exportingReconciliationReport, setExportingReconciliationReport] = useState(false);
  const [agreementAdditionsByAgreement, setAgreementAdditionsByAgreement] = useState<Record<string, AgreementAddition[]>>({});
  const [agreementAdditionsSelection, setAgreementAdditionsSelection] = useState<AgreementAdditionsSelection | null>(null);
  const [agreementAdditions, setAgreementAdditions] = useState<AgreementAddition[]>([]);
  const [agreementAdditionsLoadState, setAgreementAdditionsLoadState] = useState<'loading' | 'ready' | 'failed'>('ready');
  const [agreementAdditionsMessage, setAgreementAdditionsMessage] = useState('');
  const [manualOverrideIssue, setManualOverrideIssue] = useState<ReconcileIssue | null>(null);
  const [manualOverrideMessage, setManualOverrideMessage] = useState('');
  const [savingManualOverride, setSavingManualOverride] = useState(false);
  const [reviewingAgreementUpdates, setReviewingAgreementUpdates] = useState(false);
  const [applyingAgreementUpdates, setApplyingAgreementUpdates] = useState(false);
  const [agreementUpdateMessage, setAgreementUpdateMessage] = useState('');
  const selectedReconciliationIntegrationId = selectedReconciliationIntegrationIds[0] ?? '';
  const selectedReconciliationIntegrationSet = useMemo(
    () => new Set(selectedReconciliationIntegrationIds),
    [selectedReconciliationIntegrationIds],
  );
  const reconciliationRunMeta = selectedReconciliationIntegrationId
    ? reconciliationRunMetaByVendor[selectedReconciliationIntegrationId] ?? null
    : null;

  const navigateToView = (nextView: View, mappingIntegrationId: VendorKey = selectedMappingIntegrationId) => {
    const nextSettingsSection =
      nextView === 'settings'
        ? view === 'settings'
          ? settingsSection
          : defaultSettingsSection
        : defaultSettingsSection;

    setView(nextView);
    if (nextView === 'settings') {
      setSettingsSection(nextSettingsSection);
    }
    updateRouteForView(nextView, mappingIntegrationId, nextSettingsSection);
  };

  const navigateToSettingsSection = (section: SettingsSection) => {
    setSettingsSection(section);
    setView('settings');
    updateRouteForView('settings', selectedMappingIntegrationId, section);
  };

  const selectMappingIntegration = (integrationId: VendorKey) => {
    setSelectedMappingIntegrationId(integrationId);
    setMappingState(null);
    setUsageOverrides([]);
    setMappingMessage('Loading mapping state...');
  };

  const refreshRuntimeIntegrations = async () => {
    setIntegrationLoadState('loading');
    setIntegrationLoadMessage('Refreshing live integration status...');
    setVendorDatapointLoadState('loading');
    setVendorDatapointMessage('Loading saved vendor datapoints...');

    try {
      const response = await fetchRuntimeIntegrations();
      setRuntimeIntegrations(response.integrations);
      setIntegrationLoadState('ready');
      setIntegrationLoadMessage('Live integration status loaded.');

      try {
        const datapoints = await fetchVendorDatapoints();
        setVendorDatapoints(datapoints);
        setVendorDatapointLoadState('ready');
        setVendorDatapointMessage(
          datapoints.length > 0
            ? `${datapoints.length.toLocaleString()} saved vendor datapoint${datapoints.length === 1 ? '' : 's'} ready to import.`
            : 'Create a vendor datapoint to save column maps for repeat file imports.',
        );
      } catch (datapointError) {
        setVendorDatapoints([]);
        setVendorDatapointLoadState('failed');
        const datapointMessage =
          datapointError instanceof Error ? datapointError.message : 'Unable to load vendor datapoints.';
        setVendorDatapointMessage(datapointMessage);
        if (datapointMessage.includes('HTTP 404')) {
          setIntegrationLoadMessage(
            'Live integration status loaded. Restart the Functions host after `npm run backend:build` to enable vendor datapoints.',
          );
        }
      }

      return response;
    } catch (error) {
      setRuntimeIntegrations(null);
      setVendorDatapoints([]);
      setIntegrationLoadState('failed');
      setIntegrationLoadMessage(error instanceof Error ? error.message : 'Unable to load live integration status.');
      setVendorDatapointLoadState('failed');
      setVendorDatapointMessage(error instanceof Error ? error.message : 'Unable to load vendor datapoints.');
      return null;
    }
  };

  const createVendorDatapoint = async (payload: CreateVendorDatapointInput) => {
    const datapoint = await createVendorDatapointRequest(payload);
    setVendorDatapoints((current) => [...current, datapoint].sort((left, right) => left.displayName.localeCompare(right.displayName)));
    setSelectedVendorDatapointId(datapoint.id);
    setShowCreateVendorDatapoint(false);
    setVendorDatapointMessage(`Created ${datapoint.displayName}. Upload a file to save its column map.`);
    return datapoint;
  };

  const importVendorDatapoint = async (
    datapoint: VendorDatapointRecord,
    file: File,
    columnMap: InvoiceTableColumnMap,
    persistColumnMap: boolean,
  ) => {
    const table = await readImportTableFile(file);
    const response = await importVendorDatapointRequest(datapoint.id, {
      fileName: file.name,
      content: table.content,
      columnMap,
      persistColumnMap,
    });
    setVendorDatapoints((current) =>
      current.map((item) => (item.id === response.datapoint.id ? response.datapoint : item)),
    );
    const mappingVendorId = datapointMappingVendorId(response.datapoint);
    setSelectedInvoiceIntegrationId(mappingVendorId);
    const importsResponse = await fetchInvoiceImports(mappingVendorId);
    const nextImportsResponse = {
      imports: sortInvoiceImports(importsResponse.imports),
    };
    invalidateCachedInvoiceImports(mappingVendorId);
    cacheInvoiceImports(mappingVendorId, nextImportsResponse);
    setInvoiceImports(nextImportsResponse.imports);
    setInvoiceImportLoadState('ready');
    setInvoiceImportMessage(
      `Imported ${response.import.rowCount.toLocaleString()} rows for ${response.datapoint.displayName} with ${response.import.exceptionRows.toLocaleString()} exceptions.`,
    );
    return response;
  };

  const saveVendorDatapointMapping = async (
    datapoint: VendorDatapointRecord,
    columnMap: InvoiceTableColumnMap,
    knownHeaders?: string[],
  ) => {
    const updated = await updateVendorDatapointRequest(datapoint.id, {
      columnMap,
      knownHeaders: knownHeaders ?? mergeKnownHeaders(datapoint.knownHeaders, mappedColumnHeaders(columnMap)),
    });
    setVendorDatapoints((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    );
    setVendorDatapointMessage(`Saved column map for ${updated.displayName}.`);
    return updated;
  };

  const updateVendorDatapoint = async (datapointId: string, payload: UpdateVendorDatapointInput) => {
    const updated = await updateVendorDatapointRequest(datapointId, payload);
    setVendorDatapoints((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    );
    setEditingVendorDatapointId(null);
    setVendorDatapointMessage(`Updated ${updated.displayName}.`);
    return updated;
  };

  const deleteDatapointImport = async (datapoint: VendorDatapointRecord, invoiceImport: InvoiceImportSummary) => {
    const mappingVendorId = datapointMappingVendorId(datapoint);
    await deleteInvoiceImportRequest(invoiceImport.vendorId, invoiceImport.id);
    invalidateCachedInvoiceImports(mappingVendorId);
    const importsResponse = await fetchInvoiceImports(mappingVendorId, datapoint.id);
    cacheInvoiceImports(mappingVendorId, { imports: sortInvoiceImports(importsResponse.imports) });
    if (selectedInvoiceIntegrationId === mappingVendorId) {
      setInvoiceImports(importsResponse.imports);
    }
    setVendorDatapointMessage(`Deleted import ${invoiceImport.fileName} for ${datapoint.displayName}.`);
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

  const loadRawSyncDetails = async (
    integrationId: IntegrationId,
    syncRunId: string,
    dataset: RawSyncDataset = 'users',
    includeRawPayload = includeRawSyncRawPayload,
  ) => {
    setRawSyncLoadState('loading');
    setRawSyncMessage('Loading raw sync details...');
    setRawSyncDetails(null);
    setRawSyncColumnFilters({});

    try {
      const details = await fetchRawSyncDetails(integrationId, syncRunId, dataset, { includeRawPayload });
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

      const details = await fetchRawSyncDetails(selectedRawSyncIntegrationId, selectedSyncRunId, selectedRawSyncDataset, {
        includeRawPayload: includeRawSyncRawPayload,
      });
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
    setProductProfitabilityMessage('Generating product profitability...');

    try {
      const report = await fetchProductProfitabilityReport();
      setProductProfitabilityReport(report);
      setProductProfitabilityLoadState('ready');
      setProductProfitabilityMessage(
        report.integrations.length > 0
          ? `Generated ${report.summary.integrationCount.toLocaleString()} mapped vendors across ${report.months.length.toLocaleString()} months.`
          : 'No vendors with approved product mappings have profitability data yet.',
      );
      return report;
    } catch (error) {
      setProductProfitabilityReport(null);
      setProductProfitabilityLoadState('failed');
      setProductProfitabilityMessage(error instanceof Error ? error.message : 'Unable to generate product profitability.');
      return null;
    }
  };

  const loadDiscrepancyReport = async () => {
    setDiscrepancyLoadState('loading');
    setDiscrepancyMessage('Comparing vendor data...');

    try {
      const report = await fetchDiscrepancyReport({
        basis: selectedDiscrepancyBasis === 'all' ? undefined : selectedDiscrepancyBasis,
        severity: selectedDiscrepancySeverity === 'all' ? undefined : selectedDiscrepancySeverity,
        customerId: selectedDiscrepancyCustomerId === 'all' ? undefined : selectedDiscrepancyCustomerId,
        includeMatched: includeMatchedDiscrepancies,
      });
      setDiscrepancyReport(report);
      setDiscrepancyLoadState('ready');
      setDiscrepancyMessage(
        report.rows.length > 0
          ? `Loaded ${report.summary.openDiscrepancyCount.toLocaleString()} open discrepancies across ${report.rows.length.toLocaleString()} rows.`
          : 'No discrepancy rows match the current filters.',
      );
      return report;
    } catch (error) {
      setDiscrepancyReport(null);
      setDiscrepancyLoadState('failed');
      setDiscrepancyMessage(error instanceof Error ? error.message : 'Unable to load discrepancy dashboard.');
      return null;
    }
  };

  const loadCustomerLicenseCustomers = async () => {
    setCustomerLicenseLoadState('loading');
    setCustomerLicenseMessage('Loading customers...');

    try {
      const response = await fetchCustomerLicenseCustomers();
      setCustomerLicenseCustomers(response.customers);
      setSelectedCustomerLicenseCustomerId((currentCustomerId) =>
        currentCustomerId || response.customers[0]?.customerId || '',
      );
      setCustomerLicenseLoadState('ready');
      setCustomerLicenseMessage(
        response.customers.length > 0
          ? 'Select a customer, then generate the combined license report.'
          : 'No active customers were found for customer license reporting.',
      );
      return response;
    } catch (error) {
      setCustomerLicenseCustomers([]);
      setCustomerLicenseReport(null);
      setCustomerLicenseLoadState('failed');
      setCustomerLicenseMessage(error instanceof Error ? error.message : 'Unable to load customer license customers.');
      return null;
    }
  };

  const generateCustomerLicenseReport = async () => {
    if (!selectedCustomerLicenseCustomerId) {
      setCustomerLicenseLoadState('idle');
      setCustomerLicenseMessage('Select a customer before generating the report.');
      return null;
    }

    setCustomerLicenseLoadState('loading');
    setCustomerLicenseMessage('Generating customer license report...');
    setCustomerLicenseReport(null);

    try {
      const report = await fetchCustomerLicenseReport({
        customerId: selectedCustomerLicenseCustomerId,
        vendorId: selectedCustomerLicenseVendorId,
        monthCount: 12,
        includeMicrosoftUserDetails,
      });
      setCustomerLicenseReport(report);
      setCustomerLicenseLoadState('ready');
      setCustomerLicenseMessage(
        report.products.length > 0
          ? `Generated ${report.vendor.integrationName} report for ${report.customer.customerName}.`
          : `No ${report.vendor.integrationName} data was found for ${report.customer.customerName}.`,
      );
      return report;
    } catch (error) {
      setCustomerLicenseReport(null);
      setCustomerLicenseLoadState('failed');
      setCustomerLicenseMessage(error instanceof Error ? error.message : 'Unable to generate customer license report.');
      return null;
    }
  };

  const loadInvoiceImports = async (
    vendorId: VendorKey | '' = selectedInvoiceIntegrationId,
    options: InvoiceWorkspaceLoadOptions = {},
  ) => {
    const cached = options.forceRefresh ? null : readCachedInvoiceImports(vendorId);
    if (cached) {
      setInvoiceImports(cached.imports);
      setInvoiceImportLoadState('ready');
      setInvoiceImportMessage(
        cached.imports.length > 0
          ? `Loaded ${cached.imports.length.toLocaleString()} saved vendor invoice imports.`
          : vendorId
            ? `No ${vendorDisplayName(vendorId, vendorDatapoints)} invoices were found.`
            : 'No saved vendor invoice imports were found.',
      );
      return cached;
    }

    setInvoiceImportLoadState('loading');
    setInvoiceImportMessage('Loading invoice imports...');

    try {
      const response = await fetchInvoiceImports(vendorId || undefined);
      const nextResponse = {
        imports: sortInvoiceImports(response.imports),
      };
      setInvoiceImports(nextResponse.imports);
      cacheInvoiceImports(vendorId, nextResponse);
      setInvoiceImportLoadState('ready');
      setInvoiceImportMessage(
        nextResponse.imports.length > 0
          ? `Loaded ${nextResponse.imports.length.toLocaleString()} vendor invoice imports.`
          : vendorId
            ? `No ${vendorDisplayName(vendorId, vendorDatapoints)} invoices have been imported yet.`
            : 'No vendor invoices have been imported yet.',
      );
      return nextResponse;
    } catch (error) {
      setInvoiceImports([]);
      setInvoiceImportLoadState('failed');
      setInvoiceImportMessage(error instanceof Error ? error.message : 'Unable to load invoice imports.');
      return null;
    }
  };

  const loadOverdueInvoiceWorkspace = async (options: InvoiceWorkspaceLoadOptions = {}) => {
    const cached = options.forceRefresh ? null : readCachedOverdueInvoices();
    if (cached) {
      setOverdueInvoices(cached);
      setOverdueInvoiceLoadState('ready');
      setOverdueInvoiceMessage(
        cached.summary.reviewQueueCount > 0
          ? `Loaded ${cached.summary.reviewQueueCount.toLocaleString()} saved invoices at least 7 days overdue.`
          : 'No saved invoices are at least 7 days overdue.',
      );
      return cached;
    }

    setOverdueInvoiceLoadState('loading');
    setOverdueInvoiceMessage('Loading overdue invoices from ConnectWise...');

    try {
      const response = normalizeOverdueInvoicesResponse(await fetchOverdueInvoices());
      setOverdueInvoices(response);
      cacheOverdueInvoices(response);
      setOverdueInvoiceLoadState('ready');
      setOverdueInvoiceMessage(
        response.summary.reviewQueueCount > 0
          ? `Loaded ${response.summary.reviewQueueCount.toLocaleString()} invoices at least 7 days overdue.`
          : 'No invoices are at least 7 days overdue.',
      );
      return response;
    } catch (error) {
      setOverdueInvoices(null);
      setOverdueInvoiceLoadState('failed');
      setOverdueInvoiceMessage(error instanceof Error ? error.message : 'Unable to load overdue invoices.');
      return null;
    }
  };

  const loadMonthlyInvoiceWorkspace = async (options: InvoiceWorkspaceLoadOptions = {}) => {
    const cached = options.forceRefresh ? null : readCachedMonthlyInvoiceCandidates();
    if (cached) {
      setMonthlyInvoiceCandidates(cached);
      setMonthlyInvoiceLoadState('ready');
      setMonthlyInvoiceMessage(
        cached.agreementCount > 0
          ? `Loaded ${cached.agreementCount.toLocaleString()} saved active monthly agreements.`
          : 'No saved active monthly agreements were found.',
      );
      return cached;
    }

    setMonthlyInvoiceLoadState('loading');
    setMonthlyInvoiceMessage('Loading monthly agreements from ConnectWise...');

    try {
      const response = await fetchMonthlyInvoiceCandidates();
      setMonthlyInvoiceCandidates(response);
      cacheMonthlyInvoiceCandidates(response);
      setMonthlyInvoiceLoadState('ready');
      setMonthlyInvoiceMessage(
        response.agreementCount > 0
          ? `Loaded ${response.agreementCount.toLocaleString()} active monthly agreements.`
          : 'No active monthly agreements were found.',
      );
      return response;
    } catch (error) {
      setMonthlyInvoiceCandidates(null);
      setMonthlyInvoiceLoadState('failed');
      setMonthlyInvoiceMessage(error instanceof Error ? error.message : 'Unable to load monthly agreements.');
      return null;
    }
  };

  const loadStandardInvoiceWorkspace = async (options: InvoiceWorkspaceLoadOptions = {}) => {
    const cached = options.forceRefresh ? null : readCachedStandardInvoiceCandidates();
    if (cached) {
      setStandardInvoiceCandidates(cached);
      setStandardInvoiceLoadState('ready');
      setStandardInvoiceMessage(
        cached.candidateCount > 0
          ? `Loaded ${cached.candidateCount.toLocaleString()} saved standard invoice candidates.`
          : 'No saved standard invoice candidates were found.',
      );
      return cached;
    }

    setStandardInvoiceLoadState('loading');
    setStandardInvoiceMessage('Loading standard invoices from ConnectWise...');

    try {
      const response = await fetchStandardInvoiceCandidates();
      setStandardInvoiceCandidates(response);
      cacheStandardInvoiceCandidates(response);
      setStandardInvoiceLoadState('ready');
      setStandardInvoiceMessage(
        response.candidateCount > 0
          ? `Loaded ${response.candidateCount.toLocaleString()} standard invoice candidates.`
          : 'No standard invoice candidates were found.',
      );
      return response;
    } catch (error) {
      setStandardInvoiceCandidates(null);
      setStandardInvoiceLoadState('failed');
      setStandardInvoiceMessage(error instanceof Error ? error.message : 'Unable to load standard invoices.');
      return null;
    }
  };

  const refreshInvoiceWorkspace = async () => {
    await Promise.all([
      loadInvoiceImports(selectedInvoiceIntegrationId, { forceRefresh: true }),
      loadOverdueInvoiceWorkspace({ forceRefresh: true }),
      loadMonthlyInvoiceWorkspace({ forceRefresh: true }),
      loadStandardInvoiceWorkspace({ forceRefresh: true }),
    ]);
  };

  const previewInvoiceNotice = async (customer: OverdueInvoiceCustomerGroup) => {
    const actionKey = `${customer.customerKey}:preview`;
    const noticeType = normalizeInvoiceNoticeType(customer.noticeType, customer.oldestDaysPastDue);
    setInvoiceNoticeBusyKey(actionKey);
    setInvoiceNoticeMessage(`Preparing overdue email for ${customer.company.name}...`);

    try {
      const response = await postInvoiceNotification({
        companyKey: customer.customerKey,
        invoiceIds: customer.invoices.map((invoice) => invoice.invoiceId),
        noticeType,
      });
      setInvoiceNoticeResult(response);
      setInvoiceNoticeMessage('Email preview ready.');
      return response;
    } catch (error) {
      setInvoiceNoticeResult(null);
      setInvoiceNoticeMessage(error instanceof Error ? error.message : 'Unable to preview overdue email.');
      return null;
    } finally {
      setInvoiceNoticeBusyKey(null);
    }
  };

  const confirmInvoiceNotice = async (preview: InvoiceNotificationPreview, notes?: string) => {
    const actionKey = `${preview.companyKey ?? preview.invoiceId ?? preview.invoiceIds.join('-')}:confirm`;
    setInvoiceNoticeBusyKey(actionKey);
    setInvoiceNoticeMessage(`Saving overdue email event for ${preview.companyName}...`);

    try {
      const response = await postInvoiceNotification({
        invoiceId: preview.invoiceId,
        invoiceIds: preview.invoiceIds,
        companyKey: preview.companyKey,
        noticeType: preview.noticeType,
        confirm: true,
        notes,
      });
      setInvoiceNoticeResult(response);
      setInvoiceNoticeMessage(
        response.status === 'sent'
          ? `Overdue email sent to ${response.preview.recipientEmail ?? 'recipient'}.`
          : 'Overdue email event saved to audit history. Configure Microsoft Graph under Settings → Email Communication to send for real.',
      );
      await loadOverdueInvoiceWorkspace({ forceRefresh: true });
      return response;
    } catch (error) {
      setInvoiceNoticeMessage(error instanceof Error ? error.message : 'Unable to save overdue email event.');
      return null;
    } finally {
      setInvoiceNoticeBusyKey(null);
    }
  };

  const testInvoiceNotice = async (preview: InvoiceNotificationPreview, testRecipientEmail: string, notes?: string) => {
    const actionKey = `${preview.companyKey ?? preview.invoiceId ?? preview.invoiceIds.join('-')}:test`;
    setInvoiceNoticeBusyKey(actionKey);
    setInvoiceNoticeMessage(`Sending test email for ${preview.companyName} to ${testRecipientEmail}...`);

    try {
      const response = await postInvoiceNotification({
        invoiceId: preview.invoiceId,
        invoiceIds: preview.invoiceIds,
        companyKey: preview.companyKey,
        noticeType: preview.noticeType,
        confirm: true,
        testMode: true,
        testRecipientEmail,
        notes,
      });
      setInvoiceNoticeResult(response);
      setInvoiceNoticeMessage(
        response.status === 'test-sent'
          ? `Test email sent to ${testRecipientEmail}.`
          : `Test email stubbed to ${testRecipientEmail}. Configure Microsoft Graph under Settings → Email Communication to send for real.`,
      );
      return response;
    } catch (error) {
      setInvoiceNoticeMessage(error instanceof Error ? error.message : 'Unable to send test email.');
      return null;
    } finally {
      setInvoiceNoticeBusyKey(null);
    }
  };

  const openBulkNoticeConfirm = (customers: OverdueInvoiceCustomerGroup[]) => {
    if (customers.length === 0) {
      setBulkNoticeMessage('Select at least one customer before sending.');
      return;
    }
    setBulkNoticeCustomers(customers);
    setBulkNoticeMessage(`Review ${customers.length} selected customer email${customers.length === 1 ? '' : 's'} before sending.`);
  };

  const confirmBulkInvoiceNotices = async (customers: OverdueInvoiceCustomerGroup[], notes?: string) => {
    setBulkNoticeBusy(true);
    setBulkNoticeMessage(`Sending ${customers.length} overdue email${customers.length === 1 ? '' : 's'}...`);

    try {
      let successCount = 0;
      for (const customer of customers) {
        await postInvoiceNotification({
          companyKey: customer.customerKey,
          invoiceIds: customer.invoices.map((invoice) => invoice.invoiceId),
          noticeType: normalizeInvoiceNoticeType(customer.noticeType, customer.oldestDaysPastDue),
          confirm: true,
          notes,
        });
        successCount += 1;
        setBulkNoticeMessage(`Sent ${successCount} of ${customers.length}...`);
      }
      setBulkNoticeCustomers(null);
      setSelectedOverdueCustomerKeys([]);
      setBulkNoticeMessage(`Sent ${successCount} overdue email${successCount === 1 ? '' : 's'}.`);
      setInvoiceNoticeMessage(`Sent ${successCount} overdue email${successCount === 1 ? '' : 's'}.`);
      await loadOverdueInvoiceWorkspace({ forceRefresh: true });
    } catch (error) {
      setBulkNoticeMessage(error instanceof Error ? error.message : 'Unable to send selected overdue emails.');
    } finally {
      setBulkNoticeBusy(false);
    }
  };

  const testBulkInvoiceNotices = async (
    customers: OverdueInvoiceCustomerGroup[],
    testRecipientEmail: string,
    notes?: string,
  ) => {
    setBulkNoticeBusy(true);
    setBulkNoticeMessage(`Sending ${customers.length} test email${customers.length === 1 ? '' : 's'} to ${testRecipientEmail}...`);

    try {
      let successCount = 0;
      let sentCount = 0;
      for (const customer of customers) {
        const response = await postInvoiceNotification({
          companyKey: customer.customerKey,
          invoiceIds: customer.invoices.map((invoice) => invoice.invoiceId),
          noticeType: normalizeInvoiceNoticeType(customer.noticeType, customer.oldestDaysPastDue),
          confirm: true,
          testMode: true,
          testRecipientEmail,
          notes,
        });
        successCount += 1;
        if (response.status === 'test-sent') {
          sentCount += 1;
        }
        setBulkNoticeMessage(`Tested ${successCount} of ${customers.length}...`);
      }
      const message =
        sentCount > 0
          ? `Sent ${sentCount} test email${sentCount === 1 ? '' : 's'} to ${testRecipientEmail}.`
          : `Stubbed ${successCount} test email${successCount === 1 ? '' : 's'} to ${testRecipientEmail}. Configure Microsoft Graph under Settings → Email Communication to send for real.`;
      setBulkNoticeMessage(message);
      setInvoiceNoticeMessage(message);
    } catch (error) {
      setBulkNoticeMessage(error instanceof Error ? error.message : 'Unable to send test batch emails.');
    } finally {
      setBulkNoticeBusy(false);
    }
  };

  const previewMonthlyInvoice = async (candidate: MonthlyInvoiceCandidate) => {
    setMonthlyInvoicePreviewBusyId(candidate.agreementId);
    setMonthlyInvoiceMessage(`Preparing preview for ${candidate.agreementName}...`);

    try {
      const response = await postMonthlyInvoicePreview(candidate.agreementId);
      setMonthlyInvoicePreview(response);
      setMonthlyInvoiceMessage('Monthly invoice preview ready.');
      return response;
    } catch (error) {
      setMonthlyInvoicePreview(null);
      setMonthlyInvoiceMessage(error instanceof Error ? error.message : 'Unable to preview monthly invoice.');
      return null;
    } finally {
      setMonthlyInvoicePreviewBusyId(null);
    }
  };

  const importVendorInvoice = async (file: File, importMode: InvoiceImportMode) => {
    setImportingInvoice(true);
    setInvoiceImportLoadState('loading');
    setInvoiceImportMessage(`${importMode === 'overwrite' ? 'Overwriting' : 'Merging'} ${file.name}...`);
    setInvoiceExceptionReview(null);
    setInvoiceExceptionLoadState('idle');
    setInvoiceExceptionMessage('Select an invoice import to review exceptions.');

    try {
      const response = await importInvoiceFile(file, importMode);
      const importsResponse = await fetchInvoiceImports(selectedInvoiceIntegrationId || undefined);
      const nextImportsResponse = {
        imports: sortInvoiceImports(importsResponse.imports),
      };
      invalidateCachedInvoiceImports(response.import.vendorId);
      cacheInvoiceImports(selectedInvoiceIntegrationId, nextImportsResponse);
      setInvoiceImports(nextImportsResponse.imports);
      setInvoiceImportLoadState('ready');
      const vendorName = response.detectedVendor?.vendorName ?? vendorDisplayName(response.import.vendorId, vendorDatapoints);
      setInvoiceImportMessage(
        `${importMode === 'overwrite' ? 'Overwrote' : 'Imported'} ${response.import.rowCount.toLocaleString()} ${vendorName} invoice rows with ${response.import.exceptionRows.toLocaleString()} exceptions.`,
      );
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(response.import.vendorId) &&
        selectedReconciliationIntegrationSet.has(response.import.vendorId) &&
        reconciliationVendorIds.includes(response.import.vendorId)
      ) {
        void loadVendorReconciliation(response.import.vendorId);
      }
      return response.import;
    } catch (error) {
      setInvoiceImportLoadState('failed');
      setInvoiceImportMessage(error instanceof Error ? error.message : 'Unable to import vendor invoice.');
      return null;
    } finally {
      setImportingInvoice(false);
    }
  };

  const updateInvoiceImportSummary = (invoiceImport: InvoiceImportSummary) => {
    updateCachedInvoiceImportSummary(invoiceImport);
    setInvoiceImports((current) => {
      const exists = current.some((item) => item.id === invoiceImport.id);
      const nextImports = exists
        ? current.map((item) => (item.id === invoiceImport.id ? invoiceImport : item))
        : [invoiceImport, ...current];
      return sortInvoiceImports(nextImports);
    });
  };

  const openInvoiceExceptionReview = async (invoiceImport: InvoiceImportSummary) => {
    setInvoiceExceptionLoadState('loading');
    setInvoiceExceptionReview(null);
    setInvoiceExceptionMessage(
      invoiceImport.exceptionRows > 0
        ? `Loading ${invoiceImport.exceptionRows.toLocaleString()} invoice exceptions...`
        : 'Loading invoice review...',
    );

    try {
      const [review, mappingResponse] = await Promise.all([
        fetchInvoiceImportExceptions(invoiceImport.vendorId, invoiceImport.id),
        hasMappingWorkspaceForVendor(invoiceImport.vendorId)
          ? fetchMappingState(invoiceImport.vendorId)
          : Promise.resolve({ customerOptions: [] } as unknown as MappingStateResponse),
      ]);
      setInvoiceExceptionReview(review);
      setInvoiceExceptionCustomerOptions(mappingResponse.customerOptions);
      updateInvoiceImportSummary(review.import);
      setInvoiceExceptionLoadState('ready');
      setInvoiceExceptionMessage(
        review.summary.exceptionRows > 0
          ? `${review.summary.exceptionRows.toLocaleString()} exceptions need mapping decisions.`
          : 'No exceptions remain on this invoice import.',
      );
      return review;
    } catch (error) {
      setInvoiceExceptionReview(null);
      setInvoiceExceptionLoadState('failed');
      setInvoiceExceptionMessage(error instanceof Error ? error.message : 'Unable to load invoice exceptions.');
      return null;
    }
  };

  const closeInvoiceExceptionReview = () => {
    setInvoiceExceptionReview(null);
    setInvoiceExceptionLoadState('idle');
    setInvoiceExceptionMessage('Select an invoice import to review exceptions.');
    setBusyInvoiceExceptionAction(null);
  };

  const reloadInvoiceExceptionReview = async () => {
    if (!invoiceExceptionReview) {
      return null;
    }
    return openInvoiceExceptionReview(invoiceExceptionReview.import);
  };

  const refreshInvoiceImportMappingsForReview = async (invoiceImport: InvoiceImportSummary) => {
    const refresh = await refreshInvoiceImportMappingsRequest(invoiceImport.vendorId, invoiceImport.id);
    updateInvoiceImportSummary(refresh.import);
    const review = await fetchInvoiceImportExceptions(invoiceImport.vendorId, invoiceImport.id);
    setInvoiceExceptionReview(review);
    updateInvoiceImportSummary(review.import);
    if (reconciliationComparisonRequested && selectedReconciliationIntegrationSet.has('opentext-appriver')) {
      void loadVendorReconciliation('opentext-appriver');
    }
    return refresh;
  };

  const saveInvoiceExceptionAccountMapping = async (
    account: InvoiceAccountException,
    customerId: string,
    agreementId: string,
  ) => {
    if (!invoiceExceptionReview) {
      return false;
    }
    if (!customerId || !agreementId || agreementId === noAgreementSyncValue) {
      setInvoiceExceptionLoadState('failed');
      setInvoiceExceptionMessage('Choose a ConnectWise customer and billing agreement before saving.');
      return false;
    }

    const actionKey = `invoice-account:${account.externalAccountId}`;
    setBusyInvoiceExceptionAction(actionKey);
    setInvoiceExceptionMessage(`Saving mapping for ${account.externalAccountName}...`);
    try {
      await saveAccountMapping(invoiceExceptionReview.import.vendorId, account.externalAccountId, {
        status: 'approved',
        customerId,
        agreementId,
        externalAccountName: account.externalAccountName,
      });
      const refresh = await refreshInvoiceImportMappingsForReview(invoiceExceptionReview.import);
      setInvoiceExceptionLoadState('ready');
      setInvoiceExceptionMessage(
        `Mapped ${account.externalAccountName}. Refreshed ${refresh.accountRowsUpdated.toLocaleString()} account rows and ${refresh.productRowsUpdated.toLocaleString()} product rows.`,
      );
      return true;
    } catch (error) {
      setInvoiceExceptionLoadState('failed');
      setInvoiceExceptionMessage(error instanceof Error ? error.message : 'Account mapping save failed.');
      return false;
    } finally {
      setBusyInvoiceExceptionAction(null);
    }
  };

  const saveInvoiceExceptionProductMapping = async (
    product: InvoiceProductException,
    target: ProductMappingTarget,
  ) => {
    if (!invoiceExceptionReview) {
      return false;
    }

    const actionKey = `invoice-product:${product.vendorProductKey}`;
    setBusyInvoiceExceptionAction(actionKey);
    setInvoiceExceptionMessage(`Saving product mapping for ${product.productName}...`);
    try {
      await saveProductMapping(invoiceExceptionReview.import.vendorId, product.vendorProductKey, {
        status: 'approved',
        targetProducts: [target],
      });
      const refresh = await refreshInvoiceImportMappingsForReview(invoiceExceptionReview.import);
      setInvoiceExceptionLoadState('ready');
      setInvoiceExceptionMessage(
        `Mapped ${product.productName}. Refreshed ${refresh.productRowsUpdated.toLocaleString()} product rows and ${refresh.accountRowsUpdated.toLocaleString()} account rows.`,
      );
      return true;
    } catch (error) {
      setInvoiceExceptionLoadState('failed');
      setInvoiceExceptionMessage(error instanceof Error ? error.message : 'Product mapping save failed.');
      return false;
    } finally {
      setBusyInvoiceExceptionAction(null);
    }
  };

  const loadCustomerVendorData = async (
    client: ClientGroup,
    vendorId: IntegrationId,
    vendor: string,
  ): Promise<VendorDataSelection> => {
    const dataset = rawSyncDatasetForVendorData(vendorId);
    let syncRunId =
      selectedReconciliationIntegrationSet.has(vendorId)
        ? reconciliationRunMetaByVendor[vendorId]?.syncRunId
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

  const loadMappings = async (integrationId: VendorKey) => {
    setMappingLoadState('loading');
    setMappingMessage('Loading mapping state...');

    try {
      const state = await fetchMappingState(integrationId);
      setMappingState(state);
      setMappingLoadState('ready');
      setMappingMessage(
        `Loaded ${state.summary.accountMappings.toLocaleString()} account mappings, ${state.summary.productMappings.toLocaleString()} product mappings, ${(state.summary.productBundles ?? 0).toLocaleString()} product bundles, and ${(state.summary.linkedProductRules ?? 0).toLocaleString()} linked count rules.`,
      );
      return state;
    } catch (error) {
      setMappingState(null);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load mappings.');
      return null;
    }
  };

  const loadUsageOverrides = async (integrationId: VendorKey) => {
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

  const loadLaborMappingWorkspace = async (integrationId: VendorKey) => {
    if (!hasLaborMappingWorkspace(integrationId)) {
      setLaborMappings([]);
      setLaborBoards([]);
      setLaborClassificationMessage('');
      return;
    }

    try {
      const [mappingsResponse, classifications] = await Promise.all([
        fetchLaborMappings(integrationId),
        fetchLaborClassifications().catch((error) => {
          setLaborClassificationMessage(
            error instanceof Error ? error.message : 'Unable to load ConnectWise boards.',
          );
          return { boards: [] as ConnectWiseBoardOption[], types: [], subTypes: [], statuses: [] };
        }),
      ]);
      setLaborMappings(mappingsResponse.mappings);
      setLaborBoards(classifications.boards ?? []);
      if ((classifications.boards ?? []).length > 0) {
        setLaborClassificationMessage('');
      }
    } catch (error) {
      setLaborMappings([]);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load labor mappings.');
    }
  };

  const loadInvestigationTicketMappingWorkspace = async (integrationId: VendorKey) => {
    if (!hasInvestigationTicketMappingWorkspace(integrationId)) {
      setInvestigationTicketMapping(null);
      return;
    }

    try {
      const [mappingResponse, classifications] = await Promise.all([
        fetchInvestigationTicketMapping(integrationId),
        fetchLaborClassifications().catch((error) => {
          setLaborClassificationMessage(
            error instanceof Error ? error.message : 'Unable to load ConnectWise boards.',
          );
          return { boards: [] as ConnectWiseBoardOption[], types: [], subTypes: [], statuses: [] };
        }),
      ]);
      setInvestigationTicketMapping(mappingResponse.mapping);
      if ((classifications.boards ?? []).length > 0) {
        setLaborBoards(classifications.boards ?? []);
        setLaborClassificationMessage('');
      } else if (laborBoards.length === 0) {
        setLaborBoards(classifications.boards ?? []);
      }
    } catch (error) {
      setInvestigationTicketMapping(null);
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to load investigation ticket mapping.');
    }
  };

  const refreshMappingWorkspace = async (integrationId: VendorKey) => {
    const isLaborOnly = integrationId === 'connectwise';
    const state = isLaborOnly
      ? null
      : await loadMappings(integrationId);
    if (!isLaborOnly) {
      await loadUsageOverrides(integrationId);
    } else {
      setMappingState(null);
      setUsageOverrides([]);
      setMappingLoadState('ready');
      setMappingMessage('Configure labeled labor filters for ConnectWise ticket hours.');
    }
    if (integrationId === 'ncentral') {
      await loadNcentralFilterWorkspace();
    } else {
      setNcentralFilters([]);
      setNcentralFilterMappings([]);
    }
    await loadLaborMappingWorkspace(integrationId);
    await loadInvestigationTicketMappingWorkspace(integrationId);
    return state;
  };

  const loadVendorReconciliation = async (vendorId: VendorKey) => {
    const sourceName = vendorDisplayName(vendorId, vendorDatapoints);
    setReconciliationLoadState('loading');
    setReconciliationMessage(`Comparing latest ${sourceName} sync against ConnectWise additions...`);

    try {
      const run = await fetchReconciliationRun(vendorId);
      const nextIssues = reconcileIssuesFromRun(run);
      const nextReviewIssues = nextIssues.filter(isReviewableIssue);
      const firstSelectedIssue =
        [...nextReviewIssues].sort(compareIssuesByCustomer)[0] ?? [...nextIssues].sort(compareIssuesByCustomer)[0];
      setIssues((currentIssues) => [
        ...currentIssues.filter((issue) => issue.vendorId !== vendorId),
        ...nextIssues,
      ]);
      setReconciliationRunMetaByVendor((current) => ({
        ...current,
        [vendorId]: {
        syncRunId: run.syncRunId,
        generatedAt: run.generatedAt,
        snapshotCount: run.snapshotCount,
        agreementAdditionCount: run.agreementAdditionCount,
        latestInvoice: run.latestInvoice,
        productCheckCount: nextIssues.length,
        },
      }));
      setReconciliationProductOptionsByVendor((current) => ({
        ...current,
        [vendorId]: run.productOptions ?? [],
      }));
      setExpandedClientNames(firstSelectedIssue?.customer ? [firstSelectedIssue.customer] : []);
      setReconciliationLoadState('ready');
      setReconciliationMessage(
        nextReviewIssues.length > 0
          ? `${nextReviewIssues.length.toLocaleString()} discrepancies ready for review.`
          : run.syncRunId && run.snapshotCount === 0
            ? `Latest ${sourceName} sync has no customer-mapped snapshots. Approve account mappings on ${sourceName}, refresh the device import, then compare again.`
            : run.syncRunId
              ? `No ${sourceName} discrepancies found in the latest sync.`
              : `No completed ${sourceName} sync is available yet.`,
      );
      void loadInvestigationTicketPresence([vendorId]).then((presence) => {
        setInvestigationTicketPresence((current) => {
          const next = { ...current };
          for (const key of Object.keys(next)) {
            if (key.endsWith(`::${vendorId}`)) {
              delete next[key];
            }
          }
          return { ...next, ...presence };
        });
      });
      return run;
    } catch (error) {
      setIssues((currentIssues) => currentIssues.filter((issue) => issue.vendorId !== vendorId));
      setReconciliationRunMetaByVendor((current) => {
        const next = { ...current };
        delete next[vendorId];
        return next;
      });
      setReconciliationProductOptionsByVendor((current) => {
        const next = { ...current };
        delete next[vendorId];
        return next;
      });
      setExpandedClientNames([]);
      setReconciliationLoadState('failed');
      setReconciliationMessage(error instanceof Error ? error.message : `Unable to load ${sourceName} reconciliation.`);
      return null;
    }
  };

  const loadSelectedVendorReconciliations = async (vendorIds: VendorKey[]) => {
    const uniqueVendorIds = [...new Set(vendorIds)];
    if (uniqueVendorIds.length === 0) {
      setIssues([]);
      setReconciliationRunMetaByVendor({});
      setReconciliationProductOptionsByVendor({});
      setInvestigationTicketPresence({});
      setReconciliationComparisonRequested(false);
      setExpandedClientNames([]);
      setReconciliationLoadState('idle');
      setReconciliationMessage('Choose one or more vendors.');
      return null;
    }

    setReconciliationComparisonRequested(true);
    setReconciliationLoadState('loading');
    setReconciliationMessage(
      `Comparing ${uniqueVendorIds.map((vendorId) => vendorDisplayName(vendorId, vendorDatapoints)).join(', ')} against ConnectWise additions...`,
    );

    try {
      const runs = await Promise.all(uniqueVendorIds.map((vendorId) => fetchReconciliationRun(vendorId)));
      const nextIssues = runs.flatMap(reconcileIssuesFromRun);
      const nextReviewIssues = nextIssues.filter(isReviewableIssue);
      const firstSelectedIssue =
        [...nextReviewIssues].sort(compareIssuesByCustomer)[0] ?? [...nextIssues].sort(compareIssuesByCustomer)[0];
      setIssues(nextIssues);
      setReconciliationRunMetaByVendor(
        Object.fromEntries(
          runs.map((run) => [
            run.vendorId,
            {
              syncRunId: run.syncRunId,
              generatedAt: run.generatedAt,
              snapshotCount: run.snapshotCount,
              agreementAdditionCount: run.agreementAdditionCount,
              latestInvoice: run.latestInvoice,
              productCheckCount: run.lines.length,
            },
          ]),
        ) as Partial<Record<VendorKey, ReconciliationRunMeta>>,
      );
      setReconciliationProductOptionsByVendor(
        Object.fromEntries(runs.map((run) => [run.vendorId, run.productOptions ?? []])) as Partial<
          Record<VendorKey, ReconciliationProductOption[]>
        >,
      );
      setExpandedClientNames(firstSelectedIssue?.customer ? [firstSelectedIssue.customer] : []);
      setReconciliationLoadState('ready');
      setReconciliationMessage(
        nextReviewIssues.length > 0
          ? `${nextReviewIssues.length.toLocaleString()} discrepancies ready for review.`
          : runs.some((run) => run.syncRunId && run.snapshotCount === 0)
            ? 'Latest sync has no customer-mapped snapshots. Approve account mappings, refresh the device import, then compare again.'
            : runs.some((run) => run.syncRunId)
              ? 'No selected vendor discrepancies found in the latest syncs.'
              : 'No completed sync is available for the selected vendors yet.',
      );
      void loadInvestigationTicketPresence(uniqueVendorIds).then(setInvestigationTicketPresence);
      return runs;
    } catch (error) {
      setIssues([]);
      setReconciliationRunMetaByVendor({});
      setReconciliationProductOptionsByVendor({});
      setInvestigationTicketPresence({});
      setExpandedClientNames([]);
      setReconciliationLoadState('failed');
      setReconciliationMessage(error instanceof Error ? error.message : 'Unable to load selected vendor reconciliation.');
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
      const nextView = viewFromLocation(window.location);
      const nextMappingIntegrationId = mappingIntegrationIdFromLocation(window.location);

      setView(nextView);
      setSettingsSection(settingsSectionFromPath(window.location.pathname) ?? defaultSettingsSection);
      if (nextMappingIntegrationId) {
        setSelectedMappingIntegrationId(nextMappingIntegrationId);
        setMappingState(null);
        setUsageOverrides([]);
        setMappingMessage('Loading mapping state...');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (view !== 'mappings') {
      return;
    }

    updateRouteForView('mappings', selectedMappingIntegrationId);
  }, [selectedMappingIntegrationId, view]);

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

    void loadRawSyncDetails(
      selectedRawSyncIntegrationId,
      selectedRawSyncRunId,
      selectedRawSyncDataset,
      includeRawSyncRawPayload,
    );
  }, [
    includeRawSyncRawPayload,
    reportSection,
    selectedRawSyncDataset,
    selectedRawSyncIntegrationId,
    selectedRawSyncRunId,
    view,
  ]);

  useEffect(() => {
    if (view !== 'discrepancies') {
      return;
    }

    void loadDiscrepancyReport();
  }, [
    includeMatchedDiscrepancies,
    selectedDiscrepancyBasis,
    selectedDiscrepancyCustomerId,
    selectedDiscrepancySeverity,
    view,
  ]);

  useEffect(() => {
    if (view !== 'reports' || reportSection !== 'customer-license' || customerLicenseCustomers.length > 0) {
      return;
    }

    void loadCustomerLicenseCustomers();
  }, [customerLicenseCustomers.length, reportSection, view]);

  useEffect(() => {
    if (view !== 'mappings') {
      return;
    }

    void refreshMappingWorkspace(selectedMappingIntegrationId);
  }, [selectedMappingIntegrationId, view]);

  useEffect(() => {
    if (view !== 'invoices') {
      return;
    }

    if (invoiceWorkspaceTab === 'overdue') {
      void loadOverdueInvoiceWorkspace();
    }
    if (invoiceWorkspaceTab === 'monthly') {
      void loadMonthlyInvoiceWorkspace();
    }
    if (invoiceWorkspaceTab === 'standard') {
      void loadStandardInvoiceWorkspace();
    }
  }, [invoiceWorkspaceTab, view]);

  useEffect(() => {
    if (view !== 'invoices' && view !== 'integrations') {
      return;
    }

    void loadInvoiceImports(selectedInvoiceIntegrationId);
  }, [selectedInvoiceIntegrationId, view]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (!isProcessedReconciliationIssue(issue)) {
        return false;
      }

      const matchesSearchAndVendor = issueMatchesSearchAndVendor(issue, query, vendorFilter);
      const matchesStatus = !needsReviewOnly || isReviewViewIssue(issue);
      return matchesSearchAndVendor && matchesStatus;
    });
  }, [issues, needsReviewOnly, query, vendorFilter]);

  const clientGroups = useMemo(() => groupIssuesByClient(filteredIssues), [filteredIssues]);
  const integrations = useMemo(() => buildIntegrations(runtimeIntegrations ?? undefined), [runtimeIntegrations]);
  const enabledReconciliationIntegrations = useMemo(
    () => sortIntegrationsForDisplay(integrations.filter(isEnabledReconciliationIntegration)),
    [integrations],
  );
  const enabledReconciliationVendors = useMemo(
    (): ReconciliationVendorOption[] =>
      [
        ...enabledReconciliationIntegrations.map((integration) => ({
          id: integration.id,
          name: integration.name,
          sourceKind: 'sync' as const,
          lastRefreshedLabel: integration.lastSync ?? 'Never',
          canSync: hasLiveIntegrationActions(integration.id),
          syncIntegrationId: hasLiveIntegrationActions(integration.id) ? integration.id : undefined,
        })),
        ...vendorDatapoints
          .filter(isEnabledReconciliationDatapoint)
          .map((datapoint) => ({
            id: datapoint.vendorId,
            name: datapoint.displayName,
            sourceKind: 'import' as const,
            lastRefreshedLabel: formatDateTime(datapoint.lastImportedAt) ?? 'Never',
            canSync: false,
          })),
      ].sort((left, right) => left.name.localeCompare(right.name)),
    [enabledReconciliationIntegrations, vendorDatapoints],
  );
  const invoiceImportIntegrations = useMemo(
    () =>
      sortIntegrationsForDisplay(
        integrations.filter((integration) => integrationHasCapability(integration.id, 'invoice-import')),
      ),
    [integrations],
  );
  const rawSyncReportIntegrations = useMemo(() => {
    const availableIntegrations = integrations.filter(hasAvailableRawSyncReport);
    const selectedIntegration = selectedRawSyncIntegrationId
      ? integrations.find((integration) => integration.id === selectedRawSyncIntegrationId)
      : undefined;
    const includesSelectedIntegration = selectedIntegration
      ? availableIntegrations.some((integration) => integration.id === selectedIntegration.id)
      : true;

    return sortIntegrationsForDisplay(
      selectedIntegration && !includesSelectedIntegration
        ? [...availableIntegrations, selectedIntegration]
        : availableIntegrations,
    );
  }, [integrations, selectedRawSyncIntegrationId]);
  const pendingCount = issues.filter((issue) => isProcessedReconciliationIssue(issue) && isReviewableIssue(issue)).length;
  const selectedReconciliationIntegration = integrations.find((integration) => integration.id === selectedReconciliationIntegrationId);
  const connectWiseIntegration = integrations.find((integration) => integration.id === 'connectwise');
  const vendorDataSummary = formatSyncSummary(
    reconciliationRunMeta?.generatedAt
      ? formatDateTime(reconciliationRunMeta.generatedAt)
      : selectedReconciliationIntegration?.lastSync,
    reconciliationRunMeta?.snapshotCount,
    'snapshots',
  );
  const vendorInvoiceSummary = formatInvoiceSummary(
    selectedReconciliationIntegrationId === 'opentext-appriver'
      ? reconciliationRunMeta?.latestInvoice ?? invoiceImports[0]
      : undefined,
  );
  const connectWiseSyncSummary = connectWiseIntegration?.lastSync
    ? `Last sync ${connectWiseIntegration.lastSync}`
    : 'No sync date';
  const totalExposure = issues
    .filter((issue) => isProcessedReconciliationIssue(issue) && isReviewableIssue(issue))
    .reduce((total, issue) => total + reconciliationIssueImpact(issue), 0);
  const queuedAgreementUpdateIssues = useMemo(
    () => issues.filter((issue) => issue.status === 'approved'),
    [issues],
  );
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

  useEffect(() => {
    const enabledReconciliationIds = new Set(enabledReconciliationVendors.map((vendor) => vendor.id));
    const selectedVendorNames = new Set([
      'All',
      ...enabledReconciliationVendors
        .filter((vendor) => selectedReconciliationIntegrationIds.includes(vendor.id))
        .map((vendor) => vendor.name),
    ]);

    const nextSelectedIds = selectedReconciliationIntegrationIds.filter((integrationId) =>
      enabledReconciliationIds.has(integrationId),
    );

    if (nextSelectedIds.length !== selectedReconciliationIntegrationIds.length) {
      setSelectedReconciliationIntegrationIds(nextSelectedIds);
      setIssues([]);
      setReconciliationRunMetaByVendor({});
      setReconciliationProductOptionsByVendor({});
      setReconciliationComparisonRequested(false);
      setExpandedClientNames([]);
      setReconciliationLoadState('idle');
      setReconciliationMessage(
        enabledReconciliationVendors.length > 0
          ? nextSelectedIds.length > 0
            ? 'Click Compare to load selected vendors.'
            : 'Choose one or more enabled vendors.'
          : 'No enabled reconciliation integrations.',
      );
    }

    if (!selectedVendorNames.has(vendorFilter)) {
      setVendorFilter('All');
    }
  }, [
    enabledReconciliationVendors,
    selectedReconciliationIntegrationIds,
    vendorFilter,
  ]);

  const approveIssue = (issueId: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) => {
        if (issue.id !== issueId) {
          return issue;
        }

        return issue.status === 'approved'
          ? {
              ...issue,
              status: restoredReconciliationStatus(issue),
              owner: 'Finance',
              manualOverrideTotal: undefined,
              manualOverrideTotalTouched: false,
              proposedLessIncluded: undefined,
              lessIncludedTouched: false,
              appliedUpdate: undefined,
            }
          : {
              ...issue,
              status: 'approved',
              selectedCountSource: reconciliationCountSource(issue),
              owner: 'Finance',
              appliedUpdate: undefined,
            };
      }),
    );
  };

  const selectIssueCountSource = (issueId: string, countSource: ReconciliationCountSource) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) => {
        if (issue.id !== issueId) {
          return issue;
        }

        if (countSource === 'invoice' && typeof validVendorInvoiceCount(issue) !== 'number') {
          return issue;
        }

        if (countSource === 'linked' && typeof validLinkedCount(issue) !== 'number') {
          return issue;
        }

        return {
          ...issue,
          selectedCountSource: countSource,
          manualOverrideTotal: undefined,
          manualOverrideTotalTouched: false,
        };
      }),
    );
  };

  const approveClient = (customer: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        issue.customer === customer && (issue.status === 'ready' || issue.status === 'needs-review')
          ? {
              ...issue,
              status: 'approved',
              selectedCountSource: reconciliationCountSource(issue),
              owner: 'Finance',
              appliedUpdate: undefined,
            }
          : issue,
      ),
    );
  };

  const skipIssue = (issueId: string) => {
    setIssues((currentIssues) =>
      currentIssues.map((issue) =>
        issue.id === issueId
          ? {
              ...issue,
              status: 'skipped',
              owner: 'Finance',
              manualOverrideTotal: undefined,
              manualOverrideTotalTouched: false,
              appliedUpdate: undefined,
            }
          : issue,
      ),
    );
  };

  const exportSelectedReconciliationReport = async () => {
    if (selectedReconciliationIntegrationIds.length === 0 || issues.length === 0) {
      window.alert('Choose a vendor with reconciliation data before exporting a report.');
      return;
    }

    setExportingReconciliationReport(true);

    try {
      const sourceName =
        selectedReconciliationIntegrationIds.length === 1
          ? vendorDisplayName(selectedReconciliationIntegrationIds[0], vendorDatapoints)
          : selectedReconciliationIntegrationIds.map((vendorId) => vendorDisplayName(vendorId, vendorDatapoints)).join(' + ');
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

  const createInvestigationTicket = async () => {
    if (!ticketClient || ticketIssueIds.length === 0) return;

    const selectedIssues = ticketClient.issues.filter((issue) => ticketIssueIds.includes(issue.id));
    if (selectedIssues.length === 0) return;

    const companyId = Number(ticketClient.accountId);
    const hasCompanyId = Number.isFinite(companyId) && companyId > 0;

    const ticketsByVendor = new Map<
      VendorKey,
      { vendorId: VendorKey; vendorName: string; licenses: Array<Record<string, unknown>> }
    >();
    for (const issue of selectedIssues) {
      const existing = ticketsByVendor.get(issue.vendorId) ?? {
        vendorId: issue.vendorId,
        vendorName: issue.vendor,
        licenses: [],
      };
      existing.licenses.push({
        sourceLineId: issue.id,
        productCode: issue.serviceCode,
        productName: issue.product,
        vendorProductKey: issue.vendorProductKey,
        unit: issue.unit,
        apiCount: issue.sourceCount,
        linkedCount: validLinkedCount(issue) ?? null,
        linkedCountDetail: issue.linkedCount
          ? {
              quantity: issue.linkedCount.quantity,
              ruleName: issue.linkedCount.ruleName,
              sources: issue.linkedCount.sources,
            }
          : null,
        vendorInvoiceCount: validVendorInvoiceCount(issue) ?? null,
        invoiceNumber: issue.invoiceNumber,
        invoiceDate: issue.invoiceDate,
        connectWiseCount: issue.invoiceCount,
        proposedCount: issue.proposedCount,
        selectedCountSource: reconciliationCountSource(issue),
        selectedCount: reconciliationSelectedCount(issue),
        delta: reconciliationDelta(issue),
        financialImpact: reconciliationIssueImpact(issue),
        reason: issue.reason,
        recommendation: issue.recommendation,
        status: issue.status,
        connectWiseAdditionId: issue.connectWiseAdditionId,
        matchedAgreementAdditions: issue.matchedAgreementAdditions,
        adjustments: issue.adjustments,
        audit: issue.audit,
      });
      ticketsByVendor.set(issue.vendorId, existing);
    }

    setCreatingInvestigationTicket(true);
    try {
      const result = await createInvestigationTicketsRequest({
        customerId: ticketClient.customerId,
        customerName: ticketClient.customer,
        agreementId: ticketClient.agreementId,
        agreementName: ticketClient.agreement,
        companyId: hasCompanyId ? companyId : undefined,
        notes: ticketNotes,
        reconciliationMonth: currentReconciliationMonth(),
        tickets: [...ticketsByVendor.values()],
      });

      setIssues((currentIssues) =>
        currentIssues.map((issue) =>
          ticketIssueIds.includes(issue.id) ? { ...issue, status: 'blocked', owner: 'Investigation' } : issue,
        ),
      );

      const createdNumbers = result.tickets.map((ticket) => ticket.connectWiseTicketNumber).join(', ');
      const failureText =
        result.failures.length > 0
          ? ` Some vendors failed: ${result.failures.map((failure) => `${failure.vendorId} (${failure.error})`).join('; ')}`
          : '';
      window.alert(
        result.tickets.length > 0
          ? `Created investigation ticket${result.tickets.length === 1 ? '' : 's'}: ${createdNumbers}.${failureText}`
          : `Unable to create investigation tickets.${failureText}`,
      );
      if (result.tickets.length > 0) {
        setInvestigationTicketPresence((current) => {
          const next = { ...current };
          for (const ticket of result.tickets) {
            if (!ticket.customerName) {
              continue;
            }
            const key = investigationTicketPresenceKey(ticket.customerName, ticket.vendorId);
            next[key] = (next[key] ?? 0) + 1;
          }
          return next;
        });
      }
      closeTicketModal();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to create investigation tickets.');
    } finally {
      setCreatingInvestigationTicket(false);
    }
  };

  const openIntegrationModal = (integration: Integration) => {
    setSelectedIntegration(integration);
    setIntegrationTab('api');
    setIntegrationSaveMessage(null);
  };

  const importMappedInvoiceTable = async (
    integrationId: VendorKey,
    file: File,
    columnMap: InvoiceTableColumnMap,
    sourceType: IntegrationDataSourceType,
    importMode: InvoiceImportMode,
    syncMode: ManualImportSyncMode,
    linkedIntegrationId?: IntegrationId,
  ) => {
    const storageIntegrationId = linkedIntegrationId ?? integrationId;
    setImportingInvoice(true);
    setInvoiceImportLoadState('loading');
    setInvoiceImportMessage(
      `${importMode === 'overwrite' ? 'Overwriting' : 'Importing'} ${file.name} for ${vendorDisplayName(storageIntegrationId, vendorDatapoints)}...`,
    );
    setInvoiceExceptionReview(null);
    setInvoiceExceptionLoadState('idle');
    setInvoiceExceptionMessage('Select an invoice import to review exceptions.');

    try {
      const response = await importInvoiceTableFile(
        integrationId,
        file,
        columnMap,
        sourceType,
        importMode,
        syncMode,
        linkedIntegrationId,
      );
      setSelectedInvoiceIntegrationId(storageIntegrationId);
      const importsResponse = await fetchInvoiceImports(storageIntegrationId);
      const nextImportsResponse = {
        imports: sortInvoiceImports(importsResponse.imports),
      };
      invalidateCachedInvoiceImports(storageIntegrationId);
      cacheInvoiceImports(storageIntegrationId, nextImportsResponse);
      setInvoiceImports(nextImportsResponse.imports);
      setInvoiceImportLoadState('ready');
      setInvoiceImportMessage(
        `${importMode === 'overwrite' ? 'Overwrote' : 'Imported'} ${response.import.rowCount.toLocaleString()} ${vendorDisplayName(storageIntegrationId, vendorDatapoints)} table rows with ${response.import.exceptionRows.toLocaleString()} exceptions.`,
      );
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(storageIntegrationId) &&
        selectedReconciliationIntegrationSet.has(storageIntegrationId) &&
        reconciliationVendorIds.includes(storageIntegrationId)
      ) {
        void loadVendorReconciliation(storageIntegrationId);
      }
      return response.import;
    } catch (error) {
      setInvoiceImportLoadState('failed');
      setInvoiceImportMessage(error instanceof Error ? error.message : 'Unable to import mapped invoice table.');
      return null;
    } finally {
      setImportingInvoice(false);
    }
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

  const syncIntegration = async (integrationId: IntegrationId, target?: IntegrationSyncTarget) => {
    const actionKey = syncActionKey(integrationId, target);
    setBusyIntegrationAction(actionKey);
    setIntegrationActionMessages((messages) => ({
      ...messages,
      [integrationId]: syncStartingMessage(integrationId, target),
    }));

    try {
      const response = await fetch(`/api/integrations/${integrationId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncRequestBodyForIntegration(integrationId, target)),
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
      if (
        !queuedSync &&
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
      if (
        !queuedSync &&
        reconciliationComparisonRequested &&
        integrationId === 'connectwise' &&
        selectedReconciliationIntegrationIds.length > 0
      ) {
        await loadSelectedVendorReconciliations(selectedReconciliationIntegrationIds);
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
        await loadRawSyncDetails(
          selectedRawSyncIntegrationId,
          selectedRawSyncRunId,
          selectedRawSyncDataset,
          includeRawSyncRawPayload,
        );
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
    integrationId: VendorKey,
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
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Product mapping save failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveProductBundle = async (
    integrationId: VendorKey,
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
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
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

  const deactivateProductBundle = async (integrationId: VendorKey, bundleKey: string) => {
    const actionKey = `bundle:${bundleKey}`;
    setBusyMappingAction(actionKey);
    try {
      await deactivateProductBundleRequest(integrationId, bundleKey);
      await loadMappings(integrationId);
      setMappingMessage('Product bundle disabled.');
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Product bundle deactivation failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveProductLinkRule = async (
    integrationId: VendorKey,
    payload: {
      id?: string;
      sourceVendorProductKey: string;
      ruleName: string;
      sources: ProductLinkRuleSource[];
    },
  ) => {
    setBusyMappingAction(payload.id ? `link:${payload.id}` : 'link:new');
    try {
      await saveProductLinkRuleRequest(integrationId, {
        ...payload,
        active: true,
      });
      await loadMappings(integrationId);
      setMappingMessage(`Saved linked count rule for ${payload.sourceVendorProductKey}.`);
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
      return true;
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Linked count rule save failed.');
      return false;
    } finally {
      setBusyMappingAction(null);
    }
  };

  const setProductLinkRuleActive = async (integrationId: VendorKey, ruleId: string, active: boolean) => {
    const actionKey = `link:${ruleId}`;
    setBusyMappingAction(actionKey);
    try {
      await setProductLinkRuleActiveRequest(integrationId, ruleId, active);
      await loadMappings(integrationId);
      setMappingMessage(active ? 'Linked count rule re-enabled.' : 'Linked count rule disabled.');
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Linked count rule update failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const deleteProductLinkRule = async (integrationId: VendorKey, ruleId: string) => {
    const actionKey = `link-delete:${ruleId}`;
    setBusyMappingAction(actionKey);
    try {
      await deleteProductLinkRuleRequest(integrationId, ruleId);
      await loadMappings(integrationId);
      setMappingMessage('Linked count rule deleted.');
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Linked count rule deletion failed.');
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

  const saveLaborMapping = async (payload: Partial<LaborMapping>) => {
    setBusyMappingAction(payload.id ? `labor:${payload.id}` : 'labor:new');
    setMappingMessage('Saving labor mapping...');

    try {
      await saveLaborMappingRequest(selectedMappingIntegrationId, payload);
      await loadLaborMappingWorkspace(selectedMappingIntegrationId);
      setMappingLoadState('ready');
      setMappingMessage('Labor mapping saved.');
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to save labor mapping.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveInvestigationTicketMapping = async (payload: {
    boardId: number;
    boardName?: string | null;
    typeId: number;
    typeName?: string | null;
    subTypeId?: number | null;
    subTypeName?: string | null;
    statusId?: number | null | typeof INVESTIGATION_TICKET_STATUS_DEFAULT;
    statusName?: string | null;
    companyOverrideId?: number | null;
    companyOverrideName?: string | null;
  }) => {
    setBusyMappingAction('investigation-ticket-mapping');
    setMappingMessage('Saving investigation ticket mapping...');

    try {
      const response = await saveInvestigationTicketMappingRequest(selectedMappingIntegrationId, payload);
      setInvestigationTicketMapping(response.mapping);
      setMappingLoadState('ready');
      setMappingMessage('Investigation ticket mapping saved.');
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to save investigation ticket mapping.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveMappingReconciliationOption = async (enabled: boolean) => {
    const integration = integrations.find((item) => item.id === selectedMappingIntegrationId);
    if (!integration) {
      setMappingMessage('Select an integration before changing reconciliation options.');
      return;
    }

    setBusyMappingAction('reconciliation-options');
    setMappingMessage('Saving reconciliation options...');

    try {
      const nonSecrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(integration.nonSecrets)) {
        if (typeof value === 'string') {
          nonSecrets[key] = value;
        }
      }
      nonSecrets.endpoint = nonSecrets.endpoint ?? integration.endpoint;
      nonSecrets[doNotSuggestNewAdditionsSettingKey] = enabled ? 'true' : 'false';

      const response = await fetch(`/api/integrations/${encodeURIComponent(integration.id)}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          integrationId: integration.id,
          nonSecrets,
          secrets: {},
        } satisfies IntegrationSettingsPayload),
      });
      const body = await responseJson(response);
      if (!response.ok) {
        throw new Error(String(body.error ?? `Settings save failed with HTTP ${response.status}.`));
      }

      await refreshRuntimeIntegrations();
      setMappingLoadState('ready');
      setMappingMessage(
        enabled
          ? 'Reconciliation will only track existing agreement additions for this integration.'
          : 'Reconciliation can suggest new agreement additions again for this integration.',
      );
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(selectedMappingIntegrationId) &&
        selectedReconciliationIntegrationSet.has(selectedMappingIntegrationId) &&
        reconciliationVendorIds.includes(selectedMappingIntegrationId)
      ) {
        await loadVendorReconciliation(selectedMappingIntegrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Unable to save reconciliation options.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const saveUsageOverride = async (integrationId: VendorKey, payload: CreateUsageOverridePayload) => {
    setBusyMappingAction('override:create');
    try {
      await createUsageOverrideRequest(integrationId, payload);
      await loadUsageOverrides(integrationId);
      setMappingMessage('Saved usage override.');
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
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

  const deactivateUsageOverride = async (integrationId: VendorKey, overrideId: string) => {
    const actionKey = `override:${overrideId}`;
    setBusyMappingAction(actionKey);
    try {
      await deactivateUsageOverrideRequest(integrationId, overrideId);
      await loadUsageOverrides(integrationId);
      setMappingMessage('Usage override removed.');
      if (
        reconciliationComparisonRequested &&
        isRegistryIntegrationId(integrationId) &&
        selectedReconciliationIntegrationSet.has(integrationId) &&
        reconciliationVendorIds.includes(integrationId)
      ) {
        await loadVendorReconciliation(integrationId);
      }
    } catch (error) {
      setMappingLoadState('failed');
      setMappingMessage(error instanceof Error ? error.message : 'Usage override removal failed.');
    } finally {
      setBusyMappingAction(null);
    }
  };

  const queueLessIncludedUpdate = async (issue: ReconcileIssue, quantity: number) => {
    setIssues((currentIssues) =>
      currentIssues.map((currentIssue) =>
        currentIssue.id === issue.id
          ? {
              ...currentIssue,
              proposedLessIncluded: quantity,
              lessIncludedTouched: true,
              selectedCountSource: reconciliationCountSource(currentIssue),
              status: 'approved',
              owner: 'Finance',
              appliedUpdate: undefined,
            }
          : currentIssue,
      ),
    );
    setManualOverrideMessage('Less Included Qty queued for review.');
    setManualOverrideIssue(null);
    return true;
  };

  const queueManualTotalUpdate = async (issue: ReconcileIssue, quantity: number) => {
    setIssues((currentIssues) =>
      currentIssues.map((currentIssue) =>
        currentIssue.id === issue.id
          ? {
              ...currentIssue,
              manualOverrideTotal: quantity,
              manualOverrideTotalTouched: true,
              selectedCountSource: 'manual',
              status: 'approved',
              owner: 'Finance',
              appliedUpdate: undefined,
            }
          : currentIssue,
      ),
    );
    setManualOverrideMessage('Manual override total queued for review.');
    setManualOverrideIssue(null);
    return true;
  };

  const applyReviewedAgreementUpdates = async (selectedIssueIds: string[]) => {
    const selectedIds = new Set(selectedIssueIds);
    const queuedIssues = issues.filter((issue) => issue.status === 'approved');
    const updates = queuedIssues
      .filter((issue) => selectedIds.has(issue.id) && isApplyEligibleIssue(issue))
      .map((issue) => buildAgreementAdditionUpdatePayload(issue))
      .filter((payload): payload is AgreementAdditionUpdatePayload => Boolean(payload));
    const discardedUpdates = queuedIssues
      .filter((issue) => !selectedIds.has(issue.id) || !isApplyEligibleIssue(issue))
      .map((issue) => buildAgreementAdditionUpdatePayload(issue, { allowUnselected: true }))
      .filter((payload): payload is AgreementAdditionUpdatePayload => Boolean(payload));

    if (updates.length === 0 && discardedUpdates.length === 0) {
      setAgreementUpdateMessage('No queued changes are ready to review.');
      return null;
    }

    setApplyingAgreementUpdates(true);
    setAgreementUpdateMessage('Applying reviewed ConnectWise changes...');

    try {
      const response = await applyAgreementAdditionUpdatesRequest(updates, discardedUpdates);
      const resultsByLineId = new Map(response.items.map((item) => [item.sourceLineId, item]));
      const writtenResultsByAdditionId = new Map(
        response.items
          .filter((item) => item.status === 'written')
          .map((item) => [item.connectWiseAdditionId, item] as const),
      );

      if (writtenResultsByAdditionId.size > 0) {
        setAgreementAdditions((currentAdditions) =>
          applyAgreementUpdateResultsToAdditions(currentAdditions, writtenResultsByAdditionId),
        );
        setAgreementAdditionsByAgreement((currentCache) =>
          Object.fromEntries(
            Object.entries(currentCache).map(([agreementId, additions]) => [
              agreementId,
              applyAgreementUpdateResultsToAdditions(additions, writtenResultsByAdditionId),
            ]),
          ),
        );
      }

      setIssues((currentIssues) =>
        currentIssues.map((issue) => {
          const result = resultsByLineId.get(issue.id);
          if (!result) {
            return issue;
          }

          if (result.status === 'written') {
            const selectedCountSource = reconciliationCountSource(issue);
            return {
              ...issue,
              invoiceCount: result.proposedQuantity,
              proposedCount: result.proposedQuantity,
              selectedCountSource,
              baseStatus: 'matched',
              status: 'updated',
              reason: 'ConnectWise agreement addition update applied.',
              recommendation: 'ConnectWise was updated in this reconciliation run.',
              manualOverrideTotal: selectedCountSource === 'manual' ? result.proposedQuantity : undefined,
              manualOverrideTotalTouched: selectedCountSource === 'manual',
              proposedLessIncluded: undefined,
              lessIncludedTouched: false,
              appliedUpdate: {
                quantityDelta: result.proposedQuantity - result.currentQuantity,
                lessIncludedDelta: result.lessIncludedChanged
                  ? (result.proposedLessIncluded ?? 0) - result.currentLessIncluded
                  : undefined,
                appliedAt: new Date().toISOString(),
              },
              matchedAgreementAdditions: issue.matchedAgreementAdditions.map((addition) =>
                addition.connectWiseAdditionId === result.connectWiseAdditionId
                  ? {
                      ...addition,
                      quantity: result.proposedQuantity,
                      lessIncluded: result.lessIncludedChanged
                        ? result.proposedLessIncluded ?? 0
                        : addition.lessIncluded,
                    }
                  : addition,
              ),
            };
          }

          if (result.status === 'discarded') {
            return {
              ...issue,
              status: restoredReconciliationStatus(issue),
              manualOverrideTotal: undefined,
              manualOverrideTotalTouched: false,
              proposedLessIncluded: undefined,
              lessIncludedTouched: false,
              appliedUpdate: undefined,
            };
          }

          return {
            ...issue,
            status: 'blocked',
            recommendation: result.error ?? 'ConnectWise update failed.',
            reason: result.error ?? issue.reason,
            appliedUpdate: undefined,
          };
        }),
      );
      setReviewingAgreementUpdates(false);
      setAgreementUpdateMessage(
        `Applied ${response.summary.written.toLocaleString()}, discarded ${response.summary.discarded.toLocaleString()}, failed ${response.summary.failed.toLocaleString()}.`,
      );
      return response;
    } catch (error) {
      setAgreementUpdateMessage(error instanceof Error ? error.message : 'Unable to apply ConnectWise changes.');
      return null;
    } finally {
      setApplyingAgreementUpdates(false);
    }
  };

  const remapReconciliationDevices = async (
    issue: ReconcileIssue,
    remaps: Array<{ device: ReconciliationDevice; targetVendorProductKey: string }>,
  ) => {
    const pending = remaps.filter((entry) => entry.targetVendorProductKey.trim().length > 0);
    if (pending.length === 0) {
      setManualOverrideMessage('Select a new product for at least one device before saving.');
      return false;
    }

    setSavingManualOverride(true);
    setManualOverrideMessage(
      pending.length === 1 ? 'Saving device remap...' : `Saving ${pending.length.toLocaleString()} device remaps...`,
    );

    try {
      const applied: Array<{ device: ReconciliationDevice; targetVendorProductKey: string }> = [];
      const productOptions = reconciliationProductOptionsByVendor[issue.vendorId] ?? [];

      for (const { device, targetVendorProductKey } of pending) {
        const sourceVendorProductKey = device.vendorProductKey;
        if (!sourceVendorProductKey) {
          throw new Error(`${deviceDisplayName(device)} does not have a source product key to remap.`);
        }

        const dimensionFilters = deviceIdentityFilter(device);
        if (Object.keys(dimensionFilters).length === 0) {
          throw new Error(
            `${deviceDisplayName(device)} needs a hostname, account ID, or other stable identifier before it can be remapped.`,
          );
        }

        await createUsageOverrideRequest(issue.vendorId, {
          customerId: issue.clientId,
          agreementId: issue.agreementId,
          sourceVendorProductKey,
          targetVendorProductKey,
          dimensionFilters,
          reason: `Remapped from ${device.productName} in reconciliation review.`,
        });
        applied.push({ device, targetVendorProductKey });
      }

      setManualOverrideMessage(
        applied.length === 1
          ? 'Device remap saved.'
          : `${applied.length.toLocaleString()} device remaps saved.`,
      );
      setIssues((currentIssues) => applyDeviceRemapsToIssues(currentIssues, issue, applied, productOptions));
      setManualOverrideIssue(null);
      return true;
    } catch (error) {
      setManualOverrideMessage(error instanceof Error ? error.message : 'Device remap failed.');
      return false;
    } finally {
      setSavingManualOverride(false);
    }
  };

  const saveReconciliationAdditionPin = async (
    issue: ReconcileIssue,
    addition: ReconciliationMatchedAgreementAddition | AgreementAddition,
  ) => {
    const vendorProductKey = issue.vendorProductKey;
    if (!vendorProductKey) {
      setManualOverrideMessage('This row does not have a vendor product key to pin.');
      return false;
    }

    setSavingManualOverride(true);
    setManualOverrideMessage('Saving agreement addition pin...');

    try {
      await saveAdditionPinRequest(issue.vendorId, {
        customerId: issue.clientId,
        agreementId: issue.agreementId,
        vendorProductKey,
        connectWiseAdditionId: addition.connectWiseAdditionId,
        connectwiseProductCode: addition.productCode,
        connectwiseProductName: addition.productName,
      });
      setIssues((currentIssues) =>
        currentIssues.map((current) =>
          current.id === issue.id
            ? {
                ...current,
                connectWiseAdditionId: addition.connectWiseAdditionId,
                invoiceCount: addition.quantity,
                unitPriceAmount: addition.unitPrice?.amount ?? current.unitPriceAmount,
                unitPriceCurrency: addition.unitPrice?.currency ?? current.unitPriceCurrency,
                matchedAgreementAdditions: [
                  {
                    id: addition.id,
                    agreementId: issue.agreementId,
                    connectWiseAdditionId: addition.connectWiseAdditionId,
                    productCode: addition.productCode,
                    productName: addition.productName,
                    quantity: addition.quantity,
                    unitPrice: addition.unitPrice,
                    lessIncluded: addition.lessIncluded,
                    billedQuantity: addition.billedQuantity,
                    additionStatus: addition.additionStatus,
                    updatedAt: addition.updatedAt,
                  },
                ],
                amount:
                  typeof (addition.unitPrice?.amount ?? current.unitPriceAmount) === 'number'
                    ? (reconciliationSelectedCount(current) - addition.quantity) *
                      (addition.unitPrice?.amount ?? current.unitPriceAmount ?? 0)
                    : current.amount,
              }
            : current,
        ),
      );
      setManualOverrideMessage(`Pinned ${issue.unit || vendorProductKey} to CW ${addition.connectWiseAdditionId}. Re-run compare to refresh all rows.`);
      return true;
    } catch (error) {
      setManualOverrideMessage(error instanceof Error ? error.message : 'Addition pin failed.');
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
                  href={urlForView(item.id, selectedMappingIntegrationId, settingsSection)}
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
                href={urlForView(item.id, selectedMappingIntegrationId, settingsSection)}
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
            <span className="section-kicker">Vendor API, invoice tables, and ConnectWise additions</span>
            <h1>{view === 'reconcile' ? 'Reconciliation command center' : pageTitle(view, settingsSection)}</h1>
          </div>
          <div className="top-actions">
            {view === 'reconcile' ? (
              queuedAgreementUpdateIssues.length > 0 ? (
                <button
                  className="button primary"
                  disabled={applyingAgreementUpdates}
                  onClick={() => setReviewingAgreementUpdates(true)}
                  type="button"
                >
                  <ListChecks size={18} />
                  {applyingAgreementUpdates
                    ? 'Applying'
                    : `Review & Apply (${queuedAgreementUpdateIssues.length.toLocaleString()})`}
                </button>
              ) : null
            ) : view === 'invoices' ? (
              <button
                className="button secondary"
                onClick={() => {
                  setShowInvoiceImportPanel(true);
                  void loadInvoiceImports(selectedInvoiceIntegrationId);
                }}
                type="button"
              >
                <Upload size={18} />
                Import invoices
              </button>
            ) : null}
          </div>
        </header>

        <main className={view === 'reconcile' ? 'content reconcile-content' : 'content'}>
          {view === 'reconcile' && (
            <ReconcileView
              approveClient={approveClient}
              approveIssue={approveIssue}
              agreementUpdateMessage={agreementUpdateMessage}
              clientGroups={clientGroups}
              connectWiseSyncSummary={connectWiseSyncSummary}
              exportingReport={exportingReconciliationReport}
              expandedClientNames={expandedClientNames}
              filteredIssues={filteredIssues}
              issues={issues}
              needsReviewOnly={needsReviewOnly}
              onCountSourceSelect={selectIssueCountSource}
              onExportReport={exportSelectedReconciliationReport}
              onManualOverride={(issue) => {
                setManualOverrideIssue(issue);
                setManualOverrideMessage('');
              }}
              onOpenAgreementAdditions={(client) => void openAgreementAdditionsModal(client)}
              onOpenTicket={openTicketModal}
              onOpenInvestigationTickets={(selection) => setInvestigationTicketsSelection(selection)}
              investigationTicketPresence={investigationTicketPresence}
              onLoadVendorData={loadCustomerVendorData}
              busyIntegrationAction={busyIntegrationAction}
              connectWiseLastSync={connectWiseIntegration?.lastSync ?? 'Never'}
              integrationActionMessages={integrationActionMessages}
              onCompareReconciliation={() => loadSelectedVendorReconciliations(selectedReconciliationIntegrationIds)}
              onSyncIntegration={(integrationId) => {
                if (integrationId === 'microsoft-365') {
                  void syncIntegration(integrationId, 'licenses');
                  return;
                }
                if (integrationId === 'datto') {
                  void syncIntegration(integrationId, 'datto-saas-bcdr');
                  return;
                }
                void syncIntegration(integrationId);
              }}
              onReconciliationSourceToggle={(integrationId) => {
                const nextSelectedIds = selectedReconciliationIntegrationIds.includes(integrationId)
                  ? selectedReconciliationIntegrationIds.filter((selectedId) => selectedId !== integrationId)
                  : [...selectedReconciliationIntegrationIds, integrationId];
                setSelectedReconciliationIntegrationIds(nextSelectedIds);
                setVendorFilter('All');
                setIssues([]);
                setReconciliationRunMetaByVendor({});
                setReconciliationProductOptionsByVendor({});
                setInvestigationTicketPresence({});
                setExpandedClientNames([]);
                setReconciliationComparisonRequested(false);
                setReconciliationLoadState('idle');
                setReconciliationMessage(
                  nextSelectedIds.length > 0
                    ? 'Click Compare to load selected vendors.'
                    : 'Choose one or more vendors.',
                );
              }}
              pendingCount={pendingCount}
              query={query}
              reconciliationLoadState={reconciliationLoadState}
              reconciliationIntegrations={enabledReconciliationVendors}
              reconciliationMessage={reconciliationMessage}
              selectedReconciliationIntegrationIds={selectedReconciliationIntegrationIds}
              setExpandedClientNames={setExpandedClientNames}
              setNeedsReviewOnly={setNeedsReviewOnly}
              setQuery={setQuery}
              setVendorFilter={setVendorFilter}
              skipIssue={skipIssue}
              totalExposure={totalExposure}
              vendorDataSummary={vendorDataSummary}
              vendorInvoiceSummary={vendorInvoiceSummary}
              vendorFilter={vendorFilter}
            />
          )}
          {view === 'discrepancies' && (
            <DiscrepancyDashboardView
              basisFilter={selectedDiscrepancyBasis}
              customerFilter={selectedDiscrepancyCustomerId}
              includeMatched={includeMatchedDiscrepancies}
              loadMessage={discrepancyMessage}
              loadState={discrepancyLoadState}
              onBasisFilterChange={setSelectedDiscrepancyBasis}
              onCustomerFilterChange={setSelectedDiscrepancyCustomerId}
              onIncludeMatchedChange={setIncludeMatchedDiscrepancies}
              onPairFilterChange={setSelectedDiscrepancyPairId}
              onRefresh={loadDiscrepancyReport}
              onRowSelect={setSelectedDiscrepancyRow}
              onSeverityFilterChange={setSelectedDiscrepancySeverity}
              pairFilter={selectedDiscrepancyPairId}
              report={discrepancyReport}
              severityFilter={selectedDiscrepancySeverity}
            />
          )}
          {view === 'integrations' && (
            <IntegrationsView
              actionMessages={integrationActionMessages}
              busyAction={busyIntegrationAction}
              busyInvoiceReviewAction={busyInvoiceExceptionAction}
              invoiceCustomerOptions={invoiceExceptionCustomerOptions}
              invoiceImportIntegrations={invoiceImportIntegrations}
              invoiceImportMode={invoiceImportMode}
              invoiceImports={invoiceImports}
              invoiceImporting={importingInvoice}
              invoiceLoadState={invoiceImportLoadState}
              invoiceMessage={invoiceImportMessage}
              invoiceReview={invoiceExceptionReview}
              invoiceReviewLoadState={invoiceExceptionLoadState}
              invoiceReviewMessage={invoiceExceptionMessage}
              loadMessage={integrationLoadMessage}
              loadState={integrationLoadState}
              integrations={integrations}
              onConfigure={openIntegrationModal}
              onInvoiceAccountMappingSave={saveInvoiceExceptionAccountMapping}
              onInvoiceCloseReview={closeInvoiceExceptionReview}
              onInvoiceIntegrationChange={(integrationId) => {
                setSelectedInvoiceIntegrationId(integrationId);
                closeInvoiceExceptionReview();
              }}
              onInvoiceProductCatalogSearch={(query) => {
                const vendorId = invoiceExceptionReview?.import.vendorId ?? selectedInvoiceIntegrationId;
                return searchProductCatalog(vendorId || 'custom-table', query);
              }}
              onInvoiceProductMappingSave={saveInvoiceExceptionProductMapping}
              onInvoiceRefreshReview={reloadInvoiceExceptionReview}
              onInvoiceReviewImport={openInvoiceExceptionReview}
              onInvoiceTableUpload={importMappedInvoiceTable}
              onInvoiceUpload={importVendorInvoice}
              onOpenMappings={(integrationId) => {
                selectMappingIntegration(integrationId);
                navigateToView('mappings', integrationId);
              }}
              onRefresh={refreshRuntimeIntegrations}
              selectedInvoiceIntegrationId={selectedInvoiceIntegrationId}
              setInvoiceImportMode={setInvoiceImportMode}
              onSync={syncIntegration}
              onTest={testIntegration}
              vendorDatapoints={vendorDatapoints}
              vendorDatapointLoadState={vendorDatapointLoadState}
              vendorDatapointMessage={vendorDatapointMessage}
              selectedVendorDatapointId={selectedVendorDatapointId}
              onCreateVendorDatapoint={() => setShowCreateVendorDatapoint(true)}
              onEditVendorDatapoint={setEditingVendorDatapointId}
              onSelectVendorDatapoint={setSelectedVendorDatapointId}
              onImportVendorDatapoint={importVendorDatapoint}
              onSaveVendorDatapointMapping={saveVendorDatapointMapping}
              onDeleteDatapointImport={deleteDatapointImport}
              onUpdateVendorDatapoint={updateVendorDatapoint}
            />
          )}
          {showCreateVendorDatapoint ? (
            <CreateVendorDatapointModal
              integrations={integrations}
              onClose={() => setShowCreateVendorDatapoint(false)}
              onCreate={createVendorDatapoint}
            />
          ) : null}
          {editingVendorDatapointId ? (
            <EditVendorDatapointModal
              datapoint={vendorDatapoints.find((item) => item.id === editingVendorDatapointId)}
              integrations={integrations}
              onClose={() => setEditingVendorDatapointId(null)}
              onUpdate={updateVendorDatapoint}
            />
          ) : null}
          {view === 'mappings' && (
            <MappingsView
              busyAction={busyMappingAction}
              integrations={integrations}
              loadMessage={mappingMessage}
              loadState={mappingLoadState}
              mappingState={mappingState}
              ncentralFilterMappings={ncentralFilterMappings}
              ncentralFilters={ncentralFilters}
              laborBoards={laborBoards}
              laborClassificationMessage={laborClassificationMessage}
              laborMappings={laborMappings}
              investigationTicketMapping={investigationTicketMapping}
              onAccountApprove={approveAccountCandidate}
              onAccountManualSave={saveManualAccountMapping}
              onApproveSuggested={() => runMappingAction('approve-suggested')}
              onAutomap={() => runMappingAction('automap')}
              onIntegrationChange={(integrationId) => {
                selectMappingIntegration(integrationId);
                updateRouteForView('mappings', integrationId);
              }}
              onProductTargetsSave={saveProductTargets}
              onProductBundleDeactivate={deactivateProductBundle}
              onProductBundleSave={saveProductBundle}
              onProductLinkRuleActiveChange={setProductLinkRuleActive}
              onProductLinkRuleDelete={deleteProductLinkRule}
              onProductLinkRuleSave={saveProductLinkRule}
              onRefresh={() => refreshMappingWorkspace(selectedMappingIntegrationId)}
              onNcentralFilterMappingSave={saveNcentralFilterMapping}
              onLaborMappingSave={saveLaborMapping}
              onInvestigationTicketMappingSave={saveInvestigationTicketMapping}
              onReconciliationOptionChange={saveMappingReconciliationOption}
              onUsageOverrideCreate={saveUsageOverride}
              onUsageOverrideDeactivate={deactivateUsageOverride}
              selectedIntegrationId={selectedMappingIntegrationId}
              usageOverrides={usageOverrides}
              vendorDatapoints={vendorDatapoints}
            />
          )}
          {view === 'reports' && reportSection === 'raw-sync' && (
            <ReportsView
              columnFilters={rawSyncColumnFilters}
              details={rawSyncDetails}
              includeRawPayload={includeRawSyncRawPayload}
              integrations={rawSyncReportIntegrations}
              loadMessage={rawSyncMessage}
              loadState={rawSyncLoadState}
              onColumnFilterChange={(column, value) =>
                setRawSyncColumnFilters((filters) => {
                  if (value.trim().length === 0) {
                    const { [column]: _removed, ...nextFilters } = filters;
                    return nextFilters;
                  }

                  return {
                    ...filters,
                    [column]: value,
                  };
                })
              }
              onIntegrationChange={(integrationId) => {
                setSelectedRawSyncIntegrationId(integrationId);
                setSelectedRawSyncDataset('users');
                setIncludeRawSyncRawPayload(false);
                setRawSyncRuns([]);
                setSelectedRawSyncRunId('');
                setRawSyncDetails(null);
                setRawSyncColumnFilters({});
                setRawSyncMessage(integrationId ? 'Loading raw sync dates...' : 'Select an integration to view saved raw sync rows.');
              }}
              onDatasetChange={(dataset) => {
                setSelectedRawSyncDataset(dataset);
                setIncludeRawSyncRawPayload(false);
                setRawSyncDetails(null);
                setRawSyncColumnFilters({});
                setRawSyncMessage(selectedRawSyncRunId ? 'Loading raw sync details...' : 'Select a sync date to load raw rows.');
              }}
              onIncludeRawPayloadChange={setIncludeRawSyncRawPayload}
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
          {view === 'reports' && reportSection === 'customer-license' && (
            <CustomerLicenseReportView
              customers={customerLicenseCustomers}
              includeMicrosoftUserDetails={includeMicrosoftUserDetails}
              loadMessage={customerLicenseMessage}
              loadState={customerLicenseLoadState}
              onCustomerChange={(customerId) => {
                setSelectedCustomerLicenseCustomerId(customerId);
                setCustomerLicenseReport(null);
                setCustomerLicenseMessage(customerId ? 'Generate the report for the selected customer.' : 'Select a customer before generating the report.');
              }}
              onGenerate={generateCustomerLicenseReport}
              onIncludeMicrosoftUserDetailsChange={(value) => {
                setIncludeMicrosoftUserDetails(value);
                setCustomerLicenseReport(null);
                setCustomerLicenseMessage(value ? 'Generate again to include Microsoft 365 licensed user details.' : 'Generate again to refresh the report.');
              }}
              onRefreshCustomers={loadCustomerLicenseCustomers}
              onVendorChange={(vendorId) => {
                setSelectedCustomerLicenseVendorId(vendorId);
                setCustomerLicenseReport(null);
                if (vendorId !== 'microsoft-365' && vendorId !== 'all') {
                  setIncludeMicrosoftUserDetails(false);
                }
                setCustomerLicenseMessage('Generate the report for the selected scope.');
              }}
              report={customerLicenseReport}
              selectedCustomerId={selectedCustomerLicenseCustomerId}
              selectedVendorId={selectedCustomerLicenseVendorId}
              vendorOptions={customerLicenseVendorIds}
            />
          )}
          {view === 'invoices' && (
            <InvoicesView
              importUtility={
                <ImportsView
                  busyReviewAction={busyInvoiceExceptionAction}
                  customerOptions={invoiceExceptionCustomerOptions}
                  importing={importingInvoice}
                  importMode={invoiceImportMode}
                  imports={invoiceImports}
                  integrations={invoiceImportIntegrations}
                  loadState={invoiceImportLoadState}
                  message={invoiceImportMessage}
                  onAccountMappingSave={saveInvoiceExceptionAccountMapping}
                  onCloseReview={closeInvoiceExceptionReview}
                  onProductCatalogSearch={(query) =>
                    searchProductCatalog(invoiceExceptionReview?.import.vendorId ?? 'opentext-appriver', query)
                  }
                  onProductMappingSave={saveInvoiceExceptionProductMapping}
                  onRefreshReview={reloadInvoiceExceptionReview}
                  onReviewImport={openInvoiceExceptionReview}
                  onTableUpload={importMappedInvoiceTable}
                  onUpload={importVendorInvoice}
                  onVendorChange={(integrationId) => {
                    setSelectedInvoiceIntegrationId(integrationId);
                    closeInvoiceExceptionReview();
                  }}
                  review={invoiceExceptionReview}
                  reviewLoadState={invoiceExceptionLoadState}
                  reviewMessage={invoiceExceptionMessage}
                  selectedVendorId={selectedInvoiceIntegrationId}
                  setImportMode={setInvoiceImportMode}
                  vendorDatapoints={vendorDatapoints}
                />
              }
              monthlyCandidates={monthlyInvoiceCandidates}
              monthlyLoadMessage={monthlyInvoiceMessage}
              monthlyLoadState={monthlyInvoiceLoadState}
              monthlyPreview={monthlyInvoicePreview}
              monthlyPreviewBusyId={monthlyInvoicePreviewBusyId}
              noticeBusyKey={invoiceNoticeBusyKey}
              noticeMessage={invoiceNoticeMessage}
              noticeResult={invoiceNoticeResult}
              onCloseImportPanel={() => setShowInvoiceImportPanel(false)}
              onCloseNoticePreview={() => {
                setInvoiceNoticeResult(null);
                setInvoiceNoticeMessage('');
              }}
              onConfirmNotice={confirmInvoiceNotice}
              onTestNotice={testInvoiceNotice}
              onImportInvoices={() => {
                setShowInvoiceImportPanel(true);
                void loadInvoiceImports(selectedInvoiceIntegrationId);
              }}
              onMonthlyPreview={previewMonthlyInvoice}
              onNoticePreview={previewInvoiceNotice}
              onOpenBulkNoticeConfirm={openBulkNoticeConfirm}
              onCloseBulkNoticeConfirm={() => {
                setBulkNoticeCustomers(null);
                setBulkNoticeMessage('');
              }}
              onConfirmBulkNotices={confirmBulkInvoiceNotices}
              onTestBulkNotices={testBulkInvoiceNotices}
              bulkNoticeBusy={bulkNoticeBusy}
              bulkNoticeCustomers={bulkNoticeCustomers}
              bulkNoticeMessage={bulkNoticeMessage}
              selectedOverdueCustomerKeys={selectedOverdueCustomerKeys}
              onSelectedOverdueCustomerKeysChange={setSelectedOverdueCustomerKeys}
              onRefreshAll={refreshInvoiceWorkspace}
              onTabChange={setInvoiceWorkspaceTab}
              overdueInvoices={overdueInvoices}
              overdueLoadMessage={overdueInvoiceMessage}
              overdueLoadState={overdueInvoiceLoadState}
              refreshing={
                invoiceImportLoadState === 'loading' ||
                overdueInvoiceLoadState === 'loading' ||
                monthlyInvoiceLoadState === 'loading' ||
                standardInvoiceLoadState === 'loading'
              }
              selectedTab={invoiceWorkspaceTab}
              showImportPanel={showInvoiceImportPanel}
              standardCandidates={standardInvoiceCandidates}
              standardLoadMessage={standardInvoiceMessage}
              standardLoadState={standardInvoiceLoadState}
            />
          )}
          {view === 'agreements' && (
            <AgreementsView
              autoPost={autoPost}
              productFilter={productFilter}
              setAutoPost={setAutoPost}
              setProductFilter={setProductFilter}
              visibleRules={visibleRules}
            />
          )}
          {view === 'settings' && (
            <SettingsPageView
              onNavigateToIntegrations={() => navigateToView('integrations')}
              onSectionChange={navigateToSettingsSection}
              section={settingsSection}
            />
          )}
        </main>
      </div>

      {ticketClient && (
        <TicketModal
          client={ticketClient}
          creating={creatingInvestigationTicket}
          notes={ticketNotes}
          onClose={closeTicketModal}
          onCreate={() => void createInvestigationTicket()}
          onNotesChange={setTicketNotes}
          onToggleIssue={toggleTicketIssue}
          selectedIssueIds={ticketIssueIds}
        />
      )}
      {investigationTicketsSelection ? (
        <InvestigationTicketsModal
          customer={investigationTicketsSelection.customer}
          onClose={() => setInvestigationTicketsSelection(null)}
          reconciliationMonth={currentReconciliationMonth()}
          vendor={investigationTicketsSelection.vendor}
          vendorId={investigationTicketsSelection.vendorId}
        />
      ) : null}
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
      {reviewingAgreementUpdates ? (
        <AgreementUpdateReviewModal
          applying={applyingAgreementUpdates}
          issues={queuedAgreementUpdateIssues}
          message={agreementUpdateMessage}
          onApply={(selectedIssueIds) => void applyReviewedAgreementUpdates(selectedIssueIds)}
          onClose={() => setReviewingAgreementUpdates(false)}
        />
      ) : null}
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
          agreementAdditions={
            agreementAdditionsSelection?.agreementId === manualOverrideIssue.agreementId
              ? agreementAdditions
              : manualOverrideIssue.matchedAgreementAdditions
          }
          issue={manualOverrideIssue}
          message={manualOverrideMessage}
          onClose={() => {
            setManualOverrideIssue(null);
            setManualOverrideMessage('');
          }}
          onAdditionPinSave={saveReconciliationAdditionPin}
          onLessCountSave={queueLessIncludedUpdate}
          onManualTotalSave={queueManualTotalUpdate}
          onDeviceRemapsSave={remapReconciliationDevices}
          onLoadAgreementAdditions={async () => {
            if (
              agreementAdditionsSelection?.agreementId === manualOverrideIssue.agreementId &&
              agreementAdditions.length > 0
            ) {
              return agreementAdditions;
            }
            const response = await fetchAgreementAdditions(manualOverrideIssue.agreementId);
            return response.additions;
          }}
          productOptions={reconciliationProductOptionsByVendor[manualOverrideIssue.vendorId] ?? []}
          saving={savingManualOverride}
        />
      )}
      {selectedDiscrepancyRow ? (
        <DiscrepancyDetailModal
          onClose={() => setSelectedDiscrepancyRow(null)}
          row={selectedDiscrepancyRow}
        />
      ) : null}
    </div>
  );
}

function pageTitle(view: View, settingsSection: SettingsSection = defaultSettingsSection) {
  switch (view) {
    case 'discrepancies':
      return 'Discrepancy dashboard';
    case 'integrations':
      return 'Integrations';
    case 'mappings':
      return 'Mappings';
    case 'reports':
      return 'Reporting';
    case 'invoices':
      return 'Invoices';
    case 'agreements':
      return 'Agreement workspace';
    case 'settings':
      if (settingsSection === 'audit-logs') {
        return 'Audit logs';
      }
      if (settingsSection === 'integrations') {
        return 'Integrations settings';
      }
      if (settingsSection === 'email-communication') {
        return 'Email communication';
      }
      return 'User management';
    default:
      return 'Reconciliation command center';
  }
}

function DiscrepancyDashboardView(props: {
  basisFilter: 'all' | DiscrepancyBasis;
  customerFilter: string;
  includeMatched: boolean;
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onBasisFilterChange: (basis: 'all' | DiscrepancyBasis) => void;
  onCustomerFilterChange: (customerId: string) => void;
  onIncludeMatchedChange: (value: boolean) => void;
  onPairFilterChange: (pairId: string) => void;
  onRefresh: () => Promise<DiscrepancyReportResponse | null>;
  onRowSelect: (row: DiscrepancyRow) => void;
  onSeverityFilterChange: (severity: DiscrepancyFilterValue) => void;
  pairFilter: string;
  report: DiscrepancyReportResponse | null;
  severityFilter: DiscrepancyFilterValue;
}) {
  const {
    basisFilter,
    customerFilter,
    includeMatched,
    loadMessage,
    loadState,
    onBasisFilterChange,
    onCustomerFilterChange,
    onIncludeMatchedChange,
    onPairFilterChange,
    onRefresh,
    onRowSelect,
    onSeverityFilterChange,
    pairFilter,
    report,
    severityFilter,
  } = props;
  const rows = useMemo(
    () =>
      (report?.rows ?? []).filter((row) =>
        pairFilter === 'all' ? true : row.comparisonPair.id === pairFilter,
      ),
    [pairFilter, report],
  );
  const groupedRows = useMemo(() => groupDiscrepancyRowsByCustomer(rows), [rows]);
  const pairOptions = report?.comparisonPairs ?? [];
  const customers = report?.customers ?? [];
  const generatedAt = formatDateTime(report?.generatedAt);

  return (
    <section className="discrepancy-page" aria-label="Discrepancy dashboard">
      <div className="integrations-live-bar report-reminder">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Dashboard issue' : loadState === 'loading' ? 'Comparing sources' : 'Vendor discrepancies'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{generatedAt ? `Generated ${generatedAt}` : 'Latest complete syncs'}</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <section className="metric-grid discrepancy-metrics" aria-label="Discrepancy summary">
        <MetricCard icon={Link2} label="Open discrepancies" tone="warn" value={formatCount(report?.summary.openDiscrepancyCount ?? 0)} />
        <MetricCard icon={Database} label="Device gaps" tone="ready" value={formatCount(report?.summary.deviceGapCount ?? 0)} />
        <MetricCard icon={Users} label="User gaps" tone="money" value={formatCount(report?.summary.userGapCount ?? 0)} />
        <MetricCard icon={Activity} label="Unavailable / stale" tone="approved" value={`${formatCount(report?.summary.unavailableCount ?? 0)} / ${formatCount(report?.summary.staleSourceCount ?? 0)}`} />
      </section>

      <section className="toolbar reports-toolbar discrepancy-toolbar" aria-label="Discrepancy filters">
        <label className="config-field report-select">
          <span>Customer</span>
          <select onChange={(event) => onCustomerFilterChange(event.target.value)} value={customerFilter}>
            <option value="all">All customers</option>
            {customers.map((customer) => (
              <option key={customer.customerId} value={customer.customerId}>
                {customer.customerName}
              </option>
            ))}
          </select>
        </label>
        <label className="config-field report-select">
          <span>Comparison</span>
          <select onChange={(event) => onPairFilterChange(event.target.value)} value={pairFilter}>
            <option value="all">All comparisons</option>
            {pairOptions.map((pair) => (
              <option key={pair.id} value={pair.id}>
                {pair.label}
              </option>
            ))}
          </select>
        </label>
        <label className="config-field compact-filter">
          <span>Basis</span>
          <select onChange={(event) => onBasisFilterChange(event.target.value as 'all' | DiscrepancyBasis)} value={basisFilter}>
            <option value="all">All</option>
            <option value="device">Devices</option>
            <option value="user">Users</option>
          </select>
        </label>
        <label className="config-field compact-filter">
          <span>Severity</span>
          <select onChange={(event) => onSeverityFilterChange(event.target.value as DiscrepancyFilterValue)} value={severityFilter}>
            <option value="all">Open + unavailable</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="unavailable">Unavailable</option>
            <option value="matched">Matched</option>
          </select>
        </label>
        <label className="switch-control customer-license-toggle">
          <input
            checked={includeMatched}
            disabled={loadState === 'loading'}
            onChange={(event) => onIncludeMatchedChange(event.target.checked)}
            type="checkbox"
          />
          <span>Show matched</span>
        </label>
      </section>

      <section className="work-surface discrepancy-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Operational coverage</span>
            <h2>{rows.length.toLocaleString()} comparison rows</h2>
          </div>
          <span className="status-pill ready">{formatCount(report?.summary.comparisonCount ?? 0)} configured pairs</span>
        </div>

        {loadState === 'loading' ? (
          <div className="empty-state report-empty">
            <Activity size={20} />
            <strong>Comparing latest complete syncs.</strong>
          </div>
        ) : null}

        {loadState !== 'loading' && rows.length === 0 ? (
          <div className="empty-state report-empty">
            <Search size={20} />
            <strong>No discrepancy rows found.</strong>
            <span>Adjust the filters or sync the related integrations.</span>
          </div>
        ) : null}

        {groupedRows.map(([customerName, customerRows]) => (
          <section className="discrepancy-customer-group" key={customerName}>
            <div className="discrepancy-customer-header">
              <strong>{customerName}</strong>
              <span>{customerRows.length.toLocaleString()} rows</span>
            </div>
            <div className="discrepancy-table-scroll">
              <table className="discrepancy-table">
                <thead>
                  <tr>
                    <th>Comparison</th>
                    <th>Product family</th>
                    <th>Basis</th>
                    <th>Counts</th>
                    <th>Delta</th>
                    <th>Status</th>
                    <th>Latest sync</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.comparisonPair.label}</strong>
                        <span>{row.comparisonPair.leftVendorName} vs {row.comparisonPair.rightVendorName}</span>
                      </td>
                      <td>
                        <strong>{row.productFamily}</strong>
                        <span>{row.domain ?? (row.aggregateOnly ? 'Aggregate count' : 'Item-level match')}</span>
                      </td>
                      <td>{row.basis === 'device' ? 'Device' : 'User'}</td>
                      <td>
                        {row.leftCount.toLocaleString()} / {row.rightCount.toLocaleString()}
                      </td>
                      <td className={row.delta >= 0 ? 'delta positive' : 'delta negative'}>
                        {row.delta > 0 ? `+${row.delta}` : row.delta}
                      </td>
                      <td>
                        <span className={`status-pill ${discrepancyStatusClass(row.status)}`}>
                          {discrepancyStatusLabel(row.status)}
                        </span>
                        {row.stale ? <span className="stale-chip">Stale</span> : null}
                      </td>
                      <td>{latestDiscrepancySync(row)}</td>
                      <td>
                        <button className="button secondary compact" onClick={() => onRowSelect(row)} type="button">
                          <Database size={15} />
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </section>
    </section>
  );
}

function DiscrepancyDetailModal(props: { onClose: () => void; row: DiscrepancyRow }) {
  const { onClose, row } = props;
  const leftLabel = row.comparisonPair.leftVendorName;
  const rightLabel = row.comparisonPair.rightVendorName;
  const deltaLabel = row.delta > 0 ? `+${row.delta}` : String(row.delta);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="discrepancy-detail-modal" role="dialog" aria-modal="true" aria-labelledby="discrepancy-detail-title">
        <div className="modal-header">
          <div>
            <h2 id="discrepancy-detail-title">
              <Link2 size={18} />
              Discrepancy details
            </h2>
            <p>
              {row.customer.customerName}
              <span aria-hidden="true"> · </span>
              {row.comparisonPair.label}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <section className="discrepancy-detail-summary" aria-label="Comparison summary">
          <div className="discrepancy-detail-stat">
            <span>{leftLabel}</span>
            <strong>{row.leftCount.toLocaleString()}</strong>
          </div>
          <div className="discrepancy-detail-stat">
            <span>{rightLabel}</span>
            <strong>{row.rightCount.toLocaleString()}</strong>
          </div>
          <div className={`discrepancy-detail-stat ${row.delta === 0 ? 'matched' : row.delta > 0 ? 'positive' : 'negative'}`}>
            <span>Delta</span>
            <strong>{deltaLabel}</strong>
          </div>
          <div className="discrepancy-detail-stat status">
            <span>Status</span>
            <strong>
              <span className={`status-pill ${discrepancyStatusClass(row.status)}`}>
                {discrepancyStatusLabel(row.status)}
              </span>
              {row.stale ? <span className="stale-chip">Stale</span> : null}
            </strong>
          </div>
        </section>

        <section className="discrepancy-detail-body">
          {row.unavailableReason ? (
            <div className="empty-state discrepancy-unavailable-note">
              <Database size={20} />
              <strong>Waiting for comparable data</strong>
              <span>{row.unavailableReason}</span>
            </div>
          ) : (
            <section className="discrepancy-detail-grid">
              <DiscrepancyItemPanel
                emptyLabel={`No ${rightLabel} items are missing from ${leftLabel}.`}
                items={row.missingFromLeft}
                title={`In ${rightLabel}, not in ${leftLabel}`}
              />
              <DiscrepancyItemPanel
                emptyLabel={`No ${leftLabel} items are missing from ${rightLabel}.`}
                items={row.missingFromRight}
                title={`In ${leftLabel}, not in ${rightLabel}`}
              />
            </section>
          )}

          {row.aggregateOnly ? (
            <section className="discrepancy-reference-panel">
              <div className="surface-header compact-header">
                <div>
                  <span className="section-kicker">Reference detail</span>
                  <h3>Microsoft mailbox users used for the comparison</h3>
                </div>
                <span className="status-pill ready">{row.referenceItems.length.toLocaleString()} users</span>
              </div>
              <DiscrepancyItemList items={row.referenceItems} />
            </section>
          ) : null}
        </section>

        <section className="discrepancy-sync-panel" aria-label="Sync freshness">
          <div>
            <span>{leftLabel}</span>
            <strong>{formatDateTime(row.syncTimestamps.left) ?? 'No complete sync'}</strong>
          </div>
          <div>
            <span>{rightLabel}</span>
            <strong>{formatDateTime(row.syncTimestamps.right) ?? 'No complete sync'}</strong>
          </div>
        </section>
      </section>
    </div>
  );
}

function DiscrepancyItemPanel(props: { emptyLabel: string; items: DiscrepancyItem[]; title: string }) {
  return (
    <section className="discrepancy-item-panel">
      <div className="surface-header compact-header">
        <div>
          <span className="section-kicker">Missing items</span>
          <h3>{props.title}</h3>
        </div>
        <span className={`status-pill ${props.items.length === 0 ? 'approved' : 'needs-review'}`}>
          {props.items.length.toLocaleString()}
        </span>
      </div>
      {props.items.length === 0 ? (
        <div className="empty-state discrepancy-item-empty">
          <Check size={18} />
          <strong>{props.emptyLabel}</strong>
        </div>
      ) : (
        <DiscrepancyItemList items={props.items} />
      )}
    </section>
  );
}

function DiscrepancyItemList(props: { items: DiscrepancyItem[] }) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="discrepancy-item-list">
      {props.items.map((item) => (
        <article className="discrepancy-item-row" key={`${item.vendorId}:${item.identity}:${item.id}`}>
          <div>
            <strong>{item.displayName}</strong>
            <span>{item.identity}</span>
          </div>
          <div>
            <strong>{item.productName ?? item.productKey ?? item.vendorId}</strong>
            <span>{discrepancyItemDetail(item)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function groupDiscrepancyRowsByCustomer(rows: DiscrepancyRow[]) {
  const groups = new Map<string, DiscrepancyRow[]>();
  rows.forEach((row) => {
    const key = row.customer.customerName;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return [...groups.entries()].sort((left, right) => compareCustomerNames(left[0], right[0]));
}

function discrepancyStatusLabel(status: DiscrepancySeverity) {
  if (status === 'critical') return 'Critical';
  if (status === 'warning') return 'Warning';
  if (status === 'unavailable') return 'Unavailable';
  return 'Matched';
}

function discrepancyStatusClass(status: DiscrepancySeverity) {
  if (status === 'critical') return 'blocked';
  if (status === 'warning') return 'needs-review';
  if (status === 'unavailable') return 'ready';
  return 'approved';
}

function latestDiscrepancySync(row: DiscrepancyRow) {
  const left = formatDateTime(row.syncTimestamps.left);
  const right = formatDateTime(row.syncTimestamps.right);
  if (left && right) return `${left} / ${right}`;
  return left ?? right ?? 'Waiting for data';
}

function discrepancyItemDetail(item: DiscrepancyItem) {
  const lastCheckIn =
    formatDateTime(stringDetail(item.details.LastCheckIn)) ??
    formatDateTime(item.observedAt);
  const values = [
    item.domain,
    stringDetail(item.details.Tenant),
    stringDetail(item.details.Site),
    stringDetail(item.details.OS),
    lastCheckIn ? `Check-in ${lastCheckIn}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return values.join(' / ') || 'No extra detail';
}

function stringDetail(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

type ManagedUserDraft = {
  displayName: string;
  role: AppRole;
  status: ManagedUserStatus;
};

function SettingsPageView(props: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onNavigateToIntegrations: () => void;
}) {
  const { section, onSectionChange, onNavigateToIntegrations } = props;

  return (
    <section className="settings-workspace" aria-label="Application settings">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {settingsSections.map((item) => (
          <button
            aria-selected={section === item.id}
            className={section === item.id ? 'active' : ''}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            role="tab"
            title={item.description}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === 'user-management' ? <SettingsView /> : null}
      {section === 'integrations' ? <SettingsIntegrationsStub onOpenIntegrations={onNavigateToIntegrations} /> : null}
      {section === 'email-communication' ? <SettingsEmailCommunicationView /> : null}
      {section === 'audit-logs' ? <AuditView /> : null}
    </section>
  );
}

function SettingsIntegrationsStub(props: { onOpenIntegrations: () => void }) {
  const { onOpenIntegrations } = props;

  return (
    <section className="settings-integrations-stub" aria-label="Integrations settings placeholder">
      <div className="settings-integrations-notice">
        <Plug size={18} />
        <div>
          <strong>Integrations settings</strong>
          <p>
            Integration configuration will move here soon. Continue managing integrations from the Integrations page for
            now.
          </p>
        </div>
        <button className="button secondary compact" onClick={onOpenIntegrations} type="button">
          Open Integrations
        </button>
      </div>
    </section>
  );
}

function SettingsEmailCommunicationView() {
  const [settings, setSettings] = useState<CommunicationSettings>(defaultCommunicationSettings);
  const [invoiceFromEmail, setInvoiceFromEmail] = useState(defaultCommunicationSettings.invoiceFromEmail);
  const [invoiceBccEmails, setInvoiceBccEmails] = useState('');
  const [templates, setTemplates] = useState<InvoiceNoticeTemplates>(defaultInvoiceNoticeTemplates);
  const [graphTenantId, setGraphTenantId] = useState('');
  const [graphClientId, setGraphClientId] = useState('');
  const [sendAsMailbox, setSendAsMailbox] = useState(defaultCommunicationSettings.sendAsMailbox);
  const [graphClientSecret, setGraphClientSecret] = useState('');
  const [testRecipientEmail, setTestRecipientEmail] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('Loading email communication settings...');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const applySettings = (next: CommunicationSettings) => {
    setSettings(next);
    setInvoiceFromEmail(next.invoiceFromEmail);
    setInvoiceBccEmails(next.invoiceBccEmails);
    setTemplates(next.invoiceNoticeTemplates);
    setGraphTenantId(next.graphTenantId);
    setGraphClientId(next.graphClientId);
    setSendAsMailbox(next.sendAsMailbox || next.invoiceFromEmail);
  };

  const refreshSettings = async () => {
    setLoadState('loading');
    setMessage('Refreshing email communication settings...');

    try {
      const response = await fetchCommunicationSettings();
      applySettings(response.settings);
      setLoadState('ready');
      setMessage('Email communication settings loaded.');
    } catch (error) {
      setLoadState('failed');
      setMessage(error instanceof Error ? error.message : 'Unable to load communication settings.');
    }
  };

  useEffect(() => {
    void refreshSettings();
  }, []);

  const updateTemplate = (noticeType: InvoiceNoticeType, field: keyof InvoiceNoticeTemplate, value: string) => {
    setTemplates((current) => ({
      ...current,
      [noticeType]: {
        ...current[noticeType],
        [field]: value,
      },
    }));
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fromEmail = invoiceFromEmail.trim();
    if (!fromEmail) {
      setMessage('From address is required.');
      return;
    }
    if (!isValidEmail(fromEmail)) {
      setMessage(`Invalid from email address: ${fromEmail}`);
      return;
    }
    const mailbox = sendAsMailbox.trim() || fromEmail;
    if (!isValidEmail(mailbox)) {
      setMessage(`Invalid send-as mailbox: ${mailbox}`);
      return;
    }
    const validation = validateEmailList(invoiceBccEmails);
    if (validation.invalid.length > 0) {
      setMessage(`Invalid BCC email address(es): ${validation.invalid.join(', ')}`);
      return;
    }

    setSaving(true);
    setMessage('Saving email communication settings...');

    try {
      const response = await saveCommunicationSettingsRequest({
        invoiceFromEmail: fromEmail,
        invoiceBccEmails,
        invoiceNoticeTemplates: templates,
        graphTenantId: graphTenantId.trim(),
        graphClientId: graphClientId.trim(),
        sendAsMailbox: mailbox,
        ...(graphClientSecret.trim() ? { graphClientSecret: graphClientSecret.trim() } : {}),
      });
      applySettings(response.settings);
      setGraphClientSecret('');
      setLoadState('ready');
      setMessage(
        response.settings.deliveryConfigured
          ? 'Email communication settings saved. Microsoft Graph delivery is configured.'
          : 'Email communication settings saved. Add Graph tenant, client ID, and client secret to enable sending.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save communication settings.');
    } finally {
      setSaving(false);
    }
  };

  const testDelivery = async () => {
    const recipient = testRecipientEmail.trim();
    if (!recipient || !isValidEmail(recipient)) {
      setMessage('Enter a valid test recipient email address.');
      return;
    }
    if (!settings.deliveryConfigured) {
      setMessage('Save Microsoft Graph delivery settings before sending a test email.');
      return;
    }

    setTesting(true);
    setMessage(`Sending delivery test to ${recipient}...`);

    try {
      const response = await testCommunicationSettingsRequest(recipient);
      applySettings(response.settings);
      setMessage(`Test email sent to ${recipient} from ${response.sendAsMailbox}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send delivery test.');
      try {
        const refreshed = await fetchCommunicationSettings();
        applySettings(refreshed.settings);
      } catch {
        // Keep the test error message if refresh fails.
      }
    } finally {
      setTesting(false);
    }
  };

  const deliveryStatusLabel = settings.deliveryConfigured
    ? settings.lastTestResult === 'success'
      ? 'Configured · last test succeeded'
      : settings.lastTestResult === 'failed'
        ? 'Configured · last test failed'
        : 'Configured · not tested'
    : 'Not configured';

  return (
    <section className="settings-email-communication" aria-label="Email communication settings">
      <section className="settings-panel settings-email-panel">
        <div className="settings-panel-header">
          <div>
            <span className="section-kicker">Billing email</span>
            <h2>Invoice communication</h2>
            <p>Configure Microsoft Graph delivery, the from address, past-due invoice wording, and shared BCC recipients.</p>
          </div>
          <button
            className="button secondary compact"
            disabled={saving || testing || loadState === 'loading'}
            onClick={() => void refreshSettings()}
            type="button"
          >
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
        <div className="settings-email-panel-body settings-email-status-row">
          <p className="settings-email-status">{message}</p>
        </div>
      </section>

      <form className="settings-email-form" onSubmit={(event) => void saveSettings(event)}>
        <section className="settings-panel settings-email-panel" aria-label="Email delivery settings">
          <div className="settings-panel-header">
            <div>
              <span className="section-kicker">Delivery</span>
              <h2>Microsoft Graph</h2>
              <p>
                App-only send via Graph <code>sendMail</code>. Requires an Entra app with application permission{' '}
                <code>Mail.Send</code> and admin consent. Client secret is stored in Azure Key Vault.
              </p>
            </div>
            <span className={`status-pill ${settings.deliveryConfigured ? 'approved' : 'ready'}`}>{deliveryStatusLabel}</span>
          </div>
          <div className="settings-email-panel-body">
            <div className="settings-email-delivery-grid">
              <label className="settings-email-field">
                <span>Tenant ID</span>
                <input
                  onChange={(event) => setGraphTenantId(event.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  type="text"
                  value={graphTenantId}
                />
              </label>
              <label className="settings-email-field">
                <span>Client ID</span>
                <input
                  onChange={(event) => setGraphClientId(event.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  type="text"
                  value={graphClientId}
                />
              </label>
              <label className="settings-email-field">
                <span>Send-as mailbox</span>
                <input
                  onChange={(event) => setSendAsMailbox(event.target.value)}
                  placeholder="tconnover@bmbsolutions.com"
                  type="email"
                  value={sendAsMailbox}
                />
              </label>
              <label className="settings-email-field">
                <span>Client secret {settings.graphClientSecretPresent ? '(leave blank to keep existing)' : ''}</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => setGraphClientSecret(event.target.value)}
                  placeholder={settings.graphClientSecretPresent ? '••••••••' : 'Paste client secret'}
                  type="password"
                  value={graphClientSecret}
                />
              </label>
            </div>
            <div className="settings-email-delivery-test">
              <label className="settings-email-field">
                <span>Test recipient</span>
                <input
                  onChange={(event) => setTestRecipientEmail(event.target.value)}
                  placeholder="you@bmbsolutions.com"
                  type="email"
                  value={testRecipientEmail}
                />
              </label>
              <button
                className="button secondary compact"
                disabled={saving || testing || loadState === 'loading' || !settings.deliveryConfigured}
                onClick={() => void testDelivery()}
                type="button"
              >
                {testing ? 'Sending test' : 'Send test email'}
              </button>
            </div>
            {settings.lastTestedAt ? (
              <p className="settings-email-status">
                Last tested {formatDateTime(settings.lastTestedAt)}
                {settings.lastTestResult === 'failed' && settings.lastTestError ? ` — ${settings.lastTestError}` : ''}
              </p>
            ) : null}
          </div>
        </section>

        <section className="settings-panel settings-email-panel" aria-label="Invoice sender settings">
          <div className="settings-panel-header">
            <div>
              <span className="section-kicker">Sender</span>
              <h2>From address</h2>
              <p>Display from address for billing emails. Prefer matching the Graph send-as mailbox.</p>
            </div>
          </div>
          <div className="settings-email-panel-body">
            <label className="settings-email-field">
              <span>From email</span>
              <input
                onChange={(event) => setInvoiceFromEmail(event.target.value)}
                placeholder="tconnover@bmbsolutions.com"
                type="email"
                value={invoiceFromEmail}
              />
            </label>
          </div>
        </section>

        <section className="settings-panel settings-email-panel" aria-label="Invoice BCC settings">
          <div className="settings-panel-header">
            <div>
              <span className="section-kicker">Recipients</span>
              <h2>BCC all billing emails</h2>
              <p>Separate multiple addresses with commas or semicolons. Applied to all past-due invoice emails.</p>
            </div>
          </div>
          <div className="settings-email-panel-body">
            <label className="settings-email-field">
              <span>BCC addresses</span>
              <input
                onChange={(event) => setInvoiceBccEmails(event.target.value)}
                placeholder="billing@example.com, ar@example.com"
                type="text"
                value={invoiceBccEmails}
              />
            </label>
          </div>
        </section>

        <section className="settings-panel settings-email-panel" aria-label="Invoice past-due wording">
          <div className="settings-panel-header">
            <div>
              <span className="section-kicker">Invoice</span>
              <h2>Past-due email wording</h2>
              <p>
                Templates follow the oldest invoice for each customer. Placeholders: {'{company}'}, {'{recipientName}'},{' '}
                {'{invoiceCount}'}, {'{totalBalance}'}, {'{invoiceNumber}'}.
              </p>
            </div>
          </div>
          <div className="settings-email-panel-body">
            <div className="settings-email-template-grid">
              {invoiceNoticeTypes.map((noticeType) => (
                <article className="settings-email-template-card" key={noticeType}>
                  <header>
                    <strong>{invoiceNoticeTypeLabels[noticeType]}</strong>
                    <span>{invoiceNoticeTypeRanges[noticeType]}</span>
                  </header>
                  <label className="settings-email-field">
                    <span>Subject</span>
                    <input
                      onChange={(event) => updateTemplate(noticeType, 'subject', event.target.value)}
                      type="text"
                      value={templates[noticeType].subject}
                    />
                  </label>
                  <label className="settings-email-field">
                    <span>Body</span>
                    <textarea
                      onChange={(event) => updateTemplate(noticeType, 'body', event.target.value)}
                      rows={8}
                      value={templates[noticeType].body}
                    />
                  </label>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="settings-email-actions">
          <button className="button primary compact" disabled={saving || testing || loadState === 'loading'} type="submit">
            <Check size={15} />
            {saving ? 'Saving' : 'Save email settings'}
          </button>
          {settings.updatedAt ? (
            <span className="invoice-action-message">
              Last updated {formatDateTime(settings.updatedAt)}
              {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

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
  agreementUpdateMessage: string;
  clientGroups: ClientGroup[];
  connectWiseSyncSummary: string;
  exportingReport: boolean;
  expandedClientNames: string[];
  filteredIssues: ReconcileIssue[];
  issues: ReconcileIssue[];
  needsReviewOnly: boolean;
  onCountSourceSelect: (issueId: string, countSource: ReconciliationCountSource) => void;
  onExportReport: () => Promise<void>;
  onLoadVendorData: (client: ClientGroup, vendorId: IntegrationId, vendor: string) => Promise<VendorDataSelection>;
  onManualOverride: (issue: ReconcileIssue) => void;
  onOpenAgreementAdditions: (client: ClientGroup) => void;
  onOpenTicket: (client: ClientGroup) => void;
  onOpenInvestigationTickets: (selection: {
    customer: string;
    vendorId: VendorKey;
    vendor: string;
  }) => void;
  investigationTicketPresence: Record<string, number>;
  busyIntegrationAction: IntegrationActionKey | null;
  connectWiseLastSync: string;
  integrationActionMessages: Partial<Record<IntegrationId, string>>;
  onCompareReconciliation: () => Promise<ReconciliationRunResponse[] | null>;
  onReconciliationSourceToggle: (vendorId: VendorKey) => void;
  onSyncIntegration: (integrationId: IntegrationId) => void;
  pendingCount: number;
  query: string;
  reconciliationLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  reconciliationIntegrations: ReconciliationVendorOption[];
  reconciliationMessage: string;
  selectedReconciliationIntegrationIds: VendorKey[];
  setExpandedClientNames: (value: string[] | ((currentNames: string[]) => string[])) => void;
  setNeedsReviewOnly: (value: boolean) => void;
  setQuery: (value: string) => void;
  setVendorFilter: (value: string) => void;
  skipIssue: (issueId: string) => void;
  totalExposure: number;
  vendorDataSummary: string;
  vendorInvoiceSummary: string;
  vendorFilter: string;
}) {
  const {
    approveClient,
    approveIssue,
    agreementUpdateMessage,
    busyIntegrationAction,
    clientGroups,
    connectWiseLastSync,
    connectWiseSyncSummary,
    exportingReport,
    expandedClientNames,
    filteredIssues,
    integrationActionMessages,
    issues,
    needsReviewOnly,
    onCountSourceSelect,
    onExportReport,
    onLoadVendorData,
    onManualOverride,
    onOpenAgreementAdditions,
    onOpenTicket,
    onOpenInvestigationTickets,
    investigationTicketPresence,
    onCompareReconciliation,
    onReconciliationSourceToggle,
    onSyncIntegration,
    pendingCount,
    query,
    reconciliationLoadState,
    reconciliationIntegrations,
    reconciliationMessage,
    selectedReconciliationIntegrationIds,
    setExpandedClientNames,
    setNeedsReviewOnly,
    setQuery,
    setVendorFilter,
    skipIssue,
    totalExposure,
    vendorDataSummary,
    vendorInvoiceSummary,
    vendorFilter,
  } = props;
  const [expandedProductLists, setExpandedProductLists] = useState<Record<string, boolean>>({});
  const [vendorDataSelection, setVendorDataSelection] = useState<VendorDataSelection | null>(null);
  const [compareFreshnessOpen, setCompareFreshnessOpen] = useState(false);
  const filteredReviewCount = filteredIssues.filter(isReviewViewIssue).length;
  const hasSelectedReconciliationVendors = selectedReconciliationIntegrationIds.length > 0;
  const selectedSourceName =
    selectedReconciliationIntegrationIds.length === 0
      ? 'Choose vendors'
      : selectedReconciliationIntegrationIds.length === 1
        ? (reconciliationIntegrations.find((vendor) => vendor.id === selectedReconciliationIntegrationIds[0])?.name ??
          selectedReconciliationIntegrationIds[0])
        : `${selectedReconciliationIntegrationIds.length} vendors`;
  const reconciliationVendors = useMemo(() => {
    const selectedVendors = reconciliationIntegrations.filter((vendor) =>
      selectedReconciliationIntegrationIds.includes(vendor.id),
    );
    return ['All', ...selectedVendors.map((vendor) => vendor.name)];
  }, [reconciliationIntegrations, selectedReconciliationIntegrationIds]);
  const compareFreshnessRows = useMemo((): CompareFreshnessRow[] => {
    const selectedVendors = reconciliationIntegrations
      .filter((vendor) => selectedReconciliationIntegrationIds.includes(vendor.id))
      .map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        sourceKind: vendor.sourceKind,
        lastRefreshedLabel: vendor.lastRefreshedLabel ?? 'Never',
        canSync: vendor.canSync,
        syncIntegrationId: vendor.syncIntegrationId,
      }));

    return [
      {
        id: 'connectwise',
        name: 'ConnectWise',
        sourceKind: 'sync',
        lastRefreshedLabel: connectWiseLastSync,
        canSync: true,
        syncIntegrationId: 'connectwise',
      },
      ...selectedVendors,
    ];
  }, [connectWiseLastSync, reconciliationIntegrations, selectedReconciliationIntegrationIds]);
  const workflowSteps = workflow.map((step) => {
    if (step.label === 'Vendor API Data') return { ...step, value: vendorDataSummary };
    if (step.label === 'Vendor Invoice') return { ...step, value: vendorInvoiceSummary };
    if (step.label === 'CW Data') return { ...step, value: connectWiseSyncSummary };
    if (step.label === 'Discrepancies') return { ...step, value: `${pendingCount.toLocaleString()} review` };
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
                : hasSelectedReconciliationVendors
                  ? `${selectedSourceName} vs ConnectWise`
                  : selectedSourceName}
          </strong>
          {reconciliationLoadState !== 'ready' || !hasSelectedReconciliationVendors ? (
            <span>{reconciliationMessage}</span>
          ) : null}
        </div>
        <div className="integrations-live-meta">
          <div
            className="segmented-control compact-source-control reconciliation-source-control"
            role="group"
            aria-label="Reconciliation source"
          >
            {reconciliationIntegrations.length > 0 ? (
              reconciliationIntegrations.map((vendor) => (
                <button
                  className={selectedReconciliationIntegrationIds.includes(vendor.id) ? 'active' : ''}
                  aria-pressed={selectedReconciliationIntegrationIds.includes(vendor.id)}
                  disabled={reconciliationLoadState === 'loading'}
                  key={vendor.id}
                  onClick={() => onReconciliationSourceToggle(vendor.id)}
                  type="button"
                >
                  {vendor.name}
                </button>
              ))
            ) : (
              <button disabled type="button">
                No enabled vendors
              </button>
            )}
          </div>
          <span>{pendingCount.toLocaleString()} open</span>
          <button
            className="button secondary compact"
            disabled={reconciliationLoadState === 'loading' || !hasSelectedReconciliationVendors}
            onClick={() => setCompareFreshnessOpen(true)}
            type="button"
          >
            <Search size={16} />
            {reconciliationLoadState === 'loading' ? 'Comparing' : 'Compare'}
          </button>
        </div>
      </section>

      {compareFreshnessOpen ? (
        <CompareFreshnessModal
          actionMessages={integrationActionMessages}
          busyAction={busyIntegrationAction}
          onClose={() => setCompareFreshnessOpen(false)}
          onContinue={() => {
            setCompareFreshnessOpen(false);
            void onCompareReconciliation();
          }}
          onSync={onSyncIntegration}
          rows={compareFreshnessRows}
        />
      ) : null}

      <section className="workflow-band" aria-label="Reconciliation workflow">
        {workflowSteps.map((step, index) => {
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
              {index < workflowSteps.length - 1 && <ChevronRight className="workflow-arrow" size={18} />}
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
                  !hasSelectedReconciliationVendors ||
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
          {agreementUpdateMessage ? (
            <div className="reconciliation-apply-message">
              {agreementUpdateMessage}
            </div>
          ) : null}

          <div className="client-group-list">
            {clientGroups.length === 0 && (
              <div className="empty-state">
                <Search size={20} />
                <strong>
                  {reconciliationIntegrations.length === 0
                    ? 'No enabled reconciliation integrations.'
                    : !hasSelectedReconciliationVendors
                    ? 'Choose vendors to run reconciliation.'
                    : pendingCount === 0
                      ? `No ${selectedSourceName} discrepancies to review.`
                      : 'No client groups match these filters.'}
                </strong>
                <span>
                  {reconciliationIntegrations.length === 0
                    ? 'Enable and configure a reconciliation-capable integration before running a comparison.'
                    : !hasSelectedReconciliationVendors
                    ? 'Pick one or more vendors above when you are ready to compare vendor API counts with CW data.'
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
                        const vendorId = allVendorIssues[0]?.vendorId ?? selectedReconciliationIntegrationIds[0] ?? '';
                        const showLinkedCountColumn = visibleVendorIssues.some(
                          (issue) => typeof validLinkedCount(issue) === 'number',
                        );
                        const hasInvestigationTickets =
                          Boolean(vendorId) &&
                          (investigationTicketPresence[investigationTicketPresenceKey(client.customer, vendorId as VendorKey)] ??
                            0) > 0;

                        return (
                          <section className="vendor-license-group" key={vendor}>
                            <div className="vendor-license-header">
                              <strong>{vendor}</strong>
                              <div className="vendor-license-header-meta">
                                {hasInvestigationTickets ? (
                                  <button
                                    className="vendor-data-link"
                                    onClick={() => {
                                      onOpenInvestigationTickets({
                                        customer: client.customer,
                                        vendorId: vendorId as VendorKey,
                                        vendor,
                                      });
                                    }}
                                    type="button"
                                  >
                                    <ListChecks size={14} />
                                    Tickets
                                  </button>
                                ) : null}
                                <button
                                  className="vendor-data-link"
                                  disabled={!vendorId || !isRegistryIntegrationId(vendorId)}
                                  onClick={() => {
                                    if (vendorId && isRegistryIntegrationId(vendorId)) {
                                      void openVendorData(client, vendorId, vendor);
                                    }
                                  }}
                                  type="button"
                                >
                                  <Database size={14} />
                                  Vendor API Data
                                </button>
                                <span>{visibleVendorIssues.length} product checks</span>
                              </div>
                            </div>
                            <div className="license-table" role="table" aria-label={`${client.customer} ${vendor} license checks`}>
                              <div
                                className={`license-row heading ${showLinkedCountColumn ? 'with-linked-count' : 'without-linked-count'}`}
                                role="row"
                              >
                                <span>Product</span>
                                {showLinkedCountColumn ? <span>Linked</span> : null}
                                <span>API Count</span>
                                <span>Inv. Count</span>
                                <span>CW Count</span>
                                <span>Delta</span>
                                <span>Impact</span>
                                <span>Status</span>
                                <span>Actions</span>
                              </div>
                              {visibleVendorIssues.map((issue) => {
                                const invoiceCount = validVendorInvoiceCount(issue);
                                const linkedCount = validLinkedCount(issue);
                                const selectedCountSource = reconciliationCountSource(issue);
                                const preferredCountSource = preferredReconciliationCountSource(issue.sourceCount, invoiceCount, linkedCount);
                                const delta = reconciliationDelta(issue);
                                const lessDelta = lessIncludedDelta(issue);
                                const impact = reconciliationIssueImpact(issue);
                                const canToggleApproval =
                                  issue.status === 'approved' ||
                                  ((isReviewableIssue(issue) && issue.status !== 'unmapped') || issue.status === 'ready');
                                const countButtonClass = (countSource: ReconciliationCountSource) =>
                                  [
                                    'count-select-button',
                                    selectedCountSource === countSource ? 'selected' : '',
                                    preferredCountSource === countSource ? 'largest' : '',
                                  ].filter(Boolean).join(' ');
                                const passiveActionLabel =
                                  issue.status === 'approved'
                                    ? 'Approved'
                                    : issue.status === 'skipped'
                                      ? 'Skipped'
                                      : issue.status === 'updated'
                                        ? reconciliationStatusLabel(issue)
                                        : issue.status === 'unmapped'
                                          ? 'Map product'
                                          : 'No change';
                                return (
                                  <div
                                    className={`license-row ${showLinkedCountColumn ? 'with-linked-count' : 'without-linked-count'}`}
                                    key={issue.id}
                                    role="row"
                                  >
                                    <span className="license-product">
                                      <strong>{issue.product}</strong>
                                      <em>
                                        {issue.serviceCode}
                                        {issue.vendorProductKey ? ` / ${issue.unit}` : ''}
                                        {issue.connectWiseAdditionId ? ` / CW ${issue.connectWiseAdditionId}` : ''}
                                        {' / '}
                                        {issue.family}
                                      </em>
                                    </span>
                                    {showLinkedCountColumn ? (
                                      <span className="count-cell">
                                        {typeof linkedCount === 'number' ? (
                                          <button
                                            aria-pressed={selectedCountSource === 'linked'}
                                            className={countButtonClass('linked')}
                                            onClick={() => onCountSourceSelect(issue.id, 'linked')}
                                            title={issue.linkedCount ? linkedCountTitle(issue.linkedCount) : 'Linked count'}
                                            type="button"
                                          >
                                            {formatOptionalCount(linkedCount)}
                                          </button>
                                        ) : (
                                          <span className="count-select-empty" aria-label="No linked count" />
                                        )}
                                      </span>
                                    ) : null}
                                    <span className="count-cell">
                                      <button
                                        aria-pressed={selectedCountSource === 'api'}
                                        className={countButtonClass('api')}
                                        onClick={() => onCountSourceSelect(issue.id, 'api')}
                                        title="Use API count"
                                        type="button"
                                      >
                                        {issue.sourceCount.toLocaleString()}
                                      </button>
                                    </span>
                                    <span className="count-cell">
                                      <button
                                        aria-pressed={selectedCountSource === 'invoice'}
                                        className={countButtonClass('invoice')}
                                        disabled={typeof invoiceCount !== 'number'}
                                        onClick={() => onCountSourceSelect(issue.id, 'invoice')}
                                        title="Use invoice count"
                                        type="button"
                                      >
                                        {formatOptionalCount(invoiceCount)}
                                      </button>
                                    </span>
                                    <span>{cwCountLabel(issue)}</span>
                                    <span className={delta >= 0 ? 'delta positive' : 'delta negative'}>
                                      {deltaLabel(delta)}
                                      {selectedCountSource === 'manual' ? (
                                        <small className="delta-note">
                                          manual total {reconciliationSelectedCount(issue).toLocaleString()}
                                        </small>
                                      ) : null}
                                      {typeof lessDelta === 'number' ? (
                                        <small className="delta-note">less {deltaLabel(lessDelta)}</small>
                                      ) : null}
                                    </span>
                                    <span>{formatCurrency(impact)}</span>
                                    <span className={`status-pill ${issue.status}`}>{reconciliationStatusLabel(issue)}</span>
                                    <span className="license-actions">
                                      {canToggleApproval ? (
                                        <>
                                          <button
                                            aria-label={issue.status === 'approved' ? 'Remove approval' : 'Approve selected count'}
                                            aria-pressed={issue.status === 'approved'}
                                            className={issue.status === 'approved' ? 'approval-toggle approved' : 'approval-toggle'}
                                            onClick={() => approveIssue(issue.id)}
                                            title={issue.status === 'approved' ? 'Remove approval' : 'Approve selected count'}
                                            type="button"
                                          >
                                            {issue.status === 'approved' ? <Check size={16} /> : null}
                                          </button>
                                          {issue.status !== 'approved' ? (
                                            <button
                                              className="button secondary compact table-action-button"
                                              onClick={() => skipIssue(issue.id)}
                                              title="Skip change"
                                              type="button"
                                            >
                                              Skip
                                            </button>
                                          ) : null}
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
  const columnsKey = selection.columns.join('\u001f');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnResize, setColumnResize] = useState<ReportColumnResizeState | null>(null);
  const columnWidth = (column: string) => columnWidths[column] ?? vendorDataDefaultColumnWidth(column);
  const minTableWidth = Math.max(
    980,
    selection.columns.reduce((totalWidth, column) => totalWidth + columnWidth(column), 0),
  );

  useEffect(() => {
    const availableColumns = new Set(selection.columns);
    setColumnWidths((currentWidths) => {
      const nextWidths = Object.fromEntries(
        Object.entries(currentWidths).filter(([column]) => availableColumns.has(column)),
      );
      return Object.keys(nextWidths).length === Object.keys(currentWidths).length ? currentWidths : nextWidths;
    });
    setColumnResize((currentResize) =>
      currentResize && availableColumns.has(currentResize.column) ? currentResize : null,
    );
  }, [columnsKey, selection.columns]);

  const setColumnWidth = (column: string, width: number) => {
    const nextWidth = clampVendorDataColumnWidth(width);
    setColumnWidths((currentWidths) =>
      currentWidths[column] === nextWidth ? currentWidths : { ...currentWidths, [column]: nextWidth },
    );
  };

  const startColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setColumnResize({
      column,
      pointerId: event.pointerId,
      startWidth: columnWidth(column),
      startX: event.clientX,
    });
  };

  const moveColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!columnResize || columnResize.column !== column || columnResize.pointerId !== event.pointerId) {
      return;
    }

    setColumnWidth(column, columnResize.startWidth + event.clientX - columnResize.startX);
  };

  const stopColumnResize = (column: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!columnResize || columnResize.column !== column || columnResize.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setColumnResize(null);
  };

  const resetColumnWidth = (column: string) => {
    setColumnWidths((currentWidths) => {
      if (typeof currentWidths[column] === 'undefined') {
        return currentWidths;
      }

      const { [column]: _removed, ...nextWidths } = currentWidths;
      return nextWidths;
    });
  };

  const handleColumnResizeKeyDown = (column: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setColumnWidth(column, columnWidth(column) + direction * reportColumnKeyboardStep);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      resetColumnWidth(column);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="vendor-data-modal" role="dialog" aria-modal="true" aria-labelledby="vendor-data-title">
        <div className="modal-header">
          <div>
            <h2 id="vendor-data-title">
              <Database size={18} />
              Vendor API Data
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
              <table
                className={columnResize ? 'vendor-raw-sync-table resizing' : 'vendor-raw-sync-table'}
                style={{ minWidth: `${minTableWidth}px` }}
              >
                <colgroup>
                  {selection.columns.map((column) => (
                    <col key={column} style={{ width: `${columnWidth(column)}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {selection.columns.map((column) => (
                      <th key={column}>
                        <div className="vendor-raw-column-header">
                          <span title={column}>{column}</span>
                        </div>
                        <button
                          aria-label={`Resize ${column} column`}
                          className={
                            columnResize?.column === column
                              ? 'report-column-resizer active'
                              : 'report-column-resizer'
                          }
                          onDoubleClick={() => resetColumnWidth(column)}
                          onKeyDown={(event) => handleColumnResizeKeyDown(column, event)}
                          onPointerCancel={(event) => stopColumnResize(column, event)}
                          onPointerDown={(event) => startColumnResize(column, event)}
                          onPointerMove={(event) => moveColumnResize(column, event)}
                          onPointerUp={(event) => stopColumnResize(column, event)}
                          title="Drag to resize"
                          type="button"
                        />
                      </th>
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
                  <th>Less</th>
                  <th>Billed</th>
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
                    <td>{addition.lessIncluded && addition.lessIncluded > 0 ? addition.lessIncluded.toLocaleString() : '-'}</td>
                    <td>{typeof addition.billedQuantity === 'number' ? addition.billedQuantity.toLocaleString() : '-'}</td>
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

function isCompareFreshnessSyncBusy(busyAction: IntegrationActionKey | null, integrationId: IntegrationId) {
  return (
    busyAction === `${integrationId}:sync` ||
    busyAction === `${integrationId}:sync-users` ||
    busyAction === `${integrationId}:sync-licenses` ||
    busyAction === `${integrationId}:sync-datto-saas` ||
    busyAction === `${integrationId}:sync-datto-saas-bcdr`
  );
}

function compareFreshnessBusyIntegrationId(busyAction: IntegrationActionKey | null): IntegrationId | null {
  if (!busyAction || !busyAction.includes(':sync')) {
    return null;
  }

  return busyAction.split(':')[0] as IntegrationId;
}

function CompareFreshnessModal(props: {
  actionMessages: Partial<Record<IntegrationId, string>>;
  busyAction: IntegrationActionKey | null;
  onClose: () => void;
  onContinue: () => void;
  onSync: (integrationId: IntegrationId) => void;
  rows: CompareFreshnessRow[];
}) {
  const { actionMessages, busyAction, onClose, onContinue, onSync, rows } = props;
  const [optimisticSyncId, setOptimisticSyncId] = useState<IntegrationId | null>(null);
  const syncStartedAtRef = useRef<number | null>(null);
  const clearOptimisticTimeoutRef = useRef<number | null>(null);
  const busySyncIntegrationId = compareFreshnessBusyIntegrationId(busyAction);
  const activeSyncId = busySyncIntegrationId ?? optimisticSyncId;
  const anySyncBusy = activeSyncId != null;

  useEffect(() => {
    return () => {
      if (clearOptimisticTimeoutRef.current != null) {
        window.clearTimeout(clearOptimisticTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (busySyncIntegrationId) {
      if (clearOptimisticTimeoutRef.current != null) {
        window.clearTimeout(clearOptimisticTimeoutRef.current);
        clearOptimisticTimeoutRef.current = null;
      }
      setOptimisticSyncId(busySyncIntegrationId);
      syncStartedAtRef.current = Date.now();
      return;
    }

    if (!optimisticSyncId) {
      return;
    }

    const startedAt = syncStartedAtRef.current ?? Date.now();
    const remainingMs = Math.max(0, 900 - (Date.now() - startedAt));

    clearOptimisticTimeoutRef.current = window.setTimeout(() => {
      setOptimisticSyncId(null);
      syncStartedAtRef.current = null;
      clearOptimisticTimeoutRef.current = null;
    }, remainingMs);
  }, [busySyncIntegrationId, optimisticSyncId]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="compare-freshness-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-freshness-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="compare-freshness-title">
              <RefreshCcw size={18} />
              Confirm data freshness
            </h2>
            <p>Review the last sync or import for each source before comparing.</p>
          </div>
          <button className="modal-close" disabled={anySyncBusy} onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="compare-freshness-list">
          {rows.map((row) => {
            const syncIntegrationId = row.syncIntegrationId;
            const syncing = syncIntegrationId != null && activeSyncId === syncIntegrationId;
            const sourceLabel = row.sourceKind === 'import' ? 'Last imported' : 'Last synced';
            const actionMessage = syncIntegrationId ? actionMessages[syncIntegrationId] : undefined;

            return (
              <article className={syncing ? 'compare-freshness-row syncing' : 'compare-freshness-row'} key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <span>
                    {sourceLabel} {row.lastRefreshedLabel}
                  </span>
                  {actionMessage ? <em className="compare-freshness-status">{actionMessage}</em> : null}
                </div>
                {row.canSync && syncIntegrationId ? (
                  <button
                    aria-busy={syncing}
                    className={syncing ? 'button secondary compact sync-busy' : 'button secondary compact'}
                    disabled={anySyncBusy}
                    onClick={() => {
                      if (clearOptimisticTimeoutRef.current != null) {
                        window.clearTimeout(clearOptimisticTimeoutRef.current);
                        clearOptimisticTimeoutRef.current = null;
                      }
                      syncStartedAtRef.current = Date.now();
                      setOptimisticSyncId(syncIntegrationId);
                      onSync(syncIntegrationId);
                    }}
                    type="button"
                  >
                    <RefreshCcw className={syncing ? 'sync-button-spin' : undefined} size={16} />
                    {syncing ? 'Syncing' : 'Sync'}
                  </button>
                ) : (
                  <span className="compare-freshness-import-note">File import</span>
                )}
              </article>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="button secondary" disabled={anySyncBusy} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button primary" disabled={anySyncBusy} onClick={onContinue} type="button">
            <Search size={17} />
            Continue compare
          </button>
        </div>
      </section>
    </div>
  );
}

function AgreementUpdateReviewModal(props: {
  applying: boolean;
  issues: ReconcileIssue[];
  message: string;
  onApply: (selectedIssueIds: string[]) => void;
  onClose: () => void;
}) {
  const { applying, issues, message, onApply, onClose } = props;
  const eligibleIssueIds = useMemo(
    () => issues.filter(isApplyEligibleIssue).map((issue) => issue.id),
    [issues],
  );
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>(eligibleIssueIds);
  const selectedIssueIdSet = new Set(selectedIssueIds);
  const selectedCount = issues.filter((issue) => selectedIssueIdSet.has(issue.id) && isApplyEligibleIssue(issue)).length;
  const discardedCount = issues.length - selectedCount;

  const toggleIssue = (issueId: string) => {
    setSelectedIssueIds((currentIds) =>
      currentIds.includes(issueId)
        ? currentIds.filter((currentId) => currentId !== issueId)
        : [...currentIds, issueId],
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="agreement-update-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-update-title">
        <div className="modal-header">
          <div>
            <h2 id="agreement-update-title">
              <ListChecks size={18} />
              Review & Apply
            </h2>
            <p>
              {selectedCount.toLocaleString()} selected / {discardedCount.toLocaleString()} discarded
            </p>
          </div>
          <button className="modal-close" disabled={applying} onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        {message ? <div className="agreement-update-message">{message}</div> : null}

        {issues.length === 0 ? (
          <div className="empty-state agreement-additions-empty">
            <ListChecks size={20} />
            <strong>No approved changes are queued.</strong>
          </div>
        ) : (
          <div className="agreement-update-list">
            {issues.map((issue) => {
              const addition = selectedAgreementAddition(issue);
              const blockReason = applyBlockReason(issue);
              const isSelected = selectedIssueIdSet.has(issue.id) && !blockReason;
              const currentQuantity = addition?.quantity ?? issue.invoiceCount;
              const nextQuantity = reconciliationSelectedCount(issue);
              const currentLess = addition?.lessIncluded ?? currentLessIncluded(issue);
              const nextLess = proposedLessIncluded(issue);

              return (
                <article className={blockReason ? 'agreement-update-row blocked' : 'agreement-update-row'} key={issue.id}>
                  <label className="agreement-update-select">
                    <input
                      checked={isSelected}
                      disabled={Boolean(blockReason) || applying}
                      onChange={() => toggleIssue(issue.id)}
                      type="checkbox"
                    />
                  </label>
                  <div>
                    <strong>{issue.customer}</strong>
                    <span>{issue.product}</span>
                  </div>
                  <div>
                    <strong>
                      {currentQuantity.toLocaleString()}
                      {' -> '}
                      {nextQuantity.toLocaleString()}
                    </strong>
                    <span>
                      {issue.vendor} {reconciliationCountSourceLabel(reconciliationCountSource(issue)).toLowerCase()}{' '}
                      {nextQuantity.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <strong>
                      {issue.lessIncludedTouched
                        ? `${currentLess.toLocaleString()} -> ${nextLess.toLocaleString()}`
                        : '-'}
                    </strong>
                    <span>Less Included Qty</span>
                  </div>
                  <div>
                    <strong>{addition?.connectWiseAdditionId ?? 'Blocked'}</strong>
                    <span>{addition ? addition.agreementName ?? 'Mapped agreement' : blockReason ?? 'Ready'}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="modal-actions">
          <button className="button secondary" disabled={applying} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            disabled={issues.length === 0 || applying}
            onClick={() => onApply(selectedIssueIds)}
            type="button"
          >
            <Check size={17} />
            {applying ? 'Applying' : 'Apply All'}
          </button>
        </div>
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

function LinkedCountTestModal(props: {
  customers: MappingCustomerOption[];
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onAgreementChange: (agreementId: string) => void;
  onClose: () => void;
  onCustomerChange: (customerId: string) => void;
  onRun: () => void;
  result: ProductLinkRuleTestResult | null;
  rule: ProductLinkRule;
  selectedAgreementId: string;
  selectedCustomerId: string;
}) {
  const {
    customers,
    loadState,
    message,
    onAgreementChange,
    onClose,
    onCustomerChange,
    onRun,
    result,
    rule,
    selectedAgreementId,
    selectedCustomerId,
  } = props;
  const selectedCustomer = customers.find((customer) => customer.customerId === selectedCustomerId);
  const agreementOptions = selectedCustomer?.agreements ?? [];
  const statusState = loadState === 'idle' ? 'ready' : loadState;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="linked-count-test-modal" role="dialog" aria-modal="true" aria-labelledby="linked-count-test-title">
        <div className="modal-header">
          <div>
            <h2 id="linked-count-test-title">
              <Search size={18} />
              Test Linked Count
            </h2>
            <p>{rule.ruleName}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="linked-count-test-controls">
          <label>
            <span>Customer</span>
            <select
              disabled={loadState === 'loading'}
              onChange={(event) => onCustomerChange(event.target.value)}
              value={selectedCustomerId}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.customerId} value={customer.customerId}>
                  {customer.customerName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Agreement</span>
            <select
              disabled={loadState === 'loading' || !selectedCustomer}
              onChange={(event) => onAgreementChange(event.target.value)}
              value={selectedAgreementId}
            >
              <option value="">All agreements</option>
              {agreementOptions.map((agreement) => (
                <option key={agreement.agreementId} value={agreement.agreementId}>
                  {agreement.agreementName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary compact"
            disabled={loadState === 'loading' || !selectedCustomerId}
            onClick={onRun}
            type="button"
          >
            <Search size={15} />
            {loadState === 'loading' ? 'Testing' : 'Run test'}
          </button>
        </div>

        <div className={`agreement-additions-status ${statusState}`}>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <span>{message}</span>
        </div>

        <div className="linked-count-test-summary">
          <IntegrationStat label="Total" value={(result?.total ?? 0).toLocaleString()} />
          <IntegrationStat label="Rows" value={(result?.rows.length ?? 0).toLocaleString()} />
          <IntegrationStat label="Sources" value={(result?.sourceTotals.length ?? rule.sources.length).toLocaleString()} />
        </div>

        <div className="linked-count-source-totals" aria-label="Linked count source totals">
          {result ? (
            (result.sourceTotals.length > 0
              ? result.sourceTotals
              : rule.sources.map((source) => ({
                  sourceType: source.sourceType,
                  label: productLinkRuleSourceLabel(source),
                  quantity: 0,
                  rowCount: 0,
                }))
            ).map((sourceTotal) => (
              <article key={`${sourceTotal.sourceType}-${sourceTotal.label}`}>
                <strong>{sourceTotal.label}</strong>
                <span>
                  {sourceTotal.quantity.toLocaleString()} from {sourceTotal.rowCount.toLocaleString()} row
                  {sourceTotal.rowCount === 1 ? '' : 's'}
                </span>
              </article>
            ))
          ) : (
            (rule.sources.length > 0 ? rule.sources : [{ sourceType: 'connectwise-addition' as const, productCode: 'Source' }]).map(
              (source, index) => (
                <article key={`${source.sourceType}-${index}`}>
                  <strong>{productLinkRuleSourceLabel(source)}</strong>
                  <span>Run the test to load source totals.</span>
                </article>
              ),
            )
          )}
        </div>

        <div className="agreement-additions-table-scroll linked-count-test-table-scroll">
          <table className="agreement-additions-table linked-count-test-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Row</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Observed</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {result?.rows.map((row) => (
                <tr key={`${row.sourceType}-${row.rowId}`}>
                  <td>{row.sourceLabel}</td>
                  <td>
                    <strong>{row.rowLabel}</strong>
                    <span>{row.externalAccountId ?? row.rowId}</span>
                  </td>
                  <td>
                    <strong>{row.productName ?? row.productCode ?? row.productKey ?? '-'}</strong>
                    <span>{row.productCode ?? row.productKey ?? '-'}</span>
                  </td>
                  <td>{row.quantity.toLocaleString()}</td>
                  <td>{formatDateTime(row.observedAt) ?? '-'}</td>
                  <td>{formatLinkedCountTestDetails(row.details)}</td>
                </tr>
              ))}
              {result && result.rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No rows contributed to this linked count for the selected scope.</td>
                </tr>
              ) : null}
              {!result ? (
                <tr>
                  <td colSpan={6}>Run the test to show the rows behind this linked count.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
  creating: boolean;
  notes: string;
  onClose: () => void;
  onCreate: () => void;
  onNotesChange: (notes: string) => void;
  onToggleIssue: (issueId: string) => void;
  selectedIssueIds: string[];
}) {
  const { client, creating, notes, onClose, onCreate, onNotesChange, onToggleIssue, selectedIssueIds } = props;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="ticket-modal-title">
              <ListChecks size={18} />
              Create Investigation Ticket
            </h2>
            <p>Select licenses to investigate for {client.customer}. Summary will be Billing Review per integration.</p>
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
                disabled={creating}
                onChange={() => onToggleIssue(issue.id)}
                type="checkbox"
              />
              <span>
                <strong>{issue.product}</strong>
                <em>
                  {issue.vendor} / API {issue.sourceCount}
                  {' / Inv. '}
                  {typeof validVendorInvoiceCount(issue) === 'number' ? validVendorInvoiceCount(issue) : 'n/a'}
                  {' / Linked '}
                  {typeof validLinkedCount(issue) === 'number' ? validLinkedCount(issue) : 'n/a'}
                  {' -> CW '}
                  {issue.invoiceCount}
                </em>
              </span>
            </label>
          ))}
        </div>

        <label className="ticket-notes">
          <span>Ticket Notes</span>
          <textarea
            disabled={creating}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Add details for the investigation ticket..."
            value={notes}
          />
        </label>

        <div className="modal-actions">
          <button className="button secondary" disabled={creating} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            disabled={creating || selectedIssueIds.length === 0}
            onClick={onCreate}
            type="button"
          >
            <ListChecks size={17} />
            {creating ? 'Creating...' : `Create Ticket (${selectedIssueIds.length})`}
          </button>
        </div>
      </section>
    </div>
  );
}

function InvestigationTicketsModal(props: {
  customer: string;
  onClose: () => void;
  reconciliationMonth: string;
  vendor: string;
  vendorId: VendorKey;
}) {
  const { customer, onClose, reconciliationMonth, vendor, vendorId } = props;
  const [tickets, setTickets] = useState<InvestigationTicketRecord[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('Loading investigation tickets...');
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [timeEntriesByTicket, setTimeEntriesByTicket] = useState<
    Record<string, { state: 'loading' | 'ready' | 'failed'; message: string; entries: InvestigationTicketTimeEntry[] }>
  >({});

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setMessage('Loading investigation tickets...');
    void fetchInvestigationTickets({
      vendorId,
      customerName: customer,
      reconciliationMonth,
    })
      .then((response) => {
        if (cancelled) return;
        setTickets(response.tickets);
        setLoadState('ready');
        setMessage(
          response.tickets.length > 0
            ? `${response.tickets.length.toLocaleString()} ticket${response.tickets.length === 1 ? '' : 's'} this month.`
            : 'No investigation tickets for this vendor in the reconciliation month.',
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setTickets([]);
        setLoadState('failed');
        setMessage(error instanceof Error ? error.message : 'Unable to load investigation tickets.');
      });

    return () => {
      cancelled = true;
    };
  }, [customer, reconciliationMonth, vendorId]);

  const toggleTicket = async (ticketId: string) => {
    if (expandedTicketId === ticketId) {
      setExpandedTicketId(null);
      return;
    }

    setExpandedTicketId(ticketId);
    if (timeEntriesByTicket[ticketId]?.state === 'ready' || timeEntriesByTicket[ticketId]?.state === 'loading') {
      return;
    }

    setTimeEntriesByTicket((current) => ({
      ...current,
      [ticketId]: { state: 'loading', message: 'Loading time entries...', entries: [] },
    }));

    try {
      const response = await fetchInvestigationTicketTimeEntries(ticketId);
      setTimeEntriesByTicket((current) => ({
        ...current,
        [ticketId]: {
          state: 'ready',
          message:
            response.timeEntries.length > 0
              ? `${response.timeEntries.length.toLocaleString()} time entries`
              : 'No time entries on this ticket yet.',
          entries: response.timeEntries,
        },
      }));
    } catch (error) {
      setTimeEntriesByTicket((current) => ({
        ...current,
        [ticketId]: {
          state: 'failed',
          message: error instanceof Error ? error.message : 'Unable to load time entries.',
          entries: [],
        },
      }));
    }
  };

  const monthLabel = reconciliationMonth.slice(0, 7);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="ticket-modal investigation-tickets-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="investigation-tickets-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="investigation-tickets-title">
              <ListChecks size={18} />
              {vendor} investigation tickets
            </h2>
            <p>
              {customer} · {monthLabel}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <p className="config-note">{message}</p>

        {loadState === 'loading' ? (
          <div className="empty-state">
            <ListChecks size={20} />
            <strong>Loading tickets...</strong>
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state">
            <ListChecks size={20} />
            <strong>No tickets this month.</strong>
            <span>Create an investigation ticket from the client Ticket action.</span>
          </div>
        ) : (
          <div className="investigation-ticket-list">
            {tickets.map((ticket) => {
              const expanded = expandedTicketId === ticket.id;
              const timeEntries = timeEntriesByTicket[ticket.id];
              return (
                <article className="investigation-ticket-card" key={ticket.id}>
                  <button
                    className="investigation-ticket-toggle"
                    onClick={() => void toggleTicket(ticket.id)}
                    type="button"
                  >
                    <ChevronRight className={expanded ? 'chevron open' : 'chevron'} size={16} />
                    <span>
                      <strong>#{ticket.connectWiseTicketNumber}</strong>
                      <em>{formatDateTime(ticket.createdAt) ?? ticket.createdAt}</em>
                    </span>
                    <span>{ticket.products.length.toLocaleString()} products</span>
                  </button>
                  <ul className="investigation-ticket-products">
                    {ticket.products.map((product) => (
                      <li key={`${ticket.id}:${product.sourceLineId}:${product.productCode}`}>
                        <strong>{product.productName}</strong>
                        <em>
                          {product.productCode}
                          {product.delta != null ? ` · delta ${product.delta}` : ''}
                        </em>
                      </li>
                    ))}
                  </ul>
                  {expanded ? (
                    <div className="investigation-ticket-time-entries">
                      <strong>Time entries</strong>
                      <p className="config-note">{timeEntries?.message ?? 'Loading time entries...'}</p>
                      {(timeEntries?.entries ?? []).length > 0 ? (
                        <ul>
                          {timeEntries.entries.map((entry) => (
                            <li key={entry.id}>
                              <strong>{entry.memberName ?? 'Unknown member'}</strong>
                              <em>
                                {entry.actualHours != null ? `${entry.actualHours}h` : 'n/a'}
                                {entry.timeStart ? ` · ${formatDateTime(entry.timeStart) ?? entry.timeStart}` : ''}
                                {entry.workType ? ` · ${entry.workType}` : ''}
                              </em>
                              {entry.notes ? <span>{entry.notes}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        <div className="modal-actions">
          <button className="button secondary" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function ManualOverrideModal(props: {
  agreementAdditions: Array<AgreementAddition | ReconciliationMatchedAgreementAddition>;
  issue: ReconcileIssue;
  message: string;
  onClose: () => void;
  onAdditionPinSave: (
    issue: ReconcileIssue,
    addition: AgreementAddition | ReconciliationMatchedAgreementAddition,
  ) => Promise<boolean>;
  onDeviceRemapsSave: (
    issue: ReconcileIssue,
    remaps: Array<{ device: ReconciliationDevice; targetVendorProductKey: string }>,
  ) => Promise<boolean>;
  onLessCountSave: (issue: ReconcileIssue, quantity: number) => Promise<boolean>;
  onLoadAgreementAdditions: () => Promise<Array<AgreementAddition | ReconciliationMatchedAgreementAddition>>;
  onManualTotalSave: (issue: ReconcileIssue, quantity: number) => Promise<boolean>;
  productOptions: ReconciliationProductOption[];
  saving: boolean;
}) {
  const {
    agreementAdditions,
    issue,
    message,
    onClose,
    onAdditionPinSave,
    onDeviceRemapsSave,
    onLessCountSave,
    onLoadAgreementAdditions,
    onManualTotalSave,
    productOptions,
    saving,
  } = props;
  const [manualTotal, setManualTotal] = useState(
    String(validManualOverrideTotal(issue) ?? reconciliationSelectedCount(issue)),
  );
  const [lessCount, setLessCount] = useState(String(proposedLessIncluded(issue)));
  const [remapTargets, setRemapTargets] = useState<Record<string, string>>({});
  const [pinAdditions, setPinAdditions] = useState(agreementAdditions);
  const [pinAdditionId, setPinAdditionId] = useState(issue.connectWiseAdditionId ?? '');
  const [loadingPinAdditions, setLoadingPinAdditions] = useState(false);
  const manualTotalValue = Number(manualTotal);
  const lessCountValue = Number(lessCount);
  const selectedAddition = selectedAgreementAddition(issue);
  const blockReason = applyBlockReason(issue);
  const canSaveManualTotal = Number.isFinite(manualTotalValue) && manualTotalValue >= 0 && !saving && !blockReason;
  const canSaveLessCount = Number.isFinite(lessCountValue) && lessCountValue >= 0 && !saving && !blockReason;
  const pendingRemaps = issue.devices.flatMap((device) => {
    const targetVendorProductKey = remapTargets[device.id]?.trim() ?? '';
    if (!targetVendorProductKey || targetVendorProductKey === device.vendorProductKey) {
      return [];
    }
    return [{ device, targetVendorProductKey }];
  });
  const hasRemapChanges = pendingRemaps.length > 0;
  const selectedPinAddition = pinAdditions.find((addition) => addition.connectWiseAdditionId === pinAdditionId);
  const canSavePin =
    Boolean(issue.vendorProductKey) &&
    Boolean(selectedPinAddition) &&
    selectedPinAddition?.connectWiseAdditionId !== issue.connectWiseAdditionId &&
    !saving;

  useEffect(() => {
    setPinAdditions(agreementAdditions);
    setPinAdditionId(issue.connectWiseAdditionId ?? '');
  }, [agreementAdditions, issue.connectWiseAdditionId, issue.id]);

  useEffect(() => {
    let cancelled = false;
    if (pinAdditions.length > 0 || !issue.vendorProductKey) {
      return;
    }
    setLoadingPinAdditions(true);
    void onLoadAgreementAdditions()
      .then((additions) => {
        if (!cancelled) {
          setPinAdditions(additions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPinAdditions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPinAdditions(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [issue.id, issue.vendorProductKey, onLoadAgreementAdditions, pinAdditions.length]);

  const updateRemapTarget = (deviceId: string, value: string) => {
    setRemapTargets((current) => {
      const next = { ...current };
      if (value) {
        next[deviceId] = value;
      } else {
        delete next[deviceId];
      }
      return next;
    });
  };

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
          <IntegrationStat label="API Count" value={issue.sourceCount.toLocaleString()} />
          <IntegrationStat label="Inv. Count" value={formatOptionalCount(issue.vendorInvoiceCount)} />
          <IntegrationStat label="CW Count" value={cwCountLabel(issue)} />
          <IntegrationStat label="Change To" value={reconciliationSelectedCount(issue).toLocaleString()} />
          <IntegrationStat label="Impact" value={formatCurrency(reconciliationIssueImpact(issue))} />
        </div>

        <div className="manual-override-body">
          {issue.vendorProductKey ? (
            <section className="manual-section" aria-label="Agreement addition pin">
              <div className="manual-section-header">
                <span className="section-kicker">Pin to agreement addition</span>
                <strong>{issue.unit || issue.vendorProductKey}</strong>
              </div>
              <div className="cw-addition-context">
                <span>
                  Choose which ConnectWise addition this vendor product should reconcile against for {issue.customer}.
                </span>
              </div>
              <div className="manual-pin-form">
                <label>
                  <span>Agreement addition</span>
                  <select
                    disabled={saving || loadingPinAdditions || pinAdditions.length === 0}
                    onChange={(event) => setPinAdditionId(event.target.value)}
                    value={pinAdditionId}
                  >
                    <option value="">
                      {loadingPinAdditions ? 'Loading additions...' : 'Select CW addition'}
                    </option>
                    {pinAdditions.map((addition) => (
                      <option key={addition.connectWiseAdditionId} value={addition.connectWiseAdditionId}>
                        {`CW ${addition.connectWiseAdditionId} · ${addition.productName} · qty ${addition.quantity.toLocaleString()}${
                          addition.unitPrice ? ` · ${formatCurrency(addition.unitPrice.amount)}` : ''
                        }`}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary compact"
                  disabled={!canSavePin}
                  onClick={() => {
                    if (selectedPinAddition) {
                      void onAdditionPinSave(issue, selectedPinAddition);
                    }
                  }}
                  type="button"
                >
                  <Check size={16} />
                  Save Pin
                </button>
              </div>
            </section>
          ) : null}

          <section className="manual-section" aria-label="Manual total update">
            <div className="manual-section-header">
              <span className="section-kicker">Manual Override Total</span>
              <strong>{reconciliationSelectedCount(issue).toLocaleString()} selected</strong>
            </div>
            <div className="cw-addition-context">
              {selectedAddition ? (
                <span>{formatMatchedAgreementAdditionContext(selectedAddition)}</span>
              ) : (
                <span>{blockReason ?? 'Select an active CW addition before applying.'}</span>
              )}
            </div>
            <div className="manual-count-form">
              <label>
                <span>Total Count</span>
                <input
                  min="0"
                  onChange={(event) => setManualTotal(event.target.value)}
                  step="1"
                  type="number"
                  value={manualTotal}
                />
              </label>
              <button
                className="button primary compact"
                disabled={!canSaveManualTotal}
                onClick={() => void onManualTotalSave(issue, manualTotalValue)}
                type="button"
              >
                <Check size={16} />
                Queue Total
              </button>
            </div>
            {issue.manualOverrideTotalTouched && typeof issue.manualOverrideTotal === 'number' ? (
              <div className="adjustment-chip-list" aria-label="Queued manual total update">
                <span>
                  Queued total {issue.manualOverrideTotal.toLocaleString()}
                  {' '}
                  ({deltaLabel(issue.manualOverrideTotal - issue.invoiceCount)})
                </span>
              </div>
            ) : null}
          </section>

          <section className="manual-section" aria-label="Less Included Qty update">
            <div className="manual-section-header">
              <span className="section-kicker">Less Included Qty</span>
              <strong>{currentLessIncluded(issue).toLocaleString()} current</strong>
            </div>
            <div className="cw-addition-context">
              {selectedAddition ? (
                <span>{formatMatchedAgreementAdditionContext(selectedAddition)}</span>
              ) : (
                <span>{blockReason ?? 'Select an active CW addition before applying.'}</span>
              )}
            </div>
            <div className="less-count-form">
              <label>
                <span>Less Qty</span>
                <input
                  min="0"
                  onChange={(event) => setLessCount(event.target.value)}
                  step="1"
                  type="number"
                  value={lessCount}
                />
              </label>
              <button
                className="button primary compact"
                disabled={!canSaveLessCount}
                onClick={() => void onLessCountSave(issue, lessCountValue)}
                type="button"
              >
                <Check size={16} />
                Queue Less Qty
              </button>
            </div>
            {issue.lessIncludedTouched ? (
              <div className="adjustment-chip-list" aria-label="Queued less-included update">
                <span>
                  Queued less {proposedLessIncluded(issue).toLocaleString()}
                  {' '}
                  ({deltaLabel(proposedLessIncluded(issue) - currentLessIncluded(issue))})
                </span>
              </div>
            ) : null}
          </section>

          <section className="manual-section" aria-label="Source device remapping">
            <div className="manual-section-header">
              <span className="section-kicker">Source devices</span>
              <strong>
                {issue.devices.length.toLocaleString()} rows
                {hasRemapChanges ? ` / ${pendingRemaps.length.toLocaleString()} remapped` : ''}
              </strong>
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
                        aria-label={`Remap ${deviceDisplayName(device)}`}
                        disabled={saving || targetOptions.length === 0}
                        onChange={(event) => updateRemapTarget(device.id, event.target.value)}
                        value={selectedTarget}
                      >
                        <option value="">Keep current product</option>
                        {targetOptions.map((option) => (
                          <option key={option.vendorProductKey} value={option.vendorProductKey}>
                            {option.productName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {message ? <p className="config-note manual-message">{message}</p> : null}
        </div>

        <div className="manual-override-actions">
          <button className="button secondary" disabled={saving} onClick={onClose} type="button">
            Close
          </button>
          {hasRemapChanges ? (
            <button
              className="button primary"
              disabled={saving}
              onClick={() => void onDeviceRemapsSave(issue, pendingRemaps)}
              type="button"
            >
              <Check size={16} />
              {saving ? 'Saving...' : `Save (${pendingRemaps.length})`}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function IntegrationsView(props: {
  actionMessages: Partial<Record<IntegrationId, string>>;
  busyAction: IntegrationActionKey | null;
  busyInvoiceReviewAction: string | null;
  invoiceCustomerOptions: MappingCustomerOption[];
  invoiceImportIntegrations: Integration[];
  invoiceImportMode: InvoiceImportMode;
  invoiceImports: InvoiceImportSummary[];
  invoiceImporting: boolean;
  invoiceLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  invoiceMessage: string;
  invoiceReview: InvoiceImportExceptionReview | null;
  invoiceReviewLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  invoiceReviewMessage: string;
  loadMessage: string;
  loadState: 'loading' | 'ready' | 'failed';
  integrations: Integration[];
  onConfigure: (integration: Integration) => void;
  onInvoiceAccountMappingSave: (account: InvoiceAccountException, customerId: string, agreementId: string) => Promise<boolean>;
  onInvoiceCloseReview: () => void;
  onInvoiceIntegrationChange: (vendorId: VendorKey | '') => void;
  onInvoiceProductCatalogSearch: (query: string) => Promise<ProductCatalogSearchResponse>;
  onInvoiceProductMappingSave: (product: InvoiceProductException, target: ProductMappingTarget) => Promise<boolean>;
  onInvoiceRefreshReview: () => Promise<InvoiceImportExceptionReview | null>;
  onInvoiceReviewImport: (invoiceImport: InvoiceImportSummary) => Promise<InvoiceImportExceptionReview | null>;
  onInvoiceTableUpload: (
    integrationId: VendorKey,
    file: File,
    columnMap: InvoiceTableColumnMap,
    sourceType: IntegrationDataSourceType,
    importMode: InvoiceImportMode,
    syncMode: ManualImportSyncMode,
    linkedIntegrationId?: IntegrationId,
  ) => Promise<InvoiceImportSummary | null>;
  onInvoiceUpload: (file: File, importMode: InvoiceImportMode) => Promise<InvoiceImportSummary | null>;
  onOpenMappings: (integrationId: VendorKey) => void;
  onRefresh: () => Promise<RuntimeIntegrationsResponse | null>;
  selectedInvoiceIntegrationId: VendorKey | '';
  setInvoiceImportMode: (value: InvoiceImportMode) => void;
  onSync: (integrationId: IntegrationId, target?: IntegrationSyncTarget) => void;
  onTest: (integrationId: IntegrationId) => void;
  vendorDatapoints: VendorDatapointRecord[];
  vendorDatapointLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  vendorDatapointMessage: string;
  selectedVendorDatapointId: string | null;
  onCreateVendorDatapoint: () => void;
  onEditVendorDatapoint: (datapointId: string) => void;
  onSelectVendorDatapoint: (datapointId: string | null) => void;
  onImportVendorDatapoint: (
    datapoint: VendorDatapointRecord,
    file: File,
    columnMap: InvoiceTableColumnMap,
    persistColumnMap: boolean,
  ) => Promise<{ datapoint: VendorDatapointRecord; import: InvoiceImportSummary }>;
  onSaveVendorDatapointMapping: (
    datapoint: VendorDatapointRecord,
    columnMap: InvoiceTableColumnMap,
    knownHeaders?: string[],
  ) => Promise<VendorDatapointRecord>;
  onDeleteDatapointImport: (datapoint: VendorDatapointRecord, invoiceImport: InvoiceImportSummary) => Promise<void>;
  onUpdateVendorDatapoint: (datapointId: string, payload: UpdateVendorDatapointInput) => Promise<VendorDatapointRecord>;
}) {
  const {
    actionMessages,
    busyAction,
    busyInvoiceReviewAction,
    invoiceCustomerOptions,
    invoiceImportIntegrations,
    invoiceImportMode,
    invoiceImports,
    invoiceImporting,
    invoiceLoadState,
    invoiceMessage,
    invoiceReview,
    invoiceReviewLoadState,
    invoiceReviewMessage,
    integrations,
    loadMessage,
    loadState,
    onConfigure,
    onInvoiceAccountMappingSave,
    onInvoiceCloseReview,
    onInvoiceIntegrationChange,
    onInvoiceProductCatalogSearch,
    onInvoiceProductMappingSave,
    onInvoiceRefreshReview,
    onInvoiceReviewImport,
    onInvoiceTableUpload,
    onInvoiceUpload,
    onOpenMappings,
    onRefresh,
    onSync,
    onTest,
    selectedInvoiceIntegrationId,
    setInvoiceImportMode,
    vendorDatapoints,
    vendorDatapointLoadState,
    vendorDatapointMessage,
    selectedVendorDatapointId,
    onCreateVendorDatapoint,
    onEditVendorDatapoint,
    onSelectVendorDatapoint,
    onImportVendorDatapoint,
    onSaveVendorDatapointMapping,
    onDeleteDatapointImport,
    onUpdateVendorDatapoint,
  } = props;
  const [managementTab, setManagementTab] = useState<'api' | 'invoice' | 'datapoints'>('api');
  const connectedCount = integrations.filter((integration) => integration.status === 'connected').length;
  const degradedCount = integrations.filter((integration) => integration.status === 'degraded').length;
  const activeIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => isActiveApiIntegration(integration)),
  );
  const availableIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => isImplementedIntegration(integration.id) && !isActiveApiIntegration(integration)),
  );
  const comingSoonIntegrations = sortIntegrationsForDisplay(
    integrations.filter((integration) => !isImplementedIntegration(integration.id)),
  );
  const selectedVendorDatapoint = selectedVendorDatapointId
    ? vendorDatapoints.find((datapoint) => datapoint.id === selectedVendorDatapointId)
    : undefined;

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
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="integration-management-tabs">
        <div className="segmented-control" role="tablist" aria-label="Integration management mode">
          {([
            { id: 'api' as const, label: 'API' },
            { id: 'datapoints' as const, label: 'Vendor datapoints' },
            { id: 'invoice' as const, label: 'Invoice' },
          ]).map((tab) => (
            <button
              aria-selected={managementTab === tab.id}
              className={managementTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setManagementTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {managementTab === 'api' ? (
        <>
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
            <details className="integration-drawer">
              <summary>
                <div>
                  <strong>Inactive Integrations</strong>
                  <span>{availableIntegrations.length} not configured or invoice-only</span>
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
        </>
      ) : managementTab === 'datapoints' ? (
        <VendorDatapointsView
          datapoints={vendorDatapoints}
          integrations={integrations}
          loadState={vendorDatapointLoadState}
          message={vendorDatapointMessage}
          onCreate={onCreateVendorDatapoint}
          onEdit={onEditVendorDatapoint}
          onImport={onImportVendorDatapoint}
          onOpenMappings={(vendorId) => onOpenMappings(vendorId)}
          onSaveMapping={onSaveVendorDatapointMapping}
          onDeleteImport={onDeleteDatapointImport}
          onSelect={onSelectVendorDatapoint}
          selectedDatapoint={selectedVendorDatapoint}
        />
      ) : (
        <ImportsView
          busyReviewAction={busyInvoiceReviewAction}
          customerOptions={invoiceCustomerOptions}
          importing={invoiceImporting}
          importMode={invoiceImportMode}
          imports={invoiceImports}
          integrations={invoiceImportIntegrations}
          loadState={invoiceLoadState}
          message={invoiceMessage}
          onAccountMappingSave={onInvoiceAccountMappingSave}
          onCloseReview={onInvoiceCloseReview}
          onProductCatalogSearch={onInvoiceProductCatalogSearch}
          onProductMappingSave={onInvoiceProductMappingSave}
          onRefreshReview={onInvoiceRefreshReview}
          onReviewImport={onInvoiceReviewImport}
          onTableUpload={onInvoiceTableUpload}
          onUpload={onInvoiceUpload}
          onVendorChange={onInvoiceIntegrationChange}
          review={invoiceReview}
          reviewLoadState={invoiceReviewLoadState}
          reviewMessage={invoiceReviewMessage}
          selectedVendorId={selectedInvoiceIntegrationId}
          setImportMode={setInvoiceImportMode}
          vendorDatapoints={vendorDatapoints}
        />
      )}
    </section>
  );
}

function vendorDatapointSourceLabel(sourceType: string) {
  if (sourceType === 'device-count') return 'Device counts';
  if (sourceType === 'license-count') return 'License counts';
  if (sourceType === 'invoice') return 'Invoices';
  if (sourceType === 'user-license-detail') return 'User detail';
  if (sourceType === 'reseller-product-total') return 'Product totals';
  return 'Customer products';
}

function updateInvoiceTableColumnMap(
  current: InvoiceTableColumnMap,
  key: keyof InvoiceTableColumnMap,
  value: string,
) {
  const next = { ...current };
  if (value) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function InvoiceColumnMapGrid(props: {
  columnMap: InvoiceTableColumnMap;
  disabled?: boolean;
  headerOptions: string[];
  onChange: (key: keyof InvoiceTableColumnMap, value: string) => void;
  sourceType: IntegrationDataSourceType | string;
  requiresCustomerMapping?: boolean;
}) {
  const { columnMap, disabled = false, headerOptions, onChange, sourceType, requiresCustomerMapping = true } = props;
  const mappingDisabled = disabled || headerOptions.length === 0;

  return (
    <div className="invoice-column-map-groups">
      {invoiceTableFieldGroups.map((group) => (
        <section className="invoice-column-map-group" key={group.id}>
          <h3>{group.label}</h3>
          <div className="invoice-column-map-grid">
            {group.keys.map((fieldKey) => {
              const field = invoiceTableFieldDefinitions.find((item) => item.key === fieldKey);
              if (!field) {
                return null;
              }

              const required =
                (field.key === 'externalAccountId' && requiresCustomerMapping) ||
                (field.key === 'quantity' && importRequiresQuantityColumn(sourceType)) ||
                isRequiredSourceColumn(sourceType as IntegrationDataSourceType, field.key, columnMap);
              const selectOptions =
                field.key === 'quantity'
                  ? quantityColumnSelectOptions(sourceType, headerOptions)
                  : [
                      { value: '', label: 'Ignore' },
                      ...headerOptions.map((header) => ({ value: header, label: header })),
                    ];

              return (
                <label className="config-field" key={field.key}>
                  <span>{required ? `${field.label} *` : field.label}</span>
                  <select
                    disabled={mappingDisabled}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    value={columnMap[field.key] ?? ''}
                  >
                    {selectOptions.map((option) => (
                      <option key={`${field.key}:${option.value || 'blank'}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function CreateVendorDatapointModal(props: {
  integrations: Integration[];
  onClose: () => void;
  onCreate: (payload: CreateVendorDatapointInput) => Promise<VendorDatapointRecord>;
}) {
  const { integrations, onClose, onCreate } = props;
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [linkedIntegrationId, setLinkedIntegrationId] = useState<IntegrationId | ''>('');
  const [sourceType, setSourceType] = useState<IntegrationDataSourceType>('customer-product-breakdown');
  const [syncMode, setSyncMode] = useState<ManualImportSyncMode>('full-vendor-sync');
  const [message, setMessage] = useState('Name this vendor datapoint and choose what the file contains.');
  const [saving, setSaving] = useState(false);
  const linkableIntegrations = integrations.filter(
    (integration) => integrationHasCapability(integration.id, 'mapping') && integration.id !== 'custom-table',
  );

  useEffect(() => {
    if (sourceType === 'device-count' || sourceType === 'license-count') {
      setSyncMode('full-vendor-sync');
    }
  }, [sourceType]);

  const submit = async () => {
    if (!displayName.trim()) {
      setMessage('Enter a display name for this vendor datapoint.');
      return;
    }

    setSaving(true);
    setMessage('Creating vendor datapoint...');
    try {
      await onCreate({
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        linkedIntegrationId: linkedIntegrationId || undefined,
        sourceType,
        syncMode,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create vendor datapoint.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-labelledby="create-vendor-datapoint-title" className="modal-card integration-modal" role="dialog">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Vendor datapoint</span>
            <h2 id="create-vendor-datapoint-title">Create vendor datapoint</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </div>
        <div className="integration-modal-body">
          <label className="config-field">
            <span>Display name *</span>
            <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label className="config-field">
            <span>Description</span>
            <input onChange={(event) => setDescription(event.target.value)} value={description} />
          </label>
          <label className="config-field">
            <span>Linked integration</span>
            <select onChange={(event) => setLinkedIntegrationId(event.target.value as IntegrationId | '')} value={linkedIntegrationId}>
              <option value="">Standalone vendor datapoint</option>
              {linkableIntegrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                </option>
              ))}
            </select>
          </label>
          <label className="config-field">
            <span>Source type *</span>
            <select onChange={(event) => setSourceType(event.target.value as IntegrationDataSourceType)} value={sourceType}>
              <option value="customer-product-breakdown">Customer products</option>
              <option value="device-count">Device counts</option>
              <option value="license-count">License counts</option>
              <option value="invoice">Invoices</option>
              <option value="user-license-detail">User license detail</option>
              <option value="reseller-product-total">Reseller product totals</option>
            </select>
          </label>
          <div className="segmented-control invoice-source-toggle" role="group" aria-label="Vendor datapoint sync mode">
            <button className={syncMode === 'full-vendor-sync' ? 'active' : ''} onClick={() => setSyncMode('full-vendor-sync')} type="button">
              Full sync
            </button>
            <button className={syncMode === 'info-only' ? 'active' : ''} onClick={() => setSyncMode('info-only')} type="button">
              Info only
            </button>
          </div>
          {(sourceType === 'device-count' || sourceType === 'license-count') && (
            <p className="config-note">
              Use Full sync when you want this import included in reconciliation after product mappings are approved.
            </p>
          )}
          <p className="config-note">{message}</p>
        </div>
        <div className="integration-modal-actions">
          <button className="button secondary" disabled={saving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button primary" disabled={saving} onClick={() => void submit()} type="button">
            {saving ? 'Creating' : 'Create datapoint'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditVendorDatapointModal(props: {
  datapoint?: VendorDatapointRecord;
  integrations: Integration[];
  onClose: () => void;
  onUpdate: (datapointId: string, payload: UpdateVendorDatapointInput) => Promise<VendorDatapointRecord>;
}) {
  const { datapoint, integrations, onClose, onUpdate } = props;
  const [displayName, setDisplayName] = useState(datapoint?.displayName ?? '');
  const [description, setDescription] = useState(datapoint?.description ?? '');
  const [linkedIntegrationId, setLinkedIntegrationId] = useState<IntegrationId | ''>(datapoint?.linkedIntegrationId ?? '');
  const [sourceType, setSourceType] = useState<IntegrationDataSourceType>(
    (datapoint?.sourceType as IntegrationDataSourceType) ?? 'customer-product-breakdown',
  );
  const [syncMode, setSyncMode] = useState<ManualImportSyncMode>(datapoint?.syncMode ?? 'full-vendor-sync');
  const [columnMap, setColumnMap] = useState<InvoiceTableColumnMap>(datapoint?.columnMap ?? {});
  const [knownHeaders, setKnownHeaders] = useState<string[]>(datapoint?.knownHeaders ?? []);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [message, setMessage] = useState('Update datapoint settings and column mappings.');
  const [saving, setSaving] = useState(false);
  const linkableIntegrations = integrations.filter(
    (integration) => integrationHasCapability(integration.id, 'mapping') && integration.id !== 'custom-table',
  );
  const headerOptions = columnMappingHeaderOptions(columnMap, fileHeaders, knownHeaders);
  const mappingReady = columnMapSatisfiesSourceType(sourceType, columnMap);

  useEffect(() => {
    if (!datapoint) {
      return;
    }

    setDisplayName(datapoint.displayName);
    setDescription(datapoint.description ?? '');
    setLinkedIntegrationId(datapoint.linkedIntegrationId ?? '');
    setSourceType(datapoint.sourceType as IntegrationDataSourceType);
    setSyncMode(datapoint.syncMode);
    setColumnMap(datapoint.columnMap);
    setKnownHeaders(datapoint.knownHeaders);
    setFileHeaders([]);
    setMessage('Update datapoint settings and column mappings.');
  }, [datapoint?.id]);

  const handleSampleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!nextFile) {
      return;
    }

    try {
      const table = await readImportTableFile(nextFile);
      const nextKnownHeaders = mergeKnownHeaders(knownHeaders, table.headers);
      const nextMap = mergeInvoiceTableColumnMap(columnMap, table.headers, sourceType);
      setKnownHeaders(nextKnownHeaders);
      setFileHeaders(table.headers);
      setColumnMap(Object.keys(nextMap).length > 0 ? nextMap : suggestInvoiceTableColumnMap(table.headers, sourceType));
      setMessage(`Loaded ${table.headers.length.toLocaleString()} headers from ${nextFile.name}. Review the column map.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read sample file headers.');
    }
  };

  const updateColumn = (key: keyof InvoiceTableColumnMap, value: string) => {
    setColumnMap((current) => updateInvoiceTableColumnMap(current, key, value));
  };

  const submit = async () => {
    if (!datapoint) {
      return;
    }

    if (!displayName.trim()) {
      setMessage('Enter a display name for this vendor datapoint.');
      return;
    }

    if (!mappingReady) {
      setMessage('Map the required columns for this source type before saving.');
      return;
    }

    setSaving(true);
    setMessage('Saving vendor datapoint...');
    try {
      await onUpdate(datapoint.id, {
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        linkedIntegrationId: linkedIntegrationId || null,
        sourceType,
        syncMode,
        columnMap,
        knownHeaders: mergeKnownHeaders(knownHeaders, fileHeaders, mappedColumnHeaders(columnMap)),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update vendor datapoint.');
      setSaving(false);
    }
  };

  if (!datapoint) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-labelledby="edit-vendor-datapoint-title" className="modal-card integration-modal vendor-datapoint-edit-modal" role="dialog">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Vendor datapoint</span>
            <h2 id="edit-vendor-datapoint-title">Edit {datapoint.displayName}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </div>
        <div className="integration-modal-body">
          <label className="config-field">
            <span>Display name *</span>
            <input disabled={saving} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label className="config-field">
            <span>Description</span>
            <input disabled={saving} onChange={(event) => setDescription(event.target.value)} value={description} />
          </label>
          <label className="config-field">
            <span>Linked integration</span>
            <select
              disabled={saving}
              onChange={(event) => setLinkedIntegrationId(event.target.value as IntegrationId | '')}
              value={linkedIntegrationId}
            >
              <option value="">Standalone vendor datapoint</option>
              {linkableIntegrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                </option>
              ))}
            </select>
          </label>
          <label className="config-field">
            <span>Source type *</span>
            <select
              disabled={saving}
              onChange={(event) => setSourceType(event.target.value as IntegrationDataSourceType)}
              value={sourceType}
            >
              <option value="customer-product-breakdown">Customer products</option>
              <option value="device-count">Device counts</option>
              <option value="license-count">License counts</option>
              <option value="invoice">Invoices</option>
              <option value="user-license-detail">User license detail</option>
              <option value="reseller-product-total">Reseller product totals</option>
            </select>
          </label>
          <div className="segmented-control invoice-source-toggle" role="group" aria-label="Vendor datapoint sync mode">
            <button
              className={syncMode === 'full-vendor-sync' ? 'active' : ''}
              disabled={saving}
              onClick={() => setSyncMode('full-vendor-sync')}
              type="button"
            >
              Full sync
            </button>
            <button
              className={syncMode === 'info-only' ? 'active' : ''}
              disabled={saving}
              onClick={() => setSyncMode('info-only')}
              type="button"
            >
              Info only
            </button>
          </div>
          {(sourceType === 'device-count' || sourceType === 'license-count') && (
            <p className="config-note">
              Full sync includes imported counts in reconciliation once account and product mappings are approved.
            </p>
          )}

          <div className="vendor-datapoint-edit-mapping-header">
            <div>
              <strong>Column mappings</strong>
              <span>Update saved headers or load a sample file to refresh the available columns.</span>
            </div>
            <label className={saving ? 'button secondary compact file-upload-button disabled' : 'button secondary compact file-upload-button'}>
              <FileSpreadsheet size={16} />
              Load sample file
              <input
                accept=".csv,.json,.xls,.xlsx,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={saving}
                onChange={(event) => void handleSampleFileChange(event)}
                type="file"
              />
            </label>
          </div>

          {headerOptions.length === 0 ? (
            <p className="config-note">Load a sample export to choose column headers, or save mappings after the first import.</p>
          ) : (
            <>
              <p className="config-note">
                {headerOptions.length.toLocaleString()} saved column{headerOptions.length === 1 ? '' : 's'} available for mapping.
              </p>
              <InvoiceColumnMapGrid
              columnMap={columnMap}
              disabled={saving}
              headerOptions={headerOptions}
              onChange={updateColumn}
              sourceType={sourceType}
            />
            </>
          )}

          <p className="config-note">{message}</p>
        </div>
        <div className="integration-modal-actions">
          <button className="button secondary" disabled={saving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button primary" disabled={saving || !mappingReady} onClick={() => void submit()} type="button">
            {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VendorDatapointsView(props: {
  datapoints: VendorDatapointRecord[];
  integrations: Integration[];
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onCreate: () => void;
  onEdit: (datapointId: string) => void;
  onImport: (
    datapoint: VendorDatapointRecord,
    file: File,
    columnMap: InvoiceTableColumnMap,
    persistColumnMap: boolean,
  ) => Promise<{ datapoint: VendorDatapointRecord; import: InvoiceImportSummary }>;
  onOpenMappings: (vendorId: VendorKey) => void;
  onSaveMapping: (
    datapoint: VendorDatapointRecord,
    columnMap: InvoiceTableColumnMap,
    knownHeaders?: string[],
  ) => Promise<VendorDatapointRecord>;
  onDeleteImport: (datapoint: VendorDatapointRecord, invoiceImport: InvoiceImportSummary) => Promise<void>;
  onSelect: (datapointId: string | null) => void;
  selectedDatapoint?: VendorDatapointRecord;
}) {
  const {
    datapoints,
    loadState,
    message,
    onCreate,
    onEdit,
    onImport,
    onOpenMappings,
    onSaveMapping,
    onDeleteImport,
    onSelect,
    selectedDatapoint,
  } = props;
  const [importing, setImporting] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<InvoiceTableColumnMap>({});
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [pendingSourceType, setPendingSourceType] = useState<IntegrationDataSourceType>('customer-product-breakdown');
  const [pendingDatapointId, setPendingDatapointId] = useState<string>('');
  const [showImportTypePrompt, setShowImportTypePrompt] = useState(false);
  const [importHistory, setImportHistory] = useState<InvoiceImportSummary[]>([]);
  const [importHistoryState, setImportHistoryState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [panelMessage, setPanelMessage] = useState('Select a datapoint or drop a file to auto-detect the saved import setup.');

  const hasSavedMap = Boolean(selectedDatapoint && Object.keys(selectedDatapoint.columnMap).length > 0);
  const mappingReady = Boolean(
    selectedDatapoint && columnMapSatisfiesSourceType(selectedDatapoint.sourceType, columnMap),
  );
  const quickImportReady = Boolean(hasSavedMap && file && mappingReady && !showMappingEditor);

  useEffect(() => {
    if (!selectedDatapoint) {
      setFile(null);
      setHeaders([]);
      setColumnMap({});
      setShowMappingEditor(false);
      setShowImportTypePrompt(false);
      setImportHistory([]);
      setImportHistoryState('idle');
      setPanelMessage('Select a datapoint or drop a file to auto-detect the saved import setup.');
      return;
    }

    setColumnMap(selectedDatapoint.columnMap);
    setShowMappingEditor(Object.keys(selectedDatapoint.columnMap).length === 0);
    setPanelMessage(
      Object.keys(selectedDatapoint.columnMap).length > 0
        ? 'Saved column map loaded. Upload the next export for a one-click import.'
        : 'Upload the first file, map columns, save the mapping, then import.',
    );

    let cancelled = false;
    setImportHistoryState('loading');
    void fetchInvoiceImports(datapointMappingVendorId(selectedDatapoint), selectedDatapoint.id)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setImportHistory(response.imports);
        setImportHistoryState('ready');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setImportHistory([]);
        setImportHistoryState('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDatapoint?.id]);

  const applyDetectedFile = async (
    nextFile: File,
    datapoint: VendorDatapointRecord,
    nextHeaders: string[],
    nextMap: InvoiceTableColumnMap,
    quickImport: boolean,
  ) => {
    setFile(nextFile);
    setHeaders(nextHeaders);
    setColumnMap(nextMap);

    if (quickImport && columnMapSatisfiesSourceType(datapoint.sourceType, nextMap)) {
      setImporting(true);
      setPanelMessage(`Quick importing ${nextFile.name} for ${datapoint.displayName}...`);
      try {
        await onImport(datapoint, nextFile, nextMap, false);
        setPanelMessage(`Imported ${nextFile.name} for ${datapoint.displayName}.`);
        const history = await fetchInvoiceImports(datapointMappingVendorId(datapoint), datapoint.id);
        setImportHistory(history.imports);
        setImportHistoryState('ready');
      } catch (error) {
        setShowMappingEditor(true);
        setPanelMessage(error instanceof Error ? error.message : 'Unable to quick import this file.');
      } finally {
        setImporting(false);
      }
      return;
    }

    setShowMappingEditor(true);
    setPanelMessage(`${nextHeaders.length.toLocaleString()} columns detected. Review or save the mapping before import.`);
  };

  const handleQuickDetectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!nextFile) {
      return;
    }

    try {
      const table = await readImportTableFile(nextFile);
      const detected = matchVendorDatapointByHeaders(datapoints, table.headers);
      if (detected) {
        setShowImportTypePrompt(false);
        onSelect(detected.datapoint.id);
        await applyDetectedFile(nextFile, detected.datapoint, table.headers, detected.columnMap, true);
        return;
      }

      setFile(nextFile);
      setHeaders(table.headers);
      setColumnMap(suggestInvoiceTableColumnMap(table.headers, selectedDatapoint?.sourceType));
      setShowMappingEditor(true);
      setShowImportTypePrompt(true);
      setPendingDatapointId(selectedDatapoint?.id ?? datapoints[0]?.id ?? '');
      setPendingSourceType((selectedDatapoint?.sourceType as IntegrationDataSourceType) ?? 'customer-product-breakdown');
      setPanelMessage('No saved import setup matched these headers. Choose the import type and datapoint, then map columns.');
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Unable to read this table file.');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!nextFile || !selectedDatapoint) {
      return;
    }

    try {
      const table = await readImportTableFile(nextFile);
      const nextMap = mergeInvoiceTableColumnMap(selectedDatapoint.columnMap, table.headers, selectedDatapoint.sourceType);
      const resolvedMap =
        Object.keys(nextMap).length > 0
          ? nextMap
          : suggestInvoiceTableColumnMap(table.headers, selectedDatapoint.sourceType);
      const canQuickImport =
        Object.keys(selectedDatapoint.columnMap).length > 0 &&
        columnMapSatisfiesSourceType(selectedDatapoint.sourceType, resolvedMap);
      await applyDetectedFile(nextFile, selectedDatapoint, table.headers, resolvedMap, canQuickImport);
    } catch (error) {
      setHeaders([]);
      setColumnMap(selectedDatapoint.columnMap);
      setPanelMessage(error instanceof Error ? error.message : 'Unable to read this table file.');
    }
  };

  const saveMapping = async () => {
    if (!selectedDatapoint) {
      return;
    }

    setSavingMapping(true);
    setPanelMessage(`Saving column map for ${selectedDatapoint.displayName}...`);
    try {
      const updated = await onSaveMapping(
        selectedDatapoint,
        columnMap,
        mergeKnownHeaders(selectedDatapoint.knownHeaders, headers, mappedColumnHeaders(columnMap)),
      );
      setColumnMap(updated.columnMap);
      setShowMappingEditor(false);
      setPanelMessage(`Saved column map for ${updated.displayName}. Future uploads can quick import.`);
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Unable to save vendor datapoint mapping.');
    } finally {
      setSavingMapping(false);
    }
  };

  const importSelected = async (datapointOverride?: VendorDatapointRecord) => {
    const targetDatapoint = datapointOverride ?? selectedDatapoint;
    if (!targetDatapoint || !file) {
      return;
    }

    setImporting(true);
    setPanelMessage(`Importing ${file.name}...`);
    try {
      const persistColumnMap = Object.keys(targetDatapoint.columnMap).length === 0;
      await onImport(targetDatapoint, file, columnMap, persistColumnMap);
      setShowImportTypePrompt(false);
      setPanelMessage(`Imported ${file.name} for ${targetDatapoint.displayName}.`);
      const history = await fetchInvoiceImports(datapointMappingVendorId(targetDatapoint), targetDatapoint.id);
      setImportHistory(history.imports);
      setImportHistoryState('ready');
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Unable to import vendor datapoint file.');
    } finally {
      setImporting(false);
    }
  };

  const deleteImport = async (invoiceImport: InvoiceImportSummary) => {
    if (!selectedDatapoint) {
      return;
    }

    setDeletingImportId(invoiceImport.id);
    try {
      await onDeleteImport(selectedDatapoint, invoiceImport);
      setImportHistory((current) => current.filter((item) => item.id !== invoiceImport.id));
      setPanelMessage(`Deleted import ${invoiceImport.fileName}.`);
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : 'Unable to delete this import.');
    } finally {
      setDeletingImportId(null);
    }
  };

  const updateColumn = (key: keyof InvoiceTableColumnMap, value: string) => {
    setColumnMap((current) => updateInvoiceTableColumnMap(current, key, value));
  };

  const unmatchedUpload = showImportTypePrompt && Boolean(file && headers.length > 0);
  const pendingDatapoint = pendingDatapointId ? datapoints.find((item) => item.id === pendingDatapointId) : undefined;

  return (
    <section className="vendor-datapoints-view">
      <div className="vendor-datapoints-layout">
        <aside className="vendor-datapoints-sidebar work-surface">
          <div className="surface-header vendor-datapoints-sidebar-header">
            <div>
              <span className="section-kicker">Saved imports</span>
              <h2>Vendor datapoints</h2>
            </div>
            <button className="button primary compact" onClick={onCreate} type="button">
              <Plus size={16} />
              New
            </button>
          </div>
          <div className="vendor-datapoints-sidebar-toolbar">
            <label className={importing ? 'button secondary compact file-upload-button disabled' : 'button secondary compact file-upload-button'}>
              <Upload size={16} />
              Quick import file
              <input
                accept=".csv,.json,.xls,.xlsx,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={importing}
                onChange={(event) => void handleQuickDetectFile(event)}
                type="file"
              />
            </label>
          </div>
          {loadState === 'failed' ? <p className="vendor-datapoints-sidebar-status is-error">{message}</p> : null}
          {loadState !== 'failed' && datapoints.length > 0 ? (
            <p className="vendor-datapoints-sidebar-status">{message}</p>
          ) : null}
          <div className="vendor-datapoint-list">
            {datapoints.length === 0 ? (
              <div className="empty-state">
                <Database size={20} />
                <strong>{loadState === 'loading' ? 'Loading vendor datapoints.' : 'No vendor datapoints yet.'}</strong>
                <span>Create one for file-only vendors or supplemental device detail.</span>
              </div>
            ) : null}
            {datapoints.map((datapoint) => (
              <button
                className={selectedDatapoint?.id === datapoint.id ? 'vendor-datapoint-item selected' : 'vendor-datapoint-item'}
                key={datapoint.id}
                onClick={() => onSelect(datapoint.id)}
                type="button"
              >
                <div className="vendor-datapoint-item-head">
                  <h3>{datapoint.displayName}</h3>
                </div>
                <div className="vendor-datapoint-item-badges">
                  <span className="vendor-datapoint-chip">{vendorDatapointSourceLabel(datapoint.sourceType)}</span>
                  <span className={datapoint.syncMode === 'info-only' ? 'vendor-datapoint-chip warn' : 'vendor-datapoint-chip accent'}>
                    {datapoint.syncMode === 'info-only' ? 'Info only' : 'Full sync'}
                  </span>
                  {Object.keys(datapoint.columnMap).length === 0 ? (
                    <span className="vendor-datapoint-chip warn">Needs mapping</span>
                  ) : null}
                </div>
                <div className="vendor-datapoint-item-stats">
                  <div className="vendor-datapoint-stat">
                    <span>Last import</span>
                    <strong>{datapoint.lastImportedAt ? formatDateTime(datapoint.lastImportedAt) ?? 'Unknown' : 'Never'}</strong>
                  </div>
                  <div className="vendor-datapoint-stat">
                    <span>Rows</span>
                    <strong>{datapoint.lastImportRowCount?.toLocaleString() ?? '0'}</strong>
                  </div>
                </div>
                {datapoint.linkedIntegrationId ? (
                  <span className="vendor-datapoint-chip">Linked to {integrationName(datapoint.linkedIntegrationId)}</span>
                ) : (
                  <span className="vendor-datapoint-chip">Standalone</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        <div className="vendor-datapoints-main work-surface">
          {unmatchedUpload ? (
            <>
              <div className="surface-header">
                <div>
                  <span className="section-kicker">Unmatched file</span>
                  <h2>{file?.name ?? 'Select import type'}</h2>
                </div>
              </div>
              <p className="vendor-datapoint-status">{panelMessage}</p>
              <div className="vendor-datapoint-import-body">
                <label className="config-field">
                  <span>Import type</span>
                  <select onChange={(event) => setPendingSourceType(event.target.value as IntegrationDataSourceType)} value={pendingSourceType}>
                    <option value="customer-product-breakdown">Customer products</option>
                    <option value="device-count">Device counts</option>
                    <option value="license-count">License counts</option>
                    <option value="invoice">Invoices</option>
                    <option value="user-license-detail">User license detail</option>
                    <option value="reseller-product-total">Reseller product totals</option>
                  </select>
                </label>
                <label className="config-field">
                  <span>Vendor datapoint</span>
                  <select onChange={(event) => setPendingDatapointId(event.target.value)} value={pendingDatapointId}>
                    <option value="">Select datapoint</option>
                    {datapoints
                      .filter((datapoint) => datapoint.sourceType === pendingSourceType)
                      .map((datapoint) => (
                        <option key={datapoint.id} value={datapoint.id}>
                          {datapoint.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                {pendingDatapoint ? (
                  <>
                    <InvoiceColumnMapGrid
                      columnMap={columnMap}
                      disabled={importing || savingMapping}
                      headerOptions={columnMappingHeaderOptions(columnMap, headers, pendingDatapoint.knownHeaders)}
                      onChange={updateColumn}
                      sourceType={pendingDatapoint.sourceType}
                    />
                    <div className="invoice-table-import-actions">
                      <button
                        className="button secondary compact"
                        disabled={savingMapping || !columnMapSatisfiesSourceType(pendingDatapoint.sourceType, columnMap)}
                        onClick={() =>
                          void onSaveMapping(
                            pendingDatapoint,
                            columnMap,
                            mergeKnownHeaders(pendingDatapoint.knownHeaders, headers, mappedColumnHeaders(columnMap)),
                          ).then((updated) => {
                            onSelect(updated.id);
                            setShowMappingEditor(false);
                            setPanelMessage(`Saved column map for ${updated.displayName}.`);
                          })
                        }
                        type="button"
                      >
                        {savingMapping ? 'Saving' : 'Save mapping'}
                      </button>
                      <button
                        className="button primary compact"
                        disabled={!file || importing || !columnMapSatisfiesSourceType(pendingDatapoint.sourceType, columnMap)}
                        onClick={() => {
                          onSelect(pendingDatapoint.id);
                          void importSelected(pendingDatapoint);
                        }}
                        type="button"
                      >
                        <Upload size={15} />
                        {importing ? 'Importing' : 'Import mapped file'}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : selectedDatapoint ? (
            <>
              <div className="surface-header">
                <div>
                  <span className="section-kicker">{hasSavedMap ? 'Quick import' : 'Setup import'}</span>
                  <h2>{selectedDatapoint.displayName}</h2>
                </div>
                <div className="surface-header-actions">
                  <button className="button secondary compact" onClick={() => onOpenMappings(datapointMappingVendorId(selectedDatapoint))} type="button">
                    <Link2 size={16} />
                    Mapping
                  </button>
                  <button className="button secondary compact" onClick={() => onEdit(selectedDatapoint.id)} type="button">
                    <Pencil size={16} />
                    Edit
                  </button>
                  <label className={importing ? 'button primary compact file-upload-button disabled' : 'button primary compact file-upload-button'}>
                    <FileSpreadsheet size={16} />
                    {hasSavedMap ? 'Import file' : 'Select file'}
                    <input
                      accept=".csv,.json,.xls,.xlsx,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      disabled={importing}
                      onChange={(event) => void handleFileChange(event)}
                      type="file"
                    />
                  </label>
                </div>
              </div>
              <div className="vendor-datapoint-detail-meta">
                <span className="vendor-datapoint-chip">{vendorDatapointSourceLabel(selectedDatapoint.sourceType)}</span>
                <span className={selectedDatapoint.syncMode === 'info-only' ? 'vendor-datapoint-chip warn' : 'vendor-datapoint-chip accent'}>
                  {selectedDatapoint.syncMode === 'info-only' ? 'Info only' : 'Full sync'}
                </span>
                <span className="vendor-datapoint-chip">
                  {selectedDatapoint.linkedIntegrationId
                    ? `Linked to ${integrationName(selectedDatapoint.linkedIntegrationId)}`
                    : 'Standalone mappings'}
                </span>
                <span className="vendor-datapoint-chip">
                  {Object.keys(selectedDatapoint.columnMap).length > 0 ? 'Saved column map' : 'Needs mapping'}
                </span>
              </div>
              <p className="vendor-datapoint-status">{panelMessage}</p>

              <div className="vendor-datapoint-import-body">
                {quickImportReady ? (
                  <div className="invoice-table-import-actions">
                    <button className="button primary compact" disabled={importing} onClick={() => void importSelected()} type="button">
                      <Upload size={15} />
                      {importing ? 'Importing' : `Import ${file?.name ?? 'file'}`}
                    </button>
                    <button className="button secondary compact" onClick={() => setShowMappingEditor(true)} type="button">
                      Review mapping
                    </button>
                  </div>
                ) : null}

                {showMappingEditor || !hasSavedMap ? (
                  <>
                    <InvoiceColumnMapGrid
                      columnMap={columnMap}
                      disabled={importing || savingMapping}
                      headerOptions={columnMappingHeaderOptions(columnMap, headers, selectedDatapoint.knownHeaders)}
                      onChange={updateColumn}
                      sourceType={selectedDatapoint.sourceType}
                    />
                    <div className="invoice-table-import-actions">
                      <button
                        className="button secondary compact"
                        disabled={
                          columnMappingHeaderOptions(columnMap, headers, selectedDatapoint.knownHeaders).length === 0 ||
                          savingMapping ||
                          !mappingReady
                        }
                        onClick={() => void saveMapping()}
                        type="button"
                      >
                        {savingMapping ? 'Saving' : 'Save mapping'}
                      </button>
                      <button className="button primary compact" disabled={!file || importing || !mappingReady} onClick={() => void importSelected()} type="button">
                        <Upload size={15} />
                        {importing ? 'Importing' : 'Import mapped file'}
                      </button>
                      {hasSavedMap ? (
                        <button className="button secondary compact" onClick={() => setShowMappingEditor(false)} type="button">
                          Hide mapping
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>

              <section className="vendor-datapoint-import-history">
                <div className="surface-header vendor-datapoint-import-history-header">
                  <div>
                    <span className="section-kicker">Import history</span>
                    <h3>Past imports</h3>
                  </div>
                </div>
                <div className="import-table">
                  {importHistory.length === 0 ? (
                    <div className="empty-state">
                      <FileSpreadsheet size={20} />
                      <strong>{importHistoryState === 'loading' ? 'Loading import history.' : 'No imports for this datapoint yet.'}</strong>
                    </div>
                  ) : null}
                  {importHistory.map((item) => (
                    <div className="import-row" key={item.id}>
                      <span className="vendor-badge">{vendorDatapointSourceLabel(selectedDatapoint.sourceType)}</span>
                      <div>
                        <strong>{item.fileName}</strong>
                        <span>
                          {formatCount(item.rowCount)} rows / {formatDateTime(item.importedAt)}
                        </span>
                      </div>
                      <div className="match-bar">
                        <span style={{ width: `${item.rowCount > 0 ? (item.matchedRows / item.rowCount) * 100 : 0}%` }} />
                      </div>
                      <strong>{item.exceptionRows} exceptions</strong>
                      <button
                        className="button secondary compact"
                        disabled={deletingImportId === item.id}
                        onClick={() => void deleteImport(item)}
                        title="Delete import and remove synced rows"
                        type="button"
                      >
                        <Trash2 size={15} />
                        {deletingImportId === item.id ? 'Deleting' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state tall">
              <Database size={24} />
              <strong>Select a vendor datapoint</strong>
              <span>Choose a saved import on the left, or use Quick import file to auto-detect headers.</span>
            </div>
          )}
        </div>
      </div>
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
  onSync?: (integrationId: IntegrationId, target?: IntegrationSyncTarget) => void;
  onTest?: (integrationId: IntegrationId) => void;
}) {
  const { actionMessage, busyAction, comingSoon = false, integration, onConfigure, onOpenMappings, onSync, onTest } = props;
  const displayName = comingSoon ? `${integration.name} (Coming Soon)` : integration.name;
  const actionKeyPrefix = integration.id;
  const microsoft365SyncBusy =
    busyAction === `${actionKeyPrefix}:sync-users` || busyAction === `${actionKeyPrefix}:sync-licenses`;
  const dattoSyncBusy =
    busyAction === `${actionKeyPrefix}:sync-datto-saas` || busyAction === `${actionKeyPrefix}:sync-datto-saas-bcdr`;

  return (
    <article aria-disabled={comingSoon || undefined} className={comingSoon ? 'integration-card coming-soon' : 'integration-card'}>
      <div className="integration-main">
        <div className="integration-title-row">
          <h2>{displayName}</h2>
          <span className={comingSoon ? 'integration-status disabled' : `integration-status ${integration.status}`}>
            {comingSoon ? 'Disabled' : integrationStatusLabel(integration.status)}
          </span>
        </div>
      </div>

      <div className="integration-stats" aria-label={`${integration.name} integration status`}>
        <IntegrationStat label="Last sync" value={comingSoon ? 'Unavailable' : integration.lastSync ?? 'Never'} />
        <IntegrationStat label="Records" value={comingSoon ? '0' : integration.records ?? '0'} />
      </div>

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
                ) : integration.id === 'datto' ? (
                  <>
                    <button
                      className="button secondary compact"
                      disabled={dattoSyncBusy}
                      onClick={() => onSync?.(integration.id, 'datto-saas-bcdr')}
                      type="button"
                    >
                      <RefreshCcw size={16} />
                      {busyAction === `${actionKeyPrefix}:sync-datto-saas-bcdr` ? 'Syncing SaaS + BCDR' : 'Sync SaaS + BCDR'}
                    </button>
                    <button
                      className="button secondary compact"
                      disabled={dattoSyncBusy}
                      onClick={() => onSync?.(integration.id, 'datto-saas')}
                      type="button"
                    >
                      <RefreshCcw size={16} />
                      {busyAction === `${actionKeyPrefix}:sync-datto-saas` ? 'Syncing SaaS' : 'SaaS only'}
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
            {hasAnyMappingWorkspace(integration.id) ? (
              <button className="button secondary compact" onClick={() => onOpenMappings?.(integration.id)} type="button">
                <Link2 size={16} />
                Mapping
              </button>
            ) : null}
          </>
        )}
      </div>

      <p className={`config-note integration-action-message${actionMessage ? '' : ' is-empty'}`}>
        {actionMessage ?? '\u00a0'}
      </p>
    </article>
  );
}

function IntegrationStat(props: { label: string; value: string }) {
  return (
    <div className="integration-stat">
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

function MappingSectionDrawer(props: {
  children: ReactNode;
  defaultOpen: boolean;
  meta: string;
  onOpenChange: (sectionId: MappingSectionId, open: boolean) => void;
  openState: Partial<Record<MappingSectionId, boolean>>;
  sectionId: MappingSectionId;
  status: string;
  statusTone?: 'approved' | 'blocked' | 'needs-review' | 'ready';
  title: string;
}) {
  const {
    children,
    defaultOpen,
    meta,
    onOpenChange,
    openState,
    sectionId,
    status,
    statusTone = 'ready',
    title,
  } = props;
  const open = openState[sectionId] ?? defaultOpen;

  return (
    <details
      className="mapping-section-drawer"
      onToggle={(event) => onOpenChange(sectionId, event.currentTarget.open)}
      open={open}
    >
      <summary>
        <ChevronRight className="drawer-chevron" size={18} />
        <div>
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
        <span className={`status-pill ${statusTone}`}>{status}</span>
      </summary>
      <div className="mapping-section-body">{children}</div>
    </details>
  );
}

function MappingsView(props: {
  busyAction: string | null;
  integrations: Integration[];
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  mappingState: MappingStateResponse | null;
  ncentralFilterMappings: NcentralFilterMapping[];
  ncentralFilters: NcentralFilter[];
  laborBoards: ConnectWiseBoardOption[];
  laborClassificationMessage: string;
  laborMappings: LaborMapping[];
  investigationTicketMapping: InvestigationTicketMapping | null;
  onAccountApprove: (candidate: AccountMappingCandidate) => void;
  onAccountManualSave: (account: AccountMappingCandidate, customerId: string, agreementId: string) => Promise<boolean>;
  onApproveSuggested: () => void;
  onAutomap: () => void;
  onIntegrationChange: (integrationId: VendorKey) => void;
  onProductTargetsSave: (
    integrationId: VendorKey,
    vendorProductKey: string,
    targetProducts: ProductMappingTarget[],
  ) => Promise<void>;
  onProductBundleDeactivate: (integrationId: VendorKey, bundleKey: string) => Promise<void>;
  onProductBundleSave: (
    integrationId: VendorKey,
    payload: {
      bundleKey?: string;
      bundleName: string;
      components: ProductBundleComponent[];
      targetProduct: ProductMappingTarget;
    },
  ) => Promise<boolean>;
  onProductLinkRuleActiveChange: (integrationId: VendorKey, ruleId: string, active: boolean) => Promise<void>;
  onProductLinkRuleDelete: (integrationId: VendorKey, ruleId: string) => Promise<void>;
  onProductLinkRuleSave: (
    integrationId: VendorKey,
    payload: {
      id?: string;
      sourceVendorProductKey: string;
      ruleName: string;
      sources: ProductLinkRuleSource[];
    },
  ) => Promise<boolean>;
  onRefresh: () => Promise<MappingStateResponse | null>;
  onNcentralFilterMappingSave: (payload: Partial<NcentralFilterMapping>) => Promise<void>;
  onLaborMappingSave: (payload: Partial<LaborMapping>) => Promise<void>;
  onInvestigationTicketMappingSave: (payload: {
    boardId: number;
    boardName?: string | null;
    typeId: number;
    typeName?: string | null;
    subTypeId?: number | null;
    subTypeName?: string | null;
    statusId?: number | null | typeof INVESTIGATION_TICKET_STATUS_DEFAULT;
    statusName?: string | null;
    companyOverrideId?: number | null;
    companyOverrideName?: string | null;
  }) => Promise<void>;
  onReconciliationOptionChange: (doNotSuggestNewAdditions: boolean) => Promise<void>;
  onUsageOverrideCreate: (integrationId: VendorKey, payload: CreateUsageOverridePayload) => Promise<boolean>;
  onUsageOverrideDeactivate: (integrationId: VendorKey, overrideId: string) => Promise<void>;
  selectedIntegrationId: VendorKey;
  usageOverrides: UsageOverride[];
  vendorDatapoints: VendorDatapointRecord[];
}) {
  const {
    busyAction,
    integrations,
    loadMessage,
    loadState,
    mappingState,
    ncentralFilterMappings,
    ncentralFilters,
    laborBoards,
    laborClassificationMessage,
    laborMappings,
    investigationTicketMapping,
    onAccountApprove,
    onAccountManualSave,
    onApproveSuggested,
    onAutomap,
    onIntegrationChange,
    onProductTargetsSave,
    onProductBundleDeactivate,
    onProductBundleSave,
    onProductLinkRuleActiveChange,
    onProductLinkRuleDelete,
    onProductLinkRuleSave,
    onRefresh,
    onNcentralFilterMappingSave,
    onLaborMappingSave,
    onInvestigationTicketMappingSave,
    onReconciliationOptionChange,
    onUsageOverrideCreate,
    onUsageOverrideDeactivate,
    selectedIntegrationId,
    usageOverrides,
    vendorDatapoints,
  } = props;
  const [showMappedAccounts, setShowMappedAccounts] = useState(false);
  const [showMappedProducts, setShowMappedProducts] = useState(false);
  const [mappingSectionOpen, setMappingSectionOpen] = useState<Partial<Record<MappingSectionId, boolean>>>({});
  const [dattoMappingDataset, setDattoMappingDataset] = useState<DattoMappingDataset>('saas');
  const [huntressMappingDataset, setHuntressMappingDataset] = useState<HuntressMappingDataset>('itdr');
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
  const [editingLinkRuleId, setEditingLinkRuleId] = useState<string | null>(null);
  const [linkTargetProductKey, setLinkTargetProductKey] = useState('');
  const [linkRuleName, setLinkRuleName] = useState('');
  const [linkSourceMode, setLinkSourceMode] = useState<ProductLinkRuleSource['sourceType']>('vendor-product');
  const [linkSourceVendorId, setLinkSourceVendorId] = useState<IntegrationId>('microsoft-365');
  const [linkSourceDataset, setLinkSourceDataset] = useState<RawSyncDataset>('licenses');
  const [linkAggregationType, setLinkAggregationType] = useState<ProductLinkRuleAggregation['type']>('row-count');
  const [linkAggregationColumn, setLinkAggregationColumn] = useState('TotalUnits');
  const [linkFilterRoot, setLinkFilterRoot] = useState<ProductLinkRuleFilterNode>(() => defaultLinkedCountFilter());
  const [linkDatasetMetadata, setLinkDatasetMetadata] = useState<LinkedDatasetMetadata>({
    columns: [],
    uniqueValuesByColumn: {},
    rowCount: 0,
  });
  const [linkDatasetLoadState, setLinkDatasetLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [linkDatasetMessage, setLinkDatasetMessage] = useState('');
  const [linkSourceMappingStates, setLinkSourceMappingStates] = useState<Partial<Record<IntegrationId, MappingStateResponse>>>({});
  const [linkSourceLoadState, setLinkSourceLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [linkSourceMessage, setLinkSourceMessage] = useState('');
  const [linkVendorProductKeys, setLinkVendorProductKeys] = useState<string[]>([]);
  const [linkCatalogQuery, setLinkCatalogQuery] = useState('');
  const [linkCatalogTarget, setLinkCatalogTarget] = useState<ProductCatalogTarget | null>(null);
  const [linkCatalogResults, setLinkCatalogResults] = useState<ProductCatalogTarget[]>([]);
  const [linkCatalogMessage, setLinkCatalogMessage] = useState('');
  const [linkCatalogLoading, setLinkCatalogLoading] = useState(false);
  const [linkTestRule, setLinkTestRule] = useState<ProductLinkRule | null>(null);
  const [linkTestCustomerId, setLinkTestCustomerId] = useState('');
  const [linkTestAgreementId, setLinkTestAgreementId] = useState('');
  const [linkTestResult, setLinkTestResult] = useState<ProductLinkRuleTestResult | null>(null);
  const [linkTestLoadState, setLinkTestLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [linkTestMessage, setLinkTestMessage] = useState('');
  const [overrideCustomerId, setOverrideCustomerId] = useState('');
  const [overrideAgreementId, setOverrideAgreementId] = useState('');
  const [overrideSourceProductKey, setOverrideSourceProductKey] = useState('cove-workstation');
  const [overrideTargetProductKey, setOverrideTargetProductKey] = useState('cove-server');
  const [overrideHostname, setOverrideHostname] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const selectedIntegration = integrations.find((integration) => integration.id === selectedIntegrationId);
  const selectedIntegrationName = selectedIntegration?.name ?? selectedIntegrationId;
  const doNotSuggestNewAdditions = selectedIntegration
    ? integrationDoNotSuggestNewAdditions(selectedIntegration.nonSecrets, {
        optionalNonSecrets: selectedIntegration.optionalNonSecrets,
      } as IntegrationSettingsDefinition)
    : false;
  const isDattoMappingWorkspace = selectedIntegrationId === 'datto';
  const isHuntressMappingWorkspace = selectedIntegrationId === 'huntress';
  const isLaborOnlyMappingWorkspace = selectedIntegrationId === 'connectwise';
  const showLaborMappingSection = hasLaborMappingWorkspace(selectedIntegrationId);
  const showInvestigationTicketMappingSection = hasInvestigationTicketMappingWorkspace(selectedIntegrationId);
  const accountMappings = filterHuntressAccountRows(
    filterDattoAccountRows(mappingState?.accountMappings ?? [], isDattoMappingWorkspace ? dattoMappingDataset : undefined),
    isHuntressMappingWorkspace ? huntressMappingDataset : undefined,
  );
  const accountCandidates = filterHuntressAccountRows(
    filterDattoAccountRows(mappingState?.accountCandidates ?? [], isDattoMappingWorkspace ? dattoMappingDataset : undefined),
    isHuntressMappingWorkspace ? huntressMappingDataset : undefined,
  );
  const accountRows = showMappedAccounts ? [...accountMappings, ...accountCandidates] : accountCandidates;
  const productMappings = (mappingState?.productMappings ?? [])
    .filter((row) => dattoProductMatchesDataset(row.vendorProductKey, isDattoMappingWorkspace ? dattoMappingDataset : undefined))
    .filter((row) => huntressProductMatchesDataset(row.vendorProductKey, isHuntressMappingWorkspace ? huntressMappingDataset : undefined));
  const productCandidates = (mappingState?.productCandidates ?? [])
    .filter((row) => dattoProductMatchesDataset(row.vendorProductKey, isDattoMappingWorkspace ? dattoMappingDataset : undefined))
    .filter((row) => huntressProductMatchesDataset(row.vendorProductKey, isHuntressMappingWorkspace ? huntressMappingDataset : undefined));
  const allProductRows = [...productMappings, ...productCandidates];
  const visibleProductRows = showMappedProducts ? allProductRows : productCandidates;
  const allProductGroups = useMemo(() => buildProductGroups(allProductRows), [allProductRows]);
  const productGroups = useMemo(() => buildProductGroups(visibleProductRows), [visibleProductRows]);
  const unmatchedProductGroupCount = useMemo(() => buildProductGroups(productCandidates).length, [productCandidates]);
  const productSelectionDefaults = useMemo(() => buildProductSelectionDefaults(productGroups), [productGroups]);
  const productBundles = (mappingState?.productBundles ?? []).filter((bundle) =>
    dattoBundleMatchesDataset(bundle, isDattoMappingWorkspace ? dattoMappingDataset : undefined),
  ).filter((bundle) =>
    huntressBundleMatchesDataset(bundle, isHuntressMappingWorkspace ? huntressMappingDataset : undefined),
  );
  const productLinkRules = (mappingState?.productLinkRules ?? []).filter((rule) =>
    dattoProductMatchesDataset(rule.sourceVendorProductKey, isDattoMappingWorkspace ? dattoMappingDataset : undefined),
  ).filter((rule) =>
    huntressProductMatchesDataset(rule.sourceVendorProductKey, isHuntressMappingWorkspace ? huntressMappingDataset : undefined),
  );
  const bundleProductOptions = useMemo(
    () =>
      allProductGroups
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
    [allProductGroups],
  );
  const customerOptions = mappingState?.customerOptions ?? [];
  const selectedOverrideCustomer = customerOptions.find((option) => option.customerId === overrideCustomerId);
  const overrideAgreementOptions = selectedOverrideCustomer?.agreements ?? [];
  const suggestedAccountCount = accountCandidates.filter(
    (candidate) => candidate.status === 'approved' && candidate.customerId,
  ).length;
  const canBulkApproveSuggested = !isDattoMappingWorkspace && !isHuntressMappingWorkspace && suggestedAccountCount > 0;
  const selectedDatasetLabel = isDattoMappingWorkspace
    ? dattoMappingDatasetLabel(dattoMappingDataset)
    : isHuntressMappingWorkspace
      ? huntressMappingDatasetLabel(huntressMappingDataset)
      : selectedIntegrationName;
  const approvedAccountMappingCount = accountMappings.filter((mapping) => mapping.status === 'approved' && mapping.active).length;
  const approvedProductMappingCount = productMappings.filter((row) => isSavedProductMapping(row) && row.status === 'approved' && row.active).length;
  const activeLinkRuleCount = productLinkRules.filter((rule) => rule.active).length;
  const activeBundleCount = productBundles.filter((bundle) => bundle.active).length;
  const bundleActionKey = editingBundleKey ? `bundle:${editingBundleKey}` : 'bundle:new';
  const bundleTargetOptions = dedupeProductTargets(
    bundleTarget ? [bundleTarget, ...bundleCatalogResults] : bundleCatalogResults,
  );
  const linkSourceIntegrationOptions = useMemo(
    () =>
      integrations.filter(
        (integration) => integration.id !== 'connectwise' && integrationHasCapability(integration.id, 'mapping'),
      ),
    [integrations],
  );
  const linkSourceMappingState =
    linkSourceVendorId === selectedIntegrationId && mappingState
      ? mappingState
      : linkSourceMappingStates[linkSourceVendorId];
  const linkSourceProductOptions = useMemo(
    () =>
      buildProductGroups(
        (linkSourceMappingState?.productMappings ?? []).filter(
          (row) => row.active && row.status === 'approved',
        ),
      )
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
    [linkSourceMappingState],
  );
  const linkCatalogTargetOptions = dedupeProductTargets(
    linkCatalogTarget ? [linkCatalogTarget, ...linkCatalogResults] : linkCatalogResults,
  );
  const linkFilterColumnOptions = uniqueStrings([
    ...linkDatasetMetadata.columns,
    ...linkedDatasetColumnOptions(linkSourceVendorId, linkSourceDataset),
  ]);
  const linkRuleActionKey = editingLinkRuleId ? `link:${editingLinkRuleId}` : 'link:new';

  const setMappingSection = (sectionId: MappingSectionId, open: boolean) => {
    setMappingSectionOpen((current) =>
      current[sectionId] === open
        ? current
        : {
            ...current,
            [sectionId]: open,
          },
    );
  };

  const resetLinkRuleForm = () => {
    setEditingLinkRuleId(null);
    setLinkTargetProductKey('');
    setLinkRuleName('');
    setLinkSourceMode('vendor-product');
    setLinkSourceDataset('licenses');
    setLinkAggregationType('row-count');
    setLinkAggregationColumn('TotalUnits');
    setLinkFilterRoot(defaultLinkedCountFilter());
    setLinkDatasetMetadata({ columns: [], uniqueValuesByColumn: {}, rowCount: 0 });
    setLinkDatasetLoadState('idle');
    setLinkDatasetMessage('');
    setLinkVendorProductKeys([]);
    setLinkCatalogQuery('');
    setLinkCatalogTarget(null);
    setLinkCatalogResults([]);
    setLinkCatalogMessage('');
    setLinkCatalogLoading(false);
  };

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
    setLinkTestRule(null);
    setLinkTestCustomerId('');
    setLinkTestAgreementId('');
    setLinkTestResult(null);
    setLinkTestLoadState('idle');
    setLinkTestMessage('');
    resetBundleForm();
    resetLinkRuleForm();
  }, [dattoMappingDataset, mappingState?.vendorId, mappingState?.summary.productMappings, mappingState?.summary.productCandidates]);

  useEffect(() => {
    setMappingSectionOpen({});
  }, [dattoMappingDataset, mappingState?.vendorId, selectedIntegrationId]);

  useEffect(() => {
    if (
      linkSourceIntegrationOptions.length > 0 &&
      !linkSourceIntegrationOptions.some((integration) => integration.id === linkSourceVendorId)
    ) {
      setLinkSourceVendorId(linkSourceIntegrationOptions[0].id);
    }
  }, [linkSourceIntegrationOptions, linkSourceVendorId]);

  useEffect(() => {
    if (linkSourceMode !== 'filtered-dataset' || !linkSourceVendorId) {
      return;
    }

    let cancelled = false;
    const dataset = linkSourceVendorId === 'microsoft-365' ? linkSourceDataset : undefined;

    setLinkDatasetLoadState('loading');
    setLinkDatasetMessage('Loading dataset columns and values...');

    fetchRawSyncRuns(linkSourceVendorId, dataset)
      .then(async (runsResponse) => {
        const latestRun = runsResponse.runs[0];
        if (!latestRun) {
          return {
            metadata: { columns: [], uniqueValuesByColumn: {}, rowCount: 0 } satisfies LinkedDatasetMetadata,
            message: 'No completed raw sync rows are available for this dataset yet.',
          };
        }

        const details = await fetchRawSyncDetails(linkSourceVendorId, latestRun.id, dataset);
        return {
          metadata: linkedDatasetMetadataFromDetails(details),
          message: `Loaded ${details.columns.length.toLocaleString()} columns and ${details.rows.length.toLocaleString()} rows from latest sync.`,
        };
      })
      .then(({ metadata, message }) => {
        if (cancelled) {
          return;
        }

        setLinkDatasetMetadata(metadata);
        setLinkDatasetLoadState(metadata.columns.length > 0 ? 'ready' : 'failed');
        setLinkDatasetMessage(message);
        if (metadata.columns.length > 0) {
          const preferredField = metadata.columns.includes('LicenseName')
            ? 'LicenseName'
            : metadata.columns.includes('ProductName')
              ? 'ProductName'
              : metadata.columns[0];
          setLinkFilterRoot((current) => alignLinkedFilterFields(current, metadata.columns, preferredField));
          setLinkAggregationColumn((current) => current && metadata.columns.includes(current) ? current : metadata.columns[0]);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setLinkDatasetMetadata({ columns: [], uniqueValuesByColumn: {}, rowCount: 0 });
        setLinkDatasetLoadState('failed');
        setLinkDatasetMessage(error instanceof Error ? error.message : 'Unable to load dataset columns and values.');
      });

    return () => {
      cancelled = true;
    };
  }, [linkSourceDataset, linkSourceMode, linkSourceVendorId]);

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

  const openLinkRuleTest = (rule: ProductLinkRule) => {
    const firstCustomer = customerOptions[0];
    setLinkTestRule(rule);
    setLinkTestCustomerId(firstCustomer?.customerId ?? '');
    setLinkTestAgreementId('');
    setLinkTestResult(null);
    setLinkTestLoadState('idle');
    setLinkTestMessage(
      firstCustomer
        ? 'Choose a customer scope and run the linked count test.'
        : 'No mapped ConnectWise customers are available yet.',
    );
  };

  const closeLinkRuleTest = () => {
    setLinkTestRule(null);
    setLinkTestCustomerId('');
    setLinkTestAgreementId('');
    setLinkTestResult(null);
    setLinkTestLoadState('idle');
    setLinkTestMessage('');
  };

  const selectLinkTestCustomer = (customerId: string) => {
    setLinkTestCustomerId(customerId);
    setLinkTestAgreementId('');
    setLinkTestResult(null);
    setLinkTestLoadState('idle');
    setLinkTestMessage('Run the linked count test for the selected customer.');
  };

  const runLinkRuleTest = async () => {
    if (!linkTestRule) {
      return;
    }

    if (!linkTestCustomerId) {
      setLinkTestLoadState('failed');
      setLinkTestMessage('Choose a customer before running the test.');
      return;
    }

    setLinkTestLoadState('loading');
    setLinkTestMessage('Calculating linked count rows...');
    try {
      const result = await testProductLinkRuleRequest(selectedIntegrationId, linkTestRule.id, {
        customerId: linkTestCustomerId,
        agreementId: linkTestAgreementId || undefined,
      });
      setLinkTestResult(result);
      setLinkTestLoadState('ready');
      setLinkTestMessage(
        `Found ${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? '' : 's'} contributing ${result.total.toLocaleString()} total.`,
      );
    } catch (error) {
      setLinkTestResult(null);
      setLinkTestLoadState('failed');
      setLinkTestMessage(error instanceof Error ? error.message : 'Linked count test failed.');
    }
  };

  const deleteLinkRule = async (rule: ProductLinkRule) => {
    const confirmed = window.confirm(`Delete linked count rule "${rule.ruleName}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    if (editingLinkRuleId === rule.id) {
      resetLinkRuleForm();
    }
    if (linkTestRule?.id === rule.id) {
      closeLinkRuleTest();
    }

    await onProductLinkRuleDelete(selectedIntegrationId, rule.id);
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

  const loadLinkSourceProducts = async (integrationId = linkSourceVendorId) => {
    if (!integrationId) {
      setLinkSourceMessage('Choose a source vendor.');
      return;
    }

    setLinkSourceLoadState('loading');
    setLinkSourceMessage('');
    try {
      const state =
        integrationId === selectedIntegrationId && mappingState
          ? mappingState
          : await fetchMappingState(integrationId);
      setLinkSourceMappingStates((current) => ({ ...current, [integrationId]: state }));
      const approvedProductCount = state.productMappings.filter((row) => row.active && row.status === 'approved').length;
      setLinkSourceLoadState('ready');
      setLinkSourceMessage(
        `Loaded ${approvedProductCount.toLocaleString()} approved source product${approvedProductCount === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      setLinkSourceLoadState('failed');
      setLinkSourceMessage(error instanceof Error ? error.message : 'Unable to load source vendor products.');
    }
  };

  const toggleLinkVendorProductKey = (vendorProductKey: string) => {
    setLinkVendorProductKeys((current) =>
      current.includes(vendorProductKey)
        ? current.filter((currentKey) => currentKey !== vendorProductKey)
        : [...current, vendorProductKey],
    );
  };

  const runLinkCatalogSearch = async () => {
    const query = linkCatalogQuery.trim();
    if (!query) {
      setLinkCatalogMessage('Enter a product code or name to search ConnectWise.');
      return;
    }

    setLinkCatalogLoading(true);
    setLinkCatalogMessage('');
    try {
      const response = await searchProductCatalog(selectedIntegrationId, query);
      setLinkCatalogResults(response.targets);
      setLinkCatalogMessage(
        response.warning ?? `${response.targets.length} catalog item${response.targets.length === 1 ? '' : 's'} found.`,
      );
    } catch (error) {
      setLinkCatalogResults([]);
      setLinkCatalogMessage(error instanceof Error ? error.message : 'Product catalog search failed.');
    } finally {
      setLinkCatalogLoading(false);
    }
  };

  const editLinkRule = (rule: ProductLinkRule) => {
    setEditingLinkRuleId(rule.id);
    setLinkTargetProductKey(rule.sourceVendorProductKey);
    setLinkRuleName(rule.ruleName);
    const firstSource = rule.sources[0];
    if (firstSource?.sourceType === 'filtered-dataset') {
      setLinkSourceMode('filtered-dataset');
      setLinkSourceVendorId(firstSource.vendorId);
      setLinkSourceDataset(firstSource.dataset ?? 'users');
      setLinkAggregationType(firstSource.aggregation.type);
      setLinkAggregationColumn(firstSource.aggregation.type === 'column-sum' ? firstSource.aggregation.column : 'TotalUnits');
      setLinkFilterRoot(firstSource.filter);
      setLinkVendorProductKeys([]);
      setLinkCatalogTarget(null);
      setLinkCatalogResults([]);
      setLinkCatalogMessage('');
      return;
    }

    if (firstSource?.sourceType === 'connectwise-addition') {
      setLinkSourceMode('connectwise-addition');
      setLinkVendorProductKeys([]);
      setLinkCatalogTarget({
        connectwiseProductCode: firstSource.productCode,
        connectwiseProductName: firstSource.productName ?? firstSource.productCode,
        source: 'local',
      });
      setLinkCatalogQuery(firstSource.productCode);
      setLinkCatalogResults([]);
      setLinkCatalogMessage('');
      return;
    }

    setLinkSourceMode('vendor-product');
    if (firstSource?.sourceType === 'vendor-product') {
      setLinkSourceVendorId(firstSource.vendorId);
    }
    setLinkSourceDataset('licenses');
    setLinkAggregationType('row-count');
    setLinkAggregationColumn('TotalUnits');
    setLinkFilterRoot(defaultLinkedCountFilter());
    setLinkVendorProductKeys(
      rule.sources.flatMap((source) => (source.sourceType === 'vendor-product' ? [source.vendorProductKey] : [])),
    );
    setLinkCatalogTarget(null);
    setLinkCatalogResults([]);
    setLinkCatalogMessage('');
  };

  const saveLinkRule = async () => {
    const targetOption = bundleProductOptions.find((option) => option.vendorProductKey === linkTargetProductKey);
    if (!targetOption) {
      setLinkSourceMessage('Choose the vendor product that should receive the linked count.');
      return;
    }

    let sources: ProductLinkRuleSource[] = [];
    if (linkSourceMode === 'vendor-product') {
      sources = linkVendorProductKeys.flatMap((vendorProductKey) => {
        const option = linkSourceProductOptions.find((candidate) => candidate.vendorProductKey === vendorProductKey);
        return option
          ? [
              {
                sourceType: 'vendor-product' as const,
                vendorId: linkSourceVendorId,
                vendorProductKey: option.vendorProductKey,
                vendorProductName: option.vendorProductName,
              },
            ]
          : [];
      });
    } else if (linkSourceMode === 'filtered-dataset') {
      const aggregation: ProductLinkRuleAggregation =
        linkAggregationType === 'column-sum'
          ? { type: 'column-sum', column: linkAggregationColumn.trim() }
          : { type: 'row-count' };
      sources = hasLinkedFilterCondition(linkFilterRoot) &&
        (aggregation.type === 'row-count' || aggregation.column)
        ? [
            {
              sourceType: 'filtered-dataset' as const,
              vendorId: linkSourceVendorId,
              dataset: linkSourceVendorId === 'microsoft-365' ? linkSourceDataset : undefined,
              filter: linkFilterRoot,
              aggregation,
            },
          ]
        : [];
    } else if (linkCatalogTarget) {
      sources = [
        {
          sourceType: 'connectwise-addition' as const,
          productCode: linkCatalogTarget.connectwiseProductCode,
          productName: linkCatalogTarget.connectwiseProductName,
        },
      ];
    }

    if (sources.length === 0) {
      const message = linkSourceMode === 'vendor-product'
        ? 'Choose at least one approved source vendor product.'
        : linkSourceMode === 'filtered-dataset'
          ? 'Complete the dataset filter and aggregation.'
          : 'Choose a ConnectWise agreement addition product.';
      if (linkSourceMode === 'vendor-product') {
        setLinkSourceMessage(message);
      } else if (linkSourceMode === 'filtered-dataset') {
        setLinkSourceMessage(message);
      } else {
        setLinkCatalogMessage(message);
      }
      return;
    }

    const saved = await onProductLinkRuleSave(selectedIntegrationId, {
      id: editingLinkRuleId ?? undefined,
      sourceVendorProductKey: targetOption.vendorProductKey,
      ruleName: linkRuleName.trim() || `${targetOption.vendorProductName} linked count`,
      sources,
    });

    if (saved) {
      resetLinkRuleForm();
    }
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

  const runProductCatalogSearch = async (integrationId: VendorKey, vendorProductKey: string) => {
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
            <span>Vendor</span>
            <select
              onChange={(event) => onIntegrationChange(event.target.value as VendorKey)}
              value={selectedIntegrationId}
            >
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                </option>
              ))}
              {vendorDatapoints.map((datapoint) => (
                <option key={datapoint.vendorId} value={datapointMappingVendorId(datapoint)}>
                  {datapoint.displayName}
                  {datapoint.linkedIntegrationId ? ` (${integrationName(datapoint.linkedIntegrationId)})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
          {!isLaborOnlyMappingWorkspace ? (
            <>
              <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={onAutomap} type="button">
                <Zap size={16} />
                {busyAction === 'automap' ? 'Automapping' : 'Run automap'}
              </button>
              <button
                className="button primary compact"
                disabled={Boolean(busyAction) || !canBulkApproveSuggested}
                onClick={onApproveSuggested}
                title={
                  isDattoMappingWorkspace
                    ? 'Approve Datto SaaS and BCDR mappings individually from their dataset table.'
                    : suggestedAccountCount === 0
                      ? 'No suggested customer mappings are ready to approve.'
                      : 'Approve all suggested customer mappings.'
                }
                type="button"
              >
                <Link2 size={16} />
                {busyAction === 'approve-suggested'
                  ? 'Approving'
                  : isDattoMappingWorkspace
                    ? 'Approve rows individually'
                    : `Approve suggested (${suggestedAccountCount})`}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {showLaborMappingSection ? (
        <MappingSectionDrawer
          defaultOpen={isLaborOnlyMappingWorkspace}
          meta="Ticket board / type / subtype filters for profitability hours"
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="labor"
          status={`${laborMappings.length.toLocaleString()} labeled`}
          title="Labor mapping"
        >
          <LaborMappingPanel
            boards={laborBoards}
            busyAction={busyAction}
            classificationMessage={laborClassificationMessage}
            mappings={laborMappings}
            onSave={onLaborMappingSave}
          />
        </MappingSectionDrawer>
      ) : null}

      {showInvestigationTicketMappingSection ? (
        <MappingSectionDrawer
          defaultOpen
          meta="Board, type, optional subtype, and status for reconcile investigation tickets"
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="investigation-tickets"
          status={investigationTicketMapping ? 'Configured' : 'Required'}
          statusTone={investigationTicketMapping ? 'ready' : 'needs-review'}
          title="Investigation ticket mapping"
        >
          <InvestigationTicketMappingPanel
            boards={laborBoards}
            busyAction={busyAction}
            classificationMessage={laborClassificationMessage}
            customerOptions={customerOptions}
            mapping={investigationTicketMapping}
            onSave={onInvestigationTicketMappingSave}
          />
        </MappingSectionDrawer>
      ) : null}

      {!isLaborOnlyMappingWorkspace ? (
        <MappingSectionDrawer
          defaultOpen={doNotSuggestNewAdditions || selectedIntegrationId === 'ncentral'}
          meta="Controls how reconcile suggests agreement changes"
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="reconciliation-options"
          status={doNotSuggestNewAdditions ? 'Existing only' : 'Suggest new'}
          statusTone={doNotSuggestNewAdditions ? 'needs-review' : 'ready'}
          title="Reconciliation options"
        >
          <section className="work-surface" aria-label="Reconciliation options">
            <div className="surface-header">
              <div>
                <span className="section-kicker">Integration</span>
                <h2>{selectedIntegrationName} reconcile behavior</h2>
              </div>
            </div>
            <label className="config-checkbox">
              <input
                checked={doNotSuggestNewAdditions}
                disabled={busyAction === 'reconciliation-options'}
                onChange={(event) => void onReconciliationOptionChange(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Do not suggest New Additions</strong>
                <small>
                  Only track customers that already have the mapped product on their agreement. Useful when a small subset
                  of monitored clients should be billed, such as N-central servers.
                </small>
              </span>
            </label>
          </section>
        </MappingSectionDrawer>
      ) : null}

      {!isLaborOnlyMappingWorkspace ? (
        <>
      {isDattoMappingWorkspace ? (
        <section className="mapping-dataset-tabs" aria-label="Datto mapping dataset">
          {(['saas', 'bcdr'] as const).map((dataset) => {
            const counts = dattoDatasetCounts(mappingState, dataset);
            return (
              <button
                aria-selected={dattoMappingDataset === dataset}
                className={dattoMappingDataset === dataset ? 'active' : ''}
                key={dataset}
                onClick={() => setDattoMappingDataset(dataset)}
                type="button"
              >
                <span>{dattoMappingDatasetLabel(dataset)}</span>
                <strong>{counts.accounts.toLocaleString()} accounts</strong>
                <em>{counts.products.toLocaleString()} products</em>
              </button>
            );
          })}
        </section>
      ) : null}

      {isHuntressMappingWorkspace ? (
        <section className="mapping-dataset-tabs huntress-dataset-tabs" aria-label="Huntress product class">
          {huntressMappingDatasets.map((dataset) => {
            const counts = huntressDatasetCounts(mappingState, dataset);
            return (
              <button
                aria-selected={huntressMappingDataset === dataset}
                className={huntressMappingDataset === dataset ? 'active' : ''}
                key={dataset}
                onClick={() => setHuntressMappingDataset(dataset)}
                type="button"
              >
                <span>{huntressMappingDatasetLabel(dataset)}</span>
                <strong>{counts.accounts.toLocaleString()} accounts</strong>
                <em>{counts.products.toLocaleString()} products</em>
              </button>
            );
          })}
        </section>
      ) : null}

      <section className="metric-grid mapping-metrics" aria-label="Mapping summary">
        <MetricCard icon={Users} label="Mapped clients" tone="approved" value={formatCount(approvedAccountMappingCount)} />
        <MetricCard icon={ClipboardCheck} label="Client review" tone="warn" value={formatCount(accountCandidates.filter((candidate) => candidate.status === 'needs-review').length)} />
        <MetricCard icon={Package} label="Mapped products" tone="ready" value={formatCount(approvedProductMappingCount)} />
        <MetricCard icon={Database} label="Unmapped products" tone="money" value={formatCount(productCandidates.length)} />
      </section>

      {selectedIntegrationId === 'ncentral' ? (
        <MappingSectionDrawer
          defaultOpen={false}
          meta={`${ncentralFilters.length.toLocaleString()} discovered filters`}
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="ncentral"
          status={`${ncentralFilterMappings.length.toLocaleString()} mapped`}
          title="N-central filters"
        >
          <NcentralFilterMappingPanel
            busyAction={busyAction}
            filters={ncentralFilters}
            mappings={ncentralFilterMappings}
            onSave={onNcentralFilterMappingSave}
          />
        </MappingSectionDrawer>
      ) : null}

      <section className="mapping-review-grid">
        <MappingSectionDrawer
          defaultOpen={false}
          meta={`${approvedAccountMappingCount.toLocaleString()} mapped customers`}
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="customer"
          status={`${accountCandidates.length.toLocaleString()} unmatched`}
          statusTone={accountCandidates.length > 0 ? 'needs-review' : 'approved'}
          title="Customer mapping"
        >
          <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Customer mapping</span>
              <h2>
                {showMappedAccounts
                  ? `${accountRows.length.toLocaleString()} ${selectedDatasetLabel} accounts`
                  : `${accountCandidates.length.toLocaleString()} unmapped ${selectedDatasetLabel} accounts`}
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
              <span>{selectedDatasetLabel} customer</span>
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
        </MappingSectionDrawer>

        <MappingSectionDrawer
          defaultOpen={unmatchedProductGroupCount > 0}
          meta={`${approvedProductMappingCount.toLocaleString()} mapped products`}
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="product"
          status={`${unmatchedProductGroupCount.toLocaleString()} unmatched`}
          statusTone={unmatchedProductGroupCount > 0 ? 'needs-review' : 'approved'}
          title="Product mapping"
        >
          <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Product mapping</span>
              <h2>
                {showMappedProducts
                  ? `${productGroups.length.toLocaleString()} ${selectedIntegrationName} product groups`
                  : `${productGroups.length.toLocaleString()} unmatched ${selectedIntegrationName} product groups`}
              </h2>
            </div>
            <label className="switch-control compact-switch">
              <input
                checked={showMappedProducts}
                onChange={(event) => setShowMappedProducts(event.target.checked)}
                type="checkbox"
              />
              Show matched products
            </label>
          </div>

          <div className="mapping-review-list product-mapping-list">
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
              const approvedLabel = approvedCount > 0 ? `${approvedCount} mapped` : 'Suggested';
              const customerCountLabel = `${group.customerCount.toLocaleString()} customer${group.customerCount === 1 ? '' : 's'}`;
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
                      {customerCountLabel}
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
                    {approvedLabel}
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
        </MappingSectionDrawer>
      </section>

      <MappingSectionDrawer
        defaultOpen={false}
        meta={`${productLinkRules.length.toLocaleString()} saved linked count rules`}
        onOpenChange={setMappingSection}
        openState={mappingSectionOpen}
        sectionId="linked-counts"
        status={`${activeLinkRuleCount.toLocaleString()} active`}
        title="Linked counts"
      >
        <section className="work-surface product-bundle-surface linked-count-surface" aria-label="Linked count rules">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Linked counts</span>
            <h2>{activeLinkRuleCount.toLocaleString()} active linked count rules</h2>
          </div>
          {editingLinkRuleId ? (
            <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={resetLinkRuleForm} type="button">
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className={`product-bundle-form linked-count-form${linkSourceMode === 'filtered-dataset' ? ' filtered-dataset' : ''}`}>
          <label>
            <span>{selectedIntegrationName} product</span>
            <select onChange={(event) => setLinkTargetProductKey(event.target.value)} value={linkTargetProductKey}>
              <option value="">Select product</option>
              {bundleProductOptions.map((option) => (
                <option key={option.vendorProductKey} value={option.vendorProductKey}>
                  {option.vendorProductName}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{editingLinkRuleId ? 'Editing rule' : 'Rule name'}</span>
            <input
              onChange={(event) => setLinkRuleName(event.target.value)}
              placeholder="Email Threat Protection linked count"
              value={linkRuleName}
            />
          </label>

          <label>
            <span>Source type</span>
            <select
              onChange={(event) => {
                const nextMode = event.target.value as ProductLinkRuleSource['sourceType'];
                setLinkSourceMode(nextMode);
                setLinkSourceMessage('');
                setLinkCatalogMessage('');
              }}
              value={linkSourceMode}
            >
              <option value="vendor-product">Vendor product</option>
              <option value="filtered-dataset">Vendor dataset</option>
              <option value="connectwise-addition">ConnectWise addition</option>
            </select>
          </label>

          {linkSourceMode === 'vendor-product' ? (
            <div className="product-bundle-target linked-count-source">
              <label>
                <span>Source vendor</span>
                <div className="product-catalog-search-row">
                  <select
                    onChange={(event) => {
                      setLinkSourceVendorId(event.target.value as IntegrationId);
                      setLinkVendorProductKeys([]);
                      setLinkSourceMessage('');
                    }}
                    value={linkSourceVendorId}
                  >
                    {linkSourceIntegrationOptions.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary compact"
                    disabled={linkSourceLoadState === 'loading'}
                    onClick={() => void loadLinkSourceProducts()}
                    type="button"
                  >
                    <RefreshCcw size={14} />
                    {linkSourceLoadState === 'loading' ? 'Loading' : 'Load'}
                  </button>
                </div>
              </label>
              {linkSourceMessage ? <span className="product-catalog-message">{linkSourceMessage}</span> : null}
              <div className="product-bundle-target-list">
                {linkSourceProductOptions.length === 0 ? (
                  <span className="product-target-empty">Load a vendor with approved product mappings.</span>
                ) : null}
                {linkSourceProductOptions.map((option) => (
                  <label className="product-bundle-component-option" key={option.vendorProductKey}>
                    <input
                      checked={linkVendorProductKeys.includes(option.vendorProductKey)}
                      onChange={() => toggleLinkVendorProductKey(option.vendorProductKey)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{option.vendorProductName}</strong>
                      <em>
                        {option.vendorProductKey}
                        {option.rowCount > 0 ? ` / ${option.rowCount.toLocaleString()} additions` : ''}
                      </em>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : linkSourceMode === 'filtered-dataset' ? (
            <div className="product-bundle-target linked-count-source linked-filter-source">
              <div className="linked-filter-grid">
                <label>
                  <span>Source vendor</span>
                  <select
                    onChange={(event) => {
                      setLinkSourceVendorId(event.target.value as IntegrationId);
                      setLinkSourceMessage('');
                    }}
                    value={linkSourceVendorId}
                  >
                    {linkSourceIntegrationOptions.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Dataset</span>
                  <select
                    disabled={linkSourceVendorId !== 'microsoft-365'}
                    onChange={(event) => setLinkSourceDataset(event.target.value as RawSyncDataset)}
                    value={linkSourceVendorId === 'microsoft-365' ? linkSourceDataset : 'users'}
                  >
                    <option value="licenses">Licenses</option>
                    <option value="users">Users</option>
                  </select>
                </label>
                <label>
                  <span>Aggregation</span>
                  <select
                    onChange={(event) => setLinkAggregationType(event.target.value as ProductLinkRuleAggregation['type'])}
                    value={linkAggregationType}
                  >
                    <option value="row-count">Row count</option>
                    <option value="column-sum">Column sum</option>
                  </select>
                </label>
                <label>
                  <span>Sum column</span>
                  <select
                    disabled={linkAggregationType !== 'column-sum'}
                    onChange={(event) => setLinkAggregationColumn(event.target.value)}
                    value={linkAggregationColumn}
                  >
                    {uniqueStrings([linkAggregationColumn, ...linkFilterColumnOptions]).map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="linked-filter-builder">
                {Object.entries(linkDatasetMetadata.uniqueValuesByColumn).map(([column, values]) => (
                  <datalist id={`linked-filter-values-${safeDomId(column)}`} key={column}>
                    {values.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                ))}
                <LinkedFilterGroupEditor
                  node={linkFilterRoot}
                  onChange={setLinkFilterRoot}
                  columns={linkFilterColumnOptions}
                  uniqueValuesByColumn={linkDatasetMetadata.uniqueValuesByColumn}
                />
                {linkDatasetMessage ? (
                  <span className="product-catalog-message">{linkDatasetLoadState === 'loading' ? 'Loading dataset values...' : linkDatasetMessage}</span>
                ) : null}
                {linkSourceMessage ? <span className="product-catalog-message">{linkSourceMessage}</span> : null}
              </div>
            </div>
          ) : (
            <div className="product-bundle-target linked-count-source">
              <label>
                <span>ConnectWise product</span>
                <div className="product-catalog-search-row">
                  <input
                    onChange={(event) => setLinkCatalogQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void runLinkCatalogSearch();
                      }
                    }}
                    placeholder="Sync product code or name"
                    value={linkCatalogQuery}
                  />
                  <button
                    className="button secondary compact"
                    disabled={linkCatalogLoading}
                    onClick={() => void runLinkCatalogSearch()}
                    type="button"
                  >
                    <Search size={14} />
                    {linkCatalogLoading ? 'Searching' : 'Search'}
                  </button>
                </div>
              </label>
              {linkCatalogMessage ? <span className="product-catalog-message">{linkCatalogMessage}</span> : null}
              <div className="product-bundle-target-list">
                {linkCatalogTargetOptions.map((target) => (
                  <label className="product-target-option" key={target.connectwiseProductCode}>
                    <input
                      checked={linkCatalogTarget?.connectwiseProductCode === target.connectwiseProductCode}
                      onChange={() => setLinkCatalogTarget({ ...target, source: 'local' })}
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
          )}

          <div className="product-bundle-actions">
            <button
              className="button primary compact"
              disabled={
                Boolean(busyAction) ||
                !linkTargetProductKey ||
                (linkSourceMode === 'vendor-product' && linkVendorProductKeys.length === 0) ||
                (linkSourceMode === 'filtered-dataset' &&
                  (!hasLinkedFilterCondition(linkFilterRoot) ||
                    (linkAggregationType === 'column-sum' && !linkAggregationColumn.trim()))) ||
                (linkSourceMode === 'connectwise-addition' && !linkCatalogTarget)
              }
              onClick={() => void saveLinkRule()}
              type="button"
            >
              <Link2 size={16} />
              {busyAction === linkRuleActionKey ? 'Saving' : editingLinkRuleId ? 'Update rule' : 'Save rule'}
            </button>
          </div>
        </div>

        <div className="product-bundle-list">
          {productLinkRules.length === 0 ? (
            <div className="empty-state">
              <Link2 size={20} />
              <strong>No linked count rules saved.</strong>
            </div>
          ) : null}
          {productLinkRules.map((rule) => (
            <article className="product-bundle-row linked-count-row" key={rule.id}>
              <div>
                <strong>{productLinkRuleTargetLabel(rule, bundleProductOptions)}</strong>
                <span>{rule.sourceVendorProductKey}</span>
              </div>
              <ArrowRight size={16} />
              <div>
                <strong>{rule.ruleName}</strong>
                <span>{rule.sources.map(productLinkRuleSourceLabel).join('; ')}</span>
              </div>
              <span className={`status-pill ${rule.active ? 'approved' : 'blocked'}`}>
                {rule.active ? 'Active' : 'Disabled'}
              </span>
              <span>{rule.sources.length.toLocaleString()} source{rule.sources.length === 1 ? '' : 's'}</span>
              <div className="product-bundle-row-actions">
                <button
                  className="button secondary compact"
                  disabled={linkTestLoadState === 'loading'}
                  onClick={() => openLinkRuleTest(rule)}
                  type="button"
                >
                  <Search size={15} />
                  Test
                </button>
                <button
                  className="button secondary compact"
                  disabled={Boolean(busyAction)}
                  onClick={() => editLinkRule(rule)}
                  type="button"
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  className="button secondary compact"
                  disabled={busyAction === `link:${rule.id}`}
                  onClick={() => void onProductLinkRuleActiveChange(selectedIntegrationId, rule.id, !rule.active)}
                  type="button"
                >
                  {rule.active ? <X size={15} /> : <Check size={15} />}
                  {rule.active ? 'Disable' : 'Re-enable'}
                </button>
                <button
                  className="button secondary compact danger"
                  disabled={Boolean(busyAction)}
                  onClick={() => void deleteLinkRule(rule)}
                  type="button"
                >
                  <X size={15} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      </MappingSectionDrawer>

      {selectedIntegrationId === 'opentext-appriver' ? (
        <MappingSectionDrawer
          defaultOpen={false}
          meta={`${productBundles.length.toLocaleString()} saved AppRiver bundles`}
          onOpenChange={setMappingSection}
          openState={mappingSectionOpen}
          sectionId="bundles"
          status={`${activeBundleCount.toLocaleString()} active`}
          title="Bundles"
        >
          <section className="work-surface product-bundle-surface" aria-label="AppRiver product bundles">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Bundles</span>
              <h2>{activeBundleCount.toLocaleString()} active AppRiver bundles</h2>
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
        </MappingSectionDrawer>
      ) : null}

      <MappingSectionDrawer
        defaultOpen={false}
        meta={`${selectedIntegrationName} product count adjustments`}
        onOpenChange={setMappingSection}
        openState={mappingSectionOpen}
        sectionId="usage-overrides"
        status={`${usageOverrides.length.toLocaleString()} active`}
        title="Usage overrides"
      >
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
      </MappingSectionDrawer>
        </>
      ) : null}

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
      {linkTestRule ? (
        <LinkedCountTestModal
          customers={customerOptions}
          loadState={linkTestLoadState}
          message={linkTestMessage}
          onAgreementChange={setLinkTestAgreementId}
          onClose={closeLinkRuleTest}
          onCustomerChange={selectLinkTestCustomer}
          onRun={runLinkRuleTest}
          result={linkTestResult}
          rule={linkTestRule}
          selectedAgreementId={linkTestAgreementId}
          selectedCustomerId={linkTestCustomerId}
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

const sentinelOneVendorDataColumns: VendorDataColumn[] = [
  { label: 'Device Name', primary: true, value: deviceDisplayName },
  { label: 'ID', value: deviceIdentityLabel },
  { label: 'Type', value: deviceTypeLabel },
  { label: 'Product', value: (device) => device.productName },
  { label: 'OS', value: deviceOsLabel },
  { label: 'Site', value: (device) => device.dimensions.siteName },
  { label: 'Last Check-In', format: 'date', value: deviceLastCheckIn },
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
  { label: 'Last Check-In', format: 'date', value: deviceLastCheckIn },
  { label: 'Observed', format: 'date', value: (device) => device.observedAt },
];

function vendorDataColumns(selection: VendorDataSelection) {
  if (selection.vendorId === 'opentext-appriver') return appRiverVendorDataColumns;
  if (selection.vendorId === 'microsoft-365') return microsoft365VendorDataColumns;
  if (selection.vendorId === 'cove') return coveVendorDataColumns;
  if (selection.vendorId === 'ncentral') return ncentralVendorDataColumns;
  if (selection.vendorId === 'sentinelone') return sentinelOneVendorDataColumns;
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

function refreshIssueCountsFromDevices(issue: ReconcileIssue): ReconcileIssue {
  const nextSourceCount = issue.devices.reduce((total, device) => total + device.quantity, 0);
  const nextIssue: ReconcileIssue = {
    ...issue,
    sourceCount: nextSourceCount,
    measuredSourceCount: nextSourceCount,
    proposedCount: nextSourceCount,
  };
  const nextDelta = reconciliationDelta(nextIssue);
  const matchedAdditionCount = issue.matchedAgreementAdditions.length;
  const writeAction =
    nextDelta === 0
      ? undefined
      : matchedAdditionCount === 0
        ? 'create-addition'
        : matchedAdditionCount === 1
          ? 'update-addition'
          : 'review-required';

  return {
    ...nextIssue,
    amount: reconciliationIssueImpact(nextIssue),
    writeAction,
    status:
      nextDelta === 0
        ? 'matched'
        : issue.status === 'approved' || issue.status === 'updated'
          ? issue.status
          : 'needs-review',
    baseStatus: nextDelta === 0 ? 'matched' : 'needs-review',
    reason:
      nextDelta === 0
        ? `${issue.product} count matches the agreement addition.`
        : `${issue.product} count differs from the agreement addition.`,
  };
}

function createRemappedDeviceIssue(
  sourceIssue: ReconcileIssue,
  target: ReconciliationProductOption,
  devices: ReconciliationDevice[],
): ReconcileIssue {
  return refreshIssueCountsFromDevices({
    ...sourceIssue,
    id: `${sourceIssue.clientId}|${sourceIssue.agreementId}|${target.productCode}|base`,
    product: target.productName,
    serviceCode: target.productCode,
    family: 'Base count',
    lineType: 'base-count',
    invoiceCount: 0,
    proposedCount: 0,
    sourceCount: 0,
    measuredSourceCount: 0,
    amount: 0,
    vendorInvoiceCount: undefined,
    vendorInvoiceLineCount: undefined,
    invoiceImportId: undefined,
    invoiceNumber: undefined,
    invoiceDate: undefined,
    linkedCount: undefined,
    matchedAgreementAdditions: [],
    adjustments: [],
    devices,
    writeAction: 'create-addition',
    status: 'needs-review',
    baseStatus: 'needs-review',
    selectedCountSource: 'api',
    manualOverrideTotal: undefined,
    manualOverrideTotalTouched: false,
    proposedLessIncluded: undefined,
    lessIncludedTouched: false,
    appliedUpdate: undefined,
    reason: `${target.productName} count differs from the agreement addition.`,
    recommendation: 'Create a ConnectWise agreement addition after review.',
    audit: [`Remapped from ${sourceIssue.product}.`],
  });
}

function applyDeviceRemapsToIssues(
  issues: ReconcileIssue[],
  sourceIssue: ReconcileIssue,
  remaps: Array<{ device: ReconciliationDevice; targetVendorProductKey: string }>,
  productOptions: ReconciliationProductOption[],
) {
  if (remaps.length === 0) {
    return issues;
  }

  const remappedIds = new Set(remaps.map((entry) => entry.device.id));
  const movedByTarget = new Map<string, ReconciliationDevice[]>();

  for (const { device, targetVendorProductKey } of remaps) {
    const target = productOptions.find((option) => option.vendorProductKey === targetVendorProductKey);
    if (!target) {
      continue;
    }

    const remappedDevice: ReconciliationDevice = {
      ...device,
      vendorProductKey: target.vendorProductKey,
      productCode: target.productCode,
      productName: target.productName,
      dimensions: {
        ...device.dimensions,
        originalVendorProductKey: device.vendorProductKey,
        originalProductCode: device.productCode,
      },
    };
    const existing = movedByTarget.get(target.vendorProductKey) ?? [];
    existing.push(remappedDevice);
    movedByTarget.set(target.vendorProductKey, existing);
  }

  let nextIssues = issues.map((current) => {
    if (current.id !== sourceIssue.id) {
      return current;
    }

    return refreshIssueCountsFromDevices({
      ...current,
      devices: current.devices.filter((device) => !remappedIds.has(device.id)),
    });
  });

  for (const [targetVendorProductKey, devices] of movedByTarget.entries()) {
    const target = productOptions.find((option) => option.vendorProductKey === targetVendorProductKey);
    if (!target) {
      continue;
    }

    const targetIndex = nextIssues.findIndex(
      (candidate) =>
        candidate.vendorId === sourceIssue.vendorId &&
        candidate.clientId === sourceIssue.clientId &&
        candidate.agreementId === sourceIssue.agreementId &&
        (candidate.serviceCode === target.productCode || candidate.product === target.productName),
    );

    if (targetIndex >= 0) {
      const targetIssue = nextIssues[targetIndex];
      nextIssues = [
        ...nextIssues.slice(0, targetIndex),
        refreshIssueCountsFromDevices({
          ...targetIssue,
          devices: [...targetIssue.devices, ...devices],
        }),
        ...nextIssues.slice(targetIndex + 1),
      ];
      continue;
    }

    nextIssues = [...nextIssues, createRemappedDeviceIssue(sourceIssue, target, devices)];
  }

  return nextIssues.filter(
    (issue) =>
      !isZeroZeroReconciliationIssue(issue) &&
      (issue.devices.length > 0 ||
        issue.invoiceCount > 0 ||
        issue.matchedAgreementAdditions.length > 0 ||
        issue.status === 'approved' ||
        issue.status === 'updated'),
  );
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
  const value = device.dimensions.operatingSystem ?? device.dimensions.os ?? device.dimensions.osType;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '-';
}

function deviceLastCheckIn(device: ReconciliationDevice) {
  const value =
    device.dimensions.lastApplianceCheckinTime ??
    device.dimensions.lastCheckIn ??
    device.dimensions.lastActiveDate ??
    device.dimensions.lastSeen ??
    device.dimensions.lastComplete;
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mappingType, setMappingType] = useState<NcentralFilterMapping['mappingType']>('overlay');
  const [filterName, setFilterName] = useState('');
  const [filterId, setFilterId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [vendorProductKey, setVendorProductKey] = useState('');
  const [tagKey, setTagKey] = useState('');
  const [priority, setPriority] = useState(100);
  const productMappings = mappings.filter((mapping) => mapping.mappingType === 'product');
  const overlayMappings = mappings.filter((mapping) => mapping.mappingType === 'overlay');

  const resetCreateForm = () => {
    setMappingType('overlay');
    setFilterId('');
    setFilterName('');
    setDisplayName('');
    setVendorProductKey('');
    setTagKey('');
    setPriority(100);
  };

  const cancelCreate = () => {
    resetCreateForm();
    setShowCreateForm(false);
  };

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
    resetCreateForm();
    setShowCreateForm(false);
  };

  return (
    <section className="work-surface ncentral-filter-panel" aria-label="N-central filter mapping">
      <div className="surface-header">
        <div>
          <span className="section-kicker">N-central filters</span>
          <h2>{mappings.length.toLocaleString()} billing and overlay filters</h2>
        </div>
        <div className="mapping-panel-header-actions">
          <span className="status-pill ready">{filters.length.toLocaleString()} discovered</span>
          {showCreateForm ? (
            <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={cancelCreate} type="button">
              Cancel
            </button>
          ) : (
            <button className="button primary compact" disabled={Boolean(busyAction)} onClick={() => setShowCreateForm(true)} type="button">
              <Plus size={16} />
              Add filter
            </button>
          )}
        </div>
      </div>

      {showCreateForm ? (
        <div className="mapping-create-form">
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
          <div className="mapping-form-actions">
            <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={cancelCreate} type="button">
              Cancel
            </button>
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
              <Plus size={16} />
              Save filter
            </button>
          </div>
        </div>
      ) : null}

      <div className="ncentral-filter-grid">
        <div>
          <h3>Product filters</h3>
          <div className="ncentral-filter-list">
            {productMappings.length === 0 ? <p className="mapping-empty-hint">No product filters yet.</p> : null}
            {productMappings.map((mapping) => (
              <NcentralFilterMappingRow busyAction={busyAction} filters={filters} key={mapping.id} mapping={mapping} onSave={onSave} />
            ))}
          </div>
        </div>

        <div>
          <h3>Overlay tags</h3>
          <div className="ncentral-filter-list">
            {overlayMappings.length === 0 ? <p className="mapping-empty-hint">No overlay tags yet.</p> : null}
            {overlayMappings.map((mapping) => (
              <NcentralFilterMappingRow busyAction={busyAction} filters={filters} key={mapping.id} mapping={mapping} onSave={onSave} />
            ))}
          </div>
        </div>
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
        <div className="mapping-create-form mapping-edit-form">
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
          <div className="mapping-form-actions">
            <button className="button secondary compact" disabled={busyAction === actionKey} onClick={cancelEdit} type="button">
              Cancel
            </button>
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
          </div>
        </div>
      ) : null}
    </article>
  );
}

function InvestigationTicketMappingPanel(props: {
  boards: ConnectWiseBoardOption[];
  busyAction: string | null;
  classificationMessage: string;
  customerOptions: MappingCustomerOption[];
  mapping: InvestigationTicketMapping | null;
  onSave: (payload: {
    boardId: number;
    boardName?: string | null;
    typeId: number;
    typeName?: string | null;
    subTypeId?: number | null;
    subTypeName?: string | null;
    statusId?: number | null | typeof INVESTIGATION_TICKET_STATUS_DEFAULT;
    statusName?: string | null;
    companyOverrideId?: number | null;
    companyOverrideName?: string | null;
  }) => Promise<void>;
}) {
  const { boards, busyAction, classificationMessage, customerOptions, mapping, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [boardId, setBoardId] = useState(mapping ? String(mapping.boardId) : '');
  const [typeId, setTypeId] = useState(mapping ? String(mapping.typeId) : '');
  const [subTypeId, setSubTypeId] = useState(mapping?.subTypeId != null ? String(mapping.subTypeId) : '');
  const [statusId, setStatusId] = useState(
    mapping?.statusId != null ? String(mapping.statusId) : INVESTIGATION_TICKET_STATUS_DEFAULT,
  );
  const [companyOverrideId, setCompanyOverrideId] = useState(
    mapping?.companyOverrideId != null ? String(mapping.companyOverrideId) : '',
  );
  const [types, setTypes] = useState<ConnectWiseTypeOption[]>([]);
  const [subTypes, setSubTypes] = useState<ConnectWiseSubTypeOption[]>([]);
  const [statuses, setStatuses] = useState<ConnectWiseStatusOption[]>([]);
  const [classificationBusy, setClassificationBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState('');

  const showEditor = editing;
  const companyOverrideOptions = customerOptions
    .filter((option) => {
      const id = Number(option.connectWiseCompanyId);
      return Number.isFinite(id) && id > 0;
    })
    .slice()
    .sort((left, right) => left.customerName.localeCompare(right.customerName));

  useEffect(() => {
    setBoardId(mapping ? String(mapping.boardId) : '');
    setTypeId(mapping ? String(mapping.typeId) : '');
    setSubTypeId(mapping?.subTypeId != null ? String(mapping.subTypeId) : '');
    setStatusId(mapping?.statusId != null ? String(mapping.statusId) : INVESTIGATION_TICKET_STATUS_DEFAULT);
    setCompanyOverrideId(mapping?.companyOverrideId != null ? String(mapping.companyOverrideId) : '');
    setEditing(false);
  }, [mapping]);

  useEffect(() => {
    if (!showEditor || !boardId) {
      if (!boardId) {
        setTypes([]);
        setSubTypes([]);
        setStatuses([]);
      }
      return;
    }

    let cancelled = false;
    setClassificationBusy(true);
    setLocalMessage('');
    void fetchLaborClassifications(Number(boardId))
      .then((response) => {
        if (cancelled) return;
        setTypes(response.types);
        setSubTypes(response.subTypes);
        setStatuses(response.statuses ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        setTypes([]);
        setSubTypes([]);
        setStatuses([]);
        setLocalMessage(error instanceof Error ? error.message : 'Unable to load board classifications.');
      })
      .finally(() => {
        if (!cancelled) {
          setClassificationBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, showEditor]);

  const selectedBoard = boards.find((board) => String(board.id) === boardId);
  const selectedType = types.find((type) => String(type.id) === typeId);
  const selectedSubType = subTypes.find((subType) => String(subType.id) === subTypeId);
  const selectedStatus = statuses.find((status) => String(status.id) === statusId);
  const selectedCompanyOverride = companyOverrideOptions.find(
    (option) => String(option.connectWiseCompanyId) === companyOverrideId,
  );
  const usingDefaultStatus = statusId === INVESTIGATION_TICKET_STATUS_DEFAULT || statusId === '';

  const resetFormFields = () => {
    setBoardId(mapping ? String(mapping.boardId) : '');
    setTypeId(mapping ? String(mapping.typeId) : '');
    setSubTypeId(mapping?.subTypeId != null ? String(mapping.subTypeId) : '');
    setStatusId(mapping?.statusId != null ? String(mapping.statusId) : INVESTIGATION_TICKET_STATUS_DEFAULT);
    setCompanyOverrideId(mapping?.companyOverrideId != null ? String(mapping.companyOverrideId) : '');
    setLocalMessage('');
  };

  const cancelEdit = () => {
    resetFormFields();
    setEditing(false);
  };

  const saveMapping = async () => {
    if (!boardId || !typeId) {
      setLocalMessage('Board and type are required.');
      return;
    }

    await onSave({
      boardId: Number(boardId),
      boardName: selectedBoard?.name ?? mapping?.boardName ?? null,
      typeId: Number(typeId),
      typeName: selectedType?.name ?? mapping?.typeName ?? null,
      subTypeId: subTypeId ? Number(subTypeId) : null,
      subTypeName: subTypeId ? selectedSubType?.name ?? mapping?.subTypeName ?? null : null,
      statusId: usingDefaultStatus ? INVESTIGATION_TICKET_STATUS_DEFAULT : Number(statusId),
      statusName: usingDefaultStatus ? INVESTIGATION_TICKET_STATUS_DEFAULT : selectedStatus?.name ?? mapping?.statusName ?? null,
      companyOverrideId: companyOverrideId ? Number(companyOverrideId) : null,
      companyOverrideName: companyOverrideId
        ? selectedCompanyOverride?.customerName ?? mapping?.companyOverrideName ?? null
        : null,
    });
    setEditing(false);
  };

  return (
    <section className="work-surface ncentral-filter-panel labor-mapping-panel" aria-label="Investigation ticket mapping">
      <div className="surface-header">
        <div>
          <span className="section-kicker">Investigation tickets</span>
          <h2>{mapping ? 'PSA ticket defaults configured' : 'Configure PSA ticket defaults'}</h2>
          <p className="config-note">
            Each vendor needs a ConnectWise board and type. Subtype is optional. Status default leaves status unset so
            the board assigns its default. Company override opens every ticket under that company while the license
            company stays in the ticket description.
          </p>
        </div>
        <div className="mapping-panel-header-actions">
          <span className={`status-pill ${mapping ? 'ready' : 'warn'}`}>
            {mapping ? 'Configured' : 'Required'}
          </span>
          {showEditor ? (
            <button className="button secondary compact" disabled={busyAction === 'investigation-ticket-mapping'} onClick={cancelEdit} type="button">
              Cancel
            </button>
          ) : (
            <button className="button primary compact" onClick={() => setEditing(true)} type="button">
              {mapping ? (
                <>
                  <Pencil size={15} />
                  Edit
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Add mapping
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {classificationMessage || localMessage ? (
        <p className="config-note mapping-panel-message">{classificationMessage || localMessage}</p>
      ) : null}

      {mapping && !showEditor ? (
        <article className="ncentral-filter-row">
          <div className="ncentral-filter-row-main investigation-ticket-mapping-summary">
            <div>
              <strong>{mapping.boardName || `Board ${mapping.boardId}`}</strong>
              <span>
                {mapping.typeName || `Type ${mapping.typeId}`}
                {mapping.subTypeId != null ? ` · ${mapping.subTypeName || `Subtype ${mapping.subTypeId}`}` : ''}
              </span>
            </div>
            <dl className="investigation-ticket-mapping-meta">
              <div>
                <dt>Status</dt>
                <dd>{formatInvestigationTicketStatusLabel(mapping)}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>
                  {mapping.companyOverrideId != null
                    ? mapping.companyOverrideName || `Company ${mapping.companyOverrideId}`
                    : 'License company'}
                </dd>
              </div>
            </dl>
          </div>
        </article>
      ) : null}

      {!mapping && !showEditor ? (
        <div className="empty-state">
          <ListChecks size={20} />
          <strong>No investigation ticket mapping yet.</strong>
          <span>Click Add mapping to choose board, type, and optional subtype, status, and company override.</span>
        </div>
      ) : null}

      {showEditor ? (
        <div className="mapping-create-form">
          <label>
            <span>Board</span>
            <select
              onChange={(event) => {
                setBoardId(event.target.value);
                setTypeId('');
                setSubTypeId('');
                setStatusId(INVESTIGATION_TICKET_STATUS_DEFAULT);
              }}
              value={boardId}
            >
              <option value="">Select board</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select
              disabled={!boardId || classificationBusy}
              onChange={(event) => {
                setTypeId(event.target.value);
                setSubTypeId('');
              }}
              value={typeId}
            >
              <option value="">Select type</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Subtype (optional)</span>
            <select
              disabled={!boardId || classificationBusy || !typeId}
              onChange={(event) => setSubTypeId(event.target.value)}
              value={subTypeId}
            >
              <option value="">None</option>
              {subTypes.map((subType) => (
                <option key={subType.id} value={subType.id}>
                  {subType.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              disabled={!boardId || classificationBusy}
              onChange={(event) => setStatusId(event.target.value)}
              value={statusId}
            >
              <option value={INVESTIGATION_TICKET_STATUS_DEFAULT}>default (board assigns)</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mapping-form-span-2">
            <span>Company override (optional)</span>
            <select onChange={(event) => setCompanyOverrideId(event.target.value)} value={companyOverrideId}>
              <option value="">Use license company</option>
              {companyOverrideOptions.map((option) => (
                <option key={option.customerId} value={option.connectWiseCompanyId}>
                  {option.customerName}
                  {option.connectWiseCompanyId ? ` (#${option.connectWiseCompanyId})` : ''}
                </option>
              ))}
            </select>
            <small>
              {companyOverrideId
                ? 'Tickets always open under this company.'
                : 'Tickets open under the license customer company.'}
            </small>
          </label>
          <div className="mapping-form-actions">
            <button className="button secondary compact" disabled={busyAction === 'investigation-ticket-mapping'} onClick={cancelEdit} type="button">
              Cancel
            </button>
            <button
              className="button primary compact"
              disabled={!boardId || !typeId || classificationBusy || busyAction === 'investigation-ticket-mapping'}
              onClick={() => void saveMapping()}
              type="button"
            >
              {busyAction === 'investigation-ticket-mapping' ? 'Saving' : mapping ? 'Save changes' : 'Save mapping'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LaborMappingPanel(props: {
  boards: ConnectWiseBoardOption[];
  busyAction: string | null;
  classificationMessage: string;
  mappings: LaborMapping[];
  onSave: (payload: Partial<LaborMapping>) => Promise<void>;
}) {
  const { boards, busyAction, classificationMessage, mappings, onSave } = props;
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [label, setLabel] = useState('');
  const [boardId, setBoardId] = useState('');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [subTypeIds, setSubTypeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState(100);
  const [types, setTypes] = useState<ConnectWiseTypeOption[]>([]);
  const [subTypes, setSubTypes] = useState<ConnectWiseSubTypeOption[]>([]);
  const [classificationBusy, setClassificationBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState('');

  const selectedBoard = boards.find((board) => String(board.id) === boardId);

  useEffect(() => {
    if (!showCreateForm || !boardId) {
      if (!boardId) {
        setTypes([]);
        setSubTypes([]);
        setTypeIds([]);
        setSubTypeIds([]);
      }
      return;
    }

    let cancelled = false;
    setClassificationBusy(true);
    setLocalMessage('');
    void fetchLaborClassifications(Number(boardId))
      .then((response) => {
        if (cancelled) {
          return;
        }
        setTypes(response.types);
        setSubTypes(response.subTypes);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setTypes([]);
        setSubTypes([]);
        setLocalMessage(error instanceof Error ? error.message : 'Unable to load types for this board.');
      })
      .finally(() => {
        if (!cancelled) {
          setClassificationBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, showCreateForm]);

  const resetCreateForm = () => {
    setLabel('');
    setBoardId('');
    setTypeIds([]);
    setSubTypeIds([]);
    setPriority(100);
    setLocalMessage('');
  };

  const cancelCreate = () => {
    resetCreateForm();
    setShowCreateForm(false);
  };

  const submitNewMapping = async () => {
    const selectedTypes = types.filter((type) => typeIds.includes(String(type.id)));
    const selectedSubTypes = subTypes.filter((subType) => subTypeIds.includes(String(subType.id)));
    await onSave({
      label: label.trim(),
      boardId: boardId ? Number(boardId) : null,
      boardName: selectedBoard?.name ?? null,
      typeIds: selectedTypes.map((type) => type.id),
      typeNames: selectedTypes.map((type) => type.name),
      subTypeIds: selectedSubTypes.map((subType) => subType.id),
      subTypeNames: selectedSubTypes.map((subType) => subType.name),
      priority,
      active: true,
    });
    resetCreateForm();
    setShowCreateForm(false);
  };

  return (
    <section className="work-surface ncentral-filter-panel labor-mapping-panel" aria-label="Labor mapping">
      <div className="surface-header">
        <div>
          <span className="section-kicker">Labor mapping</span>
          <h2>{mappings.length.toLocaleString()} labeled labor filters</h2>
          <p className="config-note">
            Match ConnectWise tickets by board plus one or more types/subtypes. Leave a list empty for Any. Reports
            use the label and sum ticket actual hours once per ticket id.
          </p>
        </div>
        <div className="mapping-panel-header-actions">
          <span className="status-pill ready">{boards.length.toLocaleString()} boards</span>
          {showCreateForm ? (
            <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={cancelCreate} type="button">
              Cancel
            </button>
          ) : (
            <button className="button primary compact" disabled={Boolean(busyAction)} onClick={() => setShowCreateForm(true)} type="button">
              <Plus size={16} />
              Add labor mapping
            </button>
          )}
        </div>
      </div>

      {classificationMessage || localMessage ? (
        <p className="config-note mapping-panel-message">{classificationMessage || localMessage}</p>
      ) : null}

      {showCreateForm ? (
        <div className="mapping-create-form">
          <label>
            <span>Report label</span>
            <input
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Datto BCDR labor"
              value={label}
            />
          </label>
          <label>
            <span>Board</span>
            <select
              onChange={(event) => {
                setBoardId(event.target.value);
                setTypeIds([]);
                setSubTypeIds([]);
              }}
              value={boardId}
            >
              <option value="">Any board</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Types (multi-select)</span>
            <select
              disabled={!boardId || classificationBusy}
              multiple
              onChange={(event) => {
                setTypeIds(selectedOptionValues(event.currentTarget));
                setSubTypeIds([]);
              }}
              size={Math.min(6, Math.max(3, types.length || 3))}
              value={typeIds}
            >
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <small>{typeIds.length === 0 ? 'Any type' : `${typeIds.length} selected`}</small>
          </label>
          <label>
            <span>Subtypes (multi-select)</span>
            <select
              disabled={!boardId || classificationBusy || typeIds.length === 0}
              multiple
              onChange={(event) => setSubTypeIds(selectedOptionValues(event.currentTarget))}
              size={Math.min(6, Math.max(3, subTypes.length || 3))}
              value={subTypeIds}
            >
              {subTypes.map((subType) => (
                <option key={subType.id} value={subType.id}>
                  {subType.name}
                </option>
              ))}
            </select>
            <small>
              {typeIds.length === 0 ? 'Select types first, or leave Any' : subTypeIds.length === 0 ? 'Any subtype' : `${subTypeIds.length} selected`}
            </small>
          </label>
          <label>
            <span>Priority</span>
            <input onChange={(event) => setPriority(Number(event.target.value))} type="number" value={priority} />
          </label>
          <div className="mapping-form-actions">
            <button className="button secondary compact" disabled={Boolean(busyAction)} onClick={cancelCreate} type="button">
              Cancel
            </button>
            <button
              className="button primary compact"
              disabled={Boolean(busyAction) || !label.trim()}
              onClick={() => void submitNewMapping()}
              type="button"
            >
              <Plus size={16} />
              Save labor mapping
            </button>
          </div>
        </div>
      ) : null}

      <div className="ncentral-filter-list labor-mapping-list">
        {mappings.length === 0 && !showCreateForm ? (
          <div className="empty-state">
            <Filter size={20} />
            <strong>No labor mappings yet.</strong>
            <span>Click Add labor mapping to create a report label and optional board / type / subtype filter.</span>
          </div>
        ) : null}
        {mappings.map((mapping) => (
          <LaborMappingRow
            boards={boards}
            busyAction={busyAction}
            key={mapping.id}
            mapping={mapping}
            onSave={onSave}
          />
        ))}
      </div>
    </section>
  );
}

function LaborMappingRow(props: {
  boards: ConnectWiseBoardOption[];
  busyAction: string | null;
  mapping: LaborMapping;
  onSave: (payload: Partial<LaborMapping>) => Promise<void>;
}) {
  const { boards, busyAction, mapping, onSave } = props;
  const actionKey = `labor:${mapping.id}`;
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(mapping.label);
  const [boardId, setBoardId] = useState(mapping.boardId != null ? String(mapping.boardId) : '');
  const [typeIds, setTypeIds] = useState<string[]>((mapping.typeIds ?? []).map(String));
  const [subTypeIds, setSubTypeIds] = useState<string[]>((mapping.subTypeIds ?? []).map(String));
  const [priority, setPriority] = useState(mapping.priority);
  const [types, setTypes] = useState<ConnectWiseTypeOption[]>([]);
  const [subTypes, setSubTypes] = useState<ConnectWiseSubTypeOption[]>([]);
  const [classificationBusy, setClassificationBusy] = useState(false);

  useEffect(() => {
    if (!editing || !boardId) {
      return;
    }

    let cancelled = false;
    setClassificationBusy(true);
    void fetchLaborClassifications(Number(boardId))
      .then((response) => {
        if (cancelled) {
          return;
        }
        setTypes(response.types);
        setSubTypes(response.subTypes);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTypes([]);
        setSubTypes([]);
      })
      .finally(() => {
        if (!cancelled) {
          setClassificationBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, editing]);

  const selectedBoard = boards.find((board) => String(board.id) === boardId);

  const cancelEdit = () => {
    setEditing(false);
    setLabel(mapping.label);
    setBoardId(mapping.boardId != null ? String(mapping.boardId) : '');
    setTypeIds((mapping.typeIds ?? []).map(String));
    setSubTypeIds((mapping.subTypeIds ?? []).map(String));
    setPriority(mapping.priority);
  };

  const saveEdit = async () => {
    const selectedTypes = types.filter((type) => typeIds.includes(String(type.id)));
    const selectedSubTypes = subTypes.filter((subType) => subTypeIds.includes(String(subType.id)));
    await onSave({
      ...mapping,
      label: label.trim(),
      boardId: boardId ? Number(boardId) : null,
      boardName: boardId ? selectedBoard?.name ?? mapping.boardName ?? null : null,
      typeIds: typeIds.length === 0 ? [] : selectedTypes.map((type) => type.id),
      typeNames: typeIds.length === 0 ? [] : selectedTypes.map((type) => type.name),
      subTypeIds: subTypeIds.length === 0 ? [] : selectedSubTypes.map((subType) => subType.id),
      subTypeNames: subTypeIds.length === 0 ? [] : selectedSubTypes.map((subType) => subType.name),
      priority,
    });
    setEditing(false);
  };

  return (
    <article className={editing ? 'ncentral-filter-row editing' : 'ncentral-filter-row'}>
      <div className="ncentral-filter-row-main">
        <div>
          <strong>{mapping.label}</strong>
          <span>{formatLaborFilterSummary(mapping)}</span>
          <small>Priority {mapping.priority}</small>
        </div>
        <span className={`status-pill ${mapping.active ? 'approved' : 'needs-review'}`}>
          {mapping.active ? 'Active' : 'Inactive'}
        </span>
        <em>Hours only</em>
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
        <div className="mapping-create-form mapping-edit-form">
          <label>
            <span>Report label</span>
            <input onChange={(event) => setLabel(event.target.value)} value={label} />
          </label>
          <label>
            <span>Board</span>
            <select
              onChange={(event) => {
                setBoardId(event.target.value);
                setTypeIds([]);
                setSubTypeIds([]);
              }}
              value={boardId}
            >
              <option value="">Any board</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Types (multi-select)</span>
            <select
              disabled={!boardId || classificationBusy}
              multiple
              onChange={(event) => {
                setTypeIds(selectedOptionValues(event.currentTarget));
                setSubTypeIds([]);
              }}
              size={Math.min(6, Math.max(3, types.length || 3))}
              value={typeIds}
            >
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Subtypes (multi-select)</span>
            <select
              disabled={!boardId || classificationBusy || typeIds.length === 0}
              multiple
              onChange={(event) => setSubTypeIds(selectedOptionValues(event.currentTarget))}
              size={Math.min(6, Math.max(3, subTypes.length || 3))}
              value={subTypeIds}
            >
              {subTypes.map((subType) => (
                <option key={subType.id} value={subType.id}>
                  {subType.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <input onChange={(event) => setPriority(Number(event.target.value))} type="number" value={priority} />
          </label>
          <div className="mapping-form-actions">
            <button className="button secondary compact" disabled={busyAction === actionKey} onClick={cancelEdit} type="button">
              Cancel
            </button>
            <button
              className="button primary compact"
              disabled={busyAction === actionKey || !label.trim()}
              onClick={() => void saveEdit()}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function selectedOptionValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

type ProductMappingRow = ProductMapping | ProductMappingCandidate;

function isSavedProductMapping(row: ProductMappingRow): row is ProductMapping {
  return 'id' in row;
}

function dattoMappingDatasetLabel(dataset: DattoMappingDataset) {
  return dataset === 'saas' ? 'Datto SaaS' : 'Datto BCDR';
}

function filterDattoAccountRows<T extends AccountMappingCandidate>(rows: T[], dataset?: DattoMappingDataset) {
  if (!dataset) {
    return rows;
  }

  return rows.filter((row) => dattoAccountMatchesDataset(row, dataset));
}

function dattoAccountMatchesDataset(row: AccountMappingCandidate, dataset: DattoMappingDataset) {
  const accountId = row.externalAccountId.toLowerCase();
  const accountName = row.externalAccountName.toLowerCase();
  const isSaas =
    accountId.includes('|datto-saas-') ||
    accountName.includes('office 365') ||
    accountName.includes('google workspace') ||
    accountName.includes('datto saas');

  return dataset === 'saas' ? isSaas : !isSaas;
}

function dattoProductMatchesDataset(vendorProductKey: string, dataset?: DattoMappingDataset) {
  if (!dataset) {
    return true;
  }

  const isSaas = vendorProductKey.startsWith('datto-saas-');
  return dataset === 'saas' ? isSaas : vendorProductKey === 'datto-bcdr-agent' || !isSaas;
}

function dattoBundleMatchesDataset(bundle: ProductBundle, dataset?: DattoMappingDataset) {
  if (!dataset) {
    return true;
  }

  return bundle.components.length > 0 && bundle.components.every((component) => dattoProductMatchesDataset(component.vendorProductKey, dataset));
}

function dattoDatasetCounts(mappingState: MappingStateResponse | null, dataset: DattoMappingDataset) {
  const accountIds = new Set(
    [
      ...(mappingState?.accountMappings ?? []),
      ...(mappingState?.accountCandidates ?? []),
    ]
      .filter((row) => dattoAccountMatchesDataset(row, dataset))
      .map((row) => row.externalAccountId),
  );
  const productKeys = new Set(
    [
      ...(mappingState?.productMappings ?? []),
      ...(mappingState?.productCandidates ?? []),
    ]
      .filter((row) => dattoProductMatchesDataset(row.vendorProductKey, dataset))
      .map((row) => row.vendorProductKey),
  );

  return {
    accounts: accountIds.size,
    products: productKeys.size,
  };
}

const huntressMappingDatasets: HuntressMappingDataset[] = [
  'itdr',
  'edr',
  'sat',
  'siem',
  'ispm',
  'siem-extended-retention',
];

function huntressMappingDatasetLabel(dataset: HuntressMappingDataset) {
  if (dataset === 'edr') return 'EDR';
  if (dataset === 'itdr') return 'ITDR';
  if (dataset === 'sat') return 'SAT';
  if (dataset === 'siem') return 'SIEM';
  if (dataset === 'ispm') return 'ISPM';
  return 'SIEM Retention';
}

function filterHuntressAccountRows<T extends AccountMappingCandidate>(rows: T[], dataset?: HuntressMappingDataset) {
  if (!dataset) {
    return rows;
  }

  return rows.filter((row) => huntressAccountMatchesDataset(row, dataset));
}

function huntressAccountMatchesDataset(row: AccountMappingCandidate, dataset: HuntressMappingDataset) {
  const accountId = row.externalAccountId.toLowerCase();
  const productKey = huntressVendorProductKeyForDataset(dataset);

  return accountId.includes(`|${productKey}`) || accountId.endsWith(productKey);
}

function huntressProductMatchesDataset(vendorProductKey: string, dataset?: HuntressMappingDataset) {
  if (!dataset) {
    return true;
  }

  return vendorProductKey.toLowerCase() === huntressVendorProductKeyForDataset(dataset);
}

function huntressBundleMatchesDataset(bundle: ProductBundle, dataset?: HuntressMappingDataset) {
  if (!dataset) {
    return true;
  }

  return bundle.components.length > 0 && bundle.components.every((component) => huntressProductMatchesDataset(component.vendorProductKey, dataset));
}

function huntressDatasetCounts(mappingState: MappingStateResponse | null, dataset: HuntressMappingDataset) {
  const accountIds = new Set(
    [
      ...(mappingState?.accountMappings ?? []),
      ...(mappingState?.accountCandidates ?? []),
    ]
      .filter((row) => huntressAccountMatchesDataset(row, dataset))
      .map((row) => row.externalAccountId),
  );
  const productKeys = new Set(
    [
      ...(mappingState?.productMappings ?? []),
      ...(mappingState?.productCandidates ?? []),
    ]
      .filter((row) => huntressProductMatchesDataset(row.vendorProductKey, dataset))
      .map((row) => row.vendorProductKey),
  );

  return {
    accounts: accountIds.size,
    products: productKeys.size,
  };
}

function huntressVendorProductKeyForDataset(dataset: HuntressMappingDataset) {
  return `huntress-${dataset}`;
}

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

function linkedDatasetMetadataFromDetails(details: RawSyncDetailsResponse): LinkedDatasetMetadata {
  const baseColumns = details.columns.filter((column) => !['Customer', 'Agreement', 'Mapped', 'RawPayload'].includes(column));
  const columns = uniqueStrings([
    ...(details.integrationId === 'microsoft-365' && details.dataset === 'licenses' ? ['LicenseName'] : []),
    ...baseColumns,
  ]);
  const uniqueValuesByColumn = Object.fromEntries(
    columns.map((column) => [column, uniqueColumnValues(details.rows, column)]),
  );

  return {
    columns,
    uniqueValuesByColumn,
    syncRunId: details.syncRun.id,
    rowCount: details.rows.length,
  };
}

function uniqueColumnValues(rows: RawSyncRow[], column: string) {
  const values = new Set<string>();
  for (const row of rows) {
    const value = linkedDatasetRowValue(row, column);
    if (value === null || typeof value === 'undefined' || value === '') {
      continue;
    }

    values.add(String(value));
    if (values.size >= 250) {
      break;
    }
  }

  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function linkedDatasetRowValue(row: RawSyncRow, column: string) {
  if (column === 'LicenseName') {
    return row.LicenseName ?? row.SkuName ?? row.SkuPartNumber ?? row.ProductName ?? row.SkuId ?? null;
  }

  return row[column] ?? null;
}

function alignLinkedFilterFields(
  node: ProductLinkRuleFilterNode,
  columns: string[],
  preferredField: string,
): ProductLinkRuleFilterNode {
  if (node.nodeType === 'condition') {
    return columns.includes(node.field)
      ? node
      : {
          ...node,
          field: preferredField,
          value: '',
        };
  }

  return {
    ...node,
    children: node.children.map((child) => alignLinkedFilterFields(child, columns, preferredField)),
  };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function safeDomId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function defaultLinkedCountFilter(): ProductLinkRuleFilterNode {
  return {
    nodeType: 'group',
    operator: 'or',
    children: [
      {
        nodeType: 'condition',
        field: 'LicenseName',
        operator: 'contains',
        value: '',
      },
    ],
  };
}

function hasLinkedFilterCondition(node: ProductLinkRuleFilterNode): boolean {
  if (node.nodeType === 'condition') {
    if (!node.field.trim()) {
      return false;
    }

    return node.operator === 'is-empty' ||
      node.operator === 'is-not-empty' ||
      Boolean(node.value?.trim());
  }

  return node.children.some(hasLinkedFilterCondition);
}

function linkedDatasetColumnOptions(vendorId: IntegrationId, dataset: RawSyncDataset) {
  if (vendorId === 'microsoft-365' && dataset === 'licenses') {
    return [
      'LicenseName',
      'SkuName',
      'SkuPartNumber',
      'SkuId',
      'SubscriptionStatus',
      'CapabilityStatus',
      'TotalUnits',
      'AssignedUnits',
      'UnassignedUnits',
      'EnabledUnits',
      'SuspendedUnits',
      'WarningUnits',
      'LockedOutUnits',
      'SubscriptionCount',
      'BillingType',
      'BillingCycle',
      'BillingTerm',
      'TenantName',
      'TenantId',
      'TenantDefaultDomain',
    ];
  }

  if (vendorId === 'microsoft-365') {
    return [
      'ProductName',
      'SkuName',
      'SkuId',
      'ProductKey',
      'Quantity',
      'ConsumedUnits',
      'UserState',
      'TenantName',
      'TenantId',
      'UserPrincipalName',
      'DisplayName',
    ];
  }

  return [
    'ProductName',
    'ProductCode',
    'ProductKey',
    'VendorProductKey',
    'Quantity',
    'ExternalAccountId',
    'CustomerId',
    'AgreementId',
    'ObservedAt',
    'TotalLicenses',
    'AssignedLicenses',
    'UnassignedLicenses',
    'SubscriptionTerm',
    'BillingFrequency',
  ];
}

function LinkedFilterGroupEditor(props: {
  columns: string[];
  depth?: number;
  node: ProductLinkRuleFilterNode;
  onChange: (node: ProductLinkRuleFilterNode) => void;
  onRemove?: () => void;
  uniqueValuesByColumn: Record<string, string[]>;
}) {
  const { columns, depth = 0, node, onChange, onRemove, uniqueValuesByColumn } = props;

  if (node.nodeType === 'condition') {
    const requiresValue = node.operator !== 'is-empty' && node.operator !== 'is-not-empty';
    const fieldOptions = uniqueStrings([node.field, ...columns]).filter(Boolean);
    const valueOptions = uniqueValuesByColumn[node.field] ?? [];
    const usesValueDropdown = (node.operator === 'equals' || node.operator === 'not-equals') && valueOptions.length > 0;
    return (
      <div className="linked-filter-condition">
        <select
          aria-label="Filter field"
          onChange={(event) => onChange({ ...node, field: event.target.value, value: '' })}
          value={node.field}
        >
          {fieldOptions.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter operator"
          onChange={(event) =>
            onChange({
              ...node,
              operator: event.target.value as ProductLinkRuleFilterOperator,
            })
          }
          value={node.operator}
        >
          <option value="contains">contains</option>
          <option value="not-contains">does not contain</option>
          <option value="equals">equals</option>
          <option value="not-equals">does not equal</option>
          <option value="starts-with">starts with</option>
          <option value="ends-with">ends with</option>
          <option value="is-empty">is empty</option>
          <option value="is-not-empty">is not empty</option>
        </select>
        {usesValueDropdown ? (
          <select
            aria-label="Filter value"
            onChange={(event) => onChange({ ...node, value: event.target.value })}
            value={node.value ?? ''}
          >
            <option value="">Select value</option>
            {uniqueStrings([node.value ?? '', ...valueOptions]).filter(Boolean).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : requiresValue ? (
          <input
            aria-label="Filter value"
            list={`linked-filter-values-${safeDomId(node.field)}`}
            onChange={(event) => onChange({ ...node, value: event.target.value })}
            placeholder="Value"
            value={node.value ?? ''}
          />
        ) : (
          <span className="linked-filter-value-placeholder" />
        )}
        {onRemove ? (
          <button className="icon-button small" onClick={onRemove} title="Remove condition" type="button">
            <X size={14} />
          </button>
        ) : null}
      </div>
    );
  }

  const updateChild = (index: number, child: ProductLinkRuleFilterNode) => {
    onChange({
      ...node,
      children: node.children.map((currentChild, currentIndex) =>
        currentIndex === index ? child : currentChild,
      ),
    });
  };
  const removeChild = (index: number) => {
    onChange({
      ...node,
      children: node.children.filter((_, currentIndex) => currentIndex !== index),
    });
  };
  const addCondition = () => {
    onChange({
      ...node,
      children: [
        ...node.children,
        {
          nodeType: 'condition',
          field: columns[0] ?? 'ProductName',
          operator: 'contains',
          value: '',
        },
      ],
    });
  };
  const addGroup = () => {
    onChange({
      ...node,
      children: [
        ...node.children,
        {
          nodeType: 'group',
          operator: 'and',
          children: [
            {
              nodeType: 'condition',
              field: columns[0] ?? 'ProductName',
              operator: 'contains',
              value: '',
            },
          ],
        },
      ],
    });
  };

  return (
    <div className={depth > 0 ? 'linked-filter-group nested' : 'linked-filter-group'}>
      <div className="linked-filter-group-bar">
        <select
          aria-label="Filter group mode"
          onChange={(event) => onChange({ ...node, operator: event.target.value === 'or' ? 'or' : 'and' })}
          value={node.operator}
        >
          <option value="and">All</option>
          <option value="or">Any</option>
        </select>
        <button className="button secondary compact" onClick={addCondition} type="button">
          <ListChecks size={14} />
          Condition
        </button>
        <button className="button secondary compact" onClick={addGroup} type="button">
          <Layers3 size={14} />
          Group
        </button>
        {onRemove ? (
          <button className="icon-button small" onClick={onRemove} title="Remove group" type="button">
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div className="linked-filter-children">
        {node.children.map((child, index) => (
          <LinkedFilterGroupEditor
            columns={columns}
            depth={depth + 1}
            key={`${child.nodeType}-${index}`}
            node={child}
            onChange={(nextChild) => updateChild(index, nextChild)}
            onRemove={node.children.length > 1 ? () => removeChild(index) : undefined}
            uniqueValuesByColumn={uniqueValuesByColumn}
          />
        ))}
      </div>
    </div>
  );
}

function productLinkRuleTargetLabel(
  rule: ProductLinkRule,
  options: Array<{ vendorProductKey: string; vendorProductName: string }>,
) {
  return options.find((option) => option.vendorProductKey === rule.sourceVendorProductKey)?.vendorProductName ?? rule.sourceVendorProductKey;
}

function productLinkRuleSourceLabel(source: ProductLinkRuleSource) {
  if (source.sourceType === 'connectwise-addition') {
    return `ConnectWise: ${source.productName ?? source.productCode}`;
  }

  if (source.sourceType === 'filtered-dataset') {
    const dataset = source.dataset === 'licenses' ? 'Licenses' : source.dataset === 'users' ? 'Users' : 'Usage';
    const aggregation = source.aggregation.type === 'row-count' ? 'row count' : `sum ${source.aggregation.column}`;
    return `${integrationName(source.vendorId)} ${dataset}: ${source.label ?? aggregation}`;
  }

  return `${integrationName(source.vendorId)}: ${source.vendorProductName ?? source.vendorProductKey}`;
}

function formatLinkedCountTestDetails(details: DimensionMap) {
  const entries = Object.entries(details)
    .filter(([, value]) => typeof value !== 'undefined' && value !== null && String(value).trim().length > 0)
    .slice(0, 4);
  if (entries.length === 0) {
    return '-';
  }

  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' / ');
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

function groupOptionalIntegrationSettings(settings: IntegrationNonSecretDefinition[]) {
  const sections = new Map<string, IntegrationNonSecretDefinition[]>();

  for (const setting of settings) {
    const sectionKey = setting.section ?? '';
    sections.set(sectionKey, [...(sections.get(sectionKey) ?? []), setting]);
  }

  return [...sections.entries()].map(([section, items]) => ({
    section: section || undefined,
    items,
  }));
}

function optionalIntegrationSettingValue(integration: Integration, setting: IntegrationNonSecretDefinition) {
  if (setting.inputType === 'checkbox') {
    if (setting.key === 'detailOnlySync') {
      return integrationDetailOnlySyncEnabled(integration.nonSecrets, {
        optionalNonSecrets: [setting],
      } as IntegrationSettingsDefinition)
        ? 'true'
        : 'false';
    }

    return checkboxSettingEnabled(integration.nonSecrets[setting.key] ?? setting.defaultValue) ? 'true' : 'false';
  }

  return integration.nonSecrets[setting.key] ?? setting.defaultValue ?? '';
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
    { id: 'api', label: 'API' },
    { id: 'invoice', label: 'Invoice' },
  ];
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const requiredNonSecrets = integration.requiredNonSecrets.map((setting) => [
      setting.key,
      String(formData.get(`nonSecret:${setting.key}`) ?? '').trim(),
    ] as const);
    const optionalNonSecrets = integration.optionalNonSecrets.map((setting) => [
      setting.key,
      setting.inputType === 'checkbox'
        ? (formData.get(`nonSecret:${setting.key}`) === 'on' ? 'true' : 'false')
        : String(formData.get(`nonSecret:${setting.key}`) ?? '').trim(),
    ] as const);
    const nonSecrets = Object.fromEntries([...requiredNonSecrets, ...optionalNonSecrets]);
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
            {tab === 'api' && (
              <>
                {integration.requiredNonSecrets.length === 0 &&
                integration.requiredSecrets.length === 0 &&
                integration.optionalNonSecrets.length === 0 ? (
                  <p className="config-note">This integration does not require API credentials.</p>
                ) : null}
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
                {integration.requiredSecrets.map((setting) => (
                  <label className="config-field" key={setting.key}>
                    <span>{setting.label}</span>
                    <input name={`secret:${setting.key}`} placeholder="Leave blank to keep the existing Key Vault value" type="password" />
                  </label>
                ))}
                {groupOptionalIntegrationSettings(integration.optionalNonSecrets).map(({ section, items }) => (
                  <div className="integration-settings-section" key={section ?? 'general-optional-settings'}>
                    {section ? <h3 className="integration-settings-section-title">{section}</h3> : null}
                    {items.map((setting) =>
                      setting.inputType === 'select' ? (
                        <label className="config-field" key={setting.key}>
                          <span>{setting.label}</span>
                          <select
                            defaultValue={optionalIntegrationSettingValue(integration, setting)}
                            name={`nonSecret:${setting.key}`}
                          >
                            {(setting.options ?? []).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {setting.description ? <small>{setting.description}</small> : null}
                        </label>
                      ) : (
                        <label className="config-checkbox" key={setting.key}>
                          <input
                            defaultChecked={optionalIntegrationSettingValue(integration, setting) === 'true'}
                            name={`nonSecret:${setting.key}`}
                            type="checkbox"
                          />
                          <span>
                            <strong>{setting.label}</strong>
                            {setting.description ? <small>{setting.description}</small> : null}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                ))}
                <p className="config-note">
                  {integration.missingSecrets.length + integration.missingNonSecrets.length > 0
                    ? `Missing: ${[...integration.missingSecrets, ...integration.missingNonSecrets].join(', ')}`
                    : 'All required settings are present. Blank secret fields keep the current Key Vault value.'}
                </p>
                <p className="config-note">
                  Last sync {integration.lastSync ?? 'never'} / Records {integration.records ?? '0'}
                </p>
              </>
            )}

            {tab === 'invoice' && (
              <div className="integration-invoice-settings">
                <div>
                  <FileSpreadsheet size={18} />
                  <span>
                    Invoice imports use CSV table mapping, customer mapping, and product mapping for this integration.
                  </span>
                </div>
                <div className="scope-list capability-list">
                  <span>{integrationHasCapability(integration.id, 'invoice-import') ? 'Invoice import enabled' : 'Invoice import unavailable'}</span>
                  <span>{integrationHasCapability(integration.id, 'mapping') ? 'Customer/product mapping enabled' : 'Mapping unavailable'}</span>
                </div>
              </div>
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
            <button className="button primary" disabled={saving || tab !== 'api'} type="submit">
              {saving ? (
                <>
                  <RefreshCcw size={17} />
                  Saving
                </>
              ) : (
                <>
                  <KeyRound size={17} />
                  Save API settings
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CustomerLicenseReportView(props: {
  customers: CustomerLicenseCustomerOption[];
  includeMicrosoftUserDetails: boolean;
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onCustomerChange: (customerId: string) => void;
  onGenerate: () => Promise<CustomerLicenseReportResponse | null>;
  onIncludeMicrosoftUserDetailsChange: (value: boolean) => void;
  onRefreshCustomers: () => Promise<CustomerLicenseCustomersResponse | null>;
  onVendorChange: (vendorId: CustomerLicenseReportVendorId) => void;
  report: CustomerLicenseReportResponse | null;
  selectedCustomerId: string;
  selectedVendorId: CustomerLicenseReportVendorId;
  vendorOptions: CustomerLicenseReportVendorId[];
}) {
  const {
    customers,
    includeMicrosoftUserDetails,
    loadMessage,
    loadState,
    onCustomerChange,
    onGenerate,
    onIncludeMicrosoftUserDetailsChange,
    onRefreshCustomers,
    onVendorChange,
    report,
    selectedCustomerId,
    selectedVendorId,
    vendorOptions,
  } = props;
  const canIncludeMicrosoftUsers = selectedVendorId === 'microsoft-365' || selectedVendorId === 'all';
  const generatedAt = formatDateTime(report?.generatedAt);
  const chart = buildCustomerLicenseChart(report);
  const inventoryRows = customerLicenseInventoryRows(report);
  const userRows = inventoryRows.filter((item) => item.row.DetailType === 'Licensed user');
  const deviceRows = inventoryRows.filter((item) => item.row.DetailType === 'Device');
  const subscriptionRows = inventoryRows.filter(
    (item) => item.row.DetailType === 'Subscription' || item.row.DetailType === 'License total',
  );
  const chartWidth = 920;
  const chartHeight = 300;
  const plot = {
    left: 60,
    right: 22,
    top: 24,
    bottom: 52,
  };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = chartHeight - plot.top - plot.bottom;
  const yForCount = (value: number) => plot.top + ((chart.maxCount - value) / chart.maxCount) * plotHeight;
  const xForMonth = (index: number) =>
    chart.months.length > 1 ? plot.left + (plotWidth * index) / (chart.months.length - 1) : plot.left + plotWidth / 2;
  const yTicks = Array.from({ length: 4 }, (_, index) => (chart.maxCount * (3 - index)) / 3);
  const pointRadius = 4;

  return (
    <section className="reports-page customer-license-page" aria-label="Customer license report">
      <div className="integrations-live-bar report-reminder">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Report issue' : loadState === 'loading' ? 'Loading' : 'Customer licenses'}</strong>
          <span>{loadMessage}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{report ? `${formatMonthRange(report.months)} / ${generatedAt ?? 'Generated'}` : 'On-demand preview'}</span>
          <button
            className="button secondary compact"
            disabled={loadState === 'loading'}
            onClick={() => void onRefreshCustomers()}
            type="button"
          >
            <RefreshCcw size={16} />
            Refresh customers
          </button>
        </div>
      </div>

      <section className="toolbar reports-toolbar customer-license-toolbar" aria-label="Customer license report filters">
        <label className="config-field report-select">
          <span>Customer</span>
          <select
            disabled={loadState === 'loading' && customers.length === 0}
            onChange={(event) => onCustomerChange(event.target.value)}
            value={selectedCustomerId}
          >
            <option value="">{customers.length === 0 ? 'No customers found' : 'Select customer'}</option>
            {customers.map((customer) => (
              <option key={customer.customerId} value={customer.customerId}>
                {customer.customerName}
              </option>
            ))}
          </select>
        </label>

        <label className="config-field report-select">
          <span>Scope</span>
          <select
            disabled={loadState === 'loading'}
            onChange={(event) => onVendorChange(event.target.value as CustomerLicenseReportVendorId)}
            value={selectedVendorId}
          >
            {vendorOptions.map((vendorId) => (
              <option key={vendorId} value={vendorId}>
                {customerLicenseVendorName(vendorId)}
              </option>
            ))}
          </select>
        </label>

        <label className={canIncludeMicrosoftUsers ? 'switch-control customer-license-toggle' : 'switch-control customer-license-toggle hidden'}>
          <input
            checked={includeMicrosoftUserDetails}
            disabled={!canIncludeMicrosoftUsers || loadState === 'loading'}
            onChange={(event) => onIncludeMicrosoftUserDetailsChange(event.target.checked)}
            type="checkbox"
          />
          <span>Include M365 users</span>
        </label>

        <button
          className="button primary customer-license-generate"
          disabled={!selectedCustomerId || loadState === 'loading'}
          onClick={() => void onGenerate()}
          type="button"
        >
            <FileSpreadsheet size={17} />
          {loadState === 'loading' ? 'Generating' : selectedVendorId === 'all' ? 'Generate all' : 'Generate'}
        </button>
      </section>

      {!report ? (
        <section className="work-surface report-surface customer-license-surface">
          <div className="empty-state report-empty">
            <FileSpreadsheet size={20} />
            <strong>No customer license report generated.</strong>
            <span>Choose a customer to preview all license counts.</span>
          </div>
        </section>
      ) : report.products.length === 0 ? (
        <section className="work-surface report-surface customer-license-surface">
          <div className="empty-state report-empty">
            <Package size={20} />
            <strong>No license rows found.</strong>
            <span>{report.customer.customerName} has no saved {report.vendor.integrationName} rows in the selected period.</span>
          </div>
        </section>
      ) : (
        <section className="customer-client-report" aria-label={`${report.customer.customerName} client license report`}>
          <div className="customer-report-cover">
            <div>
              <span className="section-kicker">Customer report</span>
              <h2>License Summary</h2>
              <p>{report.customer.customerName}</p>
            </div>
            <dl>
              <div>
                <dt>Period</dt>
                <dd>{formatMonthRange(report.months)}</dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>{generatedAt ?? 'Now'}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{report.vendor.integrationName}</dd>
              </div>
            </dl>
          </div>

          <div className="customer-report-kpis" aria-label="License report summary">
            <article>
              <span>Total licenses and devices</span>
              <strong>{formatLicenseCount(report.summary.totalCurrentCount)}</strong>
            </article>
            <article>
              <span>Licensed users</span>
              <strong>{formatCount(userRows.length)}</strong>
            </article>
            <article>
              <span>Devices</span>
              <strong>{formatCount(deviceRows.length)}</strong>
            </article>
            <article>
              <span>Products</span>
              <strong>{formatCount(report.summary.productCount)}</strong>
            </article>
          </div>

          <section className="customer-report-card customer-report-chart-card">
            <div className="customer-report-card-header">
              <div>
                <span className="section-kicker">Trend</span>
                <h3>Month-to-month service counts</h3>
              </div>
              <span className="status-pill approved">{formatCount(chart.services.length)} services</span>
            </div>
            <div className="customer-license-chart-wrap">
              <svg
                aria-label="Month-to-month license counts by service"
                className="customer-license-chart"
                role="img"
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              >
                {yTicks.map((tick) => {
                  const y = yForCount(tick);
                  return (
                    <g className="customer-license-chart-grid" key={tick.toFixed(2)}>
                      <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
                      <text x={plot.left - 10} y={y + 4}>
                        {formatLicenseCount(tick)}
                      </text>
                    </g>
                  );
                })}
                {chart.services.map((service) => {
                  const points = service.points.map((point, pointIndex) => ({
                    ...point,
                    x: xForMonth(pointIndex),
                    y: yForCount(point.count),
                  }));

                  return (
                    <g className="customer-license-chart-service" key={service.serviceId}>
                      <path d={customerLicenseLinePath(points)} stroke={service.color}>
                        <title>
                          {service.vendorName} / {service.serviceName}
                        </title>
                      </path>
                      {points.map((point) => (
                        <circle cx={point.x} cy={point.y} fill={service.color} key={point.month} r={pointRadius}>
                          <title>
                            {service.vendorName} / {service.serviceName} / {formatMonthLabel(point.month, true)} / {formatLicenseCount(point.count)}
                          </title>
                        </circle>
                      ))}
                    </g>
                  );
                })}
                {chart.months.map((month, monthIndex) => {
                  const x = xForMonth(monthIndex);
                  return (
                    <g className="customer-license-chart-month" key={month}>
                      <text x={x} y={chartHeight - 18}>
                        {formatMonthLabel(month, month === report.startMonth || month === report.endMonth)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="customer-license-chart-legend" aria-label="Chart legend">
              {chart.services.map((service) => (
                <div key={service.serviceId}>
                  <span style={{ backgroundColor: service.color }} />
                  <strong>{service.serviceName}</strong>
                  <small>{service.vendorName}</small>
                  <em>{formatLicenseCount(service.currentCount)}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="customer-report-card">
            <div className="customer-report-card-header">
              <div>
                <span className="section-kicker">Products</span>
                <h3>Current license summary</h3>
              </div>
            </div>
            <div className="customer-report-table-scroll compact">
              <table className="customer-report-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Product</th>
                    <th>Current</th>
                    <th>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((product) => (
                    <tr key={product.productKey}>
                      <td>{product.vendor.integrationName}</td>
                      <td>{product.productName}</td>
                      <td>{formatLicenseCount(product.currentCount)}</td>
                      <td>{product.productCode ?? product.productKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="customer-report-card">
            <div className="customer-report-card-header">
              <div>
                <span className="section-kicker">Users</span>
                <h3>Licensed Microsoft users</h3>
              </div>
              <span className="status-pill ready">{formatCount(userRows.length)} users</span>
            </div>
            <div className="customer-report-table-scroll">
              {userRows.length === 0 ? (
                <div className="empty-state customer-license-detail-empty">
                  <Users size={18} />
                  <strong>No licensed user rows loaded.</strong>
                  <span>Enable Microsoft 365 user details and generate the report with an Admin account.</span>
                </div>
              ) : (
                <table className="customer-report-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Product</th>
                      <th>Tenant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((item) => (
                      <tr key={item.key}>
                        <td>{detailText(item.row, 'DisplayName', 'Email', 'UserPrincipalName')}</td>
                        <td>{detailText(item.row, 'Email', 'UserPrincipalName')}</td>
                        <td>{detailText(item.row, 'UserState')}</td>
                        <td>{item.product.productName}</td>
                        <td>{detailText(item.row, 'TenantName')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="customer-report-card">
            <div className="customer-report-card-header">
              <div>
                <span className="section-kicker">Devices</span>
                <h3>Device inventory</h3>
              </div>
              <span className="status-pill ready">{formatCount(deviceRows.length)} devices</span>
            </div>
            <div className="customer-report-table-scroll">
              {deviceRows.length === 0 ? (
                <div className="empty-state customer-license-detail-empty">
                  <Database size={18} />
                  <strong>No device rows loaded.</strong>
                </div>
              ) : (
                <table className="customer-report-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Type</th>
                      <th>Vendor</th>
                      <th>Product</th>
                      <th>Site / OS</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceRows.map((item) => (
                      <tr key={item.key}>
                        <td>{detailText(item.row, 'Hostname', 'DeviceId')}</td>
                        <td>{detailText(item.row, 'ProtectedSystemType', 'DeviceClass')}</td>
                        <td>{item.product.vendor.integrationName}</td>
                        <td>{item.product.productName}</td>
                        <td>{detailText(item.row, 'Site', 'OS')}</td>
                        <td>{detailText(item.row, 'LastCheckIn', 'LastComplete', 'ObservedAt')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="customer-report-card">
            <div className="customer-report-card-header">
              <div>
                <span className="section-kicker">Subscriptions</span>
                <h3>License subscriptions and totals</h3>
              </div>
              <span className="status-pill ready">{formatCount(subscriptionRows.length)} rows</span>
            </div>
            <div className="customer-report-table-scroll compact">
              {subscriptionRows.length === 0 ? (
                <div className="empty-state customer-license-detail-empty">
                  <Package size={18} />
                  <strong>No subscription rows loaded.</strong>
                </div>
              ) : (
                <table className="customer-report-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Product</th>
                      <th>Total</th>
                      <th>Assigned</th>
                      <th>Unassigned</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptionRows.map((item) => (
                      <tr key={item.key}>
                        <td>{item.product.vendor.integrationName}</td>
                        <td>{item.product.productName}</td>
                        <td>{detailText(item.row, 'TotalUnits', 'TotalLicenses', 'Quantity')}</td>
                        <td>{detailText(item.row, 'AssignedUnits', 'AssignedLicenses')}</td>
                        <td>{detailText(item.row, 'UnassignedUnits', 'UnassignedLicenses')}</td>
                        <td>{detailText(item.row, 'SubscriptionStatus', 'CapabilityStatus', 'IsTrial')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </section>
      )}
    </section>
  );
}

function ProductProfitabilityReportView(props: {
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onRefresh: () => Promise<ProductProfitabilityReportResponse | null>;
  report: ProductProfitabilityReportResponse | null;
}) {
  const { loadMessage, loadState, onRefresh, report: liveReport } = props;
  const [savedReports, setSavedReports] = useState<SavedProductProfitabilityReportSummary[]>([]);
  const [savedView, setSavedView] = useState<SavedProductProfitabilityReportResponse | null>(null);
  const [savedBusy, setSavedBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const report = savedView?.report ?? liveReport;

  useEffect(() => {
    void (async () => {
      try {
        const reports = await fetchSavedProductProfitabilityReports();
        setSavedReports(reports);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : 'Unable to load saved reports.');
      }
    })();
  }, []);

  const months = report?.months ?? [];
  const integrations = report?.integrations ?? [];
  const laborMonths = report?.labor?.months ?? [];
  const laborRows = report?.labor?.rows ?? [];
  const laborHourlyRate = report?.laborHourlyRate ?? 50;
  const chartWidth = 920;
  const chartHeight = 360;
  const plot = {
    left: 72,
    right: 64,
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
  const laborValues = laborMonths.map((month) => month.hours);
  const laborMax = Math.max(1, ...(laborValues.length > 0 ? laborValues : [0]));
  const xForMonth = (index: number) =>
    plot.left + (months.length <= 1 ? plotWidth / 2 : (index / (months.length - 1)) * plotWidth);
  const yForValue = (value: number) => plot.top + ((valueMax - value) / valueRange) * plotHeight;
  const yForLaborHours = (hours: number) => plot.top + ((laborMax - hours) / laborMax) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => valueMax - (valueRange * index) / 4);
  const laborTicks = Array.from({ length: 5 }, (_, index) => laborMax - (laborMax * index) / 4);
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
  const laborPoints = months.map((month, monthIndex) => {
    const hours = laborMonths.find((item) => item.month === month)?.hours ?? 0;
    return {
      month,
      value: hours,
      x: xForMonth(monthIndex),
      y: yForLaborHours(hours),
    };
  });
  const laborPath = profitabilityPath(laborPoints);
  const laborColor = '#b45309';

  const handleGenerate = async () => {
    setSavedView(null);
    setActionMessage('');
    await onRefresh();
  };

  const handleSave = async () => {
    if (!report) {
      return;
    }
    const defaultName = `Profitability ${report.endMonth || 'report'}`;
    const name = window.prompt('Name this saved report', defaultName)?.trim();
    if (!name) {
      return;
    }
    setSavedBusy(true);
    setActionMessage('Saving report...');
    try {
      const saved = await saveProductProfitabilityReportSnapshot({
        name,
        vendorIds: report.integrations.map((integration) => integration.integrationId),
        report,
      });
      const reports = await fetchSavedProductProfitabilityReports();
      setSavedReports(reports);
      setActionMessage(`Saved “${saved.name}”.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to save report.');
    } finally {
      setSavedBusy(false);
    }
  };

  const handleLoadSaved = async (savedId: string) => {
    if (!savedId) {
      setSavedView(null);
      setActionMessage('');
      return;
    }
    setSavedBusy(true);
    setActionMessage('Loading saved report...');
    try {
      const saved = await fetchSavedProductProfitabilityReport(savedId);
      setSavedView(saved);
      setActionMessage(`Showing saved report “${saved.name}”.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to load saved report.');
    } finally {
      setSavedBusy(false);
    }
  };

  const handleExportPdf = () => {
    window.print();
  };

  return (
    <section className="reports-page product-profitability-page" aria-label="Product profitability report">
      <div className="integrations-live-bar report-reminder no-print">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : loadState === 'idle' ? 'idle' : 'ready'}`} />
          <strong>
            {savedView
              ? `Saved: ${savedView.name}`
              : loadState === 'failed'
                ? 'Report issue'
                : loadState === 'loading'
                  ? 'Generating'
                  : 'Product profitability'}
          </strong>
          <span>{actionMessage || loadMessage}</span>
        </div>
        <div className="integrations-live-meta profitability-toolbar">
          <label className="profitability-saved-select">
            <span>Saved reports</span>
            <select
              disabled={savedBusy || loadState === 'loading'}
              onChange={(event) => void handleLoadSaved(event.target.value)}
              value={savedView?.id ?? ''}
            >
              <option value="">Live report</option>
              {savedReports.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name} ({formatMonthLabel(saved.createdAt.slice(0, 7), true)})
                </option>
              ))}
            </select>
          </label>
          <span>{report ? formatMonthRange(report.months) : 'Most recent 12 months'}</span>
          <button className="button secondary compact" disabled={!report || savedBusy} onClick={() => void handleSave()} type="button">
            <Save size={16} />
            Save
          </button>
          <button className="button secondary compact" disabled={!report} onClick={handleExportPdf} type="button">
            <Download size={16} />
            Export PDF
          </button>
          <button className="button compact" disabled={loadState === 'loading' || savedBusy} onClick={() => void handleGenerate()} type="button">
            <RefreshCcw size={16} />
            {loadState === 'loading' ? 'Generating' : 'Generate'}
          </button>
        </div>
      </div>

      <div className="profitability-print-root">
        <section className="metric-grid report-metrics" aria-label="Product profitability summary">
          <MetricCard icon={CircleDollarSign} label="Net profit" tone="money" value={formatMoneyValue(report?.summary.totalProfit ?? 0)} />
          <MetricCard icon={BarChart3} label="Revenue" tone="ready" value={formatMoneyValue(report?.summary.totalRevenue ?? 0)} />
          <MetricCard icon={Activity} label="Cost" tone="warn" value={formatMoneyValue(report?.summary.totalCost ?? 0)} />
          <MetricCard icon={Clock3} label="Labor hours" tone="approved" value={formatHoursValue(report?.summary.totalLaborHours ?? 0)} />
          <MetricCard
            icon={CircleDollarSign}
            label={`Labor cost ($${laborHourlyRate}/hr)`}
            tone="warn"
            value={formatMoneyValue(report?.summary.totalLaborCost ?? 0)}
          />
        </section>

        {report?.billingBasis === 'latest-addition-per-month' ? (
          <p className="config-note">
            Revenue and product cost use the latest ConnectWise addition snapshot per agreement line for each month
            (once-a-month billing), not the sum of every sync. Summary totals cover the most recent 12 months.
          </p>
        ) : null}
        {report?.labor?.warning ? <p className="config-note">{report.labor.warning}</p> : null}

        <section className="work-surface report-surface profitability-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">{report ? formatMonthRange(report.months) : 'Profit trend'}</span>
              <h2>Month-to-month net profit by integration</h2>
            </div>
            <span className="status-pill approved">{formatCount(report?.summary.productCount ?? 0)} products</span>
          </div>

          {!report ? (
            <div className="empty-state report-empty">
              <FileSpreadsheet size={20} />
              <strong>Report not generated yet.</strong>
              <span>Click Generate to load profitability from ConnectWise agreement additions for mapped vendors.</span>
            </div>
          ) : integrations.length === 0 ? (
            <div className="empty-state report-empty">
              <FileSpreadsheet size={20} />
              <strong>No profitability data loaded.</strong>
              <span>Approve product mappings for vendors, then generate again. WisePay and unmapped integrations are hidden until mapped.</span>
            </div>
          ) : (
            <>
              <div className="profitability-chart-wrap">
                <svg
                  aria-label="Monthly net profit by integration with labor hours"
                  className="profitability-chart"
                  role="img"
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                >
                  {yTicks.map((tick) => {
                    const y = yForValue(tick);
                    return (
                      <g className="profitability-grid-line" key={`money-${tick.toFixed(2)}`}>
                        <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
                        <text x={plot.left - 10} y={y + 4}>
                          {formatCurrencyCompact(tick)}
                        </text>
                      </g>
                    );
                  })}
                  {laborTicks.map((tick) => {
                    const y = yForLaborHours(tick);
                    return (
                      <text className="profitability-labor-axis" key={`labor-${tick.toFixed(2)}`} x={chartWidth - plot.right + 8} y={y + 4}>
                        {formatHoursCompact(tick)}
                      </text>
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
                  <path className="profitability-line profitability-labor-line" d={laborPath} stroke={laborColor} />
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
                  {laborPoints.map((point) => (
                    <circle
                      className="profitability-point"
                      cx={point.x}
                      cy={point.y}
                      fill={laborColor}
                      key={`labor-${point.month}`}
                      r={3.5}
                    >
                      <title>
                        Labor hours / {formatMonthLabel(point.month, true)} / {formatHoursValue(point.value)}
                      </title>
                    </circle>
                  ))}
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
                <div className="profitability-legend-item">
                  <span className="profitability-legend-swatch" style={{ backgroundColor: laborColor }} />
                  <strong>Labor hours</strong>
                  <span>{formatHoursValue(report.summary.totalLaborHours ?? 0)}</span>
                </div>
              </div>

              <div className="profitability-table-scroll">
                <table className="profitability-table">
                  <thead>
                    <tr>
                      <th>Integration</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Net profit</th>
                      <th>Labor hours</th>
                      <th>Labor cost</th>
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
                        <td>{formatHoursValue(integration.totalLaborHours ?? 0)}</td>
                        <td>{formatMoneyValue(integration.totalLaborCost ?? (integration.totalLaborHours ?? 0) * laborHourlyRate)}</td>
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

        <section className="work-surface report-surface profitability-surface" aria-label="Labor expenses">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Labor</span>
              <h2>Labor hours and cost by mapping label (${laborHourlyRate}/hr)</h2>
            </div>
            <span className="status-pill ready">
              {formatHoursValue(report?.summary.totalLaborHours ?? 0)} / {formatMoneyValue(report?.summary.totalLaborCost ?? 0)}
            </span>
          </div>
          {!report || laborRows.length === 0 ? (
            <div className="empty-state report-empty">
              <Clock3 size={20} />
              <strong>{report ? 'No matched labor hours yet.' : 'Generate the report to load labor hours.'}</strong>
              <span>Add Labor mapping filters, then generate. Hours come from closed ConnectWise tickets (actualHours).</span>
            </div>
          ) : (
            <div className="profitability-table-scroll">
              <table className="profitability-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Labor label</th>
                    <th>Tickets</th>
                    <th>Total hours</th>
                    <th>Total cost</th>
                    {months.map((month) => (
                      <th key={month}>{formatMonthLabel(month, false)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {laborRows.map((row) => (
                    <tr key={`${row.vendorId}-${row.label}`}>
                      <td>{row.vendorName}</td>
                      <td>{row.label}</td>
                      <td>{formatCount(row.ticketCount)}</td>
                      <td>{formatHoursValue(row.totalHours)}</td>
                      <td>{formatMoneyValue(row.totalCost ?? row.totalHours * laborHourlyRate)}</td>
                      {months.map((month) => {
                        const monthRow = row.months.find((item) => item.month === month);
                        const hours = monthRow?.hours ?? 0;
                        const cost = monthRow?.cost ?? hours * laborHourlyRate;
                        return (
                          <td key={`${row.vendorId}-${row.label}-${month}`}>
                            <span className="profitability-labor-cell">
                              <strong>{formatHoursValue(hours)}</strong>
                              <em>{formatMoneyValue(cost)}</em>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function ReportsView(props: {
  columnFilters: Record<string, string>;
  details: RawSyncDetailsResponse | null;
  includeRawPayload: boolean;
  integrations: Integration[];
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onColumnFilterChange: (column: string, value: string) => void;
  onDatasetChange: (dataset: RawSyncDataset) => void;
  onIncludeRawPayloadChange: (includeRawPayload: boolean) => void;
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
    includeRawPayload,
    integrations,
    loadMessage,
    loadState,
    onColumnFilterChange,
    onDatasetChange,
    onIncludeRawPayloadChange,
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
  const [reportFiltersExpanded, setReportFiltersExpanded] = useState(false);
  const [reportFilterColumn, setReportFilterColumn] = useState('');
  const [reportSort, setReportSort] = useState<ReportSortState | null>(null);
  const reportColumnWidth = (column: string) => reportColumnWidths[column] ?? reportDefaultColumnWidth;
  const reportTableMinWidth = Math.max(
    720,
    columns.reduce((totalWidth, column) => totalWidth + reportColumnWidth(column), 0),
  );
  const selectedReportFilterColumn = columns.includes(reportFilterColumn) ? reportFilterColumn : columns[0] ?? '';
  const activeColumnFilters = Object.entries(columnFilters)
    .map(([column, value]) => [column, value.trim().toLowerCase()] as const)
    .filter(([column, value]) => columns.includes(column) && value.length > 0);
  const filteredRows =
    activeColumnFilters.length > 0
      ? rows.filter((row) =>
          activeColumnFilters.every(([column, filter]) =>
            String(formatReportCell(column, row[column])).toLowerCase().includes(filter),
          ),
        )
      : rows;
  const activeReportSort = reportSort && columns.includes(reportSort.column) ? reportSort : null;
  const visibleRows = activeReportSort
    ? [...filteredRows].sort((left, right) => {
        const comparison = compareReportCellValues(
          activeReportSort.column,
          left[activeReportSort.column],
          right[activeReportSort.column],
        );
        return activeReportSort.direction === 'asc' ? comparison : comparison * -1;
      })
    : filteredRows;
  const activeReportFilterCount = activeColumnFilters.length + (activeReportSort ? 1 : 0);
  const selectedReportFilterValue = selectedReportFilterColumn ? columnFilters[selectedReportFilterColumn] ?? '' : '';
  const selectedReportSortDirection =
    activeReportSort?.column === selectedReportFilterColumn ? activeReportSort.direction : undefined;

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
    setReportFilterColumn((currentColumn) => (currentColumn && availableColumns.has(currentColumn) ? currentColumn : columns[0] ?? ''));
    setReportSort((currentSort) => (currentSort && availableColumns.has(currentSort.column) ? currentSort : null));
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

  const openReportColumnFilter = (column: string) => {
    setReportFilterColumn(column);
    setReportFiltersExpanded(true);
  };

  const setSelectedReportSortDirection = (direction: ReportSortDirection) => {
    if (!selectedReportFilterColumn) {
      return;
    }

    setReportSort({ column: selectedReportFilterColumn, direction });
  };

  const clearSelectedReportFilter = () => {
    if (!selectedReportFilterColumn) {
      return;
    }

    onColumnFilterChange(selectedReportFilterColumn, '');
    setReportSort((currentSort) =>
      currentSort?.column === selectedReportFilterColumn ? null : currentSort,
    );
  };

  const clearAllReportFilters = () => {
    Object.keys(columnFilters).forEach((column) => onColumnFilterChange(column, ''));
    setReportSort(null);
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
            disabled={integrations.length === 0}
            onChange={(event) => onIntegrationChange(event.target.value as IntegrationId | '')}
            value={selectedIntegrationId}
          >
            <option value="">{integrations.length === 0 ? 'No available raw sync reports' : 'Select integration'}</option>
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

        <label className="raw-payload-toggle">
          <input
            checked={includeRawPayload}
            disabled={!selectedIntegrationId || !selectedSyncRunId || loadState === 'loading'}
            onChange={(event) => onIncludeRawPayloadChange(event.target.checked)}
            type="checkbox"
          />
          <span>Include RawPayload</span>
        </label>
        {includeRawPayload ? (
          <span className="raw-payload-warning">Raw vendor JSON access is audited.</span>
        ) : null}
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
          <div className="surface-header-actions">
            <button
              aria-controls="raw-sync-column-filters"
              aria-expanded={reportFiltersExpanded}
              className="button secondary compact"
              disabled={columns.length === 0}
              onClick={() => setReportFiltersExpanded((expanded) => !expanded)}
              type="button"
            >
              <Filter size={16} />
              {activeReportFilterCount > 0 ? `${activeReportFilterCount} active` : 'Filters'}
            </button>
            <span className={`status-pill ${selectedRun?.status === 'complete' ? 'approved' : 'needs-review'}`}>
              {selectedRun?.status ?? 'No run'}
            </span>
          </div>
        </div>

        {columns.length === 0 ? (
          <div className="empty-state report-empty">
            <FileSpreadsheet size={20} />
            <strong>No raw sync details loaded.</strong>
            <span>Select an integration and SyncDate to inspect captured rows.</span>
          </div>
        ) : (
          <>
            <div
              className="report-filter-panel"
              hidden={!reportFiltersExpanded}
              id="raw-sync-column-filters"
            >
              <label className="config-field report-filter-column">
                <span>Column</span>
                <select
                  onChange={(event) => setReportFilterColumn(event.target.value)}
                  value={selectedReportFilterColumn}
                >
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>

              <label className="config-field report-filter-search">
                <span>Search</span>
                <div className="search-field report-search-field">
                  <Search size={16} />
                  <input
                    aria-label={`Search ${selectedReportFilterColumn}`}
                    disabled={!selectedReportFilterColumn}
                    onChange={(event) => onColumnFilterChange(selectedReportFilterColumn, event.target.value)}
                    placeholder="Search this column"
                    type="search"
                    value={selectedReportFilterValue}
                  />
                </div>
              </label>

              <div className="config-field report-sort-field">
                <span>Sort</span>
                <div className="segmented-control report-sort-toggle" role="group" aria-label="Column sort direction">
                  <button
                    className={selectedReportSortDirection === 'asc' ? 'active' : ''}
                    disabled={!selectedReportFilterColumn}
                    onClick={() => setSelectedReportSortDirection('asc')}
                    type="button"
                  >
                    Asc
                  </button>
                  <button
                    className={selectedReportSortDirection === 'desc' ? 'active' : ''}
                    disabled={!selectedReportFilterColumn}
                    onClick={() => setSelectedReportSortDirection('desc')}
                    type="button"
                  >
                    Desc
                  </button>
                </div>
              </div>

              <button
                className="button secondary compact report-clear-filter"
                disabled={!selectedReportFilterValue && !selectedReportSortDirection}
                onClick={clearSelectedReportFilter}
                type="button"
              >
                <X size={16} />
                Clear
              </button>
              <button
                className="button ghost compact report-clear-filter"
                disabled={activeReportFilterCount === 0}
                onClick={clearAllReportFilters}
                type="button"
              >
                Clear all
              </button>
            </div>

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
                    {columns.map((column) => {
                      const hasColumnFilter = Boolean((columnFilters[column] ?? '').trim());
                      const columnSortDirection = activeReportSort?.column === column ? activeReportSort.direction : undefined;

                      return (
                        <th key={column}>
                          <div className="report-column-header">
                            <button
                              aria-expanded={reportFiltersExpanded && selectedReportFilterColumn === column}
                              className={
                                hasColumnFilter || columnSortDirection
                                  ? 'report-column-filter-trigger active'
                                  : 'report-column-filter-trigger'
                              }
                              onClick={() => openReportColumnFilter(column)}
                              title={`Filter ${column}`}
                              type="button"
                            >
                              <span className="report-column-header-label" title={column}>{column}</span>
                              <span className="report-column-badges" aria-hidden="true">
                                {hasColumnFilter ? <Search size={12} /> : null}
                                {columnSortDirection ? (
                                  <span className="report-sort-indicator">
                                    {columnSortDirection === 'asc' ? 'Asc' : 'Desc'}
                                  </span>
                                ) : null}
                                <Filter size={12} />
                              </span>
                            </button>
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
                      );
                    })}
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
          </>
        )}
      </section>
    </section>
  );
}

function InvoiceLoadingGraphic() {
  return (
    <div className="invoice-loading-graphic" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function InvoicesView(props: {
  bulkNoticeBusy: boolean;
  bulkNoticeCustomers: OverdueInvoiceCustomerGroup[] | null;
  bulkNoticeMessage: string;
  importUtility: ReactNode;
  monthlyCandidates: MonthlyInvoiceCandidatesResponse | null;
  monthlyLoadMessage: string;
  monthlyLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  monthlyPreview: MonthlyInvoicePreview | null;
  monthlyPreviewBusyId: string | null;
  noticeBusyKey: string | null;
  noticeMessage: string;
  noticeResult: InvoiceNotificationResponse | null;
  onCloseBulkNoticeConfirm: () => void;
  onCloseImportPanel: () => void;
  onCloseNoticePreview: () => void;
  onConfirmBulkNotices: (customers: OverdueInvoiceCustomerGroup[], notes?: string) => Promise<void>;
  onConfirmNotice: (preview: InvoiceNotificationPreview, notes?: string) => Promise<InvoiceNotificationResponse | null>;
  onImportInvoices: () => void;
  onMonthlyPreview: (candidate: MonthlyInvoiceCandidate) => Promise<MonthlyInvoicePreview | null>;
  onNoticePreview: (customer: OverdueInvoiceCustomerGroup) => Promise<InvoiceNotificationResponse | null>;
  onOpenBulkNoticeConfirm: (customers: OverdueInvoiceCustomerGroup[]) => void;
  onRefreshAll: () => Promise<void>;
  onSelectedOverdueCustomerKeysChange: (keys: string[]) => void;
  onTabChange: (tab: InvoiceWorkspaceTab) => void;
  onTestBulkNotices: (
    customers: OverdueInvoiceCustomerGroup[],
    testRecipientEmail: string,
    notes?: string,
  ) => Promise<void>;
  onTestNotice: (
    preview: InvoiceNotificationPreview,
    testRecipientEmail: string,
    notes?: string,
  ) => Promise<InvoiceNotificationResponse | null>;
  overdueInvoices: OverdueInvoicesResponse | null;
  overdueLoadMessage: string;
  overdueLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  refreshing: boolean;
  selectedOverdueCustomerKeys: string[];
  selectedTab: InvoiceWorkspaceTab;
  showImportPanel: boolean;
  standardCandidates: StandardInvoiceCandidatesResponse | null;
  standardLoadMessage: string;
  standardLoadState: 'idle' | 'loading' | 'ready' | 'failed';
}) {
  const {
    bulkNoticeBusy,
    bulkNoticeCustomers,
    bulkNoticeMessage,
    importUtility,
    monthlyCandidates,
    monthlyLoadMessage,
    monthlyLoadState,
    monthlyPreview,
    monthlyPreviewBusyId,
    noticeBusyKey,
    noticeMessage,
    noticeResult,
    onCloseBulkNoticeConfirm,
    onCloseImportPanel,
    onCloseNoticePreview,
    onConfirmBulkNotices,
    onConfirmNotice,
    onImportInvoices,
    onMonthlyPreview,
    onNoticePreview,
    onOpenBulkNoticeConfirm,
    onRefreshAll,
    onSelectedOverdueCustomerKeysChange,
    onTabChange,
    onTestBulkNotices,
    onTestNotice,
    overdueInvoices,
    overdueLoadMessage,
    overdueLoadState,
    refreshing,
    selectedOverdueCustomerKeys,
    selectedTab,
    showImportPanel,
    standardCandidates,
    standardLoadMessage,
    standardLoadState,
  } = props;
  const tabs: Array<{ id: InvoiceWorkspaceTab; label: string }> = [
    { id: 'overdue', label: 'Past-Due' },
    { id: 'monthly', label: 'Monthly Invoicing' },
    { id: 'standard', label: 'Standard Invoicing' },
  ];
  return (
    <section className="invoices-workspace">
      <section className="toolbar invoices-toolbar" aria-label="Invoice workspace controls">
        <div className="segmented-control invoices-tab-control" role="tablist" aria-label="Invoice workspace tabs">
          {tabs.map((tab) => (
            <button
              aria-selected={selectedTab === tab.id}
              className={selectedTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="invoice-toolbar-actions">
          <button className="button secondary compact" disabled={refreshing} onClick={() => void onRefreshAll()} type="button">
            <RefreshCcw size={15} />
            {refreshing ? 'Refreshing' : 'Refresh all'}
          </button>
          <button className="button primary compact" onClick={onImportInvoices} type="button">
            <Upload size={15} />
            Import invoices
          </button>
        </div>
      </section>

      {showImportPanel ? (
        <section className="invoice-import-utility" aria-label="Import invoices">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Utility</span>
              <h2>Import invoices</h2>
            </div>
            <button className="icon-button" onClick={onCloseImportPanel} title="Close import utility" type="button">
              <X size={18} />
            </button>
          </div>
          <div className="invoice-import-utility-body">{importUtility}</div>
        </section>
      ) : null}

      {selectedTab === 'overdue' ? (
        <OverdueInvoicesTab
          bulkNoticeBusy={bulkNoticeBusy}
          bulkNoticeCustomers={bulkNoticeCustomers}
          bulkNoticeMessage={bulkNoticeMessage}
          loadMessage={overdueLoadMessage}
          loadState={overdueLoadState}
          noticeBusyKey={noticeBusyKey}
          noticeMessage={noticeMessage}
          noticeResult={noticeResult}
          onCloseBulkNoticeConfirm={onCloseBulkNoticeConfirm}
          onCloseNoticePreview={onCloseNoticePreview}
          onConfirmBulkNotices={onConfirmBulkNotices}
          onConfirmNotice={onConfirmNotice}
          onNoticePreview={onNoticePreview}
          onOpenBulkNoticeConfirm={onOpenBulkNoticeConfirm}
          onSelectedOverdueCustomerKeysChange={onSelectedOverdueCustomerKeysChange}
          onTestBulkNotices={onTestBulkNotices}
          onTestNotice={onTestNotice}
          response={overdueInvoices}
          selectedOverdueCustomerKeys={selectedOverdueCustomerKeys}
        />
      ) : null}

      {selectedTab === 'monthly' ? (
        <MonthlyInvoicesTab
          loadMessage={monthlyLoadMessage}
          loadState={monthlyLoadState}
          onPreview={onMonthlyPreview}
          preview={monthlyPreview}
          previewBusyId={monthlyPreviewBusyId}
          response={monthlyCandidates}
        />
      ) : null}

      {selectedTab === 'standard' ? (
        <StandardInvoicesTab
          loadMessage={standardLoadMessage}
          loadState={standardLoadState}
          response={standardCandidates}
        />
      ) : null}
    </section>
  );
}

function OverdueInvoicesTab(props: {
  bulkNoticeBusy: boolean;
  bulkNoticeCustomers: OverdueInvoiceCustomerGroup[] | null;
  bulkNoticeMessage: string;
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  noticeBusyKey: string | null;
  noticeMessage: string;
  noticeResult: InvoiceNotificationResponse | null;
  onCloseBulkNoticeConfirm: () => void;
  onCloseNoticePreview: () => void;
  onConfirmBulkNotices: (customers: OverdueInvoiceCustomerGroup[], notes?: string) => Promise<void>;
  onConfirmNotice: (preview: InvoiceNotificationPreview, notes?: string) => Promise<InvoiceNotificationResponse | null>;
  onNoticePreview: (customer: OverdueInvoiceCustomerGroup) => Promise<InvoiceNotificationResponse | null>;
  onOpenBulkNoticeConfirm: (customers: OverdueInvoiceCustomerGroup[]) => void;
  onSelectedOverdueCustomerKeysChange: (keys: string[]) => void;
  onTestBulkNotices: (
    customers: OverdueInvoiceCustomerGroup[],
    testRecipientEmail: string,
    notes?: string,
  ) => Promise<void>;
  onTestNotice: (
    preview: InvoiceNotificationPreview,
    testRecipientEmail: string,
    notes?: string,
  ) => Promise<InvoiceNotificationResponse | null>;
  response: OverdueInvoicesResponse | null;
  selectedOverdueCustomerKeys: string[];
}) {
  const {
    bulkNoticeBusy,
    bulkNoticeCustomers,
    bulkNoticeMessage,
    loadMessage,
    loadState,
    noticeBusyKey,
    noticeMessage,
    noticeResult,
    onCloseBulkNoticeConfirm,
    onCloseNoticePreview,
    onConfirmBulkNotices,
    onConfirmNotice,
    onNoticePreview,
    onOpenBulkNoticeConfirm,
    onSelectedOverdueCustomerKeysChange,
    onTestBulkNotices,
    onTestNotice,
    response,
    selectedOverdueCustomerKeys,
  } = props;
  const buckets = response?.buckets ?? [];
  const allReviewInvoices = buckets.flatMap((bucket) => bucket.invoices);
  const customerGroups = response?.customerGroups?.length
    ? response.customerGroups
    : groupOverdueInvoicesByCustomer(allReviewInvoices);
  const customerCount = response?.summary.customerCount ?? customerGroups.length;
  const agingSummary = overdueAgingSummary(customerGroups);
  const [sortState, setSortState] = useState<{ key: OverdueInvoiceSortKey; direction: SortDirection }>({
    key: 'pastDueStatus',
    direction: 'desc',
  });
  const [downloadCustomer, setDownloadCustomer] = useState<OverdueInvoiceCustomerGroup | null>(null);
  const [downloadBusyInvoiceId, setDownloadBusyInvoiceId] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState('');
  const sortedCustomerGroups = useMemo(
    () => sortOverdueCustomerGroups(customerGroups, sortState.key, sortState.direction),
    [customerGroups, sortState],
  );
  const selectedCustomers = sortedCustomerGroups.filter((customer) =>
    selectedOverdueCustomerKeys.includes(customer.customerKey),
  );
  const allVisibleSelected =
    sortedCustomerGroups.length > 0 &&
    sortedCustomerGroups.every((customer) => selectedOverdueCustomerKeys.includes(customer.customerKey));
  const toggleSort = (key: OverdueInvoiceSortKey) => {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };
  const sortIndicator = (key: OverdueInvoiceSortKey) =>
    sortState.key === key ? (sortState.direction === 'desc' ? '▼' : '▲') : '';
  const toggleCustomer = (customerKey: string) => {
    if (selectedOverdueCustomerKeys.includes(customerKey)) {
      onSelectedOverdueCustomerKeysChange(selectedOverdueCustomerKeys.filter((key) => key !== customerKey));
      return;
    }
    onSelectedOverdueCustomerKeysChange([...selectedOverdueCustomerKeys, customerKey]);
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectedOverdueCustomerKeysChange([]);
      return;
    }
    onSelectedOverdueCustomerKeysChange(sortedCustomerGroups.map((customer) => customer.customerKey));
  };
  const openInvoiceDownloads = (customer: OverdueInvoiceCustomerGroup) => {
    setDownloadCustomer(customer);
    setDownloadBusyInvoiceId(null);
    setDownloadMessage('');
  };
  const closeInvoiceDownloads = () => {
    setDownloadCustomer(null);
    setDownloadBusyInvoiceId(null);
    setDownloadMessage('');
  };
  const downloadCustomerInvoice = async (invoice: OverdueInvoice) => {
    setDownloadBusyInvoiceId(invoice.invoiceId);
    setDownloadMessage(`Downloading ${invoice.invoiceNumber ?? `invoice ${invoice.invoiceId}`}...`);
    try {
      await downloadInvoicePdf(invoice);
      setDownloadMessage(`Downloaded ${invoice.invoiceNumber ?? `invoice ${invoice.invoiceId}`}.`);
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Unable to download invoice PDF.');
    } finally {
      setDownloadBusyInvoiceId(null);
    }
  };

  return (
    <>
      <section className="invoice-aging-summary" aria-label="Overdue invoice aging summary">
        <div className="invoice-aging-total">
          <span>Past due</span>
          <strong>{formatMoneyValue(response?.summary.reviewQueueBalance ?? 0)}</strong>
          <em>{formatCount(customerCount)} customers / {formatCount(response?.summary.reviewQueueCount ?? 0)} invoices</em>
        </div>
        <div className="invoice-aging-stat notice-reminder">
          <span>Past Due Reminder</span>
          <strong>{formatMoneyValue(agingSummary.balanceReminder)}</strong>
          <em>
            {formatCount(agingSummary.customersReminder)} customers / {formatCount(agingSummary.invoicesReminder)}{' '}
            invoices
          </em>
        </div>
        <div className="invoice-aging-stat notice-credit-hold">
          <span>Credit Hold</span>
          <strong>{formatMoneyValue(agingSummary.balanceCreditHold)}</strong>
          <em>
            {formatCount(agingSummary.customersCreditHold)} customers / {formatCount(agingSummary.invoicesCreditHold)}{' '}
            invoices
          </em>
        </div>
        <div className="invoice-aging-stat notice-suspension critical">
          <span>Service Suspension</span>
          <strong>{formatMoneyValue(agingSummary.balanceSuspension)}</strong>
          <em>
            {formatCount(agingSummary.customersSuspension)} customers / {formatCount(agingSummary.invoicesSuspension)}{' '}
            invoices
          </em>
        </div>
      </section>

      <section className="work-surface invoice-table-surface" aria-label="Customers with overdue invoices">
        <div className="surface-header">
          <div>
            <span className="section-kicker">ConnectWise overdue</span>
            <h2>Customers with past-due invoices</h2>
          </div>
          <div className="surface-header-actions">
            <span className="invoice-action-message">{loadMessage || noticeMessage || bulkNoticeMessage}</span>
            <button
              className="button secondary compact"
              disabled={selectedCustomers.length === 0 || bulkNoticeBusy || Boolean(noticeBusyKey)}
              onClick={() => onOpenBulkNoticeConfirm(selectedCustomers)}
              type="button"
            >
              <Upload size={15} />
              Send selected ({formatCount(selectedCustomers.length)})
            </button>
          </div>
        </div>

        {loadState === 'loading' && !response ? (
          <div className="empty-state">
            <InvoiceLoadingGraphic />
            <strong>Loading overdue customers.</strong>
            <span>{loadMessage}</span>
          </div>
        ) : null}

        {loadState === 'failed' ? (
          <div className="empty-state">
            <FileSpreadsheet size={22} />
            <strong>Overdue invoices unavailable.</strong>
            <span>{loadMessage}</span>
          </div>
        ) : null}

        {loadState !== 'failed' && response && customerGroups.length === 0 ? (
          <div className="empty-state">
            <ClipboardCheck size={22} />
            <strong>No overdue customers.</strong>
            <span>{loadMessage}</span>
          </div>
        ) : null}

        {sortedCustomerGroups.length > 0 ? (
          <div className="invoice-overdue-table-scroll">
            <table className="invoice-overdue-table">
              <thead>
                <tr>
                  <th className="invoice-select-column">
                    <label className="invoice-select-control">
                      <input
                        aria-label="Select all overdue customers"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        type="checkbox"
                      />
                    </label>
                  </th>
                  <th aria-sort={ariaSortValue(sortState, 'customerName')}>
                    <button className="invoice-sort-button" onClick={() => toggleSort('customerName')} type="button">
                      Customer Name
                      <span>{sortIndicator('customerName')}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSortValue(sortState, 'pastDueStatus')}>
                    <button className="invoice-sort-button" onClick={() => toggleSort('pastDueStatus')} type="button">
                      Past Due Status
                      <span>{sortIndicator('pastDueStatus')}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSortValue(sortState, 'invoiceCount')}>
                    <button className="invoice-sort-button" onClick={() => toggleSort('invoiceCount')} type="button">
                      Total Invoice Count
                      <span>{sortIndicator('invoiceCount')}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSortValue(sortState, 'agingBalance')}>
                    <button className="invoice-sort-button" onClick={() => toggleSort('agingBalance')} type="button">
                      Past Due Balance Reminder/Hold/Suspension
                      <span>{sortIndicator('agingBalance')}</span>
                    </button>
                  </th>
                  <th>
                    <span className="invoice-table-heading-label">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedCustomerGroups.map((customer) => {
                  const previewKey = `${customer.customerKey}:preview`;
                  const agingBalances = agingBalancesForCustomer(customer);
                  const isSelected = selectedOverdueCustomerKeys.includes(customer.customerKey);
                  return (
                    <tr key={customer.customerKey}>
                      <td className="invoice-select-column">
                        <label className="invoice-select-control">
                          <input
                            aria-label={`Select ${customer.company.name}`}
                            checked={isSelected}
                            onChange={() => toggleCustomer(customer.customerKey)}
                            type="checkbox"
                          />
                        </label>
                      </td>
                      <td>
                        <strong>{customer.company.name}</strong>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${invoiceNoticeStatusClass(customer.noticeType, customer.oldestDaysPastDue)}`}
                        >
                          {invoiceNoticeLabel(customer.noticeType, customer.oldestDaysPastDue)}
                        </span>
                        <span>{customer.oldestDaysPastDue} days oldest</span>
                      </td>
                      <td>
                        <strong>{formatCount(customer.invoiceCount)}</strong>
                      </td>
                      <td>
                        <strong>{formatMoneyValue(customer.balanceTotal)}</strong>
                        <div className="invoice-aging-balance" aria-label={`${customer.company.name} aging balance`}>
                          <span>{formatMoneyValue(agingBalances.balanceReminder)}</span>
                          <span>{formatMoneyValue(agingBalances.balanceCreditHold)}</span>
                          <span>{formatMoneyValue(agingBalances.balanceSuspension)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="invoice-row-actions">
                          <button
                            className="button primary compact table-action-button invoice-preview-action"
                            disabled={Boolean(noticeBusyKey)}
                            onClick={() => void onNoticePreview(customer)}
                            type="button"
                          >
                            <ExternalLink size={15} />
                            {noticeBusyKey === previewKey ? 'Previewing' : 'Preview'}
                          </button>
                          <button
                            className="button secondary compact table-action-button invoice-download-action"
                            onClick={() => openInvoiceDownloads(customer)}
                            type="button"
                          >
                            <Download size={15} />
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {noticeResult?.preview ? (
        <InvoiceNotificationModal
          busyKey={noticeBusyKey}
          message={noticeMessage}
          onClose={onCloseNoticePreview}
          onConfirm={onConfirmNotice}
          onTest={onTestNotice}
          result={noticeResult}
        />
      ) : null}

      {downloadCustomer ? (
        <InvoiceDownloadModal
          busyInvoiceId={downloadBusyInvoiceId}
          customer={downloadCustomer}
          message={downloadMessage}
          onClose={closeInvoiceDownloads}
          onDownload={(invoice) => void downloadCustomerInvoice(invoice)}
        />
      ) : null}

      {bulkNoticeCustomers ? (
        <BulkInvoiceNoticeModal
          busy={bulkNoticeBusy}
          customers={bulkNoticeCustomers}
          message={bulkNoticeMessage}
          onClose={onCloseBulkNoticeConfirm}
          onConfirm={onConfirmBulkNotices}
          onTest={onTestBulkNotices}
        />
      ) : null}
    </>
  );
}

function InvoiceDownloadModal(props: {
  busyInvoiceId: string | null;
  customer: OverdueInvoiceCustomerGroup;
  message: string;
  onClose: () => void;
  onDownload: (invoice: OverdueInvoice) => void;
}) {
  const { busyInvoiceId, customer, message, onClose, onDownload } = props;
  const invoices = [...customer.invoices].sort((left, right) => right.daysPastDue - left.daysPastDue);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="invoice-notice-modal invoice-download-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-download-modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="invoice-download-modal-title">
              <Download size={18} />
              Download Invoices
            </h2>
            <p>
              {customer.company.name} / {formatCount(customer.invoiceCount)} overdue invoice
              {customer.invoiceCount === 1 ? '' : 's'}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="invoice-notice-modal-body">
          <div className="invoice-download-list">
            {invoices.map((invoice) => (
              <div className="invoice-download-row" key={invoice.invoiceId}>
                <div>
                  <strong>{invoice.invoiceNumber ?? `Invoice ${invoice.invoiceId}`}</strong>
                  <span>
                    Due {formatDateOnly(invoice.dueDate) ?? 'unknown'} / {invoice.daysPastDue} days past due
                  </span>
                  <span>
                    {invoice.invoiceStatus}
                    {invoice.billingTerms ? ` / ${invoice.billingTerms}` : ''}
                  </span>
                </div>
                <div className="invoice-download-meta">
                  <strong>{formatMoneyValue(invoice.balance)}</strong>
                  <span>Balance</span>
                </div>
                <button
                  className="button primary compact table-action-button"
                  disabled={Boolean(busyInvoiceId)}
                  onClick={() => onDownload(invoice)}
                  type="button"
                >
                  <Download size={15} />
                  {busyInvoiceId === invoice.invoiceId ? 'Downloading' : 'Download'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="invoice-notice-modal-footer">
          <div className="modal-actions invoice-notice-actions">
            {message ? <span className="invoice-action-message">{message}</span> : null}
            <button className="button secondary compact" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function InvoiceNotificationModal(props: {
  busyKey: string | null;
  message: string;
  onClose: () => void;
  onConfirm: (preview: InvoiceNotificationPreview, notes?: string) => Promise<InvoiceNotificationResponse | null>;
  onTest: (
    preview: InvoiceNotificationPreview,
    testRecipientEmail: string,
    notes?: string,
  ) => Promise<InvoiceNotificationResponse | null>;
  result: InvoiceNotificationResponse | null;
}) {
  const { busyKey, message, onClose, onConfirm, onTest, result } = props;
  const preview = result?.preview;
  const confirmKey = preview ? `${preview.companyKey ?? preview.invoiceId ?? preview.invoiceIds.join('-')}:confirm` : '';
  const testKey = preview ? `${preview.companyKey ?? preview.invoiceId ?? preview.invoiceIds.join('-')}:test` : '';
  const [notes, setNotes] = useState(preview?.notes ?? '');
  const [testEmailPrompt, setTestEmailPrompt] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  if (!preview) {
    return null;
  }

  const templateParagraphs = (preview.templateBody ?? preview.bodyPreview.split(/\n\nNOTE:/)[0] ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const noteText = notes.trim();
  const completed =
    result.status === 'stubbed' ||
    result.status === 'test-stubbed' ||
    result.status === 'sent' ||
    result.status === 'test-sent';

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="invoice-notice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-notice-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="invoice-notice-modal-title">
              <CircleDollarSign size={18} />
              Overdue Email Preview
            </h2>
            <p>
              From: {preview.fromEmail ?? 'tconnover@bmbsolutions.com'}
            </p>
            <p>
              To: {preview.recipientName}
              {preview.recipientEmail ? ` <${preview.recipientEmail}>` : ''} / {preview.companyName}
            </p>
            {(preview.ccEmails?.length ?? 0) > 0 ? <p>CC: {preview.ccEmails.join(', ')}</p> : null}
            {(preview.bccEmails?.length ?? 0) > 0 ? <p>BCC: {preview.bccEmails.join(', ')}</p> : null}
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="invoice-notice-modal-body">
          <div className="invoice-email-preview">
            <div className="invoice-email-subject">
              <span>Subject:</span>
              <strong>{preview.subject}</strong>
            </div>

            <div className="invoice-email-body">
              {templateParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {noteText ? (
                <div className="invoice-email-note">
                  <strong>NOTE:</strong>
                  <p>{noteText}</p>
                </div>
              ) : null}
              <div className="invoice-email-invoice-list">
                {preview.invoices.map((invoice) => (
                  <div className="invoice-email-invoice-row" key={invoice.invoiceId}>
                    <div>
                      <strong>{invoice.invoiceNumber ?? `Invoice ${invoice.invoiceId}`}</strong>
                      <span>
                        {formatDateOnly(invoice.dueDate) ?? 'No due date'} / {invoice.daysPastDue} days past due
                      </span>
                    </div>
                    <strong>{formatMoneyValue(invoice.balance)}</strong>
                    {invoice.paymentLink ? (
                      <a className="invoice-payment-link" href={invoice.paymentLink} rel="noreferrer" target="_blank">
                        Pay now
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="status-pill blocked">WisePay unavailable</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="invoice-notice-modal-footer">
          {!completed ? (
            <label className="invoice-notice-field invoice-notice-notes">
              <span>Notes</span>
              <textarea
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note shown above the invoice table"
                rows={3}
                value={notes}
              />
            </label>
          ) : null}

          {testEmailPrompt ? (
            <div className="invoice-test-email-prompt">
              <label className="invoice-notice-field">
                <span>Test email address</span>
                <input
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={testEmail}
                />
              </label>
              <div className="invoice-test-email-actions">
                <button className="button secondary compact" onClick={() => setTestEmailPrompt(false)} type="button">
                  Cancel
                </button>
                <button
                  className="button primary compact"
                  disabled={Boolean(busyKey) || !isValidEmail(testEmail)}
                  onClick={() => void onTest(preview, testEmail.trim(), noteText || undefined)}
                  type="button"
                >
                  {busyKey === testKey ? 'Sending test' : 'Send test email'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="modal-actions invoice-notice-actions">
            {message ? <span className="invoice-action-message">{message}</span> : null}
            {completed ? (
              <span className="status-pill approved">
                {result.status === 'test-sent'
                  ? 'Test sent'
                  : result.status === 'sent'
                    ? 'Sent'
                    : result.status === 'test-stubbed'
                      ? 'Test stubbed'
                      : 'Saved'}{' '}
                {formatDateTime(result.audit?.occurredAt) ?? formatDateTime(result.generatedAt)}
              </span>
            ) : (
              <>
                <button
                  className="button secondary compact"
                  disabled={Boolean(busyKey)}
                  onClick={() => setTestEmailPrompt(true)}
                  type="button"
                >
                  Test
                </button>
                <button
                  className="button primary compact"
                  disabled={Boolean(busyKey)}
                  onClick={() => void onConfirm(preview, noteText || undefined)}
                  type="button"
                >
                  <Check size={15} />
                  {busyKey === confirmKey ? 'Sending' : 'Send'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function BulkInvoiceNoticeModal(props: {
  busy: boolean;
  customers: OverdueInvoiceCustomerGroup[];
  message: string;
  onClose: () => void;
  onConfirm: (customers: OverdueInvoiceCustomerGroup[], notes?: string) => Promise<void>;
  onTest: (customers: OverdueInvoiceCustomerGroup[], testRecipientEmail: string, notes?: string) => Promise<void>;
}) {
  const { busy, customers, message, onClose, onConfirm, onTest } = props;
  const [notes, setNotes] = useState('');
  const [testEmailPrompt, setTestEmailPrompt] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const noteText = notes.trim();

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="invoice-notice-modal bulk-invoice-notice-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-invoice-notice-title">
        <div className="modal-header">
          <div>
            <h2 id="bulk-invoice-notice-title">
              <CircleDollarSign size={18} />
              Send selected overdue emails
            </h2>
            <p>Confirm {formatCount(customers.length)} customer email{customers.length === 1 ? '' : 's'} before sending.</p>
          </div>
          <button className="modal-close" disabled={busy} onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="invoice-notice-modal-body">
          <div className="bulk-invoice-notice-list">
            {customers.map((customer) => (
              <div className="bulk-invoice-notice-row" key={customer.customerKey}>
                <div>
                  <strong>{customer.company.name}</strong>
                  <span>
                    {invoiceNoticeLabel(customer.noticeType, customer.oldestDaysPastDue)} ·{' '}
                    {formatCount(customer.invoiceCount)} invoices · {customer.oldestDaysPastDue} days oldest
                  </span>
                </div>
                <strong>{formatMoneyValue(customer.balanceTotal)}</strong>
              </div>
            ))}
          </div>

          <label className="invoice-notice-field invoice-notice-notes">
            <span>Notes</span>
            <textarea
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional note applied to every selected email"
              rows={3}
              value={notes}
            />
          </label>

          {testEmailPrompt ? (
            <div className="invoice-test-email-prompt">
              <label className="invoice-notice-field">
                <span>Test batch email address</span>
                <input
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={testEmail}
                />
                <em>Ignores ConnectWise To/CC and stubs each selected email to this address only.</em>
              </label>
              <div className="invoice-test-email-actions">
                <button
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() => setTestEmailPrompt(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button primary compact"
                  disabled={busy || !isValidEmail(testEmail)}
                  onClick={() => void onTest(customers, testEmail.trim(), noteText || undefined)}
                  type="button"
                >
                  {busy ? 'Sending test batch' : 'Send test batch'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-actions invoice-notice-actions">
          {message ? <span className="invoice-action-message">{message}</span> : null}
          <button className="button secondary compact" disabled={busy} onClick={() => setTestEmailPrompt(true)} type="button">
            Test batch
          </button>
          <button
            className="button primary compact"
            disabled={busy}
            onClick={() => void onConfirm(customers, noteText || undefined)}
            type="button"
          >
            <Check size={15} />
            {busy ? 'Sending' : `Send ${formatCount(customers.length)}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function MonthlyInvoicesTab(props: {
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  onPreview: (candidate: MonthlyInvoiceCandidate) => Promise<MonthlyInvoicePreview | null>;
  preview: MonthlyInvoicePreview | null;
  previewBusyId: string | null;
  response: MonthlyInvoiceCandidatesResponse | null;
}) {
  const { loadMessage, loadState, onPreview, preview, previewBusyId, response } = props;
  const candidates = response?.candidates ?? [];
  const totalBillAmount = candidates.reduce((total, candidate) => total + candidate.billAmount, 0);
  const missingCount = candidates.filter((candidate) => candidate.missingFields.length > 0).length;

  return (
    <>
      <section className="metric-grid invoices-metric-grid" aria-label="Monthly invoicing summary">
        <MetricCard icon={Building2} label="Agreements" tone="approved" value={formatCount(response?.agreementCount ?? 0)} />
        <MetricCard icon={CircleDollarSign} label="Monthly amount" tone="money" value={formatMoneyValue(totalBillAmount)} />
        <MetricCard icon={ListChecks} label="Ready" tone="ready" value={formatCount(candidates.length - missingCount)} />
        <MetricCard icon={Activity} label="Needs data" tone="warn" value={formatCount(missingCount)} />
      </section>

      <section className="invoice-bucket-layout">
        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">ConnectWise agreements</span>
              <h2>Monthly invoicing</h2>
            </div>
            <span className="invoice-action-message">{loadMessage}</span>
          </div>
          <div className="invoice-live-list">
            {candidates.length === 0 ? (
              <div className="empty-state">
                {loadState === 'loading' ? <InvoiceLoadingGraphic /> : <FileSpreadsheet size={20} />}
                <strong>{loadState === 'loading' ? 'Loading monthly agreements.' : 'No monthly agreements found.'}</strong>
                <span>{loadMessage}</span>
              </div>
            ) : null}
            {candidates.map((candidate) => (
              <div className="invoice-live-row monthly-invoice-row" key={candidate.agreementId}>
                <div>
                  <strong>{candidate.company.name}</strong>
                  <span>{candidate.agreementName}</span>
                </div>
                <span>{formatDateOnly(candidate.nextInvoiceDate) ?? 'No next date'}</span>
                <strong>{formatMoneyValue(candidate.billAmount)}</strong>
                <span>
                  {candidate.lastInvoice
                    ? `${candidate.lastInvoice.invoiceNumber ?? `Invoice ${candidate.lastInvoice.invoiceId}`} / ${formatDateOnly(candidate.lastInvoice.invoiceDate) ?? 'No date'}`
                    : 'No prior invoice'}
                </span>
                <span className={candidate.missingFields.length > 0 ? 'status-pill needs-review' : 'status-pill approved'}>
                  {candidate.missingFields.length > 0 ? 'Review' : 'Ready'}
                </span>
                <button
                  className="button primary compact"
                  disabled={Boolean(previewBusyId)}
                  onClick={() => void onPreview(candidate)}
                  type="button"
                >
                  {previewBusyId === candidate.agreementId ? 'Generating' : 'Generate invoice'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <aside className="work-surface invoice-side-panel" aria-label="Monthly invoice preview">
          <div className="surface-header compact-header">
            <div>
              <span className="section-kicker">Preview only</span>
              <h3>{preview?.candidate.agreementName ?? 'No invoice preview'}</h3>
            </div>
          </div>
          {!preview ? (
            <div className="empty-state">
              <FileSpreadsheet size={20} />
              <strong>Select a monthly agreement.</strong>
            </div>
          ) : (
            <div className="invoice-preview-panel">
              <div>
                <span className="section-kicker">Payload</span>
                <strong>{preview.payload.companyName}</strong>
              </div>
              <div className="invoice-preview-meta">
                <span>{preview.payload.invoiceType}</span>
                <span>{preview.payload.applyToType} #{preview.payload.applyToId}</span>
                <span>{formatMoneyValue(preview.payload.billAmount)}</span>
                {preview.payload.invoiceTemplateName ? <span>{preview.payload.invoiceTemplateName}</span> : null}
              </div>
              {preview.warnings.length > 0 ? (
                <div className="invoice-warning-list">
                  {preview.warnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              ) : (
                <span className="status-pill approved">Preview ready</span>
              )}
            </div>
          )}
        </aside>
      </section>
    </>
  );
}

function StandardInvoicesTab(props: {
  loadMessage: string;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  response: StandardInvoiceCandidatesResponse | null;
}) {
  const { loadMessage, loadState, response } = props;
  const candidates = response?.candidates ?? [];
  const openInvoiceCount = candidates.reduce((total, candidate) => total + candidate.openInvoiceCount, 0);
  const openBalanceAmount = candidates.reduce((total, candidate) => total + candidate.openBalanceAmount, 0);
  const overdueInvoiceCount = candidates.reduce((total, candidate) => total + candidate.overdueInvoiceCount, 0);

  return (
    <>
      <section className="metric-grid invoices-metric-grid" aria-label="Standard invoicing summary">
        <MetricCard icon={Users} label="Candidates" tone="approved" value={formatCount(response?.candidateCount ?? 0)} />
        <MetricCard icon={FileSpreadsheet} label="Open invoices" tone="ready" value={formatCount(openInvoiceCount)} />
        <MetricCard icon={CircleDollarSign} label="Open balance" tone="money" value={formatMoneyValue(openBalanceAmount)} />
        <MetricCard icon={Activity} label="Overdue" tone="warn" value={formatCount(overdueInvoiceCount)} />
      </section>

      <section className="work-surface">
        <div className="surface-header">
            <div>
              <span className="section-kicker">ConnectWise invoices</span>
              <h2>Standard invoicing</h2>
            </div>
          <span className="invoice-action-message">{loadMessage}</span>
        </div>
        <div className="invoice-live-list">
          {candidates.length === 0 ? (
            <div className="empty-state">
              {loadState === 'loading' ? <InvoiceLoadingGraphic /> : <FileSpreadsheet size={20} />}
              <strong>{loadState === 'loading' ? 'Loading standard invoices.' : 'No standard invoice candidates found.'}</strong>
              <span>{loadMessage}</span>
            </div>
          ) : null}
          {candidates.map((candidate) => (
            <div className="invoice-live-row standard-invoice-row" key={`${candidate.company.id ?? candidate.company.name}`}>
              <div>
                <strong>{candidate.company.name}</strong>
                <span>{candidate.invoiceTypes.length > 0 ? candidate.invoiceTypes.join(', ') : 'Standard'}</span>
              </div>
              <span>{candidate.latestInvoice?.invoiceNumber ?? 'No invoice number'}</span>
              <strong>{formatCount(candidate.openInvoiceCount)} open</strong>
              <strong>{formatMoneyValue(candidate.openBalanceAmount)}</strong>
              <span className={candidate.overdueInvoiceCount > 0 ? 'status-pill needs-review' : 'status-pill approved'}>
                {candidate.overdueInvoiceCount > 0 ? `${candidate.overdueInvoiceCount} overdue` : 'Current'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function invoiceNoticeLabel(noticeType: unknown, daysPastDue?: number) {
  const normalized = normalizeInvoiceNoticeType(noticeType, daysPastDue);
  return invoiceNoticeTypePillLabels[normalized];
}

function invoiceNoticeStatusClass(noticeType: unknown, daysPastDue?: number) {
  const normalized = normalizeInvoiceNoticeType(noticeType, daysPastDue);
  if (normalized === 'service-suspension') return 'notice-suspension';
  if (normalized === 'credit-hold') return 'notice-credit-hold';
  return 'notice-reminder';
}

function ariaSortValue(
  sortState: { key: OverdueInvoiceSortKey; direction: SortDirection },
  key: OverdueInvoiceSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sortState.key !== key) {
    return 'none';
  }
  return sortState.direction === 'asc' ? 'ascending' : 'descending';
}

function sortOverdueCustomerGroups(
  customers: OverdueInvoiceCustomerGroup[],
  key: OverdueInvoiceSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...customers].sort((left, right) => {
    const compared = compareOverdueCustomerSortValue(left, right, key);
    if (compared !== 0) {
      return compared * multiplier;
    }
    return left.company.name.localeCompare(right.company.name, undefined, { sensitivity: 'base' });
  });
}

function compareOverdueCustomerSortValue(
  left: OverdueInvoiceCustomerGroup,
  right: OverdueInvoiceCustomerGroup,
  key: OverdueInvoiceSortKey,
) {
  if (key === 'customerName') {
    return left.company.name.localeCompare(right.company.name, undefined, { sensitivity: 'base' });
  }
  if (key === 'pastDueStatus') {
    return left.oldestDaysPastDue - right.oldestDaysPastDue;
  }
  if (key === 'invoiceCount') {
    return left.invoiceCount - right.invoiceCount;
  }
  if (key === 'pastDueBalance' || key === 'agingBalance') {
    return left.balanceTotal - right.balanceTotal;
  }
  return 0;
}

function agingBalancesForCustomer(customer: OverdueInvoiceCustomerGroup) {
  return customer.invoices.reduce(
    (totals, invoice) => {
      const noticeType = invoiceNoticeTypeForDaysPastDue(invoice.daysPastDue);
      if (noticeType === 'service-suspension') {
        totals.balanceSuspension += invoice.balance;
      } else if (noticeType === 'credit-hold') {
        totals.balanceCreditHold += invoice.balance;
      } else {
        totals.balanceReminder += invoice.balance;
      }
      return totals;
    },
    { balanceReminder: 0, balanceCreditHold: 0, balanceSuspension: 0 },
  );
}

function overdueAgingSummary(customers: OverdueInvoiceCustomerGroup[]) {
  return customers.reduce(
    (summary, customer) => {
      let hasReminder = false;
      let hasCreditHold = false;
      let hasSuspension = false;

      for (const invoice of customer.invoices) {
        const noticeType = invoiceNoticeTypeForDaysPastDue(invoice.daysPastDue);
        if (noticeType === 'service-suspension') {
          summary.invoicesSuspension += 1;
          summary.balanceSuspension += invoice.balance;
          hasSuspension = true;
        } else if (noticeType === 'credit-hold') {
          summary.invoicesCreditHold += 1;
          summary.balanceCreditHold += invoice.balance;
          hasCreditHold = true;
        } else {
          summary.invoicesReminder += 1;
          summary.balanceReminder += invoice.balance;
          hasReminder = true;
        }
      }

      if (hasReminder) summary.customersReminder += 1;
      if (hasCreditHold) summary.customersCreditHold += 1;
      if (hasSuspension) summary.customersSuspension += 1;

      return summary;
    },
    {
      balanceReminder: 0,
      balanceCreditHold: 0,
      balanceSuspension: 0,
      customersReminder: 0,
      customersCreditHold: 0,
      customersSuspension: 0,
      invoicesReminder: 0,
      invoicesCreditHold: 0,
      invoicesSuspension: 0,
    },
  );
}

function groupOverdueInvoicesByCustomer(invoices: OverdueInvoice[]): OverdueInvoiceCustomerGroup[] {
  const groups = new Map<string, OverdueInvoiceCustomerGroup>();

  for (const invoice of invoices) {
    const customerKey = overdueInvoiceCustomerKey(invoice);
    const existing =
      groups.get(customerKey) ??
      ({
        customerKey,
        company: invoice.company,
        invoices: [],
        invoiceCount: 0,
        balanceTotal: 0,
        oldestDaysPastDue: 0,
        noticeType: 'past-due-reminder',
        bucketCounts: {
          '7-29-days': 0,
          '30-59-days': 0,
          '60-plus-days': 0,
        },
      } satisfies OverdueInvoiceCustomerGroup);

    existing.invoices.push(invoice);
    existing.invoiceCount += 1;
    existing.balanceTotal += invoice.balance;
    existing.oldestDaysPastDue = Math.max(existing.oldestDaysPastDue, invoice.daysPastDue);
    existing.noticeType = invoiceNoticeTypeForDaysPastDue(existing.oldestDaysPastDue);
    existing.bucketCounts[invoice.bucketId] += 1;
    if (
      invoice.lastNotice &&
      (!existing.lastNotice || new Date(invoice.lastNotice.occurredAt).getTime() > new Date(existing.lastNotice.occurredAt).getTime())
    ) {
      existing.lastNotice = invoice.lastNotice;
    }

    groups.set(customerKey, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      invoices: sortedOverdueInvoicesOldestFirst(group.invoices),
      balanceTotal: Math.round(group.balanceTotal * 100) / 100,
    }))
    .sort(
      (left, right) =>
        right.balanceTotal - left.balanceTotal ||
        right.oldestDaysPastDue - left.oldestDaysPastDue ||
        left.company.name.localeCompare(right.company.name, undefined, { sensitivity: 'base' }),
    );
}

function sortedOverdueInvoicesOldestFirst(invoices: OverdueInvoice[]) {
  return [...invoices].sort(
    (left, right) => right.daysPastDue - left.daysPastDue || String(left.dueDate ?? '').localeCompare(String(right.dueDate ?? '')),
  );
}

function overdueInvoiceCustomerKey(invoice: OverdueInvoice) {
  if (invoice.company.id) return `id:${invoice.company.id}`;
  if (invoice.company.identifier) return `identifier:${invoice.company.identifier.trim().toLowerCase()}`;
  return `name:${invoice.company.name.trim().toLowerCase()}`;
}

function invoiceNoticeTypeForDaysPastDue(daysPastDue: number): InvoiceNoticeType {
  return noticeTypeForDaysPastDue(daysPastDue);
}

function ImportsView(props: {
  busyReviewAction: string | null;
  customerOptions: MappingCustomerOption[];
  importMode: InvoiceImportMode;
  imports: InvoiceImportSummary[];
  importing: boolean;
  integrations: Integration[];
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onAccountMappingSave: (account: InvoiceAccountException, customerId: string, agreementId: string) => Promise<boolean>;
  onCloseReview: () => void;
  onProductCatalogSearch: (query: string) => Promise<ProductCatalogSearchResponse>;
  onProductMappingSave: (product: InvoiceProductException, target: ProductMappingTarget) => Promise<boolean>;
  onRefreshReview: () => Promise<InvoiceImportExceptionReview | null>;
  onReviewImport: (invoiceImport: InvoiceImportSummary) => Promise<InvoiceImportExceptionReview | null>;
  onTableUpload: (
    integrationId: VendorKey,
    file: File,
    columnMap: InvoiceTableColumnMap,
    sourceType: IntegrationDataSourceType,
    importMode: InvoiceImportMode,
    syncMode: ManualImportSyncMode,
    linkedIntegrationId?: IntegrationId,
  ) => Promise<InvoiceImportSummary | null>;
  onUpload: (file: File, importMode: InvoiceImportMode) => Promise<InvoiceImportSummary | null>;
  onVendorChange: (vendorId: VendorKey | '') => void;
  review: InvoiceImportExceptionReview | null;
  reviewLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  reviewMessage: string;
  selectedVendorId: VendorKey | '';
  setImportMode: (value: InvoiceImportMode) => void;
  vendorDatapoints: VendorDatapointRecord[];
}) {
  const {
    busyReviewAction,
    customerOptions,
    importMode,
    imports,
    importing,
    integrations,
    loadState,
    message,
    onAccountMappingSave,
    onCloseReview,
    onProductCatalogSearch,
    onProductMappingSave,
    onRefreshReview,
    onReviewImport,
    onTableUpload,
    onUpload,
    onVendorChange,
    review,
    reviewLoadState,
    reviewMessage,
    selectedVendorId,
    setImportMode,
    vendorDatapoints,
  } = props;
  const latestImport = imports[0];
  const totalRows = imports.reduce((total, item) => total + item.rowCount, 0);
  const totalExceptions = imports.reduce((total, item) => total + item.exceptionRows, 0);
  const selectedVendor = selectedVendorId
    ? integrations.find((integration) => integration.id === selectedVendorId)
    : undefined;
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) {
      void onUpload(file, importMode);
    }
    event.currentTarget.value = '';
  };

  return (
    <section className="view-grid imports-view">
      <div className="work-surface">
        <div className="surface-header">
          <div>
            <span className="section-kicker">Vendor invoices</span>
            <h2>Invoice intake</h2>
          </div>
          <div className="import-actions">
            <label className="config-field import-vendor-select">
              <span>Integration</span>
              <select
                disabled={importing}
                onChange={(event) => onVendorChange(event.target.value as VendorKey | '')}
                value={selectedVendorId}
              >
                <option value="">All invoice imports</option>
                {integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name}
                  </option>
                ))}
                {vendorDatapoints.map((datapoint) => (
                  <option key={datapoint.vendorId} value={datapoint.vendorId}>
                    {datapoint.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented-control import-mode-toggle" role="group" aria-label="Invoice import mode">
              {(['overwrite', 'merge'] as const).map((mode) => (
                <button
                  className={importMode === mode ? 'active' : ''}
                  disabled={importing}
                  key={mode}
                  onClick={() => setImportMode(mode)}
                  title={
                    mode === 'overwrite'
                      ? 'Replace existing imports for the same invoice number'
                      : 'Keep existing imports and add this file as another import'
                  }
                  type="button"
                >
                  {mode === 'overwrite' ? 'Overwrite' : 'Merge'}
                </button>
              ))}
            </div>
            <label className={importing ? 'button primary compact file-upload-button disabled' : 'button primary compact file-upload-button'}>
              <FileUp size={17} />
              {importing ? 'Importing' : 'Upload file'}
              <input accept=".csv,text/csv" disabled={importing} onChange={handleFileChange} type="file" />
            </label>
          </div>
        </div>

        <div className="import-drop">
          <FileSpreadsheet size={28} />
          <div>
            <strong>
              {latestImport
                ? `${latestImport.rowCount.toLocaleString()} rows on ${latestImport.invoiceNumber ? `invoice ${latestImport.invoiceNumber}` : latestImport.fileName}`
                : 'No invoice imported yet'}
            </strong>
            <span>{loadState === 'failed' ? message : latestImport ? `${totalRows.toLocaleString()} total rows imported / ${totalExceptions.toLocaleString()} exceptions` : message}</span>
          </div>
        </div>

        <InvoiceTableImportPanel
          importMode={importMode}
          importing={importing}
          integrations={integrations}
          onImport={onTableUpload}
          selectedVendor={selectedVendor}
        />

        <div className="import-table">
          {imports.length === 0 ? (
            <div className="empty-state">
              <FileSpreadsheet size={20} />
              <strong>{loadState === 'loading' ? 'Loading invoice imports.' : 'No vendor invoice imports found.'}</strong>
              <span>{message}</span>
            </div>
          ) : null}

          {imports.map((item) => (
            <div className="import-row" key={item.id}>
              <span className="vendor-badge">{vendorDisplayName(item.vendorId, vendorDatapoints)}</span>
              <div>
                <strong>{item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : item.fileName}</strong>
                <span>
                  {formatCount(item.rowCount)} rows / {formatDateOnly(item.invoiceDate) ?? formatDateTime(item.importedAt)}
                </span>
              </div>
              <div className="match-bar">
                <span style={{ width: `${item.rowCount > 0 ? (item.matchedRows / item.rowCount) * 100 : 0}%` }} />
              </div>
              <strong>{item.exceptionRows} exceptions</strong>
              <button
                className={item.status === 'ready' ? 'button secondary compact' : 'button primary compact'}
                disabled={reviewLoadState === 'loading'}
                onClick={() => void onReviewImport(item)}
                type="button"
              >
                {item.status === 'ready' ? 'Open' : 'Review'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {review || reviewLoadState !== 'idle' ? (
        <InvoiceExceptionReviewPanel
          busyAction={busyReviewAction}
          customerOptions={customerOptions}
          loadState={reviewLoadState}
          message={reviewMessage}
          onAccountMappingSave={onAccountMappingSave}
          onClose={onCloseReview}
          onProductCatalogSearch={onProductCatalogSearch}
          onProductMappingSave={onProductMappingSave}
          onRefresh={onRefreshReview}
          review={review}
        />
      ) : null}

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
            ['Customer Account Number', 'AppRiver account', 'Required'],
            ['Product Code + Term', 'Vendor product key', 'Required'],
            ['Charge Qty', 'Invoice count', 'Renewals'],
            ['Billed Amount', 'Invoice amount', 'Detail'],
            ['Charge Type', 'Renewal / adjustment', 'Detail'],
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

function importableDataSources(integration: Integration | undefined) {
  return (
    integration?.dataSources.filter((source) =>
      source.ingestionMethods.some((method) => method === 'csv' || method === 'excel' || method === 'json'),
    ) ?? []
  );
}

function sourceLabel(source: IntegrationDataSourceDefinition) {
  if (source.sourceType === 'reseller-product-total') {
    return 'Product totals';
  }
  if (source.sourceType === 'user-license-detail') {
    return 'User detail';
  }
  if (source.sourceType === 'device-count') {
    return 'Device counts';
  }
  if (source.sourceType === 'invoice') {
    return 'Invoices';
  }
  if (source.sourceType === 'license-count') {
    return 'License counts';
  }
  return 'Customer products';
}

function hasRequiredInvoiceSourceColumn(sourceType: IntegrationDataSourceType, columnMap: InvoiceTableColumnMap) {
  const hasProductColumn = Boolean(columnMap.productName || columnMap.productCode);
  if (sourceType === 'device-count') {
    return hasProductColumn || Boolean(columnMap.deviceType || columnMap.deviceClass);
  }
  if (sourceType === 'license-count') {
    return hasProductColumn || Boolean(columnMap.licenseName || columnMap.licenseId);
  }

  return hasProductColumn;
}

function isRequiredSourceColumn(
  sourceType: IntegrationDataSourceType,
  fieldKey: keyof InvoiceTableColumnMap,
  columnMap: InvoiceTableColumnMap,
) {
  if (
    fieldKey !== 'productName' &&
    fieldKey !== 'productCode' &&
    fieldKey !== 'deviceType' &&
    fieldKey !== 'deviceClass' &&
    fieldKey !== 'licenseName' &&
    fieldKey !== 'licenseId'
  ) {
    return false;
  }

  if (sourceType === 'device-count') {
    return !columnMap.productName && !columnMap.productCode && !columnMap.deviceType && !columnMap.deviceClass;
  }
  if (sourceType === 'license-count') {
    return !columnMap.productName && !columnMap.productCode && !columnMap.licenseName && !columnMap.licenseId;
  }

  return !columnMap.productName && !columnMap.productCode && (fieldKey === 'productName' || fieldKey === 'productCode');
}

function InvoiceTableImportPanel(props: {
  importMode: InvoiceImportMode;
  importing: boolean;
  onImport: (
    integrationId: VendorKey,
    file: File,
    columnMap: InvoiceTableColumnMap,
    sourceType: IntegrationDataSourceType,
    importMode: InvoiceImportMode,
    syncMode: ManualImportSyncMode,
    linkedIntegrationId?: IntegrationId,
  ) => Promise<InvoiceImportSummary | null>;
  integrations: Integration[];
  selectedVendor?: Integration;
}) {
  const { importMode, importing, integrations, onImport, selectedVendor } = props;
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<InvoiceTableColumnMap>({});
  const [sourceType, setSourceType] = useState<IntegrationDataSourceType>('customer-product-breakdown');
  const [syncMode, setSyncMode] = useState<ManualImportSyncMode>('full-vendor-sync');
  const [linkedIntegrationId, setLinkedIntegrationId] = useState<IntegrationId | ''>('');
  const [message, setMessage] = useState('Choose a CSV, JSON, XLS, or XLSX table to map columns.');
  const importDataSources = importableDataSources(selectedVendor);
  const selectedDataSource =
    importDataSources.find((source) => source.sourceType === sourceType) ?? importDataSources[0];
  const requiresCustomerMapping = selectedDataSource?.requiresCustomerMapping ?? true;
  const requiresSourceProductMapping = hasRequiredInvoiceSourceColumn(sourceType, columnMap);
  const requiredMapped = columnMapSatisfiesSourceType(sourceType, columnMap, { requiresCustomerMapping });
  const canImport = Boolean(selectedVendor && file && requiredMapped && !importing);
  const linkableIntegrations =
    selectedVendor?.id === 'custom-table'
      ? integrations.filter(
          (integration) =>
            integration.id !== 'custom-table' &&
            integrationHasCapability(integration.id, 'mapping') &&
            integrationHasCapability(integration.id, 'invoice-import'),
        )
      : [];
  const linkedIntegration = linkedIntegrationId
    ? integrations.find((integration) => integration.id === linkedIntegrationId)
    : undefined;

  useEffect(() => {
    const nextSource = importDataSources[0]?.sourceType ?? 'customer-product-breakdown';
    setSourceType((current) => (importDataSources.some((source) => source.sourceType === current) ? current : nextSource));
  }, [selectedVendor?.id]);

  useEffect(() => {
    if (selectedVendor?.id !== 'custom-table') {
      setLinkedIntegrationId('');
    }
  }, [selectedVendor?.id]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setFile(nextFile);
    if (!nextFile) {
      setHeaders([]);
      setColumnMap({});
      setMessage('Choose a CSV, JSON, XLS, or XLSX table to map columns.');
      return;
    }

    try {
      const table = await readImportTableFile(nextFile);
      const nextMap = suggestInvoiceTableColumnMap(table.headers, sourceType);
      setHeaders(table.headers);
      setColumnMap(nextMap);
      setMessage(
        table.headers.length > 0
          ? `${table.headers.length.toLocaleString()} columns detected. Review the mapping before import.`
          : 'No header row was detected in this table.',
      );
    } catch (error) {
      setHeaders([]);
      setColumnMap({});
      setMessage(error instanceof Error ? error.message : 'Unable to read this table file.');
    }
  };

  const updateColumn = (key: keyof InvoiceTableColumnMap, value: string) => {
    setColumnMap((current) => updateInvoiceTableColumnMap(current, key, value));
  };

  const importTable = async () => {
    if (!selectedVendor || !file || !requiredMapped) {
      setMessage(
        requiresCustomerMapping
          ? 'Select an integration, table file, customer column, product/category column, and quantity column.'
          : 'Select an integration, table file, product/category column, and quantity column.',
      );
      return;
    }

    const targetName = linkedIntegration?.name ?? selectedVendor.name;
    setMessage(`Importing ${file.name} for ${targetName}...`);
    const imported = await onImport(
      selectedVendor.id,
      file,
      columnMap,
      sourceType,
      importMode,
      syncMode,
      linkedIntegrationId || undefined,
    );
    if (imported) {
      setMessage(`${imported.rowCount.toLocaleString()} rows imported for ${targetName}.`);
    }
  };

  return (
    <section className="invoice-table-import-panel" aria-label="Mapped invoice table import">
      <div className="invoice-table-import-header">
        <div>
          <span className="section-kicker">Table import</span>
          <h3>{selectedVendor ? selectedVendor.name : 'Select an integration'}</h3>
        </div>
        <label className={importing ? 'button secondary compact file-upload-button disabled' : 'button secondary compact file-upload-button'}>
          <FileSpreadsheet size={16} />
          Select file
          <input
            accept=".csv,.json,.xls,.xlsx,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={importing}
            onChange={(event) => void handleFileChange(event)}
            type="file"
          />
        </label>
      </div>

      <div className="invoice-table-import-body">
        <div className="invoice-table-import-summary">
          <strong>{file ? file.name : 'No table selected'}</strong>
          <span>{message}</span>
        </div>
        {importDataSources.length > 1 ? (
          <div className="segmented-control invoice-source-toggle" role="group" aria-label="Invoice source type">
            {importDataSources.map((source) => (
              <button
                className={sourceType === source.sourceType ? 'active' : ''}
                disabled={importing}
                key={source.key}
                onClick={() => setSourceType(source.sourceType)}
                title={source.description}
                type="button"
              >
                {sourceLabel(source)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="segmented-control invoice-source-toggle" role="group" aria-label="Manual import sync mode">
          <button
            className={syncMode === 'full-vendor-sync' ? 'active' : ''}
            disabled={importing}
            onClick={() => setSyncMode('full-vendor-sync')}
            title="Use these rows as the vendor usage data for reconciliation."
            type="button"
          >
            Full sync
          </button>
          <button
            className={syncMode === 'info-only' ? 'active' : ''}
            disabled={importing}
            onClick={() => setSyncMode('info-only')}
            title="Store these rows for reporting and filtered linked rules without product-mapping exceptions."
            type="button"
          >
            Info only
          </button>
        </div>
        {selectedVendor?.id === 'custom-table' && linkableIntegrations.length > 0 ? (
          <label className="config-field">
            <span>Linked integration</span>
            <select
              disabled={importing}
              onChange={(event) => setLinkedIntegrationId(event.target.value as IntegrationId | '')}
              value={linkedIntegrationId}
            >
              <option value="">Standalone custom import</option>
              {linkableIntegrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <InvoiceColumnMapGrid
          columnMap={columnMap}
          disabled={importing}
          headerOptions={columnMappingHeaderOptions(columnMap, headers)}
          onChange={updateColumn}
          requiresCustomerMapping={requiresCustomerMapping}
          sourceType={sourceType}
        />
        <div className="invoice-table-import-actions">
          <button className="button primary compact" disabled={!canImport} onClick={() => void importTable()} type="button">
            <Upload size={15} />
            {importing ? 'Importing' : 'Import mapped table'}
          </button>
          <span>{requiredMapped ? 'Required columns mapped' : 'Map required columns'}</span>
        </div>
      </div>
    </section>
  );
}

type ParsedImportTableFile = {
  content: string;
  headers: string[];
};

async function readImportTableFile(file: File): Promise<ParsedImportTableFile> {
  const lowerName = file.name.toLowerCase();
  const isJson = lowerName.endsWith('.json') || file.type === 'application/json';
  const isWorkbook =
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.xlsx') ||
    file.type === 'application/vnd.ms-excel' ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (isWorkbook) {
    const content = await spreadsheetFileToCsv(file);
    return {
      content,
      headers: csvHeaders(content),
    };
  }

  if (isJson) {
    const content = await file.text();
    const detectedCsv = jsonTableToCsv(content);
    return {
      content,
      headers: csvHeaders(detectedCsv),
    };
  }

  const content = await file.text();
  return {
    content,
    headers: csvHeaders(content),
  };
}

async function spreadsheetFileToCsv(file: File) {
  const rows = readWorkbookObjectRows(await file.arrayBuffer());
  return objectRowsToCsv(rows);
}

function jsonTableToCsv(content: string) {
  const parsed = JSON.parse(content) as unknown;
  const rows = jsonRowsFromValue(parsed);
  if (rows.length === 0) {
    throw new Error('The JSON file did not contain any table rows.');
  }

  if (Array.isArray(rows[0])) {
    const arrayRows = rows.filter(Array.isArray) as unknown[][];
    const headers = arrayRows[0].map((value) => tableCellToString(value).trim()).filter(Boolean);
    if (headers.length === 0) {
      throw new Error('The JSON table did not contain a header row.');
    }

    return [
      headers.map(csvCell).join(','),
      ...arrayRows.slice(1).map((row) => headers.map((_, index) => csvCell(tableCellToString(row[index]))).join(',')),
    ].join('\n');
  }

  const objectRows = rows.filter(isImportObjectRow);
  return objectRowsToCsv(objectRows);
}

function jsonRowsFromValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isImportObjectRow(value)) {
    for (const key of ['rows', 'data', 'items', 'records', 'results']) {
      const candidate = value[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return [];
}

function objectRowsToCsv(rows: Array<Record<string, unknown>>) {
  const headers = [
    ...new Set(
      rows.flatMap((row) =>
        Object.keys(row).filter((key) => typeof row[key] !== 'undefined' && row[key] !== null),
      ),
    ),
  ];
  if (headers.length === 0) {
    throw new Error('The table did not contain any columns.');
  }

  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(tableCellToString(row[header]))).join(',')),
  ].join('\n');
}

function isImportObjectRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableCellToString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return JSON.stringify(value);
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvHeaders(content: string) {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const text = content.replace(/^\uFEFF/, '');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field.trim());
      field = '';
      continue;
    }
    if (char === '\r' || char === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      break;
    }
    field += char;
  }

  if (rows.length === 0) {
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  return rows[0] ?? [];
}

function InvoiceExceptionReviewPanel(props: {
  busyAction: string | null;
  customerOptions: MappingCustomerOption[];
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onAccountMappingSave: (account: InvoiceAccountException, customerId: string, agreementId: string) => Promise<boolean>;
  onClose: () => void;
  onProductCatalogSearch: (query: string) => Promise<ProductCatalogSearchResponse>;
  onProductMappingSave: (product: InvoiceProductException, target: ProductMappingTarget) => Promise<boolean>;
  onRefresh: () => Promise<InvoiceImportExceptionReview | null>;
  review: InvoiceImportExceptionReview | null;
}) {
  const {
    busyAction,
    customerOptions,
    loadState,
    message,
    onAccountMappingSave,
    onClose,
    onProductCatalogSearch,
    onProductMappingSave,
    onRefresh,
    review,
  } = props;
  const invoiceLabel = review?.import.invoiceNumber ? `Invoice ${review.import.invoiceNumber}` : review?.import.fileName ?? 'Invoice review';

  return (
    <div className="work-surface invoice-review-surface">
      <div className="surface-header">
        <div>
          <span className="section-kicker">Exception review</span>
          <h2>{invoiceLabel}</h2>
        </div>
        <div className="import-actions">
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void onRefresh()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button className="icon-button" onClick={onClose} title="Close review" type="button">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={`integrations-live-bar invoice-review-status ${loadState === 'failed' ? 'failed' : ''}`}>
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Review issue' : loadState === 'loading' ? 'Loading review' : 'Review ready'}</strong>
          <span>{message}</span>
        </div>
      </div>

      {review ? (
        <>
          <section className="metric-grid invoice-review-metrics" aria-label="Invoice exception summary">
            <MetricCard icon={ListChecks} label="Exceptions" tone="warn" value={formatCount(review.summary.exceptionRows)} />
            <MetricCard icon={Users} label="Account rows" tone="money" value={formatCount(review.summary.missingAgreementRows)} />
            <MetricCard icon={Package} label="Product rows" tone="ready" value={formatCount(review.summary.missingProductRows)} />
            <MetricCard icon={FileSpreadsheet} label="Renewals" tone="approved" value={formatCount(review.summary.renewalExceptionRows)} />
          </section>

          <div className="invoice-exception-grid">
            <section className="invoice-exception-panel" aria-label="Account exceptions">
              <div className="surface-header compact-header">
                <div>
                  <span className="section-kicker">Customer / agreement</span>
                  <h3>{review.accountExceptions.length.toLocaleString()} account groups</h3>
                </div>
              </div>
              <div className="invoice-exception-list">
                {review.accountExceptions.length === 0 ? (
                  <div className="empty-state">
                    <Users size={20} />
                    <strong>No account exceptions.</strong>
                  </div>
                ) : null}
                {review.accountExceptions.map((account) => (
                  <InvoiceAccountExceptionRow
                    account={account}
                    busyAction={busyAction}
                    customerOptions={customerOptions}
                    key={account.externalAccountId}
                    onSave={onAccountMappingSave}
                  />
                ))}
              </div>
            </section>

            <section className="invoice-exception-panel" aria-label="Product exceptions">
              <div className="surface-header compact-header">
                <div>
                  <span className="section-kicker">Product catalog</span>
                  <h3>{review.productExceptions.length.toLocaleString()} product groups</h3>
                </div>
              </div>
              <div className="invoice-exception-list">
                {review.productExceptions.length === 0 ? (
                  <div className="empty-state">
                    <Package size={20} />
                    <strong>No product exceptions.</strong>
                  </div>
                ) : null}
                {review.productExceptions.map((product) => (
                  <InvoiceProductExceptionRow
                    busyAction={busyAction}
                    key={product.vendorProductKey}
                    onCatalogSearch={onProductCatalogSearch}
                    onSave={onProductMappingSave}
                    product={product}
                  />
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function InvoiceAccountExceptionRow(props: {
  account: InvoiceAccountException;
  busyAction: string | null;
  customerOptions: MappingCustomerOption[];
  onSave: (account: InvoiceAccountException, customerId: string, agreementId: string) => Promise<boolean>;
}) {
  const { account, busyAction, customerOptions, onSave } = props;
  const initialCustomerId = account.currentMapping?.customerId ?? '';
  const initialAgreementId = account.currentMapping?.agreementId ?? '';
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [agreementId, setAgreementId] = useState(initialAgreementId);
  const selectedCustomer = customerOptions.find((customer) => customer.customerId === customerId);
  const agreementOptions = selectedCustomer?.agreements ?? [];
  const actionKey = `invoice-account:${account.externalAccountId}`;
  const isBusy = busyAction === actionKey;
  const hasUsableMapping = Boolean(account.currentMapping?.active && account.currentMapping.agreementId);

  useEffect(() => {
    setCustomerId(initialCustomerId);
    setAgreementId(initialAgreementId);
  }, [initialAgreementId, initialCustomerId]);

  const selectCustomer = (nextCustomerId: string) => {
    const nextCustomer = customerOptions.find((customer) => customer.customerId === nextCustomerId);
    setCustomerId(nextCustomerId);
    setAgreementId(nextCustomer?.agreements[0]?.agreementId ?? '');
  };

  return (
    <article className="invoice-exception-row">
      <div className="invoice-exception-row-main">
        <div>
          <strong>{account.externalAccountName}</strong>
          <span>{account.externalAccountId}</span>
        </div>
        <span className={hasUsableMapping ? 'status-pill approved' : 'status-pill needs-review'}>
          {hasUsableMapping ? 'Mapped' : 'Needs mapping'}
        </span>
      </div>
      <div className="invoice-exception-meta">
        <span>{formatCount(account.rowCount)} rows</span>
        <span>{formatCount(account.quantity)} qty</span>
        <span>{invoiceIssueLabels(account.sampleRows).join(', ')}</span>
      </div>
      {account.currentMapping ? (
        <div className="invoice-existing-map">
          <ArrowRight size={15} />
          <span>
            {account.currentMapping.customerName}
            {account.currentMapping.agreementName ? ` / ${account.currentMapping.agreementName}` : ''}
          </span>
        </div>
      ) : null}
      <div className="invoice-map-form account-map-form">
        <label>
          <span>ConnectWise customer</span>
          <select onChange={(event) => selectCustomer(event.target.value)} value={customerId}>
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
          <span>Billing agreement</span>
          <select disabled={!customerId} onChange={(event) => setAgreementId(event.target.value)} value={agreementId}>
            <option value="">Select agreement</option>
            {agreementOptions.map((agreement) => (
              <option key={agreement.agreementId} value={agreement.agreementId}>
                {agreement.agreementName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary compact"
          disabled={isBusy || !customerId || !agreementId}
          onClick={() => void onSave(account, customerId, agreementId)}
          type="button"
        >
          <Check size={15} />
          {isBusy ? 'Saving' : 'Save'}
        </button>
      </div>
      <InvoiceExceptionSamples lines={account.sampleRows} />
    </article>
  );
}

function InvoiceProductExceptionRow(props: {
  busyAction: string | null;
  onCatalogSearch: (query: string) => Promise<ProductCatalogSearchResponse>;
  onSave: (product: InvoiceProductException, target: ProductMappingTarget) => Promise<boolean>;
  product: InvoiceProductException;
}) {
  const { busyAction, onCatalogSearch, onSave, product } = props;
  const [query, setQuery] = useState(defaultInvoiceProductSearch(product));
  const [results, setResults] = useState<ProductCatalogTarget[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [showNewItemStub, setShowNewItemStub] = useState(false);
  const actionKey = `invoice-product:${product.vendorProductKey}`;
  const isBusy = busyAction === actionKey;
  const selectedTarget = results.find((result) => result.connectwiseProductCode === selectedCode);
  const activeExisting = product.existingMappings.find((mapping) => mapping.active && mapping.status === 'approved');

  useEffect(() => {
    setQuery(defaultInvoiceProductSearch(product));
    setResults([]);
    setSelectedCode('');
    setSearchMessage('');
    setShowNewItemStub(false);
  }, [product.vendorProductKey]);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchMessage('Enter a catalog search.');
      return;
    }

    setSearching(true);
    setSearchMessage('');
    try {
      const response = await onCatalogSearch(trimmed);
      setResults(response.targets);
      setSelectedCode(response.targets[0]?.connectwiseProductCode ?? '');
      setSearchMessage(
        response.targets.length > 0
          ? `${response.targets.length.toLocaleString()} catalog matches`
          : 'No existing catalog matches',
      );
    } catch (error) {
      setResults([]);
      setSelectedCode('');
      setSearchMessage(error instanceof Error ? error.message : 'Catalog search failed.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <article className="invoice-exception-row">
      <div className="invoice-exception-row-main">
        <div>
          <strong>{product.productName}</strong>
          <span>{product.vendorProductKey}</span>
        </div>
        <span className={activeExisting ? 'status-pill approved' : 'status-pill needs-review'}>
          {activeExisting ? 'Mapped' : 'Needs mapping'}
        </span>
      </div>
      <div className="invoice-exception-meta">
        <span>{formatCount(product.rowCount)} rows</span>
        <span>{formatCount(product.quantity)} qty</span>
        <span>{[product.productCode, product.term, product.billingFrequency].filter(Boolean).join(' / ')}</span>
      </div>
      {activeExisting ? (
        <div className="invoice-existing-map">
          <ArrowRight size={15} />
          <span>{activeExisting.connectWiseProductName} / {activeExisting.connectWiseProductCode}</span>
        </div>
      ) : null}
      <div className="invoice-map-form product-map-form">
        <label>
          <span>Catalog search</span>
          <div className="product-catalog-search-row">
            <input
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              value={query}
            />
            <button className="button secondary compact" disabled={searching} onClick={() => void runSearch()} type="button">
              <Search size={14} />
              {searching ? 'Searching' : 'Search'}
            </button>
          </div>
        </label>
        {searchMessage ? <span className="product-catalog-message">{searchMessage}</span> : null}
        {results.length > 0 ? (
          <div className="invoice-catalog-results">
            {results.map((target) => (
              <label className="product-target-option" key={target.connectwiseProductCode}>
                <input
                  checked={selectedCode === target.connectwiseProductCode}
                  onChange={() => setSelectedCode(target.connectwiseProductCode)}
                  type="radio"
                />
                <span>
                  <strong>{target.connectwiseProductName}</strong>
                  <em>{target.connectwiseProductCode} - {target.source}</em>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <div className="invoice-product-actions">
          <button
            className="button primary compact"
            disabled={isBusy || !selectedTarget}
            onClick={() => selectedTarget && void onSave(product, selectedTarget)}
            type="button"
          >
            <Check size={15} />
            {isBusy ? 'Saving' : 'Map selected'}
          </button>
          <button
            className="button secondary compact"
            onClick={() => setShowNewItemStub((current) => !current)}
            type="button"
          >
            <Package size={15} />
            New catalog item
          </button>
        </div>
      </div>
      {showNewItemStub ? <InvoiceNewCatalogItemStub product={product} /> : null}
      <InvoiceExceptionSamples lines={product.sampleRows} />
    </article>
  );
}

function InvoiceNewCatalogItemStub(props: { product: InvoiceProductException }) {
  const { product } = props;
  const suggestedCode = suggestedInvoiceCatalogCode(product);

  return (
    <div className="invoice-new-item-stub">
      <div>
        <span className="section-kicker">AI draft</span>
        <strong>{product.productName}</strong>
      </div>
      <label>
        <span>Suggested code</span>
        <input readOnly value={suggestedCode} />
      </label>
      <label>
        <span>Suggested name</span>
        <input readOnly value={product.productName} />
      </label>
      <button className="button secondary compact" disabled title="AI catalog creation stub" type="button">
        <Zap size={15} />
        Generate
      </button>
    </div>
  );
}

function InvoiceExceptionSamples(props: { lines: InvoiceExceptionLine[] }) {
  const { lines } = props;
  if (lines.length === 0) {
    return null;
  }

  return (
    <details className="invoice-exception-samples">
      <summary>Rows</summary>
      <div>
        {lines.map((line) => (
          <span key={line.id}>
            #{line.rawRowNumber} / {line.chargeType ?? 'Line'} / {formatCount(line.quantity)} / {invoiceIssueLabels([line]).join(', ')}
          </span>
        ))}
      </div>
    </details>
  );
}

function invoiceIssueLabels(lines: InvoiceExceptionLine[]) {
  const labels = new Set<string>();
  if (lines.some((line) => line.missingCustomer)) labels.add('customer');
  if (lines.some((line) => line.missingAgreement)) labels.add('agreement');
  if (lines.some((line) => line.missingProduct)) labels.add('product');
  return [...labels].map((label) => `missing ${label}`);
}

function defaultInvoiceProductSearch(product: InvoiceProductException) {
  return product.productName || product.productCode || product.vendorProductKey;
}

function suggestedInvoiceCatalogCode(product: InvoiceProductException) {
  return (product.productCode || product.productName || product.vendorProductKey)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
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

function auditStatusLabel(status: string) {
  if (status === 'partial') return 'Needs review';
  if (status === 'written') return 'Updated';
  if (status === 'complete') return 'Complete';
  if (status === 'failed') return 'Blocked';
  return statusLabel(status as IssueStatus);
}

function auditStatusClass(status: string) {
  if (status === 'partial' || status === 'running' || status === 'applying') return 'needs-review';
  if (status === 'written' || status === 'complete' || status === 'updated' || status === 'approved') return 'approved';
  if (status === 'failed' || status === 'blocked') return 'blocked';
  if (status === 'discarded' || status === 'skipped') return 'skipped';
  return status;
}

function formatAuditPayloadValue(value: unknown) {
  if (value === null || typeof value === 'undefined') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function buildAuditExportRows(events: AuditEventRecord[]) {
  return events.map((event) => ({
    Occurred: formatDateTime(event.occurredAt) ?? event.occurredAt,
    Actor: event.actor,
    Action: event.eventLabel,
    Title: event.summary.title,
    Detail: event.summary.subtitle,
    Status: auditStatusLabel(event.summary.status),
    'Entity Type': event.entityType,
    'Entity Id': event.entityId,
    Payload: JSON.stringify(event.payload),
  }));
}

function AuditView() {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('Loading audit history...');
  const [syncRuns, setSyncRuns] = useState<AuditSyncRun[]>([]);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [batches, setBatches] = useState<AuditBatchRecord[]>([]);
  const [batchView, setBatchView] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditEventRecord | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<AuditBatchDetail | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [detailMessage, setDetailMessage] = useState('');

  const refreshAudit = async () => {
    setLoadState('loading');
    setMessage('Loading audit history...');

    try {
      const [syncResult, eventResult] = await Promise.all([
        fetchAuditSyncRuns(),
        fetchAuditEvents(batchView ? 'batch' : 'timeline'),
      ]);
      setSyncRuns(syncResult.runs);
      if (eventResult.view === 'batch') {
        setBatches(eventResult.batches);
        setEvents([]);
      } else {
        setEvents(eventResult.events);
        setBatches([]);
      }
      setLoadState('ready');
      setMessage('Audit history loaded.');
    } catch (error) {
      setLoadState('failed');
      setMessage(error instanceof Error ? error.message : 'Unable to load audit history.');
    }
  };

  useEffect(() => {
    void refreshAudit();
  }, [batchView]);

  const openEventDetail = async (event: AuditEventRecord) => {
    setSelectedEvent(event);
    setSelectedBatch(null);
    setDetailLoadState('loading');
    setDetailMessage('Loading event details...');

    try {
      const result = await fetchAuditEvent(event.id);
      setSelectedEvent(result.event);
      setDetailLoadState('ready');
      setDetailMessage('');
    } catch (error) {
      setDetailLoadState('failed');
      setDetailMessage(error instanceof Error ? error.message : 'Unable to load event details.');
    }
  };

  const openBatchDetail = async (batch: AuditBatchRecord) => {
    setSelectedEvent(null);
    setSelectedBatch({
      batchId: batch.batchId,
      actor: batch.actor,
      occurredAt: batch.occurredAt,
      status: batch.status,
      updateCount: batch.updateCount,
      discardedCount: batch.discardedCount,
      written: batch.written,
      failed: batch.failed,
      discarded: batch.discarded,
      items: [],
    });
    setDetailLoadState('loading');
    setDetailMessage('Loading batch details...');

    try {
      const result = await fetchAuditBatch(batch.batchId);
      setSelectedBatch(result.batch);
      setDetailLoadState('ready');
      setDetailMessage('');
    } catch (error) {
      setDetailLoadState('failed');
      setDetailMessage(error instanceof Error ? error.message : 'Unable to load batch details.');
    }
  };

  const closeDetail = () => {
    setSelectedEvent(null);
    setSelectedBatch(null);
    setDetailLoadState('idle');
    setDetailMessage('');
  };

  const exportAuditTrail = async () => {
    setExporting(true);
    try {
      const timelineResult = await fetchAuditEvents('timeline');
      const exportEvents = events.length > 0 ? events : timelineResult.view === 'timeline' ? timelineResult.events : [];
      if (exportEvents.length === 0) {
        throw new Error('There is no audit history to export yet.');
      }

      exportExcelFile(`audit-trail-${exportFileDate()}.xlsx`, buildAuditExportRows(exportEvents));
      setMessage(`Exported ${exportEvents.length.toLocaleString()} audit events.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export audit trail.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="integrations-live-bar audit-live-bar">
        <div>
          <span className={`live-dot ${loadState}`} />
          <strong>{loadState === 'ready' ? 'Audit history' : loadState === 'loading' ? 'Refreshing' : 'Audit issue'}</strong>
          <span>{message}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{syncRuns.length.toLocaleString()} sync runs</span>
          <span>{(batchView ? batches.length : events.length).toLocaleString()} {batchView ? 'batches' : 'events'}</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => void refreshAudit()} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <section className="view-grid audit-view">
        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Sync runs</span>
              <h2>Source activity</h2>
            </div>
            <button
              className="icon-button"
              disabled={exporting || loadState === 'loading'}
              onClick={() => void exportAuditTrail()}
              title="Export audit trail"
              type="button"
            >
              <Download size={18} />
            </button>
          </div>
          {syncRuns.length === 0 ? (
            <div className="empty-state audit-empty-state">
              <Database size={20} />
              <strong>No sync runs recorded yet.</strong>
              <span>Completed vendor and ConnectWise syncs will appear here.</span>
            </div>
          ) : (
            <div className="sync-list">
              {syncRuns.map((run) => (
                <div className="sync-row" key={run.id}>
                  <Zap size={17} />
                  <div>
                    <strong>{run.integrationName}</strong>
                    <span>{formatDateTime(run.completedAt ?? run.startedAt) ?? 'Unknown time'}</span>
                  </div>
                  <span>
                    {run.recordsWritten.toLocaleString()} written
                    {run.sourceLabel ? ` · ${run.sourceLabel}` : ''}
                  </span>
                  <span className={`status-pill ${auditStatusClass(run.status)}`}>{auditStatusLabel(run.status)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="work-surface">
          <div className="surface-header">
            <div>
              <span className="section-kicker">Approval ledger</span>
              <h2>Immutable history</h2>
            </div>
            <button
              className={`button secondary compact${batchView ? ' active' : ''}`}
              onClick={() => setBatchView((current) => !current)}
              type="button"
            >
              <ListChecks size={17} />
              {batchView ? 'Timeline view' : 'Batch view'}
            </button>
          </div>
          {batchView ? (
            batches.length === 0 ? (
              <div className="empty-state audit-empty-state">
                <History size={20} />
                <strong>No approval batches recorded yet.</strong>
                <span>Quantity approvals and ConnectWise writes will appear here.</span>
              </div>
            ) : (
              <div className="timeline">
                {batches.map((batch) => (
                  <button
                    className="timeline-row audit-row-button"
                    key={batch.batchId}
                    onClick={() => void openBatchDetail(batch)}
                    type="button"
                  >
                    <span className={`timeline-marker ${auditStatusClass(batch.status)}`} />
                    <div>
                      <strong>{batch.actor}</strong>
                      <span>
                        {batch.written.toLocaleString()} written · {batch.failed.toLocaleString()} failed ·{' '}
                        {batch.discarded.toLocaleString()} discarded
                      </span>
                    </div>
                    <em>{formatDateTime(batch.occurredAt) ?? 'Unknown time'}</em>
                    <span className={`status-pill ${auditStatusClass(batch.status)}`}>{auditStatusLabel(batch.status)}</span>
                  </button>
                ))}
              </div>
            )
          ) : events.length === 0 ? (
            <div className="empty-state audit-empty-state">
              <History size={20} />
              <strong>No user actions recorded yet.</strong>
              <span>Approvals, quantity updates, settings changes, and invoice notices are tracked here.</span>
            </div>
          ) : (
            <div className="timeline">
              {events.map((event) => (
                <button
                  className="timeline-row audit-row-button"
                  key={event.id}
                  onClick={() => void openEventDetail(event)}
                  type="button"
                >
                  <span className={`timeline-marker ${auditStatusClass(event.summary.status)}`} />
                  <div>
                    <strong>{event.summary.title}</strong>
                    <span>{event.summary.subtitle || event.eventLabel}</span>
                  </div>
                  <em>{formatDateTime(event.occurredAt) ?? 'Unknown time'}</em>
                  <span className={`status-pill ${auditStatusClass(event.summary.status)}`}>
                    {auditStatusLabel(event.summary.status)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedEvent ? (
        <AuditEventDetailModal
          event={selectedEvent}
          loadState={detailLoadState}
          message={detailMessage}
          onClose={closeDetail}
        />
      ) : null}
      {selectedBatch ? (
        <AuditBatchDetailModal
          batch={selectedBatch}
          loadState={detailLoadState}
          message={detailMessage}
          onClose={closeDetail}
        />
      ) : null}
    </>
  );
}

function AuditEventDetailModal(props: {
  event: AuditEventRecord;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onClose: () => void;
}) {
  const { event, loadState, message, onClose } = props;
  const payloadEntries = Object.entries(event.payload).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="audit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="audit-event-title">
        <div className="modal-header">
          <div>
            <h2 id="audit-event-title">
              <History size={18} />
              {event.eventLabel}
            </h2>
            <p>{event.summary.title}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <section className="audit-detail-summary">
          <IntegrationStat label="Actor" value={event.actor} />
          <IntegrationStat label="Occurred" value={formatDateTime(event.occurredAt) ?? event.occurredAt} />
          <IntegrationStat label="Status" value={auditStatusLabel(event.summary.status)} />
          <IntegrationStat label="Entity" value={`${event.entityType} · ${event.entityId}`} />
        </section>

        {message ? <div className="audit-detail-message">{message}</div> : null}

        <section className="audit-detail-body">
          <div className="surface-header compact-header">
            <div>
              <span className="section-kicker">Event payload</span>
              <h3>Recorded details</h3>
            </div>
          </div>
          {loadState === 'loading' ? (
            <div className="empty-state audit-empty-state">
              <RefreshCcw size={18} />
              <strong>Loading event details...</strong>
            </div>
          ) : payloadEntries.length === 0 ? (
            <div className="empty-state audit-empty-state">
              <Database size={18} />
              <strong>No additional payload was stored for this event.</strong>
            </div>
          ) : (
            <div className="audit-payload-grid">
              {payloadEntries.map(([key, value]) => (
                <div className="audit-payload-row" key={key}>
                  <span>{key}</span>
                  <strong>{formatAuditPayloadValue(value)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function AuditBatchDetailModal(props: {
  batch: AuditBatchDetail;
  loadState: 'idle' | 'loading' | 'ready' | 'failed';
  message: string;
  onClose: () => void;
}) {
  const { batch, loadState, message, onClose } = props;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="audit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="audit-batch-title">
        <div className="modal-header">
          <div>
            <h2 id="audit-batch-title">
              <ListChecks size={18} />
              Approval batch
            </h2>
            <p>{batch.actor} · {formatDateTime(batch.occurredAt) ?? batch.occurredAt}</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Close" type="button">
            <X size={20} />
          </button>
        </div>

        <section className="audit-detail-summary">
          <IntegrationStat label="Updates" value={batch.updateCount.toLocaleString()} />
          <IntegrationStat label="Written" value={batch.written.toLocaleString()} />
          <IntegrationStat label="Failed" value={batch.failed.toLocaleString()} />
          <IntegrationStat label="Discarded" value={batch.discarded.toLocaleString()} />
        </section>

        {message ? <div className="audit-detail-message">{message}</div> : null}

        <section className="audit-detail-body">
          <div className="surface-header compact-header">
            <div>
              <span className="section-kicker">Batch items</span>
              <h3>Approved changes</h3>
            </div>
            <span className={`status-pill ${auditStatusClass(batch.status)}`}>{auditStatusLabel(batch.status)}</span>
          </div>
          {loadState === 'loading' ? (
            <div className="empty-state audit-empty-state">
              <RefreshCcw size={18} />
              <strong>Loading batch details...</strong>
            </div>
          ) : batch.items.length === 0 ? (
            <div className="empty-state audit-empty-state">
              <ListChecks size={18} />
              <strong>No batch items were stored.</strong>
            </div>
          ) : (
            <div className="audit-batch-list">
              {batch.items.map((item) => (
                <article className="audit-batch-item" key={item.id}>
                  <div>
                    <strong>{item.customerName ?? 'Unknown customer'}</strong>
                    <span>{item.agreementName ?? 'Agreement'}</span>
                  </div>
                  <div>
                    <strong>{item.productName}</strong>
                    <span>{item.productCode}</span>
                  </div>
                  <div>
                    <strong>
                      {item.currentQuantity.toLocaleString()} → {item.proposedQuantity.toLocaleString()}
                    </strong>
                    {item.lessIncludedChanged ? (
                      <span>
                        Less {item.currentLessIncluded?.toLocaleString() ?? '0'} → {item.proposedLessIncluded?.toLocaleString() ?? '0'}
                      </span>
                    ) : null}
                  </div>
                  <span className={`status-pill ${auditStatusClass(item.status)}`}>{auditStatusLabel(item.status)}</span>
                  {item.errorMessage ? <em>{item.errorMessage}</em> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

export default App;
