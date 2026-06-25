import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import type { Queryable } from './agreementReports';

export type ProductProfitabilityMonth = {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
};

export type ProductProfitabilityIntegrationSeries = {
  integrationId: string;
  integrationName: string;
  months: ProductProfitabilityMonth[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  productCount: number;
  missingCostRows: number;
};

export type ProductProfitabilityReport = {
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

type ActiveIntegrationRow = {
  integration_id: string;
  display_name: string | null;
};

type ProfitabilityHistoryRow = {
  vendor_id: string;
  observed_month: Date | string;
  product_code: string;
  observed_quantity: string | number;
  unit_price: string | number | null;
  raw_payload: unknown;
};

type IntegrationAccumulator = {
  integrationId: string;
  integrationName: string;
  months: Map<string, ProductProfitabilityMonth>;
  productCodes: Set<string>;
  missingCostRows: number;
};

export async function getProductProfitabilityReport(
  database: Queryable,
  options: { monthCount?: number } = {},
): Promise<ProductProfitabilityReport> {
  const monthCount = Math.min(Math.max(options.monthCount ?? 12, 1), 24);
  const activeIntegrationResult = await database.query<ActiveIntegrationRow>(
    `select integration_id, display_name
     from integration_settings
     where configured_status <> 'not-configured'
       and integration_id <> 'connectwise'
     order by display_name, integration_id`,
  );
  const activeIntegrations = activeIntegrationResult.rows.map((row) => ({
    integrationId: row.integration_id,
    integrationName:
      getIntegrationSettingsDefinition(row.integration_id as IntegrationId)?.displayName ??
      row.display_name ??
      row.integration_id,
  }));

  if (activeIntegrations.length === 0) {
    const months = monthKeysForAnchor(new Date(), monthCount);
    return buildReport(months, []);
  }

  const activeIntegrationIds = activeIntegrations.map((integration) => integration.integrationId);
  const historyResult = await database.query<ProfitabilityHistoryRow>(
    `with mapped_products as (
       select distinct vendor_id, connectwise_product_code as product_code
       from vendor_product_mappings
       where active = true
         and mapping_status = 'approved'
         and coalesce(connectwise_product_code, '') <> ''
       union
       select distinct vendor_id, connectwise_product_code as product_code
       from vendor_product_bundles
       where active = true
         and mapping_status = 'approved'
         and coalesce(connectwise_product_code, '') <> ''
     ),
     latest as (
       select max(addition_history.observed_at) as latest_observed_at
       from addition_history
       inner join agreement_additions
         on agreement_additions.id = addition_history.agreement_addition_id
       inner join agreements
         on agreements.id = addition_history.agreement_id
       inner join mapped_products
         on lower(mapped_products.product_code) = lower(addition_history.product_code)
       where mapped_products.vendor_id = any($1::text[])
         and coalesce(addition_history.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(addition_history.raw_payload->>'additionStatus', addition_history.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(addition_history.raw_payload->>'agreementStatus', addition_history.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
         and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     )
     select
       mapped_products.vendor_id,
       date_trunc('month', addition_history.observed_at) as observed_month,
       addition_history.product_code,
       addition_history.observed_quantity,
       addition_history.unit_price,
       addition_history.raw_payload
     from addition_history
     inner join agreement_additions
       on agreement_additions.id = addition_history.agreement_addition_id
     inner join agreements
       on agreements.id = addition_history.agreement_id
     inner join mapped_products
       on lower(mapped_products.product_code) = lower(addition_history.product_code)
     cross join latest
     where mapped_products.vendor_id = any($1::text[])
       and addition_history.observed_at >= date_trunc('month', coalesce(latest.latest_observed_at, now())) - (($2::int - 1) * interval '1 month')
       and addition_history.observed_at < date_trunc('month', coalesce(latest.latest_observed_at, now())) + interval '1 month'
       and coalesce(addition_history.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(addition_history.raw_payload->>'additionStatus', addition_history.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(addition_history.raw_payload->>'agreementStatus', addition_history.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.addition_status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'additionStatus', agreement_additions.raw_payload->>'AdditionStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreement_additions.raw_payload->>'agreementStatus', agreement_additions.raw_payload->>'AgreementStatus', '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.status, '') !~* 'expired|cancelled|canceled|inactive'
       and coalesce(agreements.raw_payload->>'agreementStatus', agreements.raw_payload->>'AgreementStatus', agreements.raw_payload->'status'->>'name', '') !~* 'expired|cancelled|canceled|inactive'
     order by observed_month, mapped_products.vendor_id, addition_history.product_code`,
    [activeIntegrationIds, monthCount],
  );

  const anchor =
    historyResult.rows
      .map((row) => dateValue(row.observed_month))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? new Date();
  const months = monthKeysForAnchor(anchor, monthCount);
  const monthSet = new Set(months);
  const accumulators = new Map<string, IntegrationAccumulator>(
    activeIntegrations.map((integration) => [
      integration.integrationId,
      {
        integrationId: integration.integrationId,
        integrationName: integration.integrationName,
        months: new Map(
          months.map((month) => [
            month,
            {
              month,
              revenue: 0,
              cost: 0,
              profit: 0,
            },
          ]),
        ),
        productCodes: new Set<string>(),
        missingCostRows: 0,
      },
    ]),
  );

  for (const row of historyResult.rows) {
    const month = monthKey(row.observed_month);
    if (!month || !monthSet.has(month)) {
      continue;
    }

    const accumulator = accumulators.get(row.vendor_id);
    if (!accumulator) {
      continue;
    }

    const raw = recordFromJson(row.raw_payload);
    const quantity = numericValue(row.observed_quantity);
    const unitPrice = optionalNumericValue(raw.unitPrice) ?? optionalNumericValue(row.unit_price) ?? 0;
    const extendedRevenue = optionalNumericValue(raw.extPrice);
    const unitCost = optionalNumericValue(raw.unitCost);
    const extendedCost = optionalNumericValue(raw.extCost);
    const revenue = extendedRevenue ?? quantity * unitPrice;
    const cost = extendedCost ?? (typeof unitCost === 'number' ? quantity * unitCost : 0);
    const monthTotals = accumulator.months.get(month);

    if (!monthTotals) {
      continue;
    }

    monthTotals.revenue += revenue;
    monthTotals.cost += cost;
    monthTotals.profit += revenue - cost;
    accumulator.productCodes.add(row.product_code);

    if (typeof extendedCost !== 'number' && typeof unitCost !== 'number') {
      accumulator.missingCostRows += 1;
    }
  }

  return buildReport(months, Array.from(accumulators.values()));
}

function buildReport(months: string[], accumulators: IntegrationAccumulator[]): ProductProfitabilityReport {
  const integrations = accumulators
    .map((accumulator) => {
      const monthRows = months.map((month) => roundMonth(accumulator.months.get(month) ?? emptyMonth(month)));
      const totalRevenue = roundMoney(monthRows.reduce((total, row) => total + row.revenue, 0));
      const totalCost = roundMoney(monthRows.reduce((total, row) => total + row.cost, 0));
      const totalProfit = roundMoney(totalRevenue - totalCost);

      return {
        integrationId: accumulator.integrationId,
        integrationName: accumulator.integrationName,
        months: monthRows,
        totalRevenue,
        totalCost,
        totalProfit,
        productCount: accumulator.productCodes.size,
        missingCostRows: accumulator.missingCostRows,
      };
    })
    .sort((left, right) => right.totalProfit - left.totalProfit || left.integrationName.localeCompare(right.integrationName));

  const totalRevenue = roundMoney(integrations.reduce((total, integration) => total + integration.totalRevenue, 0));
  const totalCost = roundMoney(integrations.reduce((total, integration) => total + integration.totalCost, 0));
  const totalProfit = roundMoney(totalRevenue - totalCost);

  return {
    reportType: 'product-profitability',
    generatedAt: new Date().toISOString(),
    currency: 'USD',
    startMonth: months[0] ?? '',
    endMonth: months[months.length - 1] ?? '',
    months,
    summary: {
      integrationCount: integrations.length,
      productCount: integrations.reduce((total, integration) => total + integration.productCount, 0),
      totalRevenue,
      totalCost,
      totalProfit,
      missingCostRows: integrations.reduce((total, integration) => total + integration.missingCostRows, 0),
    },
    integrations,
  };
}

function emptyMonth(month: string): ProductProfitabilityMonth {
  return {
    month,
    revenue: 0,
    cost: 0,
    profit: 0,
  };
}

function roundMonth(month: ProductProfitabilityMonth): ProductProfitabilityMonth {
  return {
    month: month.month,
    revenue: roundMoney(month.revenue),
    cost: roundMoney(month.cost),
    profit: roundMoney(month.profit),
  };
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

function dateValue(value: Date | string) {
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
