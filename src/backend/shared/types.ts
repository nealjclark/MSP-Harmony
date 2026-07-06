export type CurrencyCode = 'USD';

export type MoneyAmount = {
  amount: number;
  currency: CurrencyCode;
};

export type BillingUnit = 'device' | 'server' | 'workstation' | 'TB' | 'GB' | 'license';

export type ReconciliationLineType = 'base-count' | 'usage-add-on' | 'unmapped-vendor';
export type ReconciliationStatus = 'matched' | 'needs-review' | 'not-billable' | 'unmapped';
export type ReconciliationWriteAction = 'update-addition' | 'create-addition' | 'review-required';

export type DimensionValue = string | number | boolean | null | undefined;
export type DimensionMap = Record<string, DimensionValue>;

export type UsageSnapshot = {
  id: string;
  vendorId: string;
  clientId: string;
  agreementId: string;
  vendorProductKey?: string;
  productCode: string;
  productName: string;
  quantity: number;
  observedAt: string;
  dimensions: DimensionMap;
};

export type AgreementAddition = {
  id: string;
  clientId: string;
  agreementId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice?: MoneyAmount;
  updatedAt?: string;
  sourceAgreementId?: string;
  sourceAgreementName?: string;
  sourceConnectWiseAgreementId?: string;
};

export type DimensionFilter = Record<string, string | number | boolean>;

export type UsageAllowance =
  | {
      kind: 'unlimited';
      metric: string;
      unit: BillingUnit;
    }
  | {
      kind: 'included';
      metric: string;
      includedQuantity: number;
      scope: 'per-agreement' | 'per-snapshot' | 'per-snapshot-pooled';
      unit: BillingUnit;
    };

export type UsageAddOnPolicy = {
  productCode: string;
  targetProductCodes?: string[];
  productName: string;
  metric: string;
  incrementQuantity: number;
  roundOverage: 'ceil' | 'floor' | 'round';
  unit: BillingUnit;
  unitPrice: MoneyAmount;
};

export type QuantityRule = {
  id: string;
  vendorId: string;
  vendorProductKey?: string;
  vendorProductKeys?: string[];
  productCode: string;
  targetProductCodes?: string[];
  productName: string;
  sourceMetric: 'snapshot-count';
  billableUnit: BillingUnit;
  dimensions?: DimensionFilter;
  unitPrice?: MoneyAmount;
  allowance?: UsageAllowance;
  addOn?: UsageAddOnPolicy;
  requiresExistingAgreementProduct?: boolean;
  notes: string;
};

export type VendorRuleSet = {
  vendorId: string;
  vendorName: string;
  rules: QuantityRule[];
};

export type ReconcileVendorUsageRequest = {
  vendorId: string;
  rules: QuantityRule[];
  snapshots: UsageSnapshot[];
  agreementAdditions: AgreementAddition[];
};

export type ReconciliationEvidence = {
  label: string;
  value: string | number;
};

export type ReconciliationLinkedCountSource = {
  sourceType: 'vendor-product' | 'connectwise-addition' | 'filtered-dataset';
  label: string;
  quantity: number;
  rowCount: number;
  vendorId?: string;
  vendorProductKey?: string;
  dataset?: string;
  productCode?: string;
};

export type ReconciliationLinkedCount = {
  ruleId: string;
  ruleName: string;
  sourceVendorProductKey: string;
  quantity: number;
  sources: ReconciliationLinkedCountSource[];
};

export type ReconciliationLine = {
  id: string;
  vendorId: string;
  clientId: string;
  agreementId: string;
  productCode: string;
  productName: string;
  lineType: ReconciliationLineType;
  ruleId: string;
  sourceQuantity: number;
  agreementQuantity: number;
  proposedQuantity: number;
  delta: number;
  unit: BillingUnit;
  unitPrice?: MoneyAmount;
  financialImpact: MoneyAmount;
  linkedCount?: ReconciliationLinkedCount;
  status: ReconciliationStatus;
  writeAction?: ReconciliationWriteAction;
  reason: string;
  evidence: ReconciliationEvidence[];
};

export type ReconciliationResult = {
  vendorId: string;
  generatedAt: string;
  lines: ReconciliationLine[];
  totals: {
    matched: number;
    needsReview: number;
    notBillable: number;
    unmapped: number;
    financialImpact: MoneyAmount;
  };
};
