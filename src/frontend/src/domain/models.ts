export type View = 'reconcile' | 'integrations' | 'invoices' | 'agreements' | 'audit' | 'objects';

export type IssueStatus = 'needs-review' | 'ready' | 'approved' | 'blocked';
export type IntegrationStatus = 'connected' | 'degraded' | 'not-configured';
export type IntegrationTab = 'credentials' | 'sync' | 'webhook';
export type CountSource = 'api' | 'invoice' | 'connectwise' | 'manual';
export type BillingBasis = 'user' | 'device' | 'mailbox' | 'site' | 'tenant' | 'usage' | 'flat';
export type MappingConfidence = 'exact' | 'alias' | 'inferred' | 'manual' | 'unmapped';

export type ClientAccount = {
  id: string;
  connectWiseCompanyId: string;
  name: string;
  owner: string;
  status: 'active' | 'onboarding' | 'offboarding' | 'inactive';
  aliases: string[];
  tenantRefs: Array<{
    providerId: string;
    externalTenantId: string;
    displayName: string;
  }>;
};

export type Agreement = {
  id: string;
  clientId: string;
  connectWiseAgreementId: string;
  name: string;
  status: 'active' | 'draft' | 'expired';
  billingMonth: string;
  defaultCurrency: 'USD';
};

export type ProductCatalogItem = {
  id: string;
  displayName: string;
  vendorId: string;
  vendorSku?: string;
  connectWiseProductId: string;
  connectWiseProductCode: string;
  family: string;
  billingBasis: BillingBasis;
  unitCost?: number;
  unitPrice?: number;
  bundleId?: string;
  dependencyRuleIds: string[];
  aliases: string[];
  active: boolean;
};

export type ProductMapping = {
  id: string;
  vendorId: string;
  sourceSku: string;
  sourceDescription: string;
  productCatalogItemId: string;
  confidence: MappingConfidence;
  matchScore: number;
  ruleNotes: string;
  lastReviewedAt?: string;
  reviewedBy?: string;
};

export type ApiCountSnapshot = {
  id: string;
  providerId: string;
  clientId: string;
  productCatalogItemId: string;
  externalAccountId: string;
  quantity: number;
  source: CountSource;
  observedAt: string;
  rawRef: string;
  dimensions: Record<string, string | number | boolean>;
};

export type InvoiceImport = {
  id: string;
  vendorId: string;
  fileName: string;
  importedAt: string;
  invoiceDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  rowCount: number;
  matchedRows: number;
  exceptionRows: number;
  status: 'processing' | 'ready' | 'review';
};

export type InvoiceLineItem = {
  id: string;
  invoiceImportId: string;
  vendorId: string;
  clientId?: string;
  sourceCustomerName: string;
  sourceSku: string;
  sourceDescription: string;
  mappedProductCatalogItemId?: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  rawRowNumber: number;
  raw: Record<string, string | number | boolean | null>;
};

export type ReconcileIssue = {
  id: string;
  customer: string;
  agreement: string;
  vendor: string;
  product: string;
  family: string;
  serviceCode: string;
  sourceCount: number;
  invoiceCount: number;
  amount: number;
  confidence: number;
  owner: string;
  age: string;
  reason: string;
  status: IssueStatus;
  recommendation: string;
  lastSeen: string;
  audit: string[];
};

export type ReconciliationFinding = {
  id: string;
  runId: string;
  clientId: string;
  agreementId: string;
  productCatalogItemId: string;
  apiSnapshotId?: string;
  invoiceLineItemIds: string[];
  apiCount: number;
  invoiceCount: number;
  delta: number;
  financialImpact: number;
  status: IssueStatus;
  reason: string;
};

export type ReconciliationRun = {
  id: string;
  billingMonth: string;
  startedAt: string;
  completedAt?: string;
  invoiceImportIds: string[];
  apiSnapshotBatchIds: string[];
  findingIds: string[];
  status: 'draft' | 'review' | 'approved' | 'posted';
};

export type ProductRule = {
  product: string;
  vendor: string;
  cwCode: string;
  basis: string;
  bundle: string;
  rule: string;
  confidence: number;
};

export type ClientProfile = {
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

export type ClientGroup = {
  customer: string;
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

export type Integration = {
  id: string;
  name: string;
  category: string;
  status: IntegrationStatus;
  auth: string;
  description: string;
  lastSync?: string;
  latestInvoice?: string;
  frequency?: string;
  records?: string;
  scopes: string[];
  enabled: boolean;
  endpoint: string;
};

export type InvestigationTicketDraft = {
  id: string;
  clientId: string;
  agreementId: string;
  findingIds: string[];
  title: string;
  notes: string;
  requestedBy: string;
  status: 'draft' | 'created';
};
