export const quoteRequestStatuses = [
  'received',
  'awaiting-clarification',
  'ready-to-draft',
  'drafting',
  'awaiting-approval',
  'changes-requested',
  'approved-ready-delivery',
  'rejected',
  'failed',
] as const;

export type QuoteRequestStatus = (typeof quoteRequestStatuses)[number];

export type SalesRoleCapability =
  | 'sales.requests.read-own'
  | 'sales.requests.read-all'
  | 'sales.requests.comment'
  | 'sales.requests.request-changes'
  | 'sales.requests.approve'
  | 'sales.requests.reject'
  | 'sales.requests.retry'
  | 'sales.settings.manage';

export type SalesEvidenceReference = {
  source: 'email' | 'attachment' | 'connectwise' | 'template-rule' | 'dell-equote';
  sourceId: string;
  excerpt?: string;
};

export type QuoteCustomerResolution = {
  companyId?: number;
  companyName?: string;
  contactId?: number;
  contactName?: string;
  evidence: SalesEvidenceReference[];
};

export type QuotePlanLineSelection = {
  templateLineId: string;
  action: 'include' | 'exclude';
  quantity: number;
  rationale: string;
  evidence: SalesEvidenceReference[];
};

export type DellEquoteReference = {
  equoteNumber: string;
  version?: string;
  locale?: string;
};

export type QuotePlan = {
  schemaVersion: 1;
  customer: QuoteCustomerResolution;
  templateId?: string;
  templateVersion?: number;
  opportunity: {
    name?: string;
    notes?: string;
  };
  lineSelections: QuotePlanLineSelection[];
  dellEquote?: DellEquoteReference;
  missingFacts: string[];
  clarificationQuestions: string[];
  warnings: string[];
  evidence: SalesEvidenceReference[];
};

export type QuoteLineSnapshot = {
  lineId: string;
  source: 'template' | 'dell-equote';
  sku?: string;
  description: string;
  quantity: number;
  unitCost?: number;
  unitPrice?: number;
  listPrice?: number;
  discountPercent?: number;
  extendedCost?: number;
  extendedPrice?: number;
  included: boolean;
};

export type QuotePolicyResult = {
  passed: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  totals: {
    cost: number;
    price: number;
    marginAmount: number;
    marginPercent?: number;
  };
};

export type QuoteRevision = {
  id: string;
  quoteRequestId: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  modelDeployment?: string;
  promptVersion?: string;
  plan: QuotePlan;
  lines: QuoteLineSnapshot[];
  policy: QuotePolicyResult;
  cpqSnapshotHash?: string;
  cpqSnapshot?: unknown;
};

export type QuoteMessage = {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  graphMessageId?: string;
  internetMessageId?: string;
  senderEmail?: string;
  subject?: string;
  bodyText: string;
  receivedAt?: string;
  sentAt?: string;
  createdAt: string;
};

export type QuoteAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  extractionStatus: 'pending' | 'extracted' | 'rejected' | 'failed';
  extractionError?: string;
  createdAt: string;
};

export type QuoteDecision = {
  id: string;
  revision: number;
  decision: 'approved' | 'rejected' | 'changes-requested';
  actor: string;
  comment?: string;
  createdAt: string;
};

export type QuoteRequestSummary = {
  id: string;
  status: QuoteRequestStatus;
  subject: string;
  requesterEmail: string;
  requesterName?: string;
  companyName?: string;
  templateName?: string;
  currentRevision: number;
  opportunityId?: number;
  opportunityUrl?: string;
  cpqQuoteId?: string;
  cpqQuoteUrl?: string;
  cpqManualTransitionRequired: boolean;
  errorMessage?: string;
  receivedAt: string;
  updatedAt: string;
};

export type QuoteRequestDetail = QuoteRequestSummary & {
  conversationId?: string;
  currentPlan?: QuotePlan;
  messages: QuoteMessage[];
  attachments: QuoteAttachment[];
  revisions: QuoteRevision[];
  decisions: QuoteDecision[];
};

export type SalesTemplateRuleLine = {
  templateLineId: string;
  sku?: string;
  label: string;
  aliases: string[];
  selection: 'required' | 'optional' | 'conditional';
  mutuallyExclusiveGroup?: string;
  quantityFact?: string;
  minimumQuantity: number;
  maximumQuantity: number;
  defaultIncluded: boolean;
  condition?: string;
};

export type SalesTemplateRule = {
  id: string;
  cpqTemplateId: string;
  name: string;
  version: number;
  active: boolean;
  requiredFacts: string[];
  lines: SalesTemplateRuleLine[];
  updatedAt?: string;
  updatedBy?: string;
};

export type SalesSettings = {
  requesterAllowlist: string[];
  approverNotificationEmails: string[];
  reviewBaseUrl: string;
  defaultOpportunityTypeId?: number;
  defaultOpportunityStageId?: number;
  defaultOpportunityStatusId?: number;
  defaultOpportunityOwnerId?: number;
  cpqReadyStatus: string;
  minimumMarginPercent: number;
  maximumDiscountPercent: number;
  highValueThreshold: number;
  attachmentRetentionDays: number;
  promptVersion: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const defaultSalesSettings: SalesSettings = {
  requesterAllowlist: [],
  approverNotificationEmails: [],
  reviewBaseUrl: '',
  cpqReadyStatus: 'Ready for Delivery',
  minimumMarginPercent: 20,
  maximumDiscountPercent: 20,
  highValueThreshold: 25000,
  attachmentRetentionDays: 90,
  promptVersion: 'sales-quote-v1',
};

const allowedTransitions: Record<QuoteRequestStatus, QuoteRequestStatus[]> = {
  received: ['awaiting-clarification', 'ready-to-draft', 'failed'],
  'awaiting-clarification': ['awaiting-clarification', 'ready-to-draft', 'failed'],
  'ready-to-draft': ['drafting', 'failed'],
  drafting: ['awaiting-clarification', 'awaiting-approval', 'failed'],
  'awaiting-approval': ['changes-requested', 'approved-ready-delivery', 'rejected', 'failed'],
  'changes-requested': ['drafting', 'awaiting-clarification', 'failed'],
  'approved-ready-delivery': [],
  rejected: [],
  failed: ['received', 'awaiting-clarification', 'ready-to-draft', 'drafting'],
};

export function canTransitionQuoteRequest(from: QuoteRequestStatus, to: QuoteRequestStatus) {
  return allowedTransitions[from].includes(to);
}

export function isQuoteRequestStatus(value: unknown): value is QuoteRequestStatus {
  return typeof value === 'string' && quoteRequestStatuses.includes(value as QuoteRequestStatus);
}

export function quoteStatusLabel(status: QuoteRequestStatus) {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
