import { getIntegrationSettingsDefinition, type IntegrationId } from '../../shared/integrationSettings';
import {
  selectLaborMappingForTicket,
  sumDistinctTicketHours,
  type LaborMappingRecord,
} from '../../shared/laborMappings';
import type { StoredConnectWiseTicket } from '../connectwise/ticketSync';
import type { Queryable } from './agreementReports';

/** Fixed billable labor rate used until per-member time-entry costs exist. */
export const LABOR_HOURLY_RATE = 50;

export type ProductProfitabilityMonth = {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  laborHours: number;
  laborCost: number;
};

export type ProductProfitabilityIntegrationSeries = {
  integrationId: string;
  integrationName: string;
  months: ProductProfitabilityMonth[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalLaborHours: number;
  totalLaborCost: number;
  productCount: number;
  missingCostRows: number;
};

export type ProductProfitabilityLaborMonth = {
  month: string;
  hours: number;
  cost: number;
  ticketCount: number;
};

export type ProductProfitabilityLaborRow = {
  vendorId: string;
  vendorName: string;
  label: string;
  months: ProductProfitabilityLaborMonth[];
  totalHours: number;
  totalCost: number;
  ticketCount: number;
};

export type ProductProfitabilityReport = {
  reportType: 'product-profitability';
  generatedAt: string;
  currency: 'USD';
  startMonth: string;
  endMonth: string;
  months: string[];
  billingBasis: 'latest-addition-per-month';
  laborHourlyRate: number;
  summary: {
    integrationCount: number;
    productCount: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    totalLaborHours: number;
    totalLaborCost: number;
    missingCostRows: number;
  };
  labor: {
    months: ProductProfitabilityLaborMonth[];
    rows: ProductProfitabilityLaborRow[];
    warning?: string;
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
  options: {
    monthCount?: number;
    vendorIds?: string[];
    laborMappings?: LaborMappingRecord[];
    laborTickets?: StoredConnectWiseTicket[];
    laborWarning?: string;
  } = {},
): Promise<ProductProfitabilityReport> {
  const monthCount = Math.min(Math.max(options.monthCount ?? 12, 1), 24);
  const mappedVendorResult = await database.query<ActiveIntegrationRow>(
    `with mapped_vendors as (
       select distinct vendor_id
       from vendor_product_mappings
       where active = true
         and mapping_status = 'approved'
         and coalesce(connectwise_product_code, '') <> ''
       union
       select distinct vendor_id
       from vendor_product_bundles
       where active = true
         and mapping_status = 'approved'
         and coalesce(connectwise_product_code, '') <> ''
     )
     select integration_settings.integration_id, integration_settings.display_name
     from mapped_vendors
     inner join integration_settings
       on integration_settings.integration_id = mapped_vendors.vendor_id
     where integration_settings.configured_status <> 'not-configured'
       and integration_settings.integration_id <> 'connectwise'
     order by integration_settings.display_name, integration_settings.integration_id`,
  );

  let activeIntegrations = mappedVendorResult.rows.map((row) => ({
    integrationId: row.integration_id,
    integrationName:
      getIntegrationSettingsDefinition(row.integration_id as IntegrationId)?.displayName ??
      row.display_name ??
      row.integration_id,
  }));

  const requestedVendorIds = normalizeVendorIds(options.vendorIds);
  if (requestedVendorIds.length > 0) {
    const allowed = new Set(requestedVendorIds);
    activeIntegrations = activeIntegrations.filter((integration) => allowed.has(integration.integrationId));
  }

  if (activeIntegrations.length === 0) {
    const months = monthKeysForAnchor(new Date(), monthCount);
    return buildReport(
      months,
      [],
      buildLaborSection(months, options.laborMappings ?? [], options.laborTickets ?? [], options.laborWarning),
    );
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
     ),
     monthly_latest as (
       select
         addition_history.agreement_addition_id,
         date_trunc('month', addition_history.observed_at) as observed_month,
         max(addition_history.observed_at) as latest_observed_at
       from addition_history
       inner join mapped_products
         on lower(mapped_products.product_code) = lower(addition_history.product_code)
       cross join latest
       where mapped_products.vendor_id = any($1::text[])
         and addition_history.observed_at >= date_trunc('month', coalesce(latest.latest_observed_at, now())) - (($2::int - 1) * interval '1 month')
         and addition_history.observed_at < date_trunc('month', coalesce(latest.latest_observed_at, now())) + interval '1 month'
       group by addition_history.agreement_addition_id, date_trunc('month', addition_history.observed_at)
     )
     select
       mapped_products.vendor_id,
       monthly_latest.observed_month,
       addition_history.product_code,
       addition_history.observed_quantity,
       addition_history.unit_price,
       addition_history.raw_payload
     from addition_history
     inner join monthly_latest
       on monthly_latest.agreement_addition_id = addition_history.agreement_addition_id
      and monthly_latest.latest_observed_at = addition_history.observed_at
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
     order by monthly_latest.observed_month, mapped_products.vendor_id, addition_history.product_code`,
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
        months: new Map(months.map((month) => [month, emptyMonth(month)])),
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

  const labor = buildLaborSection(months, options.laborMappings ?? [], options.laborTickets ?? [], options.laborWarning);
  applyLaborHoursToIntegrations(accumulators, labor.rows);

  return buildReport(months, Array.from(accumulators.values()), labor);
}

function applyLaborHoursToIntegrations(
  accumulators: Map<string, IntegrationAccumulator>,
  laborRows: ProductProfitabilityLaborRow[],
) {
  for (const row of laborRows) {
    const accumulator = accumulators.get(row.vendorId);
    if (!accumulator) {
      continue;
    }
    for (const monthRow of row.months) {
      const monthTotals = accumulator.months.get(monthRow.month);
      if (!monthTotals) {
        continue;
      }
      monthTotals.laborHours += monthRow.hours;
      monthTotals.laborCost += monthRow.cost;
    }
  }
}

export function buildLaborSection(
  months: string[],
  mappings: LaborMappingRecord[],
  tickets: StoredConnectWiseTicket[],
  warning?: string,
): ProductProfitabilityReport['labor'] {
  const monthSet = new Set(months);
  const activeMappings = mappings.filter((mapping) => mapping.active);
  const claimedTickets = new Set<string>();
  const rowMap = new Map<string, ProductProfitabilityLaborRow>();

  for (const mapping of activeMappings) {
    const key = `${mapping.vendorId}::${mapping.label}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        vendorId: mapping.vendorId,
        vendorName:
          getIntegrationSettingsDefinition(mapping.vendorId as IntegrationId)?.displayName ?? mapping.vendorId,
        label: mapping.label,
        months: months.map((month) => ({ month, hours: 0, cost: 0, ticketCount: 0 })),
        totalHours: 0,
        totalCost: 0,
        ticketCount: 0,
      });
    }
  }

  for (const ticket of tickets) {
    const ticketKey = String(ticket.ticketId);
    if (claimedTickets.has(ticketKey)) {
      continue;
    }

    const closedAt = ticket.closedAt ? dateValue(ticket.closedAt) : undefined;
    const month = closedAt ? formatMonthKey(closedAt) : undefined;
    if (!month || !monthSet.has(month)) {
      continue;
    }

    const mapping = selectLaborMappingForTicket(activeMappings, {
      boardId: ticket.boardId,
      typeId: ticket.typeId,
      subTypeId: ticket.subTypeId,
    });
    if (!mapping) {
      continue;
    }

    claimedTickets.add(ticketKey);
    const row = rowMap.get(`${mapping.vendorId}::${mapping.label}`);
    if (!row) {
      continue;
    }

    const hours = Number(ticket.actualHours) || 0;
    const monthRow = row.months.find((item) => item.month === month);
    if (!monthRow) {
      continue;
    }
    monthRow.hours += hours;
    monthRow.ticketCount += 1;
    row.totalHours += hours;
    row.ticketCount += 1;
  }

  const rows = Array.from(rowMap.values())
    .map((row) => ({
      ...row,
      months: row.months.map((month) => {
        const hours = roundHours(month.hours);
        return {
          ...month,
          hours,
          cost: laborCostForHours(hours),
        };
      }),
      totalHours: roundHours(row.totalHours),
      totalCost: laborCostForHours(roundHours(row.totalHours)),
    }))
    .filter((row) => row.totalHours > 0 || activeMappings.some((mapping) => mapping.vendorId === row.vendorId && mapping.label === row.label))
    .sort((left, right) => right.totalHours - left.totalHours || left.vendorName.localeCompare(right.vendorName) || left.label.localeCompare(right.label));

  const monthsSummary = months.map((month) => {
    const monthTickets = tickets.filter((ticket) => {
      const closedAt = ticket.closedAt ? dateValue(ticket.closedAt) : undefined;
      return closedAt ? formatMonthKey(closedAt) === month : false;
    });
    const matched = monthTickets.filter((ticket) =>
      Boolean(
        selectLaborMappingForTicket(activeMappings, {
          boardId: ticket.boardId,
          typeId: ticket.typeId,
          subTypeId: ticket.subTypeId,
        }),
      ),
    );
    const hours = roundHours(
      sumDistinctTicketHours(matched.map((ticket) => ({ ticketId: ticket.ticketId, actualHours: ticket.actualHours }))),
    );
    return {
      month,
      hours,
      cost: laborCostForHours(hours),
      ticketCount: new Set(matched.map((ticket) => String(ticket.ticketId))).size,
    };
  });

  return {
    months: monthsSummary,
    rows,
    warning,
  };
}

function buildReport(
  months: string[],
  accumulators: IntegrationAccumulator[],
  labor: ProductProfitabilityReport['labor'],
): ProductProfitabilityReport {
  const integrations = accumulators
    .map((accumulator) => {
      const monthRows = months.map((month) => roundMonth(accumulator.months.get(month) ?? emptyMonth(month)));
      const totalRevenue = roundMoney(monthRows.reduce((total, row) => total + row.revenue, 0));
      const totalCost = roundMoney(monthRows.reduce((total, row) => total + row.cost, 0));
      const totalProfit = roundMoney(totalRevenue - totalCost);
      const totalLaborHours = roundHours(monthRows.reduce((total, row) => total + row.laborHours, 0));
      const totalLaborCost = laborCostForHours(totalLaborHours);

      return {
        integrationId: accumulator.integrationId,
        integrationName: accumulator.integrationName,
        months: monthRows,
        totalRevenue,
        totalCost,
        totalProfit,
        totalLaborHours,
        totalLaborCost,
        productCount: accumulator.productCodes.size,
        missingCostRows: accumulator.missingCostRows,
      };
    })
    .sort((left, right) => right.totalProfit - left.totalProfit || left.integrationName.localeCompare(right.integrationName));

  const totalRevenue = roundMoney(integrations.reduce((total, integration) => total + integration.totalRevenue, 0));
  const totalCost = roundMoney(integrations.reduce((total, integration) => total + integration.totalCost, 0));
  const totalProfit = roundMoney(totalRevenue - totalCost);
  const totalLaborHours = roundHours(labor.months.reduce((total, month) => total + month.hours, 0));
  const totalLaborCost = laborCostForHours(totalLaborHours);

  return {
    reportType: 'product-profitability',
    generatedAt: new Date().toISOString(),
    currency: 'USD',
    startMonth: months[0] ?? '',
    endMonth: months[months.length - 1] ?? '',
    months,
    billingBasis: 'latest-addition-per-month',
    laborHourlyRate: LABOR_HOURLY_RATE,
    summary: {
      integrationCount: integrations.length,
      productCount: integrations.reduce((total, integration) => total + integration.productCount, 0),
      totalRevenue,
      totalCost,
      totalProfit,
      totalLaborHours,
      totalLaborCost,
      missingCostRows: integrations.reduce((total, integration) => total + integration.missingCostRows, 0),
    },
    labor,
    integrations,
  };
}

function emptyMonth(month: string): ProductProfitabilityMonth {
  return {
    month,
    revenue: 0,
    cost: 0,
    profit: 0,
    laborHours: 0,
    laborCost: 0,
  };
}

function roundMonth(month: ProductProfitabilityMonth): ProductProfitabilityMonth {
  const laborHours = roundHours(month.laborHours);
  return {
    month: month.month,
    revenue: roundMoney(month.revenue),
    cost: roundMoney(month.cost),
    profit: roundMoney(month.profit),
    laborHours,
    laborCost: laborCostForHours(laborHours),
  };
}

function laborCostForHours(hours: number) {
  return roundMoney(hours * LABOR_HOURLY_RATE);
}

function normalizeVendorIds(vendorIds: string[] | undefined) {
  if (!vendorIds || vendorIds.length === 0) {
    return [];
  }
  return [...new Set(vendorIds.map((id) => id.trim()).filter((id) => id.length > 0))];
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

function roundHours(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
