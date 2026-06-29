import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';

export type QueryResult<T> = {
  rows: T[];
};

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export const customerLicenseVendorIds = ['cove', 'ncentral', 'microsoft-365', 'opentext-appriver'] as const;
export const combinedCustomerLicenseVendorId = 'all' as const;

export type CustomerLicenseVendorId = (typeof customerLicenseVendorIds)[number];
export type CustomerLicenseReportVendorId = CustomerLicenseVendorId | typeof combinedCustomerLicenseVendorId;

export type CustomerLicenseReportCustomerOption = {
  customerId: string;
  connectWiseCompanyId?: string;
  customerName: string;
  agreementCount: number;
  mappedVendorIds: CustomerLicenseVendorId[];
};

export type CustomerLicenseReportCustomerOptions = {
  customers: CustomerLicenseReportCustomerOption[];
};

export type CustomerLicenseMonthCount = {
  month: string;
  count: number;
};

export type CustomerLicenseDetailValue = string | number | boolean | null;
export type CustomerLicenseDetailRow = Record<string, CustomerLicenseDetailValue>;

export type CustomerLicenseProductSection = {
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

export type CustomerLicenseReport = {
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

type CustomerRow = {
  customer_id: string;
  connectwise_company_id: string | null;
  customer_name: string;
  agreement_count?: string | number | null;
  mapped_vendor_ids?: unknown;
};

type MonthlyCountRow = {
  observed_month: Date | string;
  product_key: string | null;
  product_code: string | null;
  product_name: string | null;
  count: string | number | null;
};

type NormalizedMonthlyCountRow = MonthlyCountRow & {
  vendorId: CustomerLicenseVendorId;
};

type UsageDetailRow = {
  product_key: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: string | number | null;
  observed_at: Date | string;
  external_account_id: string | null;
  dimensions: unknown;
};

type MicrosoftSubscriptionDetailRow = {
  product_key: string | null;
  product_code: string | null;
  product_name: string | null;
  external_account_id: string;
  tenant_name: string | null;
  tenant_default_domain_name: string | null;
  sku_id: string | null;
  sku_part_number: string | null;
  sku_name: string | null;
  capability_status: string | null;
  subscription_status: string | null;
  subscription_count: string | number | null;
  total_units: string | number | null;
  assigned_units: string | number | null;
  unassigned_units: string | number | null;
  enabled_units: string | number | null;
  suspended_units: string | number | null;
  warning_units: string | number | null;
  locked_out_units: string | number | null;
  next_lifecycle_at: Date | string | null;
  is_trial: boolean | null;
  observed_at: Date | string;
};

type NormalizedDetailRow = {
  vendorId: CustomerLicenseVendorId;
  productKey: string;
  productCode?: string;
  productName: string;
  detail: CustomerLicenseDetailRow;
};

export async function listCustomerLicenseReportCustomers(
  database: Queryable,
): Promise<CustomerLicenseReportCustomerOptions> {
  const result = await database.query<CustomerRow>(
    `select
       customers.id as customer_id,
       customers.connectwise_company_id,
       customers.name as customer_name,
       count(distinct agreements.id) as agreement_count,
       coalesce(
         jsonb_agg(distinct vendor_account_mappings.vendor_id)
           filter (where vendor_account_mappings.vendor_id is not null),
         '[]'::jsonb
       ) as mapped_vendor_ids
     from customers
     left join agreements
       on agreements.customer_id = customers.id
      and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
     left join vendor_account_mappings
       on vendor_account_mappings.customer_id = customers.id
      and vendor_account_mappings.active = true
      and vendor_account_mappings.mapping_status = 'approved'
      and vendor_account_mappings.vendor_id = any($1::text[])
     where coalesce(customers.status, '') !~* 'inactive|deleted'
     group by customers.id, customers.connectwise_company_id, customers.name
     order by customers.name`,
    [[...customerLicenseVendorIds]],
  );

  return {
    customers: result.rows.map((row) => ({
      customerId: row.customer_id,
      connectWiseCompanyId: stringValue(row.connectwise_company_id) ?? undefined,
      customerName: row.customer_name,
      agreementCount: integerValue(row.agreement_count),
      mappedVendorIds: arrayValue(row.mapped_vendor_ids).filter(isCustomerLicenseVendorId),
    })),
  };
}

export async function getCustomerLicenseReport(
  database: Queryable,
  options: {
    customerId: string;
    vendorId: CustomerLicenseReportVendorId;
    monthCount?: number;
    includeMicrosoftUserDetails?: boolean;
  },
): Promise<CustomerLicenseReport | undefined> {
  const monthCount = Math.min(Math.max(options.monthCount ?? 12, 1), 24);
  const customer = await loadCustomer(database, options.customerId);

  if (!customer) {
    return undefined;
  }

  if (options.vendorId === combinedCustomerLicenseVendorId) {
    return getCombinedCustomerLicenseReport(database, customer, {
      monthCount,
      includeMicrosoftUserDetails: options.includeMicrosoftUserDetails === true,
    });
  }

  if (options.vendorId === 'microsoft-365') {
    return getMicrosoft365CustomerLicenseReport(database, customer, {
      monthCount,
      includeMicrosoftUserDetails: options.includeMicrosoftUserDetails === true,
    });
  }

  return getUsageSnapshotCustomerLicenseReport(database, customer, {
    vendorId: options.vendorId,
    monthCount,
  });
}

export function isCustomerLicenseVendorId(value: string | undefined): value is CustomerLicenseVendorId {
  return customerLicenseVendorIds.includes(value as CustomerLicenseVendorId);
}

export function isCustomerLicenseReportVendorId(value: string | undefined): value is CustomerLicenseReportVendorId {
  return value === combinedCustomerLicenseVendorId || isCustomerLicenseVendorId(value);
}

async function loadCustomer(database: Queryable, customerId: string) {
  const result = await database.query<CustomerRow>(
    `select
       id as customer_id,
       connectwise_company_id,
       name as customer_name
     from customers
     where id = $1
     limit 1`,
    [customerId],
  );

  return result.rows[0];
}

async function getUsageSnapshotCustomerLicenseReport(
  database: Queryable,
  customer: CustomerRow,
  options: {
    vendorId: Exclude<CustomerLicenseVendorId, 'microsoft-365'>;
    monthCount: number;
  },
): Promise<CustomerLicenseReport> {
  const [monthlyRows, detailRows] = await Promise.all([
    loadUsageSnapshotMonthlyCounts(database, options.vendorId, customer.customer_id, options.monthCount),
    loadCurrentUsageSnapshotDetails(database, options.vendorId, customer.customer_id),
  ]);

  return buildReport({
    customer,
    reportVendorId: options.vendorId,
    monthCount: options.monthCount,
    monthlyRows: monthlyRows.map((row) => ({ ...row, vendorId: options.vendorId })),
    detailRows: detailRows.map((row) => mapUsageDetailRow(options.vendorId, row)),
  });
}

async function getMicrosoft365CustomerLicenseReport(
  database: Queryable,
  customer: CustomerRow,
  options: {
    monthCount: number;
    includeMicrosoftUserDetails: boolean;
  },
): Promise<CustomerLicenseReport> {
  const [monthlyRows, subscriptionRows, userRows] = await Promise.all([
    loadMicrosoft365MonthlyLicenseCounts(database, customer.customer_id, options.monthCount),
    loadCurrentMicrosoft365SubscriptionDetails(database, customer.customer_id),
    options.includeMicrosoftUserDetails ? loadCurrentMicrosoft365UserDetails(database, customer.customer_id) : Promise.resolve([]),
  ]);
  const subscriptionDetails = subscriptionRows.map(mapMicrosoft365SubscriptionDetailRow);
  const userDetails = userRows.map(mapMicrosoft365UserDetailRow);

  return buildReport({
    customer,
    reportVendorId: 'microsoft-365',
    monthCount: options.monthCount,
    monthlyRows: monthlyRows.map((row) => ({ ...row, vendorId: 'microsoft-365' })),
    detailRows: [...subscriptionDetails, ...userDetails],
    microsoftUserDetailCount: userDetails.length,
  });
}

async function getCombinedCustomerLicenseReport(
  database: Queryable,
  customer: CustomerRow,
  options: {
    monthCount: number;
    includeMicrosoftUserDetails: boolean;
  },
): Promise<CustomerLicenseReport> {
  const [coveMonthlyRows, coveDetailRows, ncentralMonthlyRows, ncentralDetailRows, appRiverMonthlyRows, appRiverDetailRows, microsoftMonthlyRows, microsoftSubscriptionRows, microsoftUserRows] =
    await Promise.all([
      loadUsageSnapshotMonthlyCounts(database, 'cove', customer.customer_id, options.monthCount),
      loadCurrentUsageSnapshotDetails(database, 'cove', customer.customer_id),
      loadUsageSnapshotMonthlyCounts(database, 'ncentral', customer.customer_id, options.monthCount),
      loadCurrentUsageSnapshotDetails(database, 'ncentral', customer.customer_id),
      loadUsageSnapshotMonthlyCounts(database, 'opentext-appriver', customer.customer_id, options.monthCount),
      loadCurrentUsageSnapshotDetails(database, 'opentext-appriver', customer.customer_id),
      loadMicrosoft365MonthlyLicenseCounts(database, customer.customer_id, options.monthCount),
      loadCurrentMicrosoft365SubscriptionDetails(database, customer.customer_id),
      options.includeMicrosoftUserDetails ? loadCurrentMicrosoft365UserDetails(database, customer.customer_id) : Promise.resolve([]),
    ]);

  const microsoftUserDetails = microsoftUserRows.map(mapMicrosoft365UserDetailRow);

  return buildReport({
    customer,
    reportVendorId: combinedCustomerLicenseVendorId,
    monthCount: options.monthCount,
    monthlyRows: [
      ...coveMonthlyRows.map((row) => ({ ...row, vendorId: 'cove' as const })),
      ...ncentralMonthlyRows.map((row) => ({ ...row, vendorId: 'ncentral' as const })),
      ...appRiverMonthlyRows.map((row) => ({ ...row, vendorId: 'opentext-appriver' as const })),
      ...microsoftMonthlyRows.map((row) => ({ ...row, vendorId: 'microsoft-365' as const })),
    ],
    detailRows: [
      ...coveDetailRows.map((row) => mapUsageDetailRow('cove', row)),
      ...ncentralDetailRows.map((row) => mapUsageDetailRow('ncentral', row)),
      ...appRiverDetailRows.map((row) => mapUsageDetailRow('opentext-appriver', row)),
      ...microsoftSubscriptionRows.map(mapMicrosoft365SubscriptionDetailRow),
      ...microsoftUserDetails,
    ],
    microsoftUserDetailCount: microsoftUserDetails.length,
  });
}

async function loadUsageSnapshotMonthlyCounts(
  database: Queryable,
  vendorId: CustomerLicenseVendorId,
  customerId: string,
  monthCount: number,
) {
  const result = await database.query<MonthlyCountRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as effective_customer_id
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.vendor_id = $1
     ),
     latest as (
       select max(observed_at) as latest_observed_at
       from mapped_snapshots
       where effective_customer_id = $2::uuid
     ),
     monthly_latest as (
       select date_trunc('month', observed_at) as observed_month,
              max(observed_at) as latest_observed_at
       from mapped_snapshots
       cross join latest
       where effective_customer_id = $2::uuid
         and observed_at >= date_trunc('month', coalesce(latest.latest_observed_at, now())) - (($3::int - 1) * interval '1 month')
         and observed_at < date_trunc('month', coalesce(latest.latest_observed_at, now())) + interval '1 month'
       group by date_trunc('month', observed_at)
     )
     select
       monthly_latest.observed_month,
       coalesce(mapped_snapshots.vendor_product_key, mapped_snapshots.product_code) as product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       sum(mapped_snapshots.quantity) as count
     from mapped_snapshots
     inner join monthly_latest
       on date_trunc('month', mapped_snapshots.observed_at) = monthly_latest.observed_month
      and mapped_snapshots.observed_at = monthly_latest.latest_observed_at
     where mapped_snapshots.effective_customer_id = $2::uuid
     group by monthly_latest.observed_month, product_key, mapped_snapshots.product_code, mapped_snapshots.product_name
     order by monthly_latest.observed_month, mapped_snapshots.product_name, mapped_snapshots.product_code`,
    [vendorId, customerId, monthCount],
  );

  return result.rows;
}

async function loadCurrentUsageSnapshotDetails(
  database: Queryable,
  vendorId: CustomerLicenseVendorId,
  customerId: string,
) {
  const result = await database.query<UsageDetailRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as effective_customer_id
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.vendor_id = $1
     ),
     latest as (
       select max(observed_at) as latest_observed_at
       from mapped_snapshots
       where effective_customer_id = $2::uuid
     )
     select
       coalesce(mapped_snapshots.vendor_product_key, mapped_snapshots.product_code) as product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.external_account_id,
       mapped_snapshots.dimensions
     from mapped_snapshots
     cross join latest
     where mapped_snapshots.effective_customer_id = $2::uuid
       and mapped_snapshots.observed_at = latest.latest_observed_at
     order by mapped_snapshots.product_name, mapped_snapshots.product_code, mapped_snapshots.external_account_id`,
    [vendorId, customerId],
  );

  return result.rows;
}

async function loadMicrosoft365MonthlyLicenseCounts(
  database: Queryable,
  customerId: string,
  monthCount: number,
) {
  const result = await database.query<MonthlyCountRow>(
    `with mapped_snapshots as (
       select
         microsoft365_subscription_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else microsoft365_subscription_snapshots.customer_id
         end as effective_customer_id
       from microsoft365_subscription_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'microsoft-365'
        and vendor_account_mappings.external_account_id = microsoft365_subscription_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
     ),
     latest as (
       select max(observed_at) as latest_observed_at
       from mapped_snapshots
       where effective_customer_id = $1::uuid
     ),
     monthly_latest as (
       select date_trunc('month', observed_at) as observed_month,
              max(observed_at) as latest_observed_at
       from mapped_snapshots
       cross join latest
       where effective_customer_id = $1::uuid
         and observed_at >= date_trunc('month', coalesce(latest.latest_observed_at, now())) - (($2::int - 1) * interval '1 month')
         and observed_at < date_trunc('month', coalesce(latest.latest_observed_at, now())) + interval '1 month'
       group by date_trunc('month', observed_at)
     )
     select
       monthly_latest.observed_month,
       coalesce(mapped_snapshots.sku_part_number, mapped_snapshots.sku_id, mapped_snapshots.sku_name) as product_key,
       coalesce(mapped_snapshots.sku_part_number, mapped_snapshots.sku_id) as product_code,
       coalesce(mapped_snapshots.sku_name, mapped_snapshots.sku_part_number, mapped_snapshots.sku_id) as product_name,
       sum(coalesce(mapped_snapshots.total_units, mapped_snapshots.assigned_units, mapped_snapshots.enabled_units, 0)) as count
     from mapped_snapshots
     inner join monthly_latest
       on date_trunc('month', mapped_snapshots.observed_at) = monthly_latest.observed_month
      and mapped_snapshots.observed_at = monthly_latest.latest_observed_at
     where mapped_snapshots.effective_customer_id = $1::uuid
     group by monthly_latest.observed_month, product_key, product_code, product_name
     order by monthly_latest.observed_month, product_name, product_code`,
    [customerId, monthCount],
  );

  return result.rows;
}

async function loadCurrentMicrosoft365SubscriptionDetails(database: Queryable, customerId: string) {
  const result = await database.query<MicrosoftSubscriptionDetailRow>(
    `with mapped_snapshots as (
       select
         microsoft365_subscription_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else microsoft365_subscription_snapshots.customer_id
         end as effective_customer_id
       from microsoft365_subscription_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = 'microsoft-365'
        and vendor_account_mappings.external_account_id = microsoft365_subscription_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
     ),
     latest as (
       select max(observed_at) as latest_observed_at
       from mapped_snapshots
       where effective_customer_id = $1::uuid
     )
     select
       coalesce(mapped_snapshots.sku_part_number, mapped_snapshots.sku_id, mapped_snapshots.sku_name) as product_key,
       coalesce(mapped_snapshots.sku_part_number, mapped_snapshots.sku_id) as product_code,
       coalesce(mapped_snapshots.sku_name, mapped_snapshots.sku_part_number, mapped_snapshots.sku_id) as product_name,
       mapped_snapshots.external_account_id,
       mapped_snapshots.tenant_name,
       mapped_snapshots.tenant_default_domain_name,
       mapped_snapshots.sku_id,
       mapped_snapshots.sku_part_number,
       mapped_snapshots.sku_name,
       mapped_snapshots.capability_status,
       mapped_snapshots.subscription_status,
       mapped_snapshots.subscription_count,
       mapped_snapshots.total_units,
       mapped_snapshots.assigned_units,
       mapped_snapshots.unassigned_units,
       mapped_snapshots.enabled_units,
       mapped_snapshots.suspended_units,
       mapped_snapshots.warning_units,
       mapped_snapshots.locked_out_units,
       mapped_snapshots.next_lifecycle_at,
       mapped_snapshots.is_trial,
       mapped_snapshots.observed_at
     from mapped_snapshots
     cross join latest
     where mapped_snapshots.effective_customer_id = $1::uuid
       and mapped_snapshots.observed_at = latest.latest_observed_at
     order by product_name, product_code, mapped_snapshots.tenant_name`,
    [customerId],
  );

  return result.rows;
}

async function loadCurrentMicrosoft365UserDetails(database: Queryable, customerId: string) {
  const result = await database.query<UsageDetailRow>(
    `with mapped_snapshots as (
       select
         vendor_usage_snapshots.*,
         case
           when vendor_account_mappings.external_account_id is not null then vendor_account_mappings.customer_id
           else vendor_usage_snapshots.customer_id
         end as effective_customer_id
       from vendor_usage_snapshots
       left join vendor_account_mappings
         on vendor_account_mappings.vendor_id = vendor_usage_snapshots.vendor_id
        and vendor_account_mappings.external_account_id = vendor_usage_snapshots.external_account_id
        and vendor_account_mappings.active = true
        and vendor_account_mappings.mapping_status = 'approved'
       where vendor_usage_snapshots.vendor_id = 'microsoft-365'
     ),
     latest as (
       select max(observed_at) as latest_observed_at
       from mapped_snapshots
       where effective_customer_id = $1::uuid
     )
     select
       coalesce(mapped_snapshots.vendor_product_key, mapped_snapshots.product_code) as product_key,
       mapped_snapshots.product_code,
       mapped_snapshots.product_name,
       mapped_snapshots.quantity,
       mapped_snapshots.observed_at,
       mapped_snapshots.external_account_id,
       mapped_snapshots.dimensions
     from mapped_snapshots
     cross join latest
     where mapped_snapshots.effective_customer_id = $1::uuid
       and mapped_snapshots.observed_at = latest.latest_observed_at
     order by mapped_snapshots.product_name, mapped_snapshots.dimensions->>'displayName', mapped_snapshots.dimensions->>'userPrincipalName'`,
    [customerId],
  );

  return result.rows;
}

function buildReport(input: {
  customer: CustomerRow;
  reportVendorId: CustomerLicenseReportVendorId;
  monthCount: number;
  monthlyRows: NormalizedMonthlyCountRow[];
  detailRows: NormalizedDetailRow[];
  microsoftUserDetailCount?: number;
}): CustomerLicenseReport {
  const anchor =
    [...input.monthlyRows.map((row) => dateValue(row.observed_month))]
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? new Date();
  const months = monthKeysForAnchor(anchor, input.monthCount);
  const monthSet = new Set(months);
  const products = new Map<string, ProductAccumulator>();

  for (const row of input.monthlyRows) {
    const month = monthKey(row.observed_month);
    if (!month || !monthSet.has(month)) {
      continue;
    }

    const product = productAccumulator(products, {
      reportVendorId: input.reportVendorId,
      vendorId: row.vendorId,
      productKey: row.product_key,
      productCode: row.product_code,
      productName: row.product_name,
      months,
    });
    product.months.set(month, roundCount((product.months.get(month) ?? 0) + numericValue(row.count)));
  }

  for (const row of input.detailRows) {
    const product = productAccumulator(products, {
      reportVendorId: input.reportVendorId,
      vendorId: row.vendorId,
      productKey: row.productKey,
      productCode: row.productCode,
      productName: row.productName,
      months,
    });
    product.detailRows.push(row.detail);
  }

  const productSections = [...products.values()]
    .map((product) => {
      const monthRows = months.map((month) => ({
        month,
        count: roundCount(product.months.get(month) ?? 0),
      }));
      const lastNonZeroMonth = [...monthRows].reverse().find((row) => row.count !== 0);

      return {
        productKey: product.productKey,
        productCode: product.productCode,
        productName: product.productName,
        vendor: {
          integrationId: product.vendorId,
          integrationName: integrationDisplayName(product.vendorId),
        },
        currentCount: lastNonZeroMonth?.count ?? 0,
        months: monthRows,
        detailColumns: detailColumnsForRows(product.detailRows),
        detailRows: product.detailRows,
      };
    })
    .sort((left, right) =>
      left.vendor.integrationName.localeCompare(right.vendor.integrationName) ||
      left.productName.localeCompare(right.productName) ||
      left.productKey.localeCompare(right.productKey),
    );
  const vendorCount = new Set(productSections.map((product) => product.vendor.integrationId)).size;

  return {
    reportType: 'customer-license',
    generatedAt: new Date().toISOString(),
    customer: {
      customerId: input.customer.customer_id,
      connectWiseCompanyId: stringValue(input.customer.connectwise_company_id) ?? undefined,
      customerName: input.customer.customer_name,
    },
    vendor: {
      integrationId: input.reportVendorId,
      integrationName: integrationDisplayName(input.reportVendorId),
    },
    startMonth: months[0] ?? '',
    endMonth: months[months.length - 1] ?? '',
    months,
    summary: {
      productCount: productSections.length,
      vendorCount,
      totalCurrentCount: roundCount(productSections.reduce((total, product) => total + product.currentCount, 0)),
      detailRowCount: productSections.reduce((total, product) => total + product.detailRows.length, 0),
      microsoftUserDetailCount: input.microsoftUserDetailCount ?? 0,
    },
    products: productSections,
  };
}

type ProductAccumulator = {
  productKey: string;
  productCode?: string;
  productName: string;
  vendorId: CustomerLicenseVendorId;
  months: Map<string, number>;
  detailRows: CustomerLicenseDetailRow[];
};

function productAccumulator(
  products: Map<string, ProductAccumulator>,
  input: {
    reportVendorId: CustomerLicenseReportVendorId;
    vendorId: CustomerLicenseVendorId;
    productKey: string | null | undefined;
    productCode?: string | null;
    productName?: string | null;
    months: string[];
  },
) {
  const sourceProductKey = stringValue(input.productKey) ?? stringValue(input.productCode) ?? stringValue(input.productName) ?? 'unknown-product';
  const productKey = input.reportVendorId === combinedCustomerLicenseVendorId
    ? `${input.vendorId}:${sourceProductKey}`
    : sourceProductKey;
  const existing = products.get(productKey);
  if (existing) {
    if (!existing.productCode && input.productCode) {
      existing.productCode = input.productCode;
    }
    if (existing.productName === productKey && input.productName) {
      existing.productName = input.productName;
    }
    return existing;
  }

  const next = {
    productKey,
    productCode: stringValue(input.productCode) ?? undefined,
    productName: stringValue(input.productName) ?? sourceProductKey,
    vendorId: input.vendorId,
    months: new Map(input.months.map((month) => [month, 0])),
    detailRows: [],
  };
  products.set(productKey, next);
  return next;
}

function mapUsageDetailRow(
  vendorId: Exclude<CustomerLicenseVendorId, 'microsoft-365'>,
  row: UsageDetailRow,
): NormalizedDetailRow {
  const dimensions = recordFromJson(row.dimensions);
  const base = {
    Vendor: integrationDisplayName(vendorId),
    ProductName: row.product_name,
    ProductCode: row.product_code,
    Quantity: numericValue(row.quantity),
    ObservedAt: isoDate(row.observed_at),
  };
  let detail: CustomerLicenseDetailRow;

  if (vendorId === 'cove') {
    detail = compactDetail({
      DetailType: 'Device',
      Hostname: stringValue(dimensions.hostname),
      ProtectedSystemType: stringValue(dimensions.protectedSystemType),
      Physicality: stringValue(dimensions.physicality),
      ...base,
      SelectedStorageGB: optionalNumericValue(dimensions.selectedStorageGb),
      UsedStorageGB: optionalNumericValue(dimensions.usedStorageGb),
      AccountId: primitiveValue(dimensions.accountId),
      OS: stringValue(dimensions.os),
      DataSources: stringValue(dimensions.dataSources),
      CreationDate: stringValue(dimensions.creationDate),
      ExpirationDate: stringValue(dimensions.expirationDate),
      LastComplete: stringValue(dimensions.lastComplete),
    });
  } else if (vendorId === 'ncentral') {
    detail = compactDetail({
      DetailType: 'Device',
      DeviceId: primitiveValue(dimensions.ncentralDeviceId),
      Hostname: stringValue(dimensions.hostname),
      DeviceClass: stringValue(dimensions.deviceClass),
      ...base,
      ProductFilter: stringValue(dimensions.productFilterName),
      OverlayTags: arrayValue(dimensions.overlayTags).join(', ') || null,
      LastCheckIn: stringValue(dimensions.lastApplianceCheckinTime),
      OS: stringValue(dimensions.operatingSystem),
      Site: stringValue(dimensions.siteName),
    });
  } else {
    detail = compactDetail({
      DetailType: 'Subscription',
      AppRiverCustomer: stringValue(dimensions.customerName) ?? stringValue(dimensions.appRiverCustomerName),
      AppRiverCustomerId: primitiveValue(dimensions.appRiverCustomerId),
      Domain: stringValue(dimensions.domain),
      ...base,
      TotalLicenses: optionalNumericValue(dimensions.totalLicenses),
      AssignedLicenses: optionalNumericValue(dimensions.assignedLicenses),
      UnassignedLicenses: optionalNumericValue(dimensions.unassignedLicenses),
      SubscriptionTerm: stringValue(dimensions.subscriptionTerm),
      BillingFrequency: stringValue(dimensions.billingFrequency),
      CommitmentEndDate: stringValue(dimensions.commitmentEndDate),
      ExpirationDate: stringValue(dimensions.expirationDate),
      IsTrial: primitiveValue(dimensions.isTrial),
      SubscriptionKey: stringValue(dimensions.subscriptionKey),
    });
  }

  return {
    vendorId,
    productKey: stringValue(row.product_key) ?? stringValue(row.product_code) ?? stringValue(row.product_name) ?? 'unknown-product',
    productCode: stringValue(row.product_code) ?? undefined,
    productName: stringValue(row.product_name) ?? stringValue(row.product_key) ?? 'Unknown product',
    detail,
  };
}

function mapMicrosoft365SubscriptionDetailRow(
  row: MicrosoftSubscriptionDetailRow,
): NormalizedDetailRow {
  return {
    vendorId: 'microsoft-365',
    productKey: stringValue(row.product_key) ?? stringValue(row.product_code) ?? stringValue(row.product_name) ?? 'unknown-product',
    productCode: stringValue(row.product_code) ?? undefined,
    productName: stringValue(row.product_name) ?? stringValue(row.product_key) ?? 'Unknown product',
    detail: compactDetail({
      Vendor: integrationDisplayName('microsoft-365'),
      DetailType: 'License total',
      TenantName: row.tenant_name,
      SkuPartNumber: row.sku_part_number,
      SkuName: row.sku_name,
      SubscriptionStatus: row.subscription_status,
      CapabilityStatus: row.capability_status,
      TotalUnits: optionalNumericValue(row.total_units),
      AssignedUnits: optionalNumericValue(row.assigned_units),
      UnassignedUnits: optionalNumericValue(row.unassigned_units),
      EnabledUnits: optionalNumericValue(row.enabled_units),
      SuspendedUnits: optionalNumericValue(row.suspended_units),
      WarningUnits: optionalNumericValue(row.warning_units),
      LockedOutUnits: optionalNumericValue(row.locked_out_units),
      SubscriptionCount: optionalNumericValue(row.subscription_count),
      IsTrial: row.is_trial,
      NextLifecycleAt: isoDate(row.next_lifecycle_at),
      ObservedAt: isoDate(row.observed_at),
    }),
  };
}

function mapMicrosoft365UserDetailRow(
  row: UsageDetailRow,
): NormalizedDetailRow {
  const dimensions = recordFromJson(row.dimensions);
  const userPrincipalName = unredactedStringValue(dimensions.userPrincipalName);
  const email =
    unredactedStringValue(dimensions.email) ??
    unredactedStringValue(dimensions.mail) ??
    userPrincipalName;

  return {
    vendorId: 'microsoft-365',
    productKey: stringValue(row.product_key) ?? stringValue(row.product_code) ?? stringValue(row.product_name) ?? 'unknown-product',
    productCode: stringValue(row.product_code) ?? undefined,
    productName: stringValue(row.product_name) ?? stringValue(row.product_key) ?? 'Unknown product',
    detail: compactDetail({
      Vendor: integrationDisplayName('microsoft-365'),
      DetailType: 'Licensed user',
      TenantName: stringValue(dimensions.tenantName),
      UserPrincipalName: userPrincipalName ?? email,
      Email: email,
      DisplayName: unredactedStringValue(dimensions.displayName),
      UserState: stringValue(dimensions.userState),
      SkuName: stringValue(dimensions.skuName),
      SkuId: stringValue(dimensions.skuId),
      ProductName: row.product_name,
      ProductCode: row.product_code,
      Quantity: numericValue(row.quantity),
      ObservedAt: isoDate(row.observed_at),
    }),
  };
}

function detailColumnsForRows(rows: CustomerLicenseDetailRow[]) {
  const preferredOrder = [
    'Vendor',
    'DetailType',
    'TenantName',
    'AppRiverCustomer',
    'AppRiverCustomerId',
    'Domain',
    'Hostname',
    'DeviceId',
    'ProtectedSystemType',
    'DeviceClass',
    'DisplayName',
    'Email',
    'UserPrincipalName',
    'UserState',
    'ProductName',
    'ProductCode',
    'SkuPartNumber',
    'SkuName',
    'Quantity',
    'TotalUnits',
    'AssignedUnits',
    'UnassignedUnits',
    'EnabledUnits',
    'SuspendedUnits',
    'WarningUnits',
    'LockedOutUnits',
    'SubscriptionCount',
    'SubscriptionStatus',
    'CapabilityStatus',
    'ProductFilter',
    'OverlayTags',
    'Physicality',
    'SelectedStorageGB',
    'UsedStorageGB',
    'AccountId',
    'OS',
    'Site',
    'DataSources',
    'CreationDate',
    'ExpirationDate',
    'LastComplete',
    'LastCheckIn',
    'SubscriptionTerm',
    'BillingFrequency',
    'CommitmentEndDate',
    'IsTrial',
    'NextLifecycleAt',
    'SubscriptionKey',
    'ObservedAt',
  ];
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  const ordered = preferredOrder.filter((column) => columns.has(column));
  const extras = [...columns].filter((column) => !preferredOrder.includes(column)).sort();
  return [...ordered, ...extras];
}

function compactDetail(values: Record<string, CustomerLicenseDetailValue | undefined>): CustomerLicenseDetailRow {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as CustomerLicenseDetailRow;
}

function integrationDisplayName(integrationId: CustomerLicenseReportVendorId) {
  if (integrationId === combinedCustomerLicenseVendorId) {
    return 'All licenses';
  }

  return getIntegrationSettingsDefinition(integrationId as IntegrationId)?.displayName ?? integrationId;
}

function monthKeysForAnchor(anchor: Date, count: number) {
  const anchorMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    return formatMonthKey(new Date(Date.UTC(anchorMonth.getUTCFullYear(), anchorMonth.getUTCMonth() + offset, 1)));
  });
}

function monthKey(value: Date | string) {
  const date = dateValue(value);
  return date ? formatMonthKey(date) : undefined;
}

function formatMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return recordFromJson(parsed);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return arrayValue(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function stringValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unredactedStringValue(value: unknown) {
  const text = stringValue(value);
  return text && text.toLowerCase() !== '[redacted]' ? text : null;
}

function numericValue(value: unknown) {
  return optionalNumericValue(value) ?? 0;
}

function optionalNumericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function integerValue(value: unknown) {
  const numeric = optionalNumericValue(value);
  return typeof numeric === 'number' ? Math.trunc(numeric) : 0;
}

function primitiveValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function isoDate(value: Date | string | null | undefined) {
  const date = dateValue(value);
  return date ? date.toISOString() : null;
}

function roundCount(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
