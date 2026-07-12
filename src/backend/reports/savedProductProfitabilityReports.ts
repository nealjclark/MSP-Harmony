import type { ProductProfitabilityReport } from './productProfitabilityReports';
import type { Queryable } from './agreementReports';

export type SavedProductProfitabilityReportSummary = {
  id: string;
  name: string;
  vendorIds: string[];
  createdAt: string;
  createdBy: string | null;
};

export type SavedProductProfitabilityReport = SavedProductProfitabilityReportSummary & {
  report: ProductProfitabilityReport;
};

type SavedSummaryRow = {
  id: string;
  name: string;
  vendor_ids: string[] | null;
  created_at: Date | string;
  created_by: string | null;
};

type SavedDetailRow = SavedSummaryRow & {
  report_json: unknown;
};

export async function listSavedProductProfitabilityReports(
  database: Queryable,
): Promise<SavedProductProfitabilityReportSummary[]> {
  const result = await database.query<SavedSummaryRow>(
    `select id, name, vendor_ids, created_at, created_by
     from saved_product_profitability_reports
     order by created_at desc
     limit 100`,
  );

  return result.rows.map(mapSummaryRow);
}

export async function getSavedProductProfitabilityReport(
  database: Queryable,
  id: string,
): Promise<SavedProductProfitabilityReport | undefined> {
  const result = await database.query<SavedDetailRow>(
    `select id, name, vendor_ids, report_json, created_at, created_by
     from saved_product_profitability_reports
     where id = $1::uuid`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const report = parseReportJson(row.report_json);
  if (!report) {
    return undefined;
  }

  return {
    ...mapSummaryRow(row),
    report,
  };
}

export async function saveProductProfitabilityReport(
  database: Queryable,
  input: {
    name: string;
    vendorIds?: string[];
    report: ProductProfitabilityReport;
    createdBy?: string | null;
  },
): Promise<SavedProductProfitabilityReportSummary> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Saved report name is required.');
  }

  const vendorIds =
    input.vendorIds && input.vendorIds.length > 0
      ? [...new Set(input.vendorIds.map((id) => id.trim()).filter(Boolean))]
      : input.report.integrations.map((integration) => integration.integrationId);

  const result = await database.query<SavedSummaryRow>(
    `insert into saved_product_profitability_reports (name, vendor_ids, report_json, created_by)
     values ($1, $2::text[], $3::jsonb, $4)
     returning id, name, vendor_ids, created_at, created_by`,
    [name, vendorIds, JSON.stringify(input.report), input.createdBy ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to save product profitability report.');
  }

  return mapSummaryRow(row);
}

function mapSummaryRow(row: SavedSummaryRow): SavedProductProfitabilityReportSummary {
  return {
    id: row.id,
    name: row.name,
    vendorIds: Array.isArray(row.vendor_ids) ? row.vendor_ids : [],
    createdAt: dateToIso(row.created_at),
    createdBy: row.created_by,
  };
}

function parseReportJson(value: unknown): ProductProfitabilityReport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const report = value as ProductProfitabilityReport;
  if (report.reportType !== 'product-profitability' || !Array.isArray(report.integrations)) {
    return undefined;
  }
  return report;
}

function dateToIso(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
