import { randomUUID } from 'node:crypto';

export const azureBillingPolicyTypes = [
  'combined-avd-markup',
  'ingram-subscription-markup',
  'fixed-avd-per-user',
] as const;
export type AzureBillingPolicyType = (typeof azureBillingPolicyTypes)[number];
export const azureBillingIngramProductFamilies = ['azure-consumption', 'windows-365'] as const;
export type AzureBillingIngramProductFamily = (typeof azureBillingIngramProductFamilies)[number];
export type NerdioCountSource = 'invoice' | 'live';
export type AzureBillingDecisionType = 'policy' | 'previous-approved' | 'manual';

export type QueryResult<T> = { rows: T[] };
export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export type AzureBillingPolicy = {
  id: string;
  customerId: string;
  customerName?: string;
  agreementId: string;
  agreementName?: string;
  connectWiseAdditionId: string;
  nerdioQuantityAdditionId?: string;
  policyType: AzureBillingPolicyType;
  displayName: string;
  ingramCustomerAccountIds: string[];
  ingramProductCodes: string[];
  ingramProductFamilies: AzureBillingIngramProductFamily[];
  /** Legacy invoice evidence only. New policies map Ingram customer accounts and product SKUs. */
  ingramSubscriptionIds: string[];
  nerdioAccountIds: string[];
  nerdioBillableMetrics: string[];
  markupRate?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAzureBillingPolicyInput = {
  id?: string;
  customerId: string;
  agreementId: string;
  connectWiseAdditionId: string;
  nerdioQuantityAdditionId?: string;
  policyType: AzureBillingPolicyType;
  displayName: string;
  ingramCustomerAccountIds?: string[];
  ingramProductCodes?: string[];
  ingramProductFamilies?: AzureBillingIngramProductFamily[];
  ingramSubscriptionIds?: string[];
  nerdioAccountIds?: string[];
  nerdioBillableMetrics?: string[];
  markupRate?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  active?: boolean;
};

export type AzureBillingApprovalSettings = {
  approverEmails: string[];
  requiredApprovalCount: 1;
  updatedBy: string;
  updatedAt: string;
  eligibleApprovers: Array<{
    email: string;
    displayName?: string;
    role: 'Admin' | 'Approver';
  }>;
};

export type AzureBillingClientExclusion = {
  id: string;
  sourceType: 'ingram' | 'nerdio';
  externalAccountId: string;
  externalAccountName: string;
  reason: string;
  active: boolean;
  ignoredBy: string;
  ignoredAt: string;
  restoredBy?: string;
  restoredAt?: string;
};

export type AzureBillingSourceCatalog = {
  connectWiseCustomers: Array<{
    customerId: string;
    customerName: string;
    connectWiseCompanyId: string;
    agreements: Array<{
      agreementId: string;
      agreementName: string;
      connectWiseAgreementId: string;
      status: string;
      additions: Array<{
        connectWiseAdditionId: string;
        productCode: string;
        productName: string;
        quantity: number;
        unitPrice?: number;
        unitCost?: number;
      }>;
    }>;
  }>;
  ingramCustomers: Array<{
    customerAccountId: string;
    customerName: string;
    mappedCustomerId?: string;
    mappedAgreementId?: string;
    products: Array<{
      productCode: string;
      productName: string;
      subscriptionIds: string[];
      latestCost: number;
      family?: AzureBillingIngramProductFamily;
    }>;
  }>;
  nerdioAccounts: Array<{
    accountId: string;
    accountName: string;
    mappedCustomerId?: string;
    mappedAgreementId?: string;
    metrics: string[];
    latestBillingMonth?: string;
    latestDirectCost: number;
  }>;
};

export type AzureBillingCalculationInput = {
  policyType: AzureBillingPolicyType;
  ingramCost: number;
  nerdioCost: number;
  invoiceNerdioCount: number;
  liveNerdioCount: number;
  selectedNerdioCountSource?: NerdioCountSource;
  markupRate?: number;
  currentQuantity: number;
  currentUnitPrice?: number;
  currentUnitCost?: number;
  previousApprovedQuantity?: number;
  previousApprovedUnitPrice?: number;
  previousApprovedUnitCost?: number;
  decisionType?: AzureBillingDecisionType;
  manualQuantity?: number;
  manualUnitPrice?: number;
  manualUnitCost?: number;
};

export type AzureBillingCalculation = {
  selectedNerdioCountSource?: NerdioCountSource;
  selectedNerdioCount: number;
  combinedCost: number;
  proposedQuantity: number;
  proposedUnitPrice?: number;
  proposedUnitCost?: number;
  projectedRevenue: number;
  projectedMargin: number;
  varianceFlags: string[];
};

export type AzureBillingRunSummary = {
  id: string;
  billingMonth: string;
  status: string;
  requestedBy: string;
  shadowAcceptedBy?: string;
  shadowAcceptedAt?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
  resultCount: number;
  needsReviewCount: number;
  approvedCount: number;
  heldCount: number;
  failedCount: number;
  ingramCost: number;
  nerdioCost: number;
  combinedCost: number;
  sourceCost: number;
  billedTotal: number;
  projectedRevenue: number;
  projectedMargin: number;
};

export type AzureBillingIngramReadiness = {
  billingMonth: string;
  expectedReleaseDate: string;
  status: 'ready' | 'before-release' | 'due' | 'missing-history';
  ready: boolean;
  message: string;
  invoiceImportId?: string;
  invoiceDate?: string;
  lineCount: number;
  invoiceCost: number;
};

export type AzureBillingIngramChange = {
  status: 'new' | 'removed' | 'changed' | 'same';
  productCode: string;
  productName: string;
  subscriptionId?: string;
  unitCost?: number;
  previousQuantity: number;
  currentQuantity: number;
  quantityChange: number;
  previousCost: number;
  currentCost: number;
  costChange: number;
};

export type AzureBillingResult = {
  id: string;
  billingRunId: string;
  policyId: string;
  customerId: string;
  customerName: string;
  agreementId: string;
  agreementName: string;
  connectWiseAgreementId: string;
  connectWiseAdditionId: string;
  nerdioQuantityAdditionId?: string;
  nerdioQuantityCurrentQuantity?: number;
  nerdioQuantityProposedQuantity?: number;
  nerdioQuantityUnitPrice?: number;
  nerdioQuantityUnitCost?: number;
  policyType: AzureBillingPolicyType;
  policyDisplayName: string;
  revision: number;
  status: string;
  decisionType: AzureBillingDecisionType;
  selectedNerdioCountSource?: NerdioCountSource;
  invoiceNerdioCount: number;
  liveNerdioCount?: number;
  selectedNerdioCount: number;
  ingramCost: number;
  nerdioCost: number;
  combinedCost: number;
  markupRate?: number;
  currentQuantity: number;
  proposedQuantity: number;
  currentUnitPrice?: number;
  proposedUnitPrice?: number;
  currentUnitCost?: number;
  proposedUnitCost?: number;
  previousApprovedQuantity?: number;
  previousApprovedUnitPrice?: number;
  previousApprovedUnitCost?: number;
  externalPreTaxOverride?: number;
  externalPreTaxSuggestedBy?: string;
  externalBeforeTax: number;
  effectiveMarkupRate?: number;
  projectedRevenue: number;
  projectedMargin: number;
  reviewerNote?: string;
  holdReason?: string;
  varianceFlags: string[];
  sourceEvidence: Record<string, unknown>;
  connectWiseSnapshot: Record<string, unknown>;
  ingramComparisonMonth?: string;
  ingramChanges: AzureBillingIngramChange[];
  approvals: Array<{
    reviewerEmail: string;
    reviewerName: string;
    decision: 'approved' | 'rejected';
    comment?: string;
    createdAt: string;
  }>;
  history?: Array<{
    billingMonth: string;
    status: string;
    quantity: number;
    unitPrice?: number;
    unitCost?: number;
    invoiceNerdioCount: number;
    liveNerdioCount?: number;
    ingramCost: number;
    nerdioCost: number;
    combinedCost: number;
    assignedMarkupRate?: number;
    externalPreTaxOverride?: number;
    effectiveMarkupRate?: number;
    projectedRevenue: number;
    projectedMargin: number;
  }>;
};

type PolicyRow = {
  id: string;
  customer_id: string;
  customer_name?: string | null;
  agreement_id: string;
  agreement_name?: string | null;
  connectwise_addition_id: string;
  nerdio_quantity_addition_id: string | null;
  policy_type: string;
  display_name: string;
  ingram_customer_account_ids: unknown;
  ingram_product_codes: unknown;
  ingram_product_families: unknown;
  ingram_subscription_ids: unknown;
  nerdio_account_ids: unknown;
  nerdio_billable_metrics: unknown;
  markup_rate: string | number | null;
  effective_from: Date | string;
  effective_to: Date | string | null;
  assigned_reviewer_emails: unknown;
  active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type RunRow = {
  id: string;
  billing_month: string;
  status: string;
  requested_by: string;
  shadow_accepted_by: string | null;
  shadow_accepted_at: Date | string | null;
  released_by: string | null;
  released_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  result_count: string | number;
  needs_review_count: string | number;
  approved_count: string | number;
  held_count: string | number;
  failed_count: string | number;
  ingram_cost: string | number;
  nerdio_cost: string | number;
  combined_cost: string | number;
  source_cost: string | number;
  billed_total: string | number;
  projected_revenue: string | number;
  projected_margin: string | number;
};

type ResultRow = {
  id: string;
  billing_run_id: string;
  policy_id: string;
  customer_id: string;
  customer_name: string;
  agreement_id: string;
  agreement_name: string;
  connectwise_agreement_id: string;
  connectwise_addition_id: string;
  policy_type: string;
  policy_display_name: string;
  revision: string | number;
  status: string;
  decision_type: string;
  selected_nerdio_count_source: string | null;
  invoice_nerdio_count: string | number;
  live_nerdio_count: string | number;
  selected_nerdio_count: string | number;
  ingram_cost: string | number;
  nerdio_cost: string | number;
  combined_cost: string | number;
  markup_rate: string | number | null;
  current_quantity: string | number;
  proposed_quantity: string | number;
  current_unit_price: string | number | null;
  proposed_unit_price: string | number | null;
  current_unit_cost: string | number | null;
  proposed_unit_cost: string | number | null;
  previous_approved_quantity: string | number | null;
  previous_approved_unit_price: string | number | null;
  previous_approved_unit_cost: string | number | null;
  external_pre_tax_override: string | number | null;
  external_pre_tax_suggested_by: string | null;
  projected_revenue: string | number;
  projected_margin: string | number;
  reviewer_note: string | null;
  hold_reason: string | null;
  variance_flags: unknown;
  source_evidence: unknown;
  connectwise_snapshot: unknown;
};

type ApprovalRow = {
  billing_result_id: string;
  reviewer_email: string;
  reviewer_name: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  created_at: Date | string;
};

const requiredApprovalCount = 1;
const cents = 2;
const sourcePrecision = 4;

export function calculateAzureBillingResult(input: AzureBillingCalculationInput): AzureBillingCalculation {
  assertFinite(input.ingramCost, 'Ingram cost');
  assertFinite(input.nerdioCost, 'Nerdio cost');
  assertFiniteNonNegative(input.invoiceNerdioCount, 'Nerdio invoice count');
  assertFiniteNonNegative(input.liveNerdioCount, 'Nerdio live count');

  const combinedCost = round(input.ingramCost + input.nerdioCost, sourcePrecision);
  const selectedNerdioCountSource =
    input.policyType === 'fixed-avd-per-user'
      ? input.selectedNerdioCountSource ??
        (input.liveNerdioCount > input.invoiceNerdioCount ? 'live' : 'invoice')
      : undefined;
  const selectedNerdioCount =
    selectedNerdioCountSource === 'live'
      ? input.liveNerdioCount
      : selectedNerdioCountSource === 'invoice'
        ? input.invoiceNerdioCount
        : 0;
  const decisionType = input.decisionType ?? 'policy';
  const varianceFlags: string[] = [];
  if (input.ingramCost < 0 || input.nerdioCost < 0) varianceFlags.push('source-credit-exceeds-charges');
  if (combinedCost < 0) varianceFlags.push('negative-combined-cost');

  let proposedQuantity: number;
  let proposedUnitPrice: number | undefined;
  let proposedUnitCost: number | undefined;

  if (input.policyType === 'fixed-avd-per-user') {
    proposedQuantity = round(selectedNerdioCount, sourcePrecision);
    proposedUnitPrice = optionalRound(input.currentUnitPrice, cents);
    proposedUnitCost = proposedQuantity > 0 ? round(combinedCost / proposedQuantity, cents) : undefined;
    if (proposedQuantity === 0) varianceFlags.push('zero-selected-count');
  } else {
    const cost = input.policyType === 'ingram-subscription-markup' ? round(input.ingramCost, sourcePrecision) : combinedCost;
    if (!Number.isFinite(input.markupRate) || (input.markupRate ?? -1) < 0) {
      varianceFlags.push('missing-markup-rate');
    }
    proposedQuantity = 1;
    proposedUnitCost = round(cost, cents);
    proposedUnitPrice = round(cost * (1 + Math.max(0, input.markupRate ?? 0)), cents);
  }

  if (decisionType === 'previous-approved') {
    if (
      input.previousApprovedQuantity === undefined ||
      input.previousApprovedUnitCost === undefined ||
      (input.policyType !== 'fixed-avd-per-user' && input.previousApprovedUnitPrice === undefined)
    ) {
      throw new Error('A previous approved result is not available for this policy.');
    }
    proposedQuantity = round(input.previousApprovedQuantity, sourcePrecision);
    proposedUnitPrice =
      input.policyType === 'fixed-avd-per-user'
        ? optionalRound(input.currentUnitPrice, cents)
        : optionalRound(input.previousApprovedUnitPrice, cents);
    proposedUnitCost = optionalRound(input.previousApprovedUnitCost, cents);
  }

  if (decisionType === 'manual') {
    if (!Number.isFinite(input.manualQuantity) || (input.manualQuantity ?? -1) < 0) {
      throw new Error('Manual quantity must be zero or greater.');
    }
    if (!Number.isFinite(input.manualUnitCost) || (input.manualUnitCost ?? -1) < 0) {
      throw new Error('Manual unit cost must be zero or greater.');
    }
    proposedQuantity = round(input.manualQuantity ?? 0, sourcePrecision);
    proposedUnitCost = round(input.manualUnitCost ?? 0, cents);
    proposedUnitPrice =
      input.policyType === 'fixed-avd-per-user'
        ? optionalRound(input.currentUnitPrice, cents)
        : optionalRound(input.manualUnitPrice, cents);
    if (input.policyType !== 'fixed-avd-per-user' && proposedUnitPrice === undefined) {
      throw new Error('Manual unit price is required for a pass-through policy.');
    }
  }

  const projectedRevenue = round(proposedQuantity * (proposedUnitPrice ?? 0), cents);
  const projectedCost = round(proposedQuantity * (proposedUnitCost ?? 0), cents);
  const projectedMargin = round(projectedRevenue - projectedCost, cents);
  if (combinedCost === 0) varianceFlags.push('zero-source-cost');

  return {
    selectedNerdioCountSource,
    selectedNerdioCount: round(selectedNerdioCount, sourcePrecision),
    combinedCost,
    proposedQuantity,
    proposedUnitPrice,
    proposedUnitCost,
    projectedRevenue,
    projectedMargin,
    varianceFlags,
  };
}

export function applyExternalPreTaxTotal(
  combinedCost: number,
  quantity: number,
  externalBeforeTax: number,
) {
  assertFinite(combinedCost, 'Combined vendor cost');
  assertFiniteNonNegative(quantity, 'ConnectWise quantity');
  assertFiniteNonNegative(externalBeforeTax, 'External pre-tax total');
  return {
    proposedUnitPrice: quantity > 0 ? round(externalBeforeTax / quantity, cents) : undefined,
    proposedUnitCost: quantity > 0 ? round(combinedCost / quantity, cents) : undefined,
    projectedRevenue: round(externalBeforeTax, cents),
    projectedMargin: round(externalBeforeTax - combinedCost, cents),
    effectiveMarkupRate: effectiveMarkupRate(externalBeforeTax, combinedCost),
  };
}

export function sumNerdioClientInvoiceLines(
  items: Record<string, unknown>[],
  accountIdsOrNames: string[],
) {
  const selectedAccounts = new Set(accountIdsOrNames.map((value) => value.trim()).filter(Boolean));
  return round(items.reduce((total, item) => {
    const accountId = String(item.accountId ?? item.account_id ?? '').trim();
    const accountName = String(item.accountName ?? item.account_name ?? '').trim();
    if (!selectedAccounts.has(accountId) && !selectedAccounts.has(accountName)) return total;
    const value = Number(item.value ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0), sourcePrecision);
}

export function compareAzureBillingIngramLines(
  currentItems: Record<string, unknown>[],
  previousItems: Record<string, unknown>[],
): AzureBillingIngramChange[] {
  type Total = {
    productCode: string;
    productName: string;
    subscriptionId?: string;
    quantity: number;
    cost: number;
    unitCost?: number;
  };
  const aggregate = (items: Record<string, unknown>[]) => {
    const totals = new Map<string, Total>();
    for (const item of items) {
      const productCode = String(item.productCode ?? item.product_code ?? '').trim();
      const rawProductName = String(item.productName ?? item.product_name ?? productCode ?? 'Ingram product').trim();
      const productName = rawProductName.split(/\s+from\s+/i)[0]?.trim() || rawProductName || 'Ingram product';
      const subscriptionId = String(item.subscriptionId ?? item.subscription_id ?? '').trim() || undefined;
      const key = `${subscriptionId ?? ''}\u0000${productCode}\u0000${productName}`;
      const current = totals.get(key) ?? {
        productCode,
        productName,
        subscriptionId,
        quantity: 0,
        cost: 0,
        unitCost: undefined,
      };
      current.quantity = round(current.quantity + finiteNumber(item.quantity), sourcePrecision);
      current.cost = round(
        current.cost + finiteNumber(item.extendedCost ?? item.extended_cost ?? item.value),
        sourcePrecision,
      );
      const unitCost = optionalFiniteNumber(item.unitCost ?? item.unit_cost ?? item.rate);
      if (unitCost !== undefined) current.unitCost = unitCost;
      totals.set(key, current);
    }
    return totals;
  };
  const current = aggregate(currentItems);
  const previous = aggregate(previousItems);
  const statusRank = { new: 0, changed: 1, removed: 2, same: 3 } as const;
  return [...new Set([...current.keys(), ...previous.keys()])]
    .map((key): AzureBillingIngramChange => {
      const currentItem = current.get(key);
      const previousItem = previous.get(key);
      const currentQuantity = currentItem?.quantity ?? 0;
      const previousQuantity = previousItem?.quantity ?? 0;
      const currentCost = currentItem?.cost ?? 0;
      const previousCost = previousItem?.cost ?? 0;
      const quantityChange = round(currentQuantity - previousQuantity, sourcePrecision);
      const costChange = round(currentCost - previousCost, sourcePrecision);
      const unchanged = Math.abs(quantityChange) < 0.0001 && Math.abs(costChange) < 0.0001;
      return {
        status: !previousItem ? 'new' : !currentItem ? 'removed' : unchanged ? 'same' : 'changed',
        productCode: currentItem?.productCode ?? previousItem?.productCode ?? '',
        productName: currentItem?.productName ?? previousItem?.productName ?? 'Ingram product',
        subscriptionId: currentItem?.subscriptionId ?? previousItem?.subscriptionId,
        unitCost: currentItem?.unitCost ?? previousItem?.unitCost,
        previousQuantity,
        currentQuantity,
        quantityChange,
        previousCost,
        currentCost,
        costChange,
      };
    })
    .sort((left, right) =>
      statusRank[left.status] - statusRank[right.status]
      || Math.abs(right.costChange) - Math.abs(left.costChange)
      || left.productName.localeCompare(right.productName));
}

export async function listAzureBillingPolicies(
  database: Queryable,
  options: { activeOnly?: boolean } = {},
): Promise<AzureBillingPolicy[]> {
  const result = await database.query<PolicyRow>(
    `select
       policies.*,
       customers.name as customer_name,
       agreements.name as agreement_name
     from azure_billing_policies policies
     inner join customers on customers.id = policies.customer_id
     inner join agreements on agreements.id = policies.agreement_id
     where ($1::boolean = false or policies.active = true)
     order by customers.name, agreements.name, policies.display_name, policies.effective_from desc`,
    [options.activeOnly ?? false],
  );
  return result.rows.map(mapPolicyRow);
}

export async function getAzureBillingApprovalSettings(
  database: Queryable,
): Promise<AzureBillingApprovalSettings> {
  const [settingsResult, usersResult] = await Promise.all([
    database.query<{
      approver_emails: unknown;
      updated_by: string;
      updated_at: Date | string;
    }>(
      `select approver_emails, updated_by, updated_at
       from azure_billing_settings
       where settings_key = 'default'`,
    ),
    database.query<{
      email: string;
      display_name: string | null;
      role: 'Admin' | 'Approver';
    }>(
      `select email, display_name, role
       from app_users
       where status = 'active'
         and role in ('Admin', 'Approver')
       order by coalesce(nullif(display_name, ''), email), email`,
    ),
  ]);
  const settings = settingsResult.rows[0];
  return {
    approverEmails: asStringArray(settings?.approver_emails).map((value) => value.toLowerCase()),
    requiredApprovalCount,
    updatedBy: settings?.updated_by ?? 'migration',
    updatedAt: settings ? isoDate(settings.updated_at) : new Date(0).toISOString(),
    eligibleApprovers: usersResult.rows.map((user) => ({
      email: user.email.toLowerCase(),
      displayName: user.display_name ?? undefined,
      role: user.role,
    })),
  };
}

export async function updateAzureBillingApprovalSettings(
  database: Queryable,
  input: { approverEmails?: string[] },
  actor: string,
): Promise<AzureBillingApprovalSettings> {
  const approverEmails = uniqueStrings(input.approverEmails).map((value) => value.toLowerCase());
  if (approverEmails.length === 0) {
    throw new Error('Select at least one Azure Billing approver.');
  }
  const eligibleResult = await database.query<{ email: string }>(
    `select lower(email) as email
     from app_users
     where status = 'active'
       and role in ('Admin', 'Approver')
       and lower(email) = any($1::text[])`,
    [approverEmails],
  );
  const eligibleEmails = new Set(eligibleResult.rows.map((row) => row.email));
  const ineligibleEmails = approverEmails.filter((email) => !eligibleEmails.has(email));
  if (ineligibleEmails.length > 0) {
    throw new Error(`Azure Billing approvers must be active Admin or Approver users: ${ineligibleEmails.join(', ')}.`);
  }
  await database.query(
    `insert into azure_billing_settings (settings_key, approver_emails, updated_by)
     values ('default', $1::jsonb, $2)
     on conflict (settings_key) do update set
       approver_emails = excluded.approver_emails,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [JSON.stringify(approverEmails), actor],
  );
  await insertAuditEvent(database, actor, 'azure-billing.approvers.updated', 'azure_billing_settings', 'default', {
    approverEmails,
    requiredApprovalCount,
  });
  return getAzureBillingApprovalSettings(database);
}

export async function listAzureBillingClientExclusions(
  database: Queryable,
): Promise<AzureBillingClientExclusion[]> {
  const result = await database.query<{
    id: string;
    source_type: 'ingram' | 'nerdio';
    external_account_id: string;
    external_account_name: string;
    reason: string;
    active: boolean;
    ignored_by: string;
    ignored_at: Date | string;
    restored_by: string | null;
    restored_at: Date | string | null;
  }>(
    `select id, source_type, external_account_id, external_account_name, reason, active,
            ignored_by, ignored_at, restored_by, restored_at
     from azure_billing_client_exclusions
     order by active desc, external_account_name, source_type`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    reason: row.reason,
    active: row.active,
    ignoredBy: row.ignored_by,
    ignoredAt: isoDate(row.ignored_at),
    restoredBy: row.restored_by ?? undefined,
    restoredAt: row.restored_at ? isoDate(row.restored_at) : undefined,
  }));
}

export async function ignoreAzureBillingClientSource(
  database: Queryable,
  input: {
    sourceType: 'ingram' | 'nerdio';
    externalAccountId: string;
    externalAccountName: string;
    reason: string;
  },
  actor: string,
) {
  if (!['ingram', 'nerdio'].includes(input.sourceType)) throw new Error('Invalid Azure Billing source type.');
  if (!input.externalAccountId.trim() || !input.externalAccountName.trim()) {
    throw new Error('The detected source account is required.');
  }
  if (!input.reason.trim()) throw new Error('A reason is required to ignore an Azure Billing client.');
  const result = await database.query<{ id: string }>(
    `insert into azure_billing_client_exclusions (
       source_type, external_account_id, external_account_name, reason, active, ignored_by
     )
     values ($1, $2, $3, $4, true, $5)
     on conflict (source_type, external_account_id) do update set
       external_account_name = excluded.external_account_name,
       reason = excluded.reason,
       active = true,
       ignored_by = excluded.ignored_by,
       ignored_at = now(),
       restored_by = null,
       restored_at = null,
       updated_at = now()
     returning id`,
    [
      input.sourceType,
      input.externalAccountId.trim(),
      input.externalAccountName.trim(),
      input.reason.trim(),
      actor,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to ignore the Azure Billing client source.');
  await insertAuditEvent(database, actor, 'azure-billing.client-source.ignored', 'azure_billing_client_exclusion', id, input);
  return listAzureBillingClientExclusions(database);
}

export async function restoreAzureBillingClientSource(
  database: Queryable,
  exclusionId: string,
  actor: string,
) {
  const result = await database.query<{ id: string; source_type: string; external_account_id: string }>(
    `update azure_billing_client_exclusions
     set active = false,
         restored_by = $2,
         restored_at = now(),
         updated_at = now()
     where id = $1::uuid
       and active = true
     returning id, source_type, external_account_id`,
    [exclusionId, actor],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The Azure Billing client exclusion was not found or is already restored.');
  await insertAuditEvent(
    database,
    actor,
    'azure-billing.client-source.restored',
    'azure_billing_client_exclusion',
    row.id,
    { sourceType: row.source_type, externalAccountId: row.external_account_id },
  );
  return listAzureBillingClientExclusions(database);
}

export async function listAzureBillingSourceCatalog(database: Queryable): Promise<AzureBillingSourceCatalog> {
  const [connectWiseResult, ingramResult, nerdioResult] = await Promise.all([
    database.query<{
      customer_id: string;
      customer_name: string;
      connectwise_company_id: string;
      agreement_id: string | null;
      agreement_name: string | null;
      connectwise_agreement_id: string | null;
      agreement_status: string | null;
      connectwise_addition_id: string | null;
      product_code: string | null;
      product_name: string | null;
      quantity: string | number | null;
      unit_price: string | number | null;
      unit_cost: string | number | null;
    }>(
      `select
         customers.id as customer_id,
         customers.name as customer_name,
         customers.connectwise_company_id,
         agreements.id as agreement_id,
         agreements.name as agreement_name,
         agreements.connectwise_agreement_id,
         agreements.status as agreement_status,
         agreement_additions.connectwise_addition_id,
         agreement_additions.product_code,
         agreement_additions.product_name,
         agreement_additions.quantity,
         agreement_additions.unit_price,
         nullif(agreement_additions.raw_payload->>'unitCost', '')::numeric as unit_cost
       from customers
       left join agreements
         on agreements.customer_id = customers.id
        and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       left join agreement_additions
         on agreement_additions.agreement_id = agreements.id
        and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
        and coalesce(agreement_additions.raw_payload->>'additionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       where coalesce(customers.status, '') !~* 'inactive'
       order by customers.name, agreements.name, agreement_additions.product_name, agreement_additions.product_code`,
    ),
    database.query<{
      customer_account_id: string;
      customer_name: string;
      mapped_customer_id: string | null;
      mapped_agreement_id: string | null;
      product_code: string;
      product_name: string;
      subscription_ids: unknown;
      latest_cost: string | number;
    }>(
      `with latest_import as (
         select id
         from invoice_imports
         where vendor_id = 'ingram-micro'
         order by invoice_date desc nulls last, imported_at desc
         limit 1
       )
       select
         invoice_line_items.external_account_id as customer_account_id,
         coalesce(max(nullif(invoice_line_items.external_account_name, '')), invoice_line_items.external_account_id) as customer_name,
         max(vendor_account_mappings.customer_id::text) as mapped_customer_id,
         max(vendor_account_mappings.agreement_id::text) as mapped_agreement_id,
         invoice_line_items.product_code,
         coalesce(
           max(nullif(invoice_line_items.raw_payload->>'SUBSCRIPTION_NAME', '')),
           max(nullif(invoice_line_items.product_name, '')),
           invoice_line_items.product_code
         ) as product_name,
         coalesce(
           jsonb_agg(distinct invoice_line_items.raw_payload->>'SUBSCRIPTION_ID')
             filter (where nullif(invoice_line_items.raw_payload->>'SUBSCRIPTION_ID', '') is not null),
           '[]'::jsonb
         ) as subscription_ids,
         coalesce(sum(invoice_line_items.billed_amount), 0) as latest_cost
       from invoice_line_items
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'ingram-micro'
        and vendor_account_mappings.external_account_id = invoice_line_items.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where invoice_line_items.vendor_id = 'ingram-micro'
         and invoice_import_id = (select id from latest_import)
         and nullif(invoice_line_items.external_account_id, '') is not null
       group by invoice_line_items.external_account_id, invoice_line_items.product_code
       order by customer_name, product_name`,
    ),
    database.query<{
      account_id: string;
      account_name: string;
      mapped_customer_id: string | null;
      mapped_agreement_id: string | null;
      metrics: unknown;
      latest_billing_month: Date | string | null;
      latest_direct_cost: string | number;
    }>(
      `with latest_invoice_sync as (
         select id
         from sync_runs
         where integration_id = 'nerdio'
           and status = 'complete'
           and metadata->>'entity' = 'nerdio-invoices'
         order by completed_at desc nulls last, started_at desc
         limit 1
       ),
       latest_period as (
         select max(billing_period_start) as billing_period_start
         from nerdio_invoice_items
         where sync_run_id = (select id from latest_invoice_sync)
           and account_id is not null
       ),
       period_items as (
         select *
         from nerdio_invoice_items
         where sync_run_id = (select id from latest_invoice_sync)
           and billing_period_start = (select billing_period_start from latest_period)
       ),
       account_totals as (
         select
           account_id,
           coalesce(max(nullif(account_name, '')), account_id) as account_name,
           coalesce(
             jsonb_agg(distinct lower(metric)) filter (where nullif(metric, '') is not null),
             '[]'::jsonb
           ) as metrics,
           min(billing_period_start) as latest_billing_month,
           coalesce(sum(value), 0) as direct_cost
         from period_items
         where account_id is not null
         group by account_id
       )
       select
         account_totals.account_id,
         account_totals.account_name,
         max(vendor_account_mappings.customer_id::text) as mapped_customer_id,
         max(vendor_account_mappings.agreement_id::text) as mapped_agreement_id,
         account_totals.metrics,
         account_totals.latest_billing_month,
         account_totals.direct_cost as latest_direct_cost
       from account_totals
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'nerdio'
        and vendor_account_mappings.external_account_id = account_totals.account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       group by
         account_totals.account_id,
         account_totals.account_name,
         account_totals.metrics,
         account_totals.latest_billing_month,
         account_totals.direct_cost
       order by account_name`,
    ),
  ]);
  const connectWiseCustomers = new Map<string, AzureBillingSourceCatalog['connectWiseCustomers'][number]>();
  for (const row of connectWiseResult.rows) {
    const customer = connectWiseCustomers.get(row.customer_id) ?? {
      customerId: row.customer_id,
      customerName: row.customer_name,
      connectWiseCompanyId: row.connectwise_company_id,
      agreements: [],
    };
    if (row.agreement_id && row.agreement_name && row.connectwise_agreement_id) {
      let agreement = customer.agreements.find((item) => item.agreementId === row.agreement_id);
      if (!agreement) {
        agreement = {
          agreementId: row.agreement_id,
          agreementName: row.agreement_name,
          connectWiseAgreementId: row.connectwise_agreement_id,
          status: row.agreement_status ?? 'Active',
          additions: [],
        };
        customer.agreements.push(agreement);
      }
      if (row.connectwise_addition_id && row.product_code && row.product_name) {
        agreement.additions.push({
          connectWiseAdditionId: row.connectwise_addition_id,
          productCode: row.product_code,
          productName: row.product_name,
          quantity: numericValue(row.quantity),
          unitPrice: nullableNumber(row.unit_price),
          unitCost: nullableNumber(row.unit_cost),
        });
      }
    }
    connectWiseCustomers.set(row.customer_id, customer);
  }
  const customers = new Map<string, AzureBillingSourceCatalog['ingramCustomers'][number]>();
  for (const row of ingramResult.rows) {
    const key = row.customer_account_id;
    const customer = customers.get(key) ?? {
      customerAccountId: row.customer_account_id,
      customerName: row.customer_name,
      mappedCustomerId: row.mapped_customer_id ?? undefined,
      mappedAgreementId: row.mapped_agreement_id ?? undefined,
      products: [],
    };
    customer.products.push({
      productCode: row.product_code,
      productName: row.product_name,
      subscriptionIds: asStringArray(row.subscription_ids),
      latestCost: round(numericValue(row.latest_cost), sourcePrecision),
      family: classifyAzureBillingIngramProduct(row.product_code, row.product_name),
    });
    customers.set(key, customer);
  }
  return {
    connectWiseCustomers: [...connectWiseCustomers.values()].filter((customer) => customer.agreements.length > 0),
    ingramCustomers: [...customers.values()],
    nerdioAccounts: nerdioResult.rows.map((row) => ({
      accountId: row.account_id,
      accountName: row.account_name,
      mappedCustomerId: row.mapped_customer_id ?? undefined,
      mappedAgreementId: row.mapped_agreement_id ?? undefined,
      metrics: asStringArray(row.metrics),
      latestBillingMonth: row.latest_billing_month ? isoDate(row.latest_billing_month).slice(0, 7) : undefined,
      latestDirectCost: round(numericValue(row.latest_direct_cost), sourcePrecision),
    })),
  };
}

export async function upsertAzureBillingPolicy(
  database: Queryable,
  input: UpsertAzureBillingPolicyInput,
  actor: string,
): Promise<AzureBillingPolicy> {
  validatePolicyInput(input);
  const id = input.id ?? randomUUID();
  const ingramCustomerAccountIds = uniqueStrings(
    input.ingramCustomerAccountIds?.length ? input.ingramCustomerAccountIds : input.ingramSubscriptionIds,
  );
  const ingramProductCodes = uniqueStrings(input.ingramProductCodes);
  const ingramProductFamilies = uniqueStrings(input.ingramProductFamilies)
    .filter((family): family is AzureBillingIngramProductFamily =>
      azureBillingIngramProductFamilies.includes(family as AzureBillingIngramProductFamily));
  if (input.nerdioQuantityAdditionId) {
    const quantityAddition = await database.query<{ id: string }>(
      `select id
       from agreement_additions
       where agreement_id = $1
         and connectwise_addition_id = $2
         and addition_status !~* 'expired|cancelled|canceled|inactive'
       limit 1`,
      [input.agreementId, input.nerdioQuantityAdditionId],
    );
    if (!quantityAddition.rows[0]) {
      throw new Error('The Nerdio user-count addition must be an active addition on the selected agreement.');
    }
  }
  const ambiguous = await database.query<{ id: string; display_name: string }>(
    `select policies.id, policies.display_name
     from azure_billing_policies policies
     where policies.active = true
       and policies.id <> $1::uuid
       and daterange(
         policies.effective_from,
         coalesce(policies.effective_to, 'infinity'::date),
         '[]'
       ) && daterange($2::date, coalesce($3::date, 'infinity'::date), '[]')
       and (
         (
           exists (
             select 1
             from jsonb_array_elements_text(policies.ingram_customer_account_ids) account_id
             where account_id = any($4::text[])
           )
           and (
             (
               jsonb_array_length(policies.ingram_product_codes) = 0
               and jsonb_array_length(policies.ingram_product_families) = 0
             )
             or (cardinality($5::text[]) = 0 and cardinality($6::text[]) = 0)
             or exists (
               select 1
               from jsonb_array_elements_text(policies.ingram_product_codes) product_code
               where product_code = any($5::text[])
             )
             or exists (
               select 1
               from jsonb_array_elements_text(policies.ingram_product_families) family
               where family = any($6::text[])
             )
           )
         )
         or exists (
           select 1
           from jsonb_array_elements_text(policies.nerdio_account_ids) account_id
           where account_id = any($7::text[])
         )
       )
     limit 1`,
    [
      id,
      input.effectiveFrom,
      input.effectiveTo ?? null,
      ingramCustomerAccountIds,
      ingramProductCodes,
      ingramProductFamilies,
      uniqueStrings(input.nerdioAccountIds),
    ],
  );
  if (ambiguous.rows[0]) {
    throw new Error(`This source mapping overlaps the effective policy "${ambiguous.rows[0].display_name}".`);
  }
  const result = await database.query<PolicyRow>(
    `insert into azure_billing_policies (
       id, customer_id, agreement_id, connectwise_addition_id, policy_type, display_name,
       ingram_customer_account_ids, ingram_product_codes, ingram_product_families, ingram_subscription_ids,
       nerdio_account_ids, nerdio_billable_metrics, markup_rate,
       effective_from, effective_to, assigned_reviewer_emails, active, created_by, updated_by,
       nerdio_quantity_addition_id
     )
     values (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
       $11::jsonb, $12::jsonb, $13,
       $14::date, $15::date, $16::jsonb, $17, $18, $18,
       $19
     )
     on conflict (id) do update set
       customer_id = excluded.customer_id,
       agreement_id = excluded.agreement_id,
       connectwise_addition_id = excluded.connectwise_addition_id,
       policy_type = excluded.policy_type,
       display_name = excluded.display_name,
       ingram_customer_account_ids = excluded.ingram_customer_account_ids,
       ingram_product_codes = excluded.ingram_product_codes,
       ingram_product_families = excluded.ingram_product_families,
       ingram_subscription_ids = excluded.ingram_subscription_ids,
       nerdio_account_ids = excluded.nerdio_account_ids,
       nerdio_billable_metrics = excluded.nerdio_billable_metrics,
       markup_rate = excluded.markup_rate,
       effective_from = excluded.effective_from,
       effective_to = excluded.effective_to,
       assigned_reviewer_emails = excluded.assigned_reviewer_emails,
       nerdio_quantity_addition_id = excluded.nerdio_quantity_addition_id,
       active = excluded.active,
       updated_by = excluded.updated_by,
       updated_at = now()
     returning *`,
    [
      id,
      input.customerId,
      input.agreementId,
      input.connectWiseAdditionId.trim(),
      input.policyType,
      input.displayName.trim(),
      JSON.stringify(ingramCustomerAccountIds),
      JSON.stringify(ingramProductCodes),
      JSON.stringify(ingramProductFamilies),
      JSON.stringify(uniqueStrings(input.ingramSubscriptionIds)),
      JSON.stringify(uniqueStrings(input.nerdioAccountIds)),
      JSON.stringify(uniqueStrings(input.nerdioBillableMetrics ?? ['avd', 'cpc'])),
      input.markupRate ?? null,
      input.effectiveFrom,
      input.effectiveTo ?? null,
      JSON.stringify([]),
      input.active ?? true,
      actor,
      input.policyType === 'fixed-avd-per-user'
        ? input.nerdioQuantityAdditionId?.trim() || null
        : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Unable to save Azure billing policy.');
  await savePolicyAccountMappings(database, {
    customerId: input.customerId,
    agreementId: input.agreementId,
    ingramCustomerAccountIds,
    nerdioAccountIds: uniqueStrings(input.nerdioAccountIds),
    actor,
  });
  await insertAuditEvent(database, actor, 'azure-billing.policy.saved', 'azure_billing_policy', id, {
    policyType: input.policyType,
    customerId: input.customerId,
    agreementId: input.agreementId,
    connectWiseAdditionId: input.connectWiseAdditionId,
    nerdioQuantityAdditionId: input.nerdioQuantityAdditionId,
  });
  return mapPolicyRow(row);
}

async function savePolicyAccountMappings(
  database: Queryable,
  input: {
    customerId: string;
    agreementId: string;
    ingramCustomerAccountIds: string[];
    nerdioAccountIds: string[];
    actor: string;
  },
) {
  const mappings = [
    ...input.ingramCustomerAccountIds.map((externalAccountId) => ({
      vendorId: 'ingram-micro',
      externalAccountId,
      nameSql: `select coalesce(max(nullif(external_account_name, '')), $2)
                from invoice_line_items
                where vendor_id = 'ingram-micro' and external_account_id = $2`,
    })),
    ...input.nerdioAccountIds.map((externalAccountId) => ({
      vendorId: 'nerdio',
      externalAccountId,
      nameSql: `select coalesce(max(nullif(account_name, '')), $2)
                from nerdio_invoice_items
                where account_id = $2`,
    })),
  ];
  for (const mapping of mappings) {
    await database.query(
      `insert into vendor_account_mappings (
         vendor_id, external_account_id, external_account_name, customer_id, agreement_id,
         mapping_status, confidence, mapping_source, reviewed_by, reviewed_at, active
       )
       values (
         $1, $2, (${mapping.nameSql}), $3::uuid, $4::uuid,
         'approved', 'manual', 'azure-billing-policy', $5, now(), true
       )
       on conflict (vendor_id, external_account_id) do update set
         external_account_name = excluded.external_account_name,
         customer_id = excluded.customer_id,
         agreement_id = excluded.agreement_id,
         mapping_status = 'approved',
         confidence = 'manual',
         mapping_source = 'azure-billing-policy',
         reviewed_by = excluded.reviewed_by,
         reviewed_at = now(),
         active = true,
         updated_at = now()`,
      [
        mapping.vendorId,
        mapping.externalAccountId,
        input.customerId,
        input.agreementId,
        input.actor,
      ],
    );
  }
}

export async function createAzureBillingRun(
  database: Queryable,
  input: {
    billingMonth: string;
    requestedBy: string;
    overwriteExisting?: boolean;
    ingramInvoiceImportIds?: string[];
    nerdioInvoiceSyncRunId?: string;
    nerdioLiveSyncRunId?: string;
    azureCostSyncRunId?: string;
    connectWiseSyncRunId?: string;
  },
): Promise<{ run: AzureBillingRunSummary; results: AzureBillingResult[] }> {
  validateBillingMonth(input.billingMonth);
  const sources = await resolveBillingRunSources(database, input);
  const runInsert = await database.query<{ id: string; regenerated: boolean }>(
    `with existing as materialized (
       select runs.id, runs.status
       from azure_billing_runs runs
       where runs.billing_month = $1
     ),
     removed_results as (
       delete from azure_billing_results results
       using existing
       where results.billing_run_id = existing.id
         and $8::boolean = true
         and existing.status not in ('releasing', 'released', 'partial')
         and not exists (
           select 1
           from azure_billing_release_batches batches
           where batches.billing_run_id = existing.id
         )
       returning results.id
     ),
     regenerated as (
       update azure_billing_runs runs
       set status = 'draft',
           ingram_invoice_import_ids = $2::jsonb,
           nerdio_invoice_sync_run_id = $3,
           nerdio_live_sync_run_id = $4,
           azure_cost_sync_run_id = $5,
           connectwise_sync_run_id = $6,
           requested_by = $7,
           shadow_accepted_by = null,
           shadow_accepted_at = null,
           shadow_acceptance_note = null,
           released_by = null,
           released_at = null,
           metadata = coalesce(runs.metadata, '{}'::jsonb) || jsonb_build_object(
             'regeneratedAt', now(),
             'regeneratedBy', $7::text,
             'discardedResultCount', (select count(*) from removed_results)
           ),
           updated_at = now()
       from existing
       where runs.id = existing.id
         and $8::boolean = true
         and existing.status not in ('releasing', 'released', 'partial')
         and not exists (
           select 1
           from azure_billing_release_batches batches
           where batches.billing_run_id = existing.id
         )
       returning runs.id
     ),
     inserted as (
       insert into azure_billing_runs (
         billing_month, status, ingram_invoice_import_ids, nerdio_invoice_sync_run_id,
         nerdio_live_sync_run_id, azure_cost_sync_run_id, connectwise_sync_run_id, requested_by
       )
       select $1, 'draft', $2::jsonb, $3, $4, $5, $6, $7
       where not exists (select 1 from existing)
       returning id
     )
     select id, true as regenerated from regenerated
     union all
     select id, false as regenerated from inserted`,
    [
      input.billingMonth,
      JSON.stringify(sources.ingramInvoiceImportIds),
      sources.nerdioInvoiceSyncRunId ?? null,
      sources.nerdioLiveSyncRunId ?? null,
      sources.azureCostSyncRunId ?? null,
      sources.connectWiseSyncRunId ?? null,
      input.requestedBy,
      input.overwriteExisting === true,
    ],
  );
  if (!runInsert.rows[0]) {
    const existing = await database.query<{ status: string }>(
      `select status from azure_billing_runs where billing_month = $1`,
      [input.billingMonth],
    );
    const status = existing.rows[0]?.status;
    if (input.overwriteExisting && status && ['releasing', 'released', 'partial'].includes(status)) {
      throw new Error(`Azure billing run ${input.billingMonth} has release activity and cannot be regenerated.`);
    }
    if (input.overwriteExisting && status) {
      throw new Error(`Azure billing run ${input.billingMonth} cannot be regenerated because a release batch already exists.`);
    }
    throw new Error(`Azure billing run ${input.billingMonth} already exists. Confirm regeneration to replace its saved review results.`);
  }
  const runId = runInsert.rows[0].id;
  const regenerated = runInsert.rows[0].regenerated;

  const policies = await loadEffectivePolicyInputs(database, input.billingMonth);
  for (const policy of policies) {
    const source = await loadPolicySourceEvidence(database, policy, {
      billingMonth: input.billingMonth,
      ...sources,
    });
    const previous = await loadPreviousApprovedResult(database, policy.id, input.billingMonth);
    const splitNerdioQuantity = Boolean(policy.nerdio_quantity_addition_id);
    const calculation = calculateAzureBillingResult({
      policyType: policy.policy_type as AzureBillingPolicyType,
      ingramCost: source.ingramCost,
      nerdioCost: source.nerdioCost,
      invoiceNerdioCount: source.invoiceNerdioCount,
      liveNerdioCount: source.liveNerdioCount,
      markupRate: nullableNumber(policy.markup_rate),
      currentQuantity: splitNerdioQuantity
        ? numericValue(policy.nerdio_quantity_current_quantity)
        : numericValue(policy.current_quantity),
      currentUnitPrice: splitNerdioQuantity
        ? nullableNumber(policy.nerdio_quantity_unit_price)
        : nullableNumber(policy.current_unit_price),
      currentUnitCost: splitNerdioQuantity
        ? nullableNumber(policy.nerdio_quantity_unit_cost)
        : nullableNumber(policy.current_unit_cost),
      previousApprovedQuantity: splitNerdioQuantity
        ? nullableNumber(previous?.selected_nerdio_count)
        : nullableNumber(previous?.proposed_quantity),
      previousApprovedUnitPrice: splitNerdioQuantity
        ? nullableNumber(policy.nerdio_quantity_unit_price)
        : nullableNumber(previous?.proposed_unit_price),
      previousApprovedUnitCost: nullableNumber(previous?.proposed_unit_cost),
    });
    const primaryQuantity = numericValue(policy.current_quantity);
    const proposedQuantity = splitNerdioQuantity ? primaryQuantity : calculation.proposedQuantity;
    const policyExternalBeforeTax = splitNerdioQuantity
      ? round(calculation.selectedNerdioCount * numericValue(policy.nerdio_quantity_unit_price), cents)
      : calculation.projectedRevenue;
    const externalCalculation = applyExternalPreTaxTotal(
      calculation.combinedCost,
      proposedQuantity,
      policyExternalBeforeTax,
    );
    const proposedUnitPrice = externalCalculation.proposedUnitPrice;
    const proposedUnitCost = externalCalculation.proposedUnitCost;
    const projectedRevenue = externalCalculation.projectedRevenue;
    const projectedMargin = externalCalculation.projectedMargin;
    const varianceFlags = [...calculation.varianceFlags, ...source.varianceFlags];
    if (splitNerdioQuantity && primaryQuantity === 0) varianceFlags.push('zero-cost-addition-quantity');
    const connectWiseSnapshot = {
      ...asRecord(policy.connectwise_snapshot),
      nerdioQuantityAddition: splitNerdioQuantity
        ? {
            connectWiseAdditionId: policy.nerdio_quantity_addition_id,
            currentQuantity: numericValue(policy.nerdio_quantity_current_quantity),
            unitPrice: nullableNumber(policy.nerdio_quantity_unit_price),
            unitCost: nullableNumber(policy.nerdio_quantity_unit_cost),
            snapshot: asRecord(policy.nerdio_quantity_snapshot),
          }
        : undefined,
    };
    await database.query(
      `insert into azure_billing_results (
         billing_run_id, policy_id, customer_id, agreement_id, connectwise_addition_id,
         policy_type, selected_nerdio_count_source, invoice_nerdio_count, live_nerdio_count,
         selected_nerdio_count, ingram_cost, nerdio_cost, combined_cost, markup_rate,
         current_quantity, proposed_quantity, current_unit_price, proposed_unit_price,
         current_unit_cost, proposed_unit_cost, previous_approved_quantity,
         previous_approved_unit_price, previous_approved_unit_cost, projected_revenue,
         projected_margin, variance_flags, source_evidence, connectwise_snapshot
       )
       values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15, $16, $17, $18,
         $19, $20, $21,
         $22, $23, $24,
         $25, $26::jsonb, $27::jsonb, $28::jsonb
       )`,
      [
        runId,
        policy.id,
        policy.customer_id,
        policy.agreement_id,
        policy.connectwise_addition_id,
        policy.policy_type,
        calculation.selectedNerdioCountSource ?? null,
        source.invoiceNerdioCount,
        source.liveNerdioCount,
        calculation.selectedNerdioCount,
        source.ingramCost,
        source.nerdioCost,
        calculation.combinedCost,
        policy.markup_rate,
        policy.current_quantity,
        proposedQuantity,
        policy.current_unit_price,
        proposedUnitPrice ?? null,
        policy.current_unit_cost,
        proposedUnitCost ?? null,
        splitNerdioQuantity ? previous?.selected_nerdio_count ?? null : previous?.proposed_quantity ?? null,
        previous?.proposed_unit_price ?? null,
        previous?.proposed_unit_cost ?? null,
        projectedRevenue,
        projectedMargin,
        JSON.stringify(varianceFlags),
        JSON.stringify(source.evidence),
        JSON.stringify(connectWiseSnapshot),
      ],
    );
  }

  await database.query(
    `update azure_billing_runs set status = 'review', updated_at = now() where id = $1`,
    [runId],
  );
  await insertAuditEvent(
    database,
    input.requestedBy,
    regenerated ? 'azure-billing.run.regenerated' : 'azure-billing.run.created',
    'azure_billing_run',
    runId,
    {
    billingMonth: input.billingMonth,
    policyCount: policies.length,
    overwrittenReviewResults: regenerated,
  });
  return getAzureBillingRun(database, runId);
}

async function resolveBillingRunSources(
  database: Queryable,
  input: {
    billingMonth: string;
    ingramInvoiceImportIds?: string[];
    nerdioInvoiceSyncRunId?: string;
    nerdioLiveSyncRunId?: string;
    azureCostSyncRunId?: string;
    connectWiseSyncRunId?: string;
  },
) {
  const monthStart = `${input.billingMonth}-01`;
  const nextMonth = nextMonthStart(input.billingMonth);
  const [ingram, nerdioInvoice, nerdioLive, azureCost, connectWise] = await Promise.all([
    input.ingramInvoiceImportIds?.length
      ? Promise.resolve({ rows: input.ingramInvoiceImportIds.map((id) => ({ id })) })
      : database.query<{ id: string }>(
          `select id
           from invoice_imports
           where vendor_id = 'ingram-micro'
             and status in ('ready', 'review')
             and coalesce(invoice_date, imported_at::date) >= $1::date
             and coalesce(invoice_date, imported_at::date) < $2::date
           order by imported_at, id`,
          [monthStart, nextMonth],
        ),
    input.nerdioInvoiceSyncRunId
      ? Promise.resolve({ rows: [{ id: input.nerdioInvoiceSyncRunId }] })
      : latestSourceSyncRun(database, 'nerdio', 'nerdio-invoices'),
    input.nerdioLiveSyncRunId
      ? Promise.resolve({ rows: [{ id: input.nerdioLiveSyncRunId }] })
      : sourceSyncRunForBillingMonth(database, 'nerdio', 'nerdio-live-usage', input.billingMonth),
    input.azureCostSyncRunId
      ? Promise.resolve({ rows: [{ id: input.azureCostSyncRunId }] })
      : latestSourceSyncRun(database, 'microsoft-azure', 'azure-cost-usage'),
    input.connectWiseSyncRunId
      ? Promise.resolve({ rows: [{ id: input.connectWiseSyncRunId }] })
      : latestCompletedSyncRun(database, 'connectwise'),
  ]);
  return {
    ingramInvoiceImportIds: uniqueStrings(ingram.rows.map((row) => row.id)),
    nerdioInvoiceSyncRunId: nerdioInvoice.rows[0]?.id,
    nerdioLiveSyncRunId: nerdioLive.rows[0]?.id,
    azureCostSyncRunId: azureCost.rows[0]?.id,
    connectWiseSyncRunId: connectWise.rows[0]?.id,
  };
}

function latestSourceSyncRun(database: Queryable, integrationId: string, entity: string) {
  return database.query<{ id: string }>(
    `select id
     from sync_runs
     where integration_id = $1 and status = 'complete' and metadata->>'entity' = $2
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [integrationId, entity],
  );
}

function sourceSyncRunForBillingMonth(
  database: Queryable,
  integrationId: string,
  entity: string,
  billingMonth: string,
) {
  if (billingMonth === new Date().toISOString().slice(0, 7)) {
    return latestSourceSyncRun(database, integrationId, entity);
  }
  return database.query<{ id: string }>(
    `select runs.id
     from sync_runs runs
     where runs.integration_id = $1
       and runs.status = 'complete'
       and runs.metadata->>'entity' = $2
       and exists (
         select 1
         from nerdio_live_usage_snapshots snapshots
         where snapshots.sync_run_id = runs.id
           and snapshots.collected_at >= $3::date
           and snapshots.collected_at < ($3::date + interval '1 month')
       )
     order by runs.completed_at desc nulls last, runs.started_at desc
     limit 1`,
    [integrationId, entity, `${billingMonth}-01`],
  );
}

function latestCompletedSyncRun(database: Queryable, integrationId: string) {
  return database.query<{ id: string }>(
    `select id
     from sync_runs
     where integration_id = $1 and status = 'complete'
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [integrationId],
  );
}

export async function listAzureBillingRuns(database: Queryable): Promise<AzureBillingRunSummary[]> {
  const result = await database.query<RunRow>(`${runSummarySql()} order by runs.billing_month desc`);
  return result.rows.map(mapRunRow);
}

export async function getAzureBillingIngramReadiness(
  database: Queryable,
  billingMonth: string,
  now = new Date(),
): Promise<AzureBillingIngramReadiness> {
  validateBillingMonth(billingMonth);
  const monthStart = `${billingMonth}-01`;
  const nextMonth = nextMonthStart(billingMonth);
  const invoice = await database.query<{
    id: string;
    invoice_date: Date | string;
    line_count: string | number;
    invoice_cost: string | number;
  }>(
    `select
       imports.id,
       imports.invoice_date,
       count(lines.id) as line_count,
       coalesce(sum(coalesce(lines.billed_amount, lines.amount, lines.rate * lines.quantity, 0)), 0) as invoice_cost
     from invoice_imports imports
     left join invoice_line_items lines on lines.invoice_import_id = imports.id
     where imports.vendor_id = 'ingram-micro'
       and imports.status in ('ready', 'review')
       and imports.invoice_date >= $1::date
       and imports.invoice_date < $2::date
       and extract(day from imports.invoice_date) >= 20
     group by imports.id
     order by count(lines.id) desc,
              abs(coalesce(sum(coalesce(lines.billed_amount, lines.amount, lines.rate * lines.quantity, 0)), 0)) desc,
              imports.invoice_date desc,
              imports.imported_at desc
     limit 1`,
    [monthStart, nextMonth],
  );
  const row = invoice.rows[0];
  return buildAzureBillingIngramReadiness(billingMonth, row ? {
    invoiceImportId: row.id,
    invoiceDate: isoDate(row.invoice_date).slice(0, 10),
    lineCount: numericValue(row.line_count),
    invoiceCost: round(numericValue(row.invoice_cost), cents),
  } : undefined, now);
}

export function buildAzureBillingIngramReadiness(
  billingMonth: string,
  invoice: {
    invoiceImportId: string;
    invoiceDate: string;
    lineCount: number;
    invoiceCost: number;
  } | undefined,
  now = new Date(),
): AzureBillingIngramReadiness {
  validateBillingMonth(billingMonth);
  const expectedReleaseDate = `${billingMonth}-21`;
  if (invoice) {
    return {
      billingMonth,
      expectedReleaseDate,
      status: 'ready',
      ready: true,
      message: `The major Ingram invoice is available with an invoice date of ${invoice.invoiceDate}.`,
      ...invoice,
    };
  }

  const today = easternDate(now);
  const currentMonth = today.slice(0, 7);
  if (billingMonth < currentMonth) {
    return {
      billingMonth,
      expectedReleaseDate,
      status: 'missing-history',
      ready: false,
      message: 'No major Ingram invoice is saved for this billing month. Sync or import it before regenerating the run.',
      lineCount: 0,
      invoiceCost: 0,
    };
  }
  if (billingMonth > currentMonth || today < expectedReleaseDate) {
    return {
      billingMonth,
      expectedReleaseDate,
      status: 'before-release',
      ready: false,
      message: `The latest Ingram invoice is normally released around ${expectedReleaseDate}. Wait until the 21st before generating this month.`,
      lineCount: 0,
      invoiceCost: 0,
    };
  }
  return {
    billingMonth,
    expectedReleaseDate,
    status: 'due',
    ready: false,
    message: 'The expected Ingram invoice has not been released yet. It can arrive 1–3 days late; try again tomorrow.',
    lineCount: 0,
    invoiceCost: 0,
  };
}

export async function acceptAzureBillingShadowRun(
  database: Queryable,
  runId: string,
  actor: string,
  note: string,
) {
  if (!note.trim()) throw new Error('An Admin Approval note is required.');
  const detail = await getAzureBillingRun(database, runId);
  if (detail.results.length === 0) throw new Error('A billing run with no client results cannot receive Admin Approval.');
  const incomplete = detail.results.filter((result) => result.status !== 'approved' && result.status !== 'held');
  if (incomplete.length > 0) {
    throw new Error('Every billing client must be approved or held before Admin Approval.');
  }
  await database.query(
    `update azure_billing_runs
     set shadow_accepted_by = $2,
         shadow_accepted_at = now(),
         shadow_acceptance_note = $3,
         updated_at = now()
     where id = $1`,
    [runId, actor, note.trim()],
  );
  await insertAuditEvent(database, actor, 'azure-billing.run.admin-approved', 'azure_billing_run', runId, {
    note: note.trim(),
  });
  return getAzureBillingRun(database, runId);
}

export async function listAzureBillingReleaseHistory(database: Queryable) {
  const result = await database.query<{
    id: string;
    billing_run_id: string;
    billing_month: string;
    status: string;
    released_by: string;
    started_at: Date | string;
    completed_at: Date | string | null;
    written_count: string | number;
    blocked_count: string | number;
    failed_count: string | number;
    skipped_count: string | number;
    summary: unknown;
  }>(
    `select
       batches.id,
       batches.billing_run_id,
       runs.billing_month,
       batches.status,
       batches.released_by,
       batches.started_at,
       batches.completed_at,
       count(items.id) filter (where items.status = 'written') as written_count,
       count(items.id) filter (where items.status = 'blocked') as blocked_count,
       count(items.id) filter (where items.status = 'failed') as failed_count,
       count(items.id) filter (where items.status = 'skipped') as skipped_count,
       batches.summary
     from azure_billing_release_batches batches
     inner join azure_billing_runs runs on runs.id = batches.billing_run_id
     left join azure_billing_release_items items on items.release_batch_id = batches.id
     group by batches.id, runs.billing_month
     order by batches.started_at desc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    billingRunId: row.billing_run_id,
    billingMonth: row.billing_month,
    status: row.status,
    releasedBy: row.released_by,
    startedAt: isoDate(row.started_at),
    completedAt: row.completed_at ? isoDate(row.completed_at) : undefined,
    writtenCount: numericValue(row.written_count),
    blockedCount: numericValue(row.blocked_count),
    failedCount: numericValue(row.failed_count),
    skippedCount: numericValue(row.skipped_count),
    summary: recordValue(row.summary),
  }));
}

export async function getAzureBillingRun(
  database: Queryable,
  runId: string,
): Promise<{ run: AzureBillingRunSummary; results: AzureBillingResult[] }> {
  const runResult = await database.query<RunRow>(`${runSummarySql()} having runs.id = $1`, [runId]);
  const run = runResult.rows[0];
  if (!run) throw new Error('Azure billing run was not found.');
  const [resultsResult, approvalsResult, historyResult] = await Promise.all([
    database.query<ResultRow>(
      `select
         results.*,
         customers.name as customer_name,
         agreements.name as agreement_name,
         agreements.connectwise_agreement_id,
         policies.display_name as policy_display_name
       from azure_billing_results results
       inner join customers on customers.id = results.customer_id
       inner join agreements on agreements.id = results.agreement_id
       inner join azure_billing_policies policies on policies.id = results.policy_id
       where results.billing_run_id = $1
       order by customers.name, agreements.name, policies.display_name`,
      [runId],
    ),
    database.query<ApprovalRow>(
      `select approvals.*
       from azure_billing_result_approvals approvals
       inner join azure_billing_results results on results.id = approvals.billing_result_id
       where results.billing_run_id = $1
         and approvals.revision = results.revision
       order by approvals.created_at`,
      [runId],
    ),
    database.query<{
      policy_id: string;
      billing_month: string;
      status: string;
      proposed_quantity: string | number;
      proposed_unit_price: string | number | null;
      proposed_unit_cost: string | number | null;
      invoice_nerdio_count: string | number;
      live_nerdio_count: string | number;
      ingram_cost: string | number;
      nerdio_cost: string | number;
      combined_cost: string | number;
      markup_rate: string | number | null;
      external_pre_tax_override: string | number | null;
      projected_revenue: string | number;
      projected_margin: string | number;
      source_evidence: unknown;
    }>(
      `with ranked as (
         select
           results.policy_id,
           runs.billing_month,
           results.status,
           results.proposed_quantity,
           results.proposed_unit_price,
           results.proposed_unit_cost,
           results.invoice_nerdio_count,
           results.live_nerdio_count,
           results.ingram_cost,
           results.nerdio_cost,
           results.combined_cost,
           results.markup_rate,
           results.external_pre_tax_override,
           results.projected_revenue,
           results.projected_margin,
           results.source_evidence,
           row_number() over (partition by results.policy_id order by runs.billing_month desc) as month_rank
         from azure_billing_results results
         inner join azure_billing_runs runs on runs.id = results.billing_run_id
         where results.policy_id in (
           select policy_id from azure_billing_results where billing_run_id = $1
         )
       )
       select * from ranked where month_rank <= 12 order by policy_id, billing_month desc`,
      [runId],
    ),
  ]);
  const approvals = new Map<string, ApprovalRow[]>();
  for (const row of approvalsResult.rows) {
    approvals.set(row.billing_result_id, [...(approvals.get(row.billing_result_id) ?? []), row]);
  }
  const history = new Map<string, AzureBillingResult['history']>();
  for (const row of historyResult.rows) {
    history.set(row.policy_id, [
      ...(history.get(row.policy_id) ?? []),
      {
        billingMonth: row.billing_month,
        status: row.status,
        quantity: numericValue(row.proposed_quantity),
        unitPrice: nullableNumber(row.proposed_unit_price),
        unitCost: nullableNumber(row.proposed_unit_cost),
        invoiceNerdioCount: numericValue(row.invoice_nerdio_count),
        liveNerdioCount: historicalLiveNerdioCount(
          row.live_nerdio_count,
          row.source_evidence,
          row.billing_month,
        ),
        ingramCost: numericValue(row.ingram_cost),
        nerdioCost: numericValue(row.nerdio_cost),
        combinedCost: numericValue(row.combined_cost),
        assignedMarkupRate: nullableNumber(row.markup_rate),
        externalPreTaxOverride: nullableNumber(row.external_pre_tax_override),
        effectiveMarkupRate: effectiveMarkupRate(
          numericValue(row.projected_revenue),
          numericValue(row.combined_cost),
        ),
        projectedRevenue: numericValue(row.projected_revenue),
        projectedMargin: numericValue(row.projected_margin),
      },
    ]);
  }
  const previousByPolicy = new Map<string, typeof historyResult.rows[number]>();
  for (const row of historyResult.rows) {
    if (row.billing_month >= run.billing_month || previousByPolicy.has(row.policy_id)) continue;
    previousByPolicy.set(row.policy_id, row);
  }
  return {
    run: mapRunRow(run),
    results: resultsResult.rows.map((row) => {
      const mapped = mapResultRow(row, approvals.get(row.id) ?? [], run.billing_month);
      const previous = previousByPolicy.get(row.policy_id);
      return {
        ...mapped,
        ingramComparisonMonth: previous?.billing_month,
        ingramChanges: compareAzureBillingIngramLines(
          asRecords(mapped.sourceEvidence.ingramLines),
          asRecords(asRecord(previous?.source_evidence).ingramLines),
        ),
        history: history.get(row.policy_id) ?? [],
      };
    }),
  };
}

export async function reviseAzureBillingResult(
  database: Queryable,
  resultId: string,
  input: {
    decisionType: AzureBillingDecisionType;
    selectedNerdioCountSource?: NerdioCountSource;
    manualQuantity?: number;
    manualUnitPrice?: number;
    manualUnitCost?: number;
    externalPreTaxOverride?: number | null;
    reviewerNote?: string;
  },
  actor: string,
): Promise<AzureBillingResult> {
  const current = await loadResultForCalculation(database, resultId);
  if (!current) throw new Error('Azure billing result was not found.');
  if (current.run_status === 'released' || current.status === 'released') {
    throw new Error('Released Azure billing results cannot be revised.');
  }
  const currentExternalPreTaxOverride = nullableNumber(current.external_pre_tax_override);
  const externalPreTaxOverride =
    input.externalPreTaxOverride === undefined
      ? currentExternalPreTaxOverride
      : input.externalPreTaxOverride;
  if (externalPreTaxOverride !== null && externalPreTaxOverride !== undefined) {
    assertFiniteNonNegative(externalPreTaxOverride, 'External pre-tax override');
  }
  const overrideChanged =
    input.externalPreTaxOverride !== undefined
    && !numbersEqual(
      externalPreTaxOverride ?? undefined,
      currentExternalPreTaxOverride ?? undefined,
      cents,
    );
  if (
    (input.decisionType === 'manual' || (overrideChanged && externalPreTaxOverride !== null))
    && !input.reviewerNote?.trim()
  ) {
    throw new Error('A reviewer note is required for a manual proposal.');
  }
  const nerdioQuantityTarget = nerdioQuantityTargetFromSnapshot(current.connectwise_snapshot);
  const calculation = calculateAzureBillingResult({
    policyType: current.policy_type as AzureBillingPolicyType,
    ingramCost: numericValue(current.ingram_cost),
    nerdioCost: numericValue(current.nerdio_cost),
    invoiceNerdioCount: numericValue(current.invoice_nerdio_count),
    liveNerdioCount: numericValue(current.live_nerdio_count),
    selectedNerdioCountSource: input.selectedNerdioCountSource,
    markupRate: nullableNumber(current.markup_rate),
    currentQuantity: nerdioQuantityTarget
      ? numericValue(nerdioQuantityTarget.currentQuantity)
      : numericValue(current.current_quantity),
    currentUnitPrice: nerdioQuantityTarget
      ? nullableNumber(nerdioQuantityTarget.unitPrice)
      : nullableNumber(current.current_unit_price),
    currentUnitCost: nerdioQuantityTarget
      ? nullableNumber(nerdioQuantityTarget.unitCost)
      : nullableNumber(current.current_unit_cost),
    previousApprovedQuantity: nullableNumber(current.previous_approved_quantity),
    previousApprovedUnitPrice: nullableNumber(current.previous_approved_unit_price),
    previousApprovedUnitCost: nullableNumber(current.previous_approved_unit_cost),
    decisionType: input.decisionType,
    manualQuantity: input.manualQuantity,
    manualUnitPrice: input.manualUnitPrice,
    manualUnitCost: input.manualUnitCost,
  });
  const primaryQuantity = numericValue(current.current_quantity);
  const proposedQuantity = nerdioQuantityTarget ? primaryQuantity : calculation.proposedQuantity;
  const policyExternalBeforeTax = nerdioQuantityTarget
    ? round(calculation.selectedNerdioCount * numericValue(nerdioQuantityTarget.unitPrice), cents)
    : calculation.projectedRevenue;
  const externalCalculation = applyExternalPreTaxTotal(
    calculation.combinedCost,
    proposedQuantity,
    externalPreTaxOverride ?? policyExternalBeforeTax,
  );
  const proposedUnitPrice = externalCalculation.proposedUnitPrice;
  const proposedUnitCost = externalCalculation.proposedUnitCost;
  const projectedRevenue = externalCalculation.projectedRevenue;
  const projectedMargin = externalCalculation.projectedMargin;
  const varianceFlags = [...calculation.varianceFlags];
  if (nerdioQuantityTarget && primaryQuantity === 0) varianceFlags.push('zero-cost-addition-quantity');
  await database.query(
    `update azure_billing_results
     set revision = revision + 1,
         status = 'needs-review',
         decision_type = $2,
         selected_nerdio_count_source = $3,
         selected_nerdio_count = $4,
         proposed_quantity = $5,
         proposed_unit_price = $6,
         proposed_unit_cost = $7,
         projected_revenue = $8,
         projected_margin = $9,
         external_pre_tax_override = $10,
         external_pre_tax_suggested_by = $11,
         reviewer_note = $12,
         hold_reason = null,
         variance_flags = $13::jsonb,
         updated_at = now()
     where id = $1`,
    [
      resultId,
      input.decisionType,
      calculation.selectedNerdioCountSource ?? null,
      calculation.selectedNerdioCount,
      proposedQuantity,
      proposedUnitPrice ?? null,
      proposedUnitCost ?? null,
      projectedRevenue,
      projectedMargin,
      externalPreTaxOverride ?? null,
      input.externalPreTaxOverride !== undefined
        ? (externalPreTaxOverride === null ? null : actor)
        : current.external_pre_tax_suggested_by,
      input.reviewerNote?.trim() || (overrideChanged ? null : current.reviewer_note),
      JSON.stringify(varianceFlags),
    ],
  );
  await insertAuditEvent(database, actor, 'azure-billing.result.revised', 'azure_billing_result', resultId, {
    decisionType: input.decisionType,
    selectedNerdioCountSource: calculation.selectedNerdioCountSource,
    externalPreTaxOverride,
    externalBeforeTax: projectedRevenue,
  });
  await updateRunReadiness(database, current.billing_run_id);
  return getAzureBillingResultById(database, resultId);
}

export async function approveAzureBillingResult(
  database: Queryable,
  resultId: string,
  reviewer: { email: string; name: string; comment?: string },
): Promise<AzureBillingResult> {
  const current = await loadResultForCalculation(database, resultId);
  if (!current) throw new Error('Azure billing result was not found.');
  if (current.status === 'held') throw new Error('Held Azure billing results cannot be approved.');
  if (current.status === 'released') throw new Error('Released Azure billing results cannot be approved again.');
  if ((asStringArray(current.variance_flags) as string[]).includes('zero-selected-count')) {
    throw new Error('A fixed-price AVD result with a zero selected count cannot be approved.');
  }
  const email = reviewer.email.trim().toLowerCase();
  if (!email) throw new Error('Reviewer email is required.');
  const approvalSettings = await getAzureBillingApprovalSettings(database);
  if (approvalSettings.approverEmails.length === 0) {
    throw new Error('Azure Billing approvers have not been configured.');
  }
  if (!approvalSettings.approverEmails.includes(email)) {
    throw new Error('You are not configured as an Azure Billing approver.');
  }
  await database.query(
    `insert into azure_billing_result_approvals (
       billing_result_id, revision, reviewer_email, reviewer_name, decision, comment
     )
     values ($1, $2, $3, $4, 'approved', $5)
     on conflict (billing_result_id, revision, reviewer_email) do update set
       reviewer_name = excluded.reviewer_name,
       decision = excluded.decision,
       comment = excluded.comment,
       created_at = now()`,
    [resultId, current.revision, email, reviewer.name.trim() || email, reviewer.comment?.trim() || null],
  );
  const approvalCount = await countCurrentApprovals(database, resultId, numericValue(current.revision));
  await database.query(
    `update azure_billing_results set status = $2, updated_at = now() where id = $1`,
    [resultId, approvalCount >= requiredApprovalCount ? 'approved' : 'needs-review'],
  );
  await insertAuditEvent(database, email, 'azure-billing.result.approved', 'azure_billing_result', resultId, {
    revision: numericValue(current.revision),
    approvalCount,
    requiredApprovalCount,
  });
  await updateRunReadiness(database, current.billing_run_id);
  return getAzureBillingResultById(database, resultId);
}

export async function holdAzureBillingResult(
  database: Queryable,
  resultId: string,
  reason: string,
  actor: string,
): Promise<AzureBillingResult> {
  if (!reason.trim()) throw new Error('A hold reason is required.');
  const current = await loadResultForCalculation(database, resultId);
  if (!current) throw new Error('Azure billing result was not found.');
  if (current.status === 'released') throw new Error('Released Azure billing results cannot be held.');
  await database.query(
    `update azure_billing_results
     set revision = revision + 1,
         status = 'held',
         hold_reason = $2,
         updated_at = now()
     where id = $1`,
    [resultId, reason.trim()],
  );
  await insertAuditEvent(database, actor, 'azure-billing.result.held', 'azure_billing_result', resultId, {
    reason: reason.trim(),
  });
  await updateRunReadiness(database, current.billing_run_id);
  return getAzureBillingResultById(database, resultId);
}

export type AzureBillingConnectWiseAddition = {
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
  [key: string]: unknown;
};

export type AzureBillingConnectWiseWriter = {
  getAgreementAddition: (
    connectWiseAgreementId: string,
    connectWiseAdditionId: string,
  ) => Promise<AzureBillingConnectWiseAddition>;
  patchAgreementAddition: (
    connectWiseAgreementId: string,
    connectWiseAdditionId: string,
    changes: { quantity?: number; unitPrice?: number; unitCost?: number },
  ) => Promise<AzureBillingConnectWiseAddition>;
};

export async function releaseAzureBillingRun(
  database: Queryable,
  runId: string,
  actor: string,
  writer: AzureBillingConnectWiseWriter,
): Promise<{ batchId: string; status: 'released' | 'partial' | 'failed'; written: number; blocked: number; failed: number }> {
  const detail = await getAzureBillingRun(database, runId);
  if (detail.run.status !== 'ready-for-billing' && detail.run.status !== 'partial') {
    throw new Error('Azure billing run must be ready for Billing release.');
  }
  if (!detail.run.shadowAcceptedAt) {
    throw new Error('ConnectWise release is disabled until the billing run receives Admin Approval.');
  }
  const incomplete = detail.results.filter((result) => result.status === 'needs-review');
  if (incomplete.length > 0) throw new Error('Every Azure billing result must be approved or held before release.');
  const batchId = await getOrCreateReleaseBatch(database, runId, actor);
  await database.query(`update azure_billing_runs set status = 'releasing', updated_at = now() where id = $1`, [runId]);

  let written = 0;
  let blocked = 0;
  let failed = 0;
  for (const result of detail.results) {
    if (result.status === 'held') {
      await upsertReleaseItem(database, batchId, result.id, 'skipped', {}, {}, result.holdReason);
      continue;
    }
    if (await releaseItemAlreadyWritten(database, batchId, result.id)) {
      written += 1;
      continue;
    }
    try {
      const live = await writer.getAgreementAddition(result.connectWiseAgreementId, result.connectWiseAdditionId);
      const drift = connectWiseDrift(result, live);
      const nerdioQuantityLive = result.nerdioQuantityAdditionId
        ? await writer.getAgreementAddition(result.connectWiseAgreementId, result.nerdioQuantityAdditionId)
        : undefined;
      if (
        nerdioQuantityLive
        && !numbersEqual(nerdioQuantityLive.quantity, result.nerdioQuantityCurrentQuantity, sourcePrecision)
      ) {
        drift.push('Nerdio count addition quantity');
      }
      if (
        nerdioQuantityLive
        && !numbersEqual(nerdioQuantityLive.unitPrice, result.nerdioQuantityUnitPrice, cents)
      ) {
        drift.push('Nerdio count addition unit price');
      }
      if (
        nerdioQuantityLive
        && !numbersEqual(nerdioQuantityLive.unitCost, result.nerdioQuantityUnitCost, cents)
      ) {
        drift.push('Nerdio count addition unit cost');
      }
      if (drift.length > 0) {
        blocked += 1;
        await upsertReleaseItem(
          database,
          batchId,
          result.id,
          'blocked',
          buildReleaseRequest(result),
          { costAddition: live, nerdioQuantityAddition: nerdioQuantityLive },
          `ConnectWise changed after review: ${drift.join(', ')}`,
        );
        await database.query(`update azure_billing_results set status = 'blocked', updated_at = now() where id = $1`, [result.id]);
        continue;
      }
      const changes = buildReleaseRequest(result);
      const response = await writer.patchAgreementAddition(
        result.connectWiseAgreementId,
        result.connectWiseAdditionId,
        changes,
      );
      const nerdioQuantityResponse = result.nerdioQuantityAdditionId
        ? await writer.patchAgreementAddition(
            result.connectWiseAgreementId,
            result.nerdioQuantityAdditionId,
            { quantity: result.nerdioQuantityProposedQuantity },
          )
        : undefined;
      written += 1;
      await upsertReleaseItem(
        database,
        batchId,
        result.id,
        'written',
        {
          costAddition: changes,
          nerdioQuantityAddition: result.nerdioQuantityAdditionId
            ? { quantity: result.nerdioQuantityProposedQuantity }
            : undefined,
        },
        { costAddition: response, nerdioQuantityAddition: nerdioQuantityResponse },
      );
      await database.query(
        `update azure_billing_results set status = 'released', updated_at = now() where id = $1`,
        [result.id],
      );
      if (result.nerdioQuantityAdditionId) {
        await database.query(
          `update agreement_additions
           set quantity = $3,
               updated_at = now()
           where agreement_id = $1 and connectwise_addition_id = $2`,
          [result.agreementId, result.nerdioQuantityAdditionId, result.nerdioQuantityProposedQuantity],
        );
      }
      await database.query(
        `update agreement_additions
         set quantity = $2,
             unit_price = coalesce($3, unit_price),
             raw_payload = raw_payload || jsonb_build_object('unitCost', $4),
             updated_at = now()
         where agreement_id = $1 and connectwise_addition_id = $5`,
        [
          result.agreementId,
          result.proposedQuantity,
          result.proposedUnitPrice ?? null,
          result.proposedUnitCost ?? null,
          result.connectWiseAdditionId,
        ],
      );
    } catch (error) {
      failed += 1;
      await upsertReleaseItem(
        database,
        batchId,
        result.id,
        'failed',
        buildReleaseRequest(result),
        {},
        error instanceof Error ? error.message : String(error),
      );
      await database.query(`update azure_billing_results set status = 'failed', updated_at = now() where id = $1`, [result.id]);
    }
  }

  const status: 'released' | 'partial' | 'failed' =
    failed > 0 || blocked > 0 ? (written > 0 ? 'partial' : 'failed') : 'released';
  await database.query(
    `update azure_billing_release_batches
     set status = $2, completed_at = now(), summary = $3::jsonb
     where id = $1`,
    [batchId, status, JSON.stringify({ written, blocked, failed })],
  );
  await database.query(
    `update azure_billing_runs
     set status = $2,
         released_by = case when $2 = 'released' then $3 else released_by end,
         released_at = case when $2 = 'released' then now() else released_at end,
         updated_at = now()
     where id = $1`,
    [runId, status === 'released' ? 'released' : 'partial', actor],
  );
  await insertAuditEvent(database, actor, 'azure-billing.run.release-completed', 'azure_billing_run', runId, {
    batchId,
    status,
    written,
    blocked,
    failed,
  });
  return { batchId, status, written, blocked, failed };
}

function buildReleaseRequest(result: AzureBillingResult) {
  if (result.nerdioQuantityAdditionId) {
    return {
      unitPrice: result.proposedUnitPrice,
      unitCost: result.proposedUnitCost,
    };
  }
  return {
    quantity: result.proposedQuantity,
    unitCost: result.proposedUnitCost,
    unitPrice: result.proposedUnitPrice,
  };
}

function connectWiseDrift(result: AzureBillingResult, live: AzureBillingConnectWiseAddition) {
  const drift: string[] = [];
  if (!numbersEqual(live.quantity, result.currentQuantity, sourcePrecision)) drift.push('quantity');
  if (!numbersEqual(live.unitPrice, result.currentUnitPrice, cents)) drift.push('unit price');
  if (!numbersEqual(live.unitCost, result.currentUnitCost, cents)) drift.push('unit cost');
  return drift;
}

async function loadEffectivePolicyInputs(database: Queryable, billingMonth: string) {
  const monthStart = `${billingMonth}-01`;
  const result = await database.query<{
    id: string;
    customer_id: string;
    agreement_id: string;
    connectwise_addition_id: string;
    nerdio_quantity_addition_id: string | null;
    policy_type: string;
    ingram_customer_account_ids: unknown;
    ingram_product_codes: unknown;
    ingram_product_families: unknown;
    ingram_subscription_ids: unknown;
    nerdio_account_ids: unknown;
    nerdio_billable_metrics: unknown;
    markup_rate: string | number | null;
    current_quantity: string | number;
    current_unit_price: string | number | null;
    current_unit_cost: string | number | null;
    connectwise_snapshot: unknown;
    nerdio_quantity_current_quantity: string | number | null;
    nerdio_quantity_unit_price: string | number | null;
    nerdio_quantity_unit_cost: string | number | null;
    nerdio_quantity_snapshot: unknown;
  }>(
    `select
       policies.id,
       policies.customer_id,
       policies.agreement_id,
       policies.connectwise_addition_id,
       policies.nerdio_quantity_addition_id,
       policies.policy_type,
       policies.ingram_customer_account_ids,
       policies.ingram_product_codes,
       policies.ingram_product_families,
       policies.ingram_subscription_ids,
       policies.nerdio_account_ids,
       policies.nerdio_billable_metrics,
       policies.markup_rate,
       additions.quantity as current_quantity,
       additions.unit_price as current_unit_price,
       nullif(additions.raw_payload->>'unitCost', '')::numeric as current_unit_cost,
       additions.raw_payload as connectwise_snapshot,
       quantity_additions.quantity as nerdio_quantity_current_quantity,
       quantity_additions.unit_price as nerdio_quantity_unit_price,
       nullif(quantity_additions.raw_payload->>'unitCost', '')::numeric as nerdio_quantity_unit_cost,
       quantity_additions.raw_payload as nerdio_quantity_snapshot
     from azure_billing_policies policies
     inner join agreement_additions additions
      on additions.agreement_id = policies.agreement_id
     and additions.connectwise_addition_id = policies.connectwise_addition_id
     left join agreement_additions quantity_additions
       on quantity_additions.agreement_id = policies.agreement_id
      and quantity_additions.connectwise_addition_id = policies.nerdio_quantity_addition_id
     where policies.active = true
       and policies.effective_from <= $1::date
       and (policies.effective_to is null or policies.effective_to >= $1::date)
       and additions.addition_status !~* 'expired|cancelled|canceled|inactive'
       and (
         policies.nerdio_quantity_addition_id is null
         or quantity_additions.addition_status !~* 'expired|cancelled|canceled|inactive'
       )
     order by policies.customer_id, policies.agreement_id, policies.id`,
    [monthStart],
  );
  return result.rows;
}

async function loadPolicySourceEvidence(
  database: Queryable,
  policy: {
    id: string;
    policy_type: string;
    ingram_customer_account_ids: unknown;
    ingram_product_codes: unknown;
    ingram_product_families: unknown;
    ingram_subscription_ids: unknown;
    nerdio_account_ids: unknown;
    nerdio_billable_metrics: unknown;
  },
  runInput: {
    billingMonth: string;
    ingramInvoiceImportIds?: string[];
    nerdioInvoiceSyncRunId?: string;
    nerdioLiveSyncRunId?: string;
  },
) {
  const ingramCustomerAccountIds = asStringArray(policy.ingram_customer_account_ids);
  const ingramProductCodes = asStringArray(policy.ingram_product_codes);
  const ingramProductFamilies = asStringArray(policy.ingram_product_families)
    .filter((family): family is AzureBillingIngramProductFamily =>
      azureBillingIngramProductFamilies.includes(family as AzureBillingIngramProductFamily));
  const legacyIngramSubscriptionIds = asStringArray(policy.ingram_subscription_ids);
  const ingramAccountIds = ingramCustomerAccountIds.length
    ? ingramCustomerAccountIds
    : legacyIngramSubscriptionIds;
  const nerdioAccountIds = asStringArray(policy.nerdio_account_ids);
  const metrics = new Set(asStringArray(policy.nerdio_billable_metrics).map((value) => value.toLowerCase()));
  const invoiceIds = uniqueStrings(runInput.ingramInvoiceImportIds);
  const priorMonthStart = previousMonthStart(runInput.billingMonth);
  const [ingramResult, nerdioInvoiceResult, nerdioLiveResult] = await Promise.all([
    database.query<{
      cost: string | number;
      line_count: string | number;
      import_ids: unknown;
    }>(
      `select
         coalesce(sum(coalesce(billed_amount, amount, rate * quantity, 0)), 0) as cost,
         count(*) as line_count,
         coalesce(jsonb_agg(distinct invoice_import_id) filter (where invoice_import_id is not null), '[]'::jsonb) as import_ids
       from invoice_line_items
       where vendor_id in ('ingram-micro', 'microsoft-azure')
         and external_account_id = any($1::text[])
         and (
           (cardinality($2::text[]) = 0 and cardinality($3::text[]) = 0)
           or product_code = any($2::text[])
           or (
             'azure-consumption' = any($3::text[])
             and (
               upper(coalesce(product_code, '')) like 'MS-AZR-%'
               or lower(coalesce(product_name, '')) like '%azure%'
             )
           )
           or (
             'windows-365' = any($3::text[])
             and (
               upper(coalesce(product_code, '')) like 'CFQ7TTC0HHS9:%'
               or lower(coalesce(product_name, '')) like '%windows 365%'
               or lower(coalesce(product_name, '')) like '%cloud pc%'
             )
           )
         )
         and invoice_import_id = any($4::uuid[])`,
      [ingramAccountIds, ingramProductCodes, ingramProductFamilies, invoiceIds],
    ),
    database.query<{
      cost: string | number;
      direct_cost: string | number;
      invoice_count: string | number;
      item_count: string | number;
      invoice_ids: unknown;
    }>(
      `select
         coalesce(sum(value), 0) as cost,
         coalesce(sum(value), 0) as direct_cost,
         coalesce(sum(case when lower(metric) = any($3::text[]) then licenses else 0 end), 0) as invoice_count,
         count(*) as item_count,
         coalesce(jsonb_agg(distinct external_invoice_id), '[]'::jsonb) as invoice_ids
       from nerdio_invoice_items
       where (account_id = any($1::text[]) or account_name = any($1::text[]))
         and billing_period_start >= $2::date
         and billing_period_start < ($2::date + interval '1 month')
         and sync_run_id = $4::uuid`,
      [nerdioAccountIds, priorMonthStart, [...metrics], runInput.nerdioInvoiceSyncRunId ?? null],
    ),
    database.query<{
      live_count: string | number;
      account_count: string | number;
      collected_at: Date | string | null;
    }>(
      `with latest as (
         select distinct on (account_id)
           account_id, collected_at, avd_users, cpc_users, intune_users
         from nerdio_live_usage_snapshots
         where (account_id = any($1::text[]) or account_name = any($1::text[]))
           and sync_run_id = $2::uuid
         order by account_id, collected_at desc
       )
       select
         coalesce(sum(
           case when 'avd' = any($3::text[]) then avd_users else 0 end +
           case when 'cpc' = any($3::text[]) then cpc_users else 0 end +
           case when 'intune' = any($3::text[]) then intune_users else 0 end
         ), 0) as live_count,
         count(*) as account_count,
         max(collected_at) as collected_at
       from latest`,
      [nerdioAccountIds, runInput.nerdioLiveSyncRunId ?? null, [...metrics]],
    ),
  ]);
  const ingram = ingramResult.rows[0];
  const nerdioInvoice = nerdioInvoiceResult.rows[0];
  const nerdioLive = nerdioLiveResult.rows[0];
  const [ingramLines, nerdioInvoiceItems] = await Promise.all([
    database.query<Record<string, unknown>>(
      `select
         invoice_import_id as "invoiceImportId",
         external_account_id as "customerAccountId",
         raw_payload->>'SUBSCRIPTION_ID' as "subscriptionId",
         external_account_name as "customerName",
         product_code as "productCode",
         product_name as "productName",
         quantity,
         rate as "unitCost",
         coalesce(billed_amount, amount, rate * quantity, 0) as "extendedCost",
         invoice_date as "invoiceDate",
         billing_period_start as "billingPeriodStart",
         billing_period_end as "billingPeriodEnd",
         raw_payload as "rawPayload"
       from invoice_line_items
       where vendor_id in ('ingram-micro', 'microsoft-azure')
         and external_account_id = any($1::text[])
         and (
           (cardinality($2::text[]) = 0 and cardinality($3::text[]) = 0)
           or product_code = any($2::text[])
           or (
             'azure-consumption' = any($3::text[])
             and (
               upper(coalesce(product_code, '')) like 'MS-AZR-%'
               or lower(coalesce(product_name, '')) like '%azure%'
             )
           )
           or (
             'windows-365' = any($3::text[])
             and (
               upper(coalesce(product_code, '')) like 'CFQ7TTC0HHS9:%'
               or lower(coalesce(product_name, '')) like '%windows 365%'
               or lower(coalesce(product_name, '')) like '%cloud pc%'
             )
           )
         )
         and invoice_import_id = any($4::uuid[])
       order by invoice_date, invoice_import_id, raw_row_number`,
      [ingramAccountIds, ingramProductCodes, ingramProductFamilies, invoiceIds],
    ),
    database.query<Record<string, unknown>>(
      `select
         external_invoice_id as "invoiceId",
         invoice_number as "invoiceNumber",
         account_id as "accountId",
         account_name as "accountName",
         item_number as "itemNumber",
         metric,
         code,
         description,
         licenses,
         unit_price as "unitPrice",
         value,
         billing_period_start as "billingPeriodStart",
         billing_period_end as "billingPeriodEnd",
         raw_payload as "rawPayload"
       from nerdio_invoice_items
       where (account_id = any($1::text[]) or account_name = any($1::text[]))
         and billing_period_start >= $2::date
         and billing_period_start < ($2::date + interval '1 month')
         and sync_run_id = $3::uuid
       order by external_invoice_id, account_name, item_number`,
      [nerdioAccountIds, priorMonthStart, runInput.nerdioInvoiceSyncRunId ?? null],
    ),
  ]);
  const varianceFlags: string[] = [];
  if (ingramAccountIds.length === 0) varianceFlags.push('missing-ingram-customer-mapping');
  if (numericValue(ingram?.line_count) === 0) varianceFlags.push('missing-ingram-invoice-lines');
  if (policy.policy_type !== 'ingram-subscription-markup') {
    if (nerdioAccountIds.length === 0) varianceFlags.push('missing-nerdio-account-mapping');
    if (numericValue(nerdioInvoice?.item_count) === 0) varianceFlags.push('missing-nerdio-invoice');
    if (numericValue(nerdioLive?.account_count) === 0) varianceFlags.push('missing-nerdio-live-usage');
  }
  const nerdioClientLineCost = sumNerdioClientInvoiceLines(nerdioInvoiceItems.rows, nerdioAccountIds);
  return {
    ingramCost: round(numericValue(ingram?.cost), sourcePrecision),
    nerdioCost:
      policy.policy_type === 'ingram-subscription-markup'
        ? 0
        : nerdioClientLineCost,
    invoiceNerdioCount: round(numericValue(nerdioInvoice?.invoice_count), sourcePrecision),
    liveNerdioCount: round(numericValue(nerdioLive?.live_count), sourcePrecision),
    varianceFlags,
    evidence: {
      billingMonth: runInput.billingMonth,
      ingramCustomerAccountIds: ingramAccountIds,
      ingramProductCodes,
      ingramProductFamilies,
      legacyIngramSubscriptionIds,
      nerdioAccountIds,
      nerdioBillableMetrics: [...metrics],
      ingramLineCount: numericValue(ingram?.line_count),
      ingramInvoiceImportIds: asStringArray(ingram?.import_ids),
      nerdioInvoiceIds: asStringArray(nerdioInvoice?.invoice_ids),
      nerdioInvoiceBillingPeriodStart: priorMonthStart,
      nerdioInvoiceItemCount: numericValue(nerdioInvoice?.item_count),
      nerdioDirectCost: nerdioClientLineCost,
      nerdioLiveCollectedAt: nerdioLive?.collected_at ? isoDate(nerdioLive.collected_at) : undefined,
      ingramLines: ingramLines.rows,
      nerdioInvoiceItems: nerdioInvoiceItems.rows,
    },
  };
}

async function loadPreviousApprovedResult(database: Queryable, policyId: string, billingMonth: string) {
  const result = await database.query<{
    selected_nerdio_count: string | number;
    proposed_quantity: string | number;
    proposed_unit_price: string | number | null;
    proposed_unit_cost: string | number | null;
  }>(
    `select results.selected_nerdio_count, results.proposed_quantity, results.proposed_unit_price, results.proposed_unit_cost
     from azure_billing_results results
     inner join azure_billing_runs runs on runs.id = results.billing_run_id
     where results.policy_id = $1
       and runs.billing_month < $2
       and results.status = 'released'
     order by runs.billing_month desc
     limit 1`,
    [policyId, billingMonth],
  );
  return result.rows[0];
}

function runSummarySql() {
  return `select
     runs.id,
     runs.billing_month,
     runs.status,
     runs.requested_by,
     runs.shadow_accepted_by,
     runs.shadow_accepted_at,
     runs.released_by,
     runs.released_at,
     runs.created_at,
     runs.updated_at,
     count(results.id) as result_count,
     count(results.id) filter (where results.status = 'needs-review') as needs_review_count,
     count(results.id) filter (where results.status = 'approved') as approved_count,
     count(results.id) filter (where results.status = 'held') as held_count,
     count(results.id) filter (where results.status in ('failed', 'blocked')) as failed_count,
     coalesce(sum(results.ingram_cost), 0) as ingram_cost,
     coalesce(sum(results.nerdio_cost), 0) as nerdio_cost,
     coalesce(sum(results.combined_cost), 0) as combined_cost,
     coalesce((
       select sum(coalesce(lines.billed_amount, lines.amount, lines.rate * lines.quantity, 0))
       from invoice_line_items lines
       where lines.invoice_import_id in (
         select value::uuid
         from jsonb_array_elements_text(runs.ingram_invoice_import_ids)
       )
         and not exists (
           select 1
           from azure_billing_client_exclusions exclusions
           where exclusions.source_type = 'ingram'
             and exclusions.active = true
             and exclusions.external_account_id = lines.external_account_id
         )
     ), 0) + coalesce((
       select sum(items.value)
       from nerdio_invoice_items items
       where items.sync_run_id = runs.nerdio_invoice_sync_run_id
         and items.billing_period_start >=
           (to_date(runs.billing_month || '-01', 'YYYY-MM-DD') - interval '1 month')::date
         and items.billing_period_start <
           to_date(runs.billing_month || '-01', 'YYYY-MM-DD')
     ), 0) as source_cost,
     coalesce(sum(results.projected_revenue), 0) as billed_total,
     coalesce(sum(results.projected_revenue), 0) as projected_revenue,
     coalesce(sum(results.projected_margin), 0) as projected_margin
   from azure_billing_runs runs
   left join azure_billing_results results on results.billing_run_id = runs.id
   group by runs.id`;
}

async function loadResultForCalculation(database: Queryable, resultId: string) {
  const result = await database.query<
    ResultRow & {
      run_status: string;
    }
  >(
    `select results.*, runs.status as run_status
     from azure_billing_results results
     inner join azure_billing_runs runs on runs.id = results.billing_run_id
     where results.id = $1`,
    [resultId],
  );
  return result.rows[0];
}

async function getAzureBillingResultById(database: Queryable, resultId: string) {
  const result = await database.query<{ billing_run_id: string }>(
    `select billing_run_id from azure_billing_results where id = $1`,
    [resultId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Azure billing result was not found.');
  const detail = await getAzureBillingRun(database, row.billing_run_id);
  const mapped = detail.results.find((item) => item.id === resultId);
  if (!mapped) throw new Error('Azure billing result was not found.');
  return mapped;
}

async function countCurrentApprovals(database: Queryable, resultId: string, revision: number) {
  const result = await database.query<{ count: string | number }>(
    `select count(distinct reviewer_email) as count
     from azure_billing_result_approvals
     where billing_result_id = $1 and revision = $2 and decision = 'approved'`,
    [resultId, revision],
  );
  return numericValue(result.rows[0]?.count);
}

async function updateRunReadiness(database: Queryable, runId: string) {
  const result = await database.query<{ total: string | number; incomplete: string | number }>(
    `select count(*) as total,
            count(*) filter (where status not in ('approved', 'held')) as incomplete
     from azure_billing_results
     where billing_run_id = $1`,
    [runId],
  );
  const counts = result.rows[0];
  const ready = numericValue(counts?.total) > 0 && numericValue(counts?.incomplete) === 0;
  await database.query(
    `update azure_billing_runs
     set status = $2, updated_at = now()
     where id = $1 and status not in ('released', 'releasing')`,
    [runId, ready ? 'ready-for-billing' : 'review'],
  );
}

async function getOrCreateReleaseBatch(database: Queryable, runId: string, actor: string) {
  const result = await database.query<{ id: string }>(
    `insert into azure_billing_release_batches (billing_run_id, status, released_by)
     values ($1, 'running', $2)
     on conflict (billing_run_id) do update set
       status = 'running',
       released_by = excluded.released_by,
       completed_at = null
     returning id`,
    [runId, actor],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Unable to create Azure billing release batch.');
  return id;
}

async function releaseItemAlreadyWritten(database: Queryable, batchId: string, resultId: string) {
  const result = await database.query<{ id: string }>(
    `select id from azure_billing_release_items
     where release_batch_id = $1 and billing_result_id = $2 and status = 'written'`,
    [batchId, resultId],
  );
  return Boolean(result.rows[0]);
}

async function upsertReleaseItem(
  database: Queryable,
  batchId: string,
  resultId: string,
  status: 'written' | 'blocked' | 'failed' | 'skipped',
  request: unknown,
  response: unknown,
  error?: string,
) {
  await database.query(
    `insert into azure_billing_release_items (
       release_batch_id, billing_result_id, status, request_payload, response_payload, error_message, written_at
     )
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, case when $3 = 'written' then now() else null end)
     on conflict (release_batch_id, billing_result_id) do update set
       status = excluded.status,
       request_payload = excluded.request_payload,
       response_payload = excluded.response_payload,
       error_message = excluded.error_message,
       written_at = excluded.written_at`,
    [batchId, resultId, status, JSON.stringify(request ?? {}), JSON.stringify(response ?? {}), error ?? null],
  );
}

async function insertAuditEvent(
  database: Queryable,
  actor: string,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actor, eventType, entityType, entityId, JSON.stringify(payload ?? {})],
  );
}

function validatePolicyInput(input: UpsertAzureBillingPolicyInput) {
  if (!azureBillingPolicyTypes.includes(input.policyType)) throw new Error('Invalid Azure billing policy type.');
  if (!input.customerId || !input.agreementId || !input.connectWiseAdditionId.trim()) {
    throw new Error('Customer, agreement, and ConnectWise addition are required.');
  }
  if (!input.displayName.trim()) throw new Error('Policy display name is required.');
  if (input.nerdioQuantityAdditionId && input.policyType !== 'fixed-avd-per-user') {
    throw new Error('A separate Nerdio user-count addition is available only for fixed AVD per-user policies.');
  }
  if (input.nerdioQuantityAdditionId === input.connectWiseAdditionId) {
    throw new Error('The Azure cost addition and Nerdio user-count addition must be different.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error('Effective-from must use YYYY-MM-DD.');
  if (input.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) {
    throw new Error('Effective-to must use YYYY-MM-DD.');
  }
  if (
    input.policyType !== 'fixed-avd-per-user' &&
    (!Number.isFinite(input.markupRate) || (input.markupRate ?? -1) < 0)
  ) {
    throw new Error('A non-negative markup rate is required for pass-through policies.');
  }
  if ((input.ingramCustomerAccountIds ?? input.ingramSubscriptionIds ?? []).length === 0) {
    throw new Error('At least one Ingram customer account is required.');
  }
  const invalidFamilies = (input.ingramProductFamilies ?? [])
    .filter((family) => !azureBillingIngramProductFamilies.includes(family));
  if (invalidFamilies.length > 0) {
    throw new Error(`Unsupported Ingram product family: ${invalidFamilies.join(', ')}.`);
  }
  if (input.policyType !== 'ingram-subscription-markup' && (input.nerdioAccountIds ?? []).length === 0) {
    throw new Error('At least one Nerdio account ID is required for AVD policies.');
  }
  if (input.policyType !== 'ingram-subscription-markup' && input.nerdioBillableMetrics?.length === 0) {
    throw new Error('Select at least one Nerdio product for the billable count.');
  }
}

function validateBillingMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Billing month must use YYYY-MM.');
}

function mapPolicyRow(row: PolicyRow): AzureBillingPolicy {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name ?? undefined,
    agreementId: row.agreement_id,
    agreementName: row.agreement_name ?? undefined,
    connectWiseAdditionId: row.connectwise_addition_id,
    nerdioQuantityAdditionId: row.nerdio_quantity_addition_id ?? undefined,
    policyType: row.policy_type as AzureBillingPolicyType,
    displayName: row.display_name,
    ingramCustomerAccountIds: asStringArray(row.ingram_customer_account_ids),
    ingramProductCodes: asStringArray(row.ingram_product_codes),
    ingramProductFamilies: asStringArray(row.ingram_product_families)
      .filter((family): family is AzureBillingIngramProductFamily =>
        azureBillingIngramProductFamilies.includes(family as AzureBillingIngramProductFamily)),
    ingramSubscriptionIds: asStringArray(row.ingram_subscription_ids),
    nerdioAccountIds: asStringArray(row.nerdio_account_ids),
    nerdioBillableMetrics: asStringArray(row.nerdio_billable_metrics),
    markupRate: nullableNumber(row.markup_rate),
    effectiveFrom: isoDate(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? isoDate(row.effective_to).slice(0, 10) : undefined,
    active: row.active,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function mapRunRow(row: RunRow): AzureBillingRunSummary {
  return {
    id: row.id,
    billingMonth: row.billing_month,
    status: row.status,
    requestedBy: row.requested_by,
    shadowAcceptedBy: row.shadow_accepted_by ?? undefined,
    shadowAcceptedAt: row.shadow_accepted_at ? isoDate(row.shadow_accepted_at) : undefined,
    releasedBy: row.released_by ?? undefined,
    releasedAt: row.released_at ? isoDate(row.released_at) : undefined,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    resultCount: numericValue(row.result_count),
    needsReviewCount: numericValue(row.needs_review_count),
    approvedCount: numericValue(row.approved_count),
    heldCount: numericValue(row.held_count),
    failedCount: numericValue(row.failed_count),
    ingramCost: round(numericValue(row.ingram_cost), cents),
    nerdioCost: round(numericValue(row.nerdio_cost), cents),
    combinedCost: round(numericValue(row.combined_cost), cents),
    sourceCost: round(numericValue(row.source_cost), cents),
    billedTotal: round(numericValue(row.billed_total), cents),
    projectedRevenue: round(numericValue(row.projected_revenue), cents),
    projectedMargin: round(numericValue(row.projected_margin), cents),
  };
}

function mapResultRow(row: ResultRow, approvals: ApprovalRow[], billingMonth: string): AzureBillingResult {
  const nerdioQuantityTarget = nerdioQuantityTargetFromSnapshot(row.connectwise_snapshot);
  return {
    id: row.id,
    billingRunId: row.billing_run_id,
    policyId: row.policy_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    agreementId: row.agreement_id,
    agreementName: row.agreement_name,
    connectWiseAgreementId: row.connectwise_agreement_id,
    connectWiseAdditionId: row.connectwise_addition_id,
    nerdioQuantityAdditionId: nerdioQuantityTarget?.connectWiseAdditionId,
    nerdioQuantityCurrentQuantity: nerdioQuantityTarget
      ? numericValue(nerdioQuantityTarget.currentQuantity)
      : undefined,
    nerdioQuantityProposedQuantity: nerdioQuantityTarget
      ? numericValue(row.selected_nerdio_count)
      : undefined,
    nerdioQuantityUnitPrice: nerdioQuantityTarget
      ? nullableNumber(nerdioQuantityTarget.unitPrice)
      : undefined,
    nerdioQuantityUnitCost: nerdioQuantityTarget
      ? nullableNumber(nerdioQuantityTarget.unitCost)
      : undefined,
    policyType: row.policy_type as AzureBillingPolicyType,
    policyDisplayName: row.policy_display_name,
    revision: numericValue(row.revision),
    status: row.status,
    decisionType: row.decision_type as AzureBillingDecisionType,
    selectedNerdioCountSource: (row.selected_nerdio_count_source as NerdioCountSource | null) ?? undefined,
    invoiceNerdioCount: numericValue(row.invoice_nerdio_count),
    liveNerdioCount: historicalLiveNerdioCount(
      row.live_nerdio_count,
      row.source_evidence,
      billingMonth,
    ),
    selectedNerdioCount: numericValue(row.selected_nerdio_count),
    ingramCost: numericValue(row.ingram_cost),
    nerdioCost: numericValue(row.nerdio_cost),
    combinedCost: numericValue(row.combined_cost),
    markupRate: nullableNumber(row.markup_rate),
    currentQuantity: numericValue(row.current_quantity),
    proposedQuantity: numericValue(row.proposed_quantity),
    currentUnitPrice: nullableNumber(row.current_unit_price),
    proposedUnitPrice: nullableNumber(row.proposed_unit_price),
    currentUnitCost: nullableNumber(row.current_unit_cost),
    proposedUnitCost: nullableNumber(row.proposed_unit_cost),
    previousApprovedQuantity: nullableNumber(row.previous_approved_quantity),
    previousApprovedUnitPrice: nullableNumber(row.previous_approved_unit_price),
    previousApprovedUnitCost: nullableNumber(row.previous_approved_unit_cost),
    externalPreTaxOverride: nullableNumber(row.external_pre_tax_override),
    externalPreTaxSuggestedBy: row.external_pre_tax_suggested_by ?? undefined,
    externalBeforeTax: numericValue(row.projected_revenue),
    effectiveMarkupRate: effectiveMarkupRate(
      numericValue(row.projected_revenue),
      numericValue(row.combined_cost),
    ),
    projectedRevenue: numericValue(row.projected_revenue),
    projectedMargin: numericValue(row.projected_margin),
    reviewerNote: row.reviewer_note ?? undefined,
    holdReason: row.hold_reason ?? undefined,
    varianceFlags: asStringArray(row.variance_flags).filter((flag) => flag !== 'unit-cost-rounding-variance'),
    sourceEvidence: asRecord(row.source_evidence),
    connectWiseSnapshot: asRecord(row.connectwise_snapshot),
    ingramChanges: [],
    approvals: approvals.map((approval) => ({
      reviewerEmail: approval.reviewer_email,
      reviewerName: approval.reviewer_name,
      decision: approval.decision,
      comment: approval.comment ?? undefined,
      createdAt: isoDate(approval.created_at),
    })),
  };
}

function nerdioQuantityTargetFromSnapshot(value: unknown): {
  connectWiseAdditionId: string;
  currentQuantity: string | number | null | undefined;
  unitPrice: string | number | null | undefined;
  unitCost: string | number | null | undefined;
  snapshot: Record<string, unknown>;
} | undefined {
  const target = asRecord(asRecord(value).nerdioQuantityAddition);
  const connectWiseAdditionId = String(target.connectWiseAdditionId ?? '').trim();
  if (!connectWiseAdditionId) return undefined;
  return {
    connectWiseAdditionId,
    currentQuantity: scalarNumberValue(target.currentQuantity),
    unitPrice: scalarNumberValue(target.unitPrice),
    unitCost: scalarNumberValue(target.unitCost),
    snapshot: asRecord(target.snapshot),
  };
}

function scalarNumberValue(value: unknown): string | number | null | undefined {
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function historicalLiveNerdioCount(
  value: string | number,
  sourceEvidence: unknown,
  billingMonth: string,
) {
  const collectedAt = String(asRecord(sourceEvidence).nerdioLiveCollectedAt ?? '').trim();
  return collectedAt.slice(0, 7) === billingMonth ? numericValue(value) : undefined;
}

function easternDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function uniqueStrings(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

export function classifyAzureBillingIngramProduct(
  productCode: string,
  productName: string,
): AzureBillingIngramProductFamily | undefined {
  const code = productCode.trim().toUpperCase();
  const name = productName.trim().toLowerCase();
  if (code.startsWith('MS-AZR-') || name.includes('azure')) return 'azure-consumption';
  if (
    code.startsWith('CFQ7TTC0HHS9:')
    || name.includes('windows 365')
    || name.includes('cloud pc')
  ) {
    return 'windows-365';
  }
  return undefined;
}

function numericValue(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assertFiniteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function optionalRound(value: number | undefined, precision: number) {
  return value === undefined ? undefined : round(value, precision);
}

function effectiveMarkupRate(externalBeforeTax: number, combinedCost: number) {
  if (!Number.isFinite(externalBeforeTax) || !Number.isFinite(combinedCost) || combinedCost <= 0) return undefined;
  return round((externalBeforeTax - combinedCost) / combinedCost, 6);
}

function numbersEqual(left: number | undefined, right: number | undefined, precision: number) {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return round(left, precision) === round(right, precision);
}

function isoDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function previousMonthStart(billingMonth: string) {
  validateBillingMonth(billingMonth);
  const [year, month] = billingMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

function nextMonthStart(billingMonth: string) {
  validateBillingMonth(billingMonth);
  const [year, month] = billingMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
