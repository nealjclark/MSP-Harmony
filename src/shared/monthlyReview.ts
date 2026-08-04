import type { IntegrationId } from './integrationSettings';
import type { VendorKey } from './vendorDatapoints';

export type ReconcileWorkspaceTab = 'spotcheck' | 'monthly-review';
export type MonthlyReviewSourceKind = 'live-sync' | 'invoice-import';
export type MonthlyReviewReadinessState = 'ready' | 'warning' | 'blocked';
export type MonthlyReviewRunStatus = 'in-progress' | 'completed' | 'superseded';
export type MonthlyReviewRowType = 'agreement-addition' | 'vendor-only' | 'cw-only';
export type MonthlyReviewDisposition =
  | 'auto-passed'
  | 'needs-action'
  | 'needs-source'
  | 'approved'
  | 'applied'
  | 'skipped'
  | 'ignored'
  | 'ticketed';

export type MonthlyReviewSourceDefinition = {
  id: string;
  integrationId?: IntegrationId;
  label: string;
  sourceKind: MonthlyReviewSourceKind;
};

export const monthlyReviewSourceDefinitions: readonly MonthlyReviewSourceDefinition[] = [
  { id: 'opentext-appriver', integrationId: 'opentext-appriver', label: 'Appriver', sourceKind: 'live-sync' },
  { id: 'barracuda', label: 'Barracuda', sourceKind: 'invoice-import' },
  { id: 'cavelo', integrationId: 'cavelo', label: 'Cavelo', sourceKind: 'live-sync' },
  { id: 'cove', integrationId: 'cove', label: 'Cove', sourceKind: 'live-sync' },
  { id: 'datto', integrationId: 'datto', label: 'Datto', sourceKind: 'live-sync' },
  { id: 'huntress', integrationId: 'huntress', label: 'Huntress', sourceKind: 'live-sync' },
  { id: 'ingram-micro', integrationId: 'ingram-micro', label: 'Ingram', sourceKind: 'invoice-import' },
  { id: 'ncentral', integrationId: 'ncentral', label: 'N-Able', sourceKind: 'live-sync' },
  { id: 'nerdio', integrationId: 'nerdio', label: 'Nerdio', sourceKind: 'invoice-import' },
  { id: 'proofpoint', integrationId: 'proofpoint', label: 'Proofpoint', sourceKind: 'live-sync' },
  { id: 'sentinelone', integrationId: 'sentinelone', label: 'SentinelOne', sourceKind: 'live-sync' },
] as const;

export type MonthlyReviewReadinessSource = {
  id: string;
  vendorId?: VendorKey;
  integrationId?: IntegrationId;
  label: string;
  sourceKind: MonthlyReviewSourceKind;
  state: MonthlyReviewReadinessState;
  message: string;
  syncRunId?: string;
  invoiceImportId?: string;
  completedAt?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  canSync: boolean;
  activeJob?: boolean;
};

export type MonthlyReviewReadiness = {
  billingMonth: string;
  expectedInvoiceMonth: string;
  checkedAt: string;
  canStart: boolean;
  requiresAdminOverride: boolean;
  blockingReasons: string[];
  warningReasons: string[];
  sources: MonthlyReviewReadinessSource[];
};

export type MonthlyReviewVendorEvidence = {
  id: string;
  vendorId: VendorKey;
  label: string;
  sourceKind: MonthlyReviewSourceKind;
  syncRunId?: string;
  invoiceImportId?: string;
  vendorProductKey?: string;
  sourceAccountId?: string;
  productCode: string;
  productName: string;
  apiQuantity?: number;
  invoiceQuantity?: number;
  linkedQuantity?: number;
  proposedQuantity: number;
  rawRowIds: string[];
  evidence: Array<{ label: string; value: string | number | boolean }>;
};

export type MonthlyReviewAdditionSnapshot = {
  id: string;
  connectWiseAdditionId: string;
  connectWiseAgreementId: string;
  productCode: string;
  productName: string;
  quantity: number;
  lessIncluded?: number;
  billedQuantity?: number;
  unitPrice?: number;
  additionStatus: string;
};

export type MonthlyReviewFinding = {
  id: string;
  rowKey: string;
  rowType: MonthlyReviewRowType;
  customerId?: string;
  customerName: string;
  agreementId?: string;
  agreementName: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  selectedQuantity?: number;
  selectedSourceKey?: string;
  delta: number;
  financialImpact: number;
  disposition: MonthlyReviewDisposition;
  dispositionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  ticketIds: string[];
  writeBatchId?: string;
  additions: MonthlyReviewAdditionSnapshot[];
  vendors: MonthlyReviewVendorEvidence[];
};

export type MonthlyReviewRunSummary = {
  id: string;
  billingMonth: string;
  revision: number;
  status: MonthlyReviewRunStatus;
  startedAt: string;
  completedAt?: string;
  createdBy?: string;
  completedBy?: string;
  lockedAt?: string;
  supersedesRunId?: string;
  supersededReason?: string;
  supersededBy?: string;
  supersededAt?: string;
  freshnessOverrideReason?: string;
  findingCount: number;
  unresolvedCount: number;
  financialImpact: number;
};

export type MonthlyReviewRunDetail = {
  run: MonthlyReviewRunSummary;
  sources: MonthlyReviewReadinessSource[];
  findings: MonthlyReviewFinding[];
};

export function reconcileShortLabel(vendorId: VendorKey, fallback: string) {
  const definition = monthlyReviewSourceDefinitions.find((source) => source.id === vendorId);
  return definition?.label ?? (fallback.trim().toLowerCase() === 'barracuda' ? 'Barracuda' : fallback);
}
