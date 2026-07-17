import {
  getIntegrationSettingsDefinition,
  type IntegrationDataSourceType,
  type IntegrationId,
} from '../../shared/integrationSettings';
import {
  invoiceHeaderFingerprint,
  normalizedInvoiceHeader,
  type InvoiceHeaderSignature,
  type InvoiceImportTemplate,
} from '../../shared/invoiceImportTemplates';
import { mergeKnownHeaders, mappedColumnHeaders } from '../../shared/invoiceTableMapping';
import type { InvoiceTableColumnMap } from '../../shared/vendorDatapoints';
import type { Queryable } from './appriverInvoiceImports';

type TemplateRow = {
  id: string;
  integration_id: IntegrationId;
  name: string;
  data_source_key: string | null;
  source_type: IntegrationDataSourceType;
  column_map: unknown;
  known_headers: unknown;
  version: number | string;
  active: boolean;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SignatureRow = {
  id: string;
  template_id: string;
  headers: unknown;
  normalized_headers: unknown;
  column_map: unknown;
  sample_file_name: string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
};

export type SaveInvoiceImportTemplateInput = {
  integrationId: IntegrationId;
  name: string;
  dataSourceKey?: string;
  sourceType: IntegrationDataSourceType;
  columnMap: InvoiceTableColumnMap;
  knownHeaders?: string[];
};

export async function listInvoiceImportTemplates(
  database: Queryable,
  integrationId?: IntegrationId,
): Promise<InvoiceImportTemplate[]> {
  const result = await database.query<TemplateRow>(
    `select id, integration_id, name, data_source_key, source_type, column_map, known_headers,
            version, active, archived_at, created_at, updated_at
       from invoice_import_templates
      where ($1::text is null or integration_id = $1)
      order by active desc, integration_id, lower(name)`,
    [integrationId ?? null],
  );
  if (result.rows.length === 0) return [];
  const signatures = await database.query<SignatureRow>(
    `select id, template_id, headers, normalized_headers, column_map, sample_file_name,
            first_seen_at, last_seen_at
       from invoice_import_template_signatures
      where template_id = any($1::uuid[])
      order by last_seen_at desc`,
    [result.rows.map((row) => row.id)],
  );
  const byTemplate = new Map<string, InvoiceHeaderSignature[]>();
  for (const row of signatures.rows) {
    const list = byTemplate.get(row.template_id) ?? [];
    list.push(mapSignature(row));
    byTemplate.set(row.template_id, list);
  }
  return result.rows.map((row) => mapTemplate(row, byTemplate.get(row.id) ?? []));
}

export async function getInvoiceImportTemplate(database: Queryable, id: string) {
  const templates = await listInvoiceImportTemplates(database);
  return templates.find((template) => template.id === id);
}

export async function createInvoiceImportTemplate(
  database: Queryable,
  input: SaveInvoiceImportTemplateInput,
  actor?: string,
) {
  assertTemplateInput(input);
  const knownHeaders = mergeKnownHeaders(input.knownHeaders, mappedColumnHeaders(input.columnMap));
  const result = await database.query<{ id: string }>(
    `insert into invoice_import_templates (
       integration_id, name, data_source_key, source_type, column_map, known_headers, created_by, updated_by
     ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $7)
     returning id`,
    [
      input.integrationId,
      input.name.trim(),
      input.dataSourceKey ?? null,
      input.sourceType,
      JSON.stringify(input.columnMap),
      JSON.stringify(knownHeaders),
      actor ?? null,
    ],
  );
  return getInvoiceImportTemplate(database, result.rows[0]!.id);
}

export async function updateInvoiceImportTemplate(
  database: Queryable,
  id: string,
  input: SaveInvoiceImportTemplateInput,
  actor?: string,
  expectedVersion?: number,
) {
  assertTemplateInput(input);
  const knownHeaders = mergeKnownHeaders(input.knownHeaders, mappedColumnHeaders(input.columnMap));
  const result = await database.query<{ id: string }>(
    `update invoice_import_templates
        set integration_id = $2,
            name = $3,
            data_source_key = $4,
            source_type = $5,
            column_map = $6::jsonb,
            known_headers = $7::jsonb,
            version = version + 1,
            updated_by = $8,
            updated_at = now()
      where id = $1
        and ($9::integer is null or version = $9)
      returning id`,
    [id, input.integrationId, input.name.trim(), input.dataSourceKey ?? null, input.sourceType,
      JSON.stringify(input.columnMap), JSON.stringify(knownHeaders), actor ?? null, expectedVersion ?? null],
  );
  return result.rows[0] ? getInvoiceImportTemplate(database, id) : undefined;
}

export async function setInvoiceImportTemplateArchived(
  database: Queryable,
  id: string,
  archived: boolean,
  actor?: string,
) {
  const result = await database.query<{ id: string }>(
    `update invoice_import_templates
        set active = $2,
            archived_at = case when $2 then null else now() end,
            version = version + 1,
            updated_by = $3,
            updated_at = now()
      where id = $1
      returning id`,
    [id, !archived, actor ?? null],
  );
  return result.rows[0] ? getInvoiceImportTemplate(database, id) : undefined;
}

export async function recordInvoiceHeaderSignature(
  database: Queryable,
  input: { templateId: string; headers: string[]; columnMap: InvoiceTableColumnMap; fileName?: string },
) {
  const template = await getInvoiceImportTemplate(database, input.templateId);
  const normalizedHeaders = [...new Set(input.headers.map(normalizedInvoiceHeader).filter(Boolean))].sort();
  const fingerprint = invoiceHeaderFingerprint(input.headers);
  await database.query(
    `insert into invoice_import_template_signatures (
       template_id, header_fingerprint, headers, normalized_headers, column_map, sample_file_name
     ) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     on conflict (template_id, header_fingerprint) do update
       set headers = excluded.headers,
           normalized_headers = excluded.normalized_headers,
           column_map = excluded.column_map,
           sample_file_name = excluded.sample_file_name,
           last_seen_at = now()`,
    [input.templateId, fingerprint, JSON.stringify(input.headers), JSON.stringify(normalizedHeaders),
      JSON.stringify(input.columnMap), input.fileName ?? null],
  );
  await database.query(
    `update invoice_import_templates
        set known_headers = $2::jsonb, updated_at = now()
      where id = $1`,
    [input.templateId, JSON.stringify(mergeKnownHeaders(template?.knownHeaders, input.headers, mappedColumnHeaders(input.columnMap)))],
  );
}

function assertTemplateInput(input: SaveInvoiceImportTemplateInput) {
  if (!getIntegrationSettingsDefinition(input.integrationId)) throw new Error('A supported integration is required.');
  if (!input.name.trim()) throw new Error('Template name is required.');
  if (!input.columnMap.externalAccountId) throw new Error('Customer account mapping is required.');
  if (!input.columnMap.productName && !input.columnMap.productCode) throw new Error('Product mapping is required.');
  if (!input.columnMap.quantity) throw new Error('Quantity mapping is required.');
}

function mapTemplate(row: TemplateRow, signatures: InvoiceHeaderSignature[]): InvoiceImportTemplate {
  return {
    id: row.id,
    integrationId: row.integration_id,
    name: row.name,
    dataSourceKey: row.data_source_key ?? undefined,
    sourceType: row.source_type,
    columnMap: objectMap(row.column_map),
    knownHeaders: stringArray(row.known_headers),
    version: Number(row.version),
    status: row.active ? 'active' : 'archived',
    signatures,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
  };
}

function mapSignature(row: SignatureRow): InvoiceHeaderSignature {
  return {
    id: row.id,
    templateId: row.template_id,
    headers: stringArray(row.headers),
    normalizedHeaders: stringArray(row.normalized_headers),
    columnMap: objectMap(row.column_map),
    fileName: row.sample_file_name ?? undefined,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  };
}

function objectMap(value: unknown): InvoiceTableColumnMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InvoiceTableColumnMap : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
