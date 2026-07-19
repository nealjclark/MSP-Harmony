import {
  getIntegrationDataSourceByKey,
  getIntegrationSettingsDefinition,
  type IntegrationDataSourceType,
  type IntegrationId,
} from '../../shared/integrationSettings';
import { mappedColumnHeaders, mergeInvoiceTableColumnMap, mergeKnownHeaders } from '../../shared/invoiceTableMapping';
import {
  vendorDatapointVendorId,
  type CreateVendorDatapointInput,
  type InvoiceTableColumnMap,
  type ManualImportSyncMode,
  type UpdateVendorDatapointInput,
  type VendorDatapointImportMode,
  type VendorDatapointRecord,
} from '../../shared/vendorDatapoints';
import { importMappedInvoiceTableCsv, type InvoiceImportSummary } from '../invoices/appriverInvoiceImports';
import type { Queryable } from '../vendor/appriver/operations';

type VendorDatapointRow = {
  id: string;
  display_name: string;
  description: string | null;
  linked_integration_id: string | null;
  data_source_key: string | null;
  source_type: string;
  sync_mode: string;
  column_map: InvoiceTableColumnMap | string;
  known_headers: string[] | string | null;
  default_import_mode: string;
  active: boolean;
  last_imported_at: Date | string | null;
  last_import_file_name: string | null;
  last_import_row_count: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function listVendorDatapoints(database: Queryable): Promise<VendorDatapointRecord[]> {
  const result = await database.query<VendorDatapointRow>(
    `select id,
            display_name,
            description,
            linked_integration_id,
            data_source_key,
            source_type,
            sync_mode,
            column_map,
            known_headers,
            default_import_mode,
            active,
            last_imported_at,
            last_import_file_name,
            last_import_row_count,
            created_at,
            updated_at
       from vendor_datapoints
      where active = true
      order by display_name asc`,
  );

  return result.rows.map(mapVendorDatapointRow);
}

export async function getVendorDatapoint(database: Queryable, id: string): Promise<VendorDatapointRecord | undefined> {
  const result = await database.query<VendorDatapointRow>(
    `select id,
            display_name,
            description,
            linked_integration_id,
            data_source_key,
            source_type,
            sync_mode,
            column_map,
            known_headers,
            default_import_mode,
            active,
            last_imported_at,
            last_import_file_name,
            last_import_row_count,
            created_at,
            updated_at
       from vendor_datapoints
      where id = $1::uuid`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapVendorDatapointRow(row) : undefined;
}

export async function createVendorDatapoint(
  database: Queryable,
  input: CreateVendorDatapointInput,
): Promise<VendorDatapointRecord> {
  assertDatapointSourceType(input.sourceType);
  assertLinkedIntegrationId(input.linkedIntegrationId);
  assertDataSourceKey(input.linkedIntegrationId, input.dataSourceKey, input.sourceType);

  const result = await database.query<VendorDatapointRow>(
    `insert into vendor_datapoints (
       display_name,
       description,
       linked_integration_id,
       source_type,
       sync_mode,
       column_map,
       known_headers,
       default_import_mode,
       data_source_key
     )
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
     returning id,
               display_name,
               description,
               linked_integration_id,
               data_source_key,
               source_type,
               sync_mode,
               column_map,
               known_headers,
               default_import_mode,
               active,
               last_imported_at,
               last_import_file_name,
               last_import_row_count,
               created_at,
               updated_at`,
    [
      input.displayName.trim(),
      input.description?.trim() || null,
      input.linkedIntegrationId ?? null,
      input.sourceType,
      input.syncMode ?? 'full-vendor-sync',
      JSON.stringify(input.columnMap ?? {}),
      JSON.stringify(input.knownHeaders ?? []),
      'merge',
      input.dataSourceKey ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to create vendor datapoint.');
  }

  return mapVendorDatapointRow(row);
}

export async function updateVendorDatapoint(
  database: Queryable,
  id: string,
  input: UpdateVendorDatapointInput,
): Promise<VendorDatapointRecord | undefined> {
  const existing = await getVendorDatapoint(database, id);
  if (!existing) {
    return undefined;
  }

  if (input.sourceType) {
    assertDatapointSourceType(input.sourceType);
  }
  if (input.linkedIntegrationId) {
    assertLinkedIntegrationId(input.linkedIntegrationId);
  }
  assertDataSourceKey(
    input.linkedIntegrationId === undefined ? existing.linkedIntegrationId : input.linkedIntegrationId ?? undefined,
    input.dataSourceKey === undefined ? existing.dataSourceKey : input.dataSourceKey ?? undefined,
    input.sourceType ?? existing.sourceType,
  );

  const result = await database.query<VendorDatapointRow>(
    `update vendor_datapoints
        set display_name = $2,
            description = $3,
            linked_integration_id = $4,
            source_type = $5,
            sync_mode = $6,
            column_map = $7::jsonb,
            known_headers = $8::jsonb,
            default_import_mode = $9,
            active = $10,
            data_source_key = $11,
            updated_at = now()
      where id = $1::uuid
      returning id,
                display_name,
                description,
                linked_integration_id,
                data_source_key,
                source_type,
                sync_mode,
                column_map,
                known_headers,
                default_import_mode,
                active,
                last_imported_at,
                last_import_file_name,
                last_import_row_count,
                created_at,
                updated_at`,
    [
      id,
      input.displayName?.trim() ?? existing.displayName,
      input.description === undefined ? existing.description ?? null : input.description?.trim() || null,
      input.linkedIntegrationId === undefined
        ? existing.linkedIntegrationId ?? null
        : input.linkedIntegrationId,
      input.sourceType ?? existing.sourceType,
      input.syncMode ?? existing.syncMode,
      JSON.stringify(input.columnMap ?? existing.columnMap),
      JSON.stringify(
        input.knownHeaders ??
          mergeKnownHeaders(existing.knownHeaders, mappedColumnHeaders(input.columnMap ?? existing.columnMap)),
      ),
      'merge',
      input.active ?? existing.active,
      input.dataSourceKey === undefined ? existing.dataSourceKey ?? null : input.dataSourceKey,
    ],
  );

  const row = result.rows[0];
  return row ? mapVendorDatapointRow(row) : undefined;
}

export async function importVendorDatapointFile(
  database: Queryable,
  datapointId: string,
  input: {
    fileName: string;
    content: string;
    columnMap?: InvoiceTableColumnMap;
    importMode?: VendorDatapointImportMode;
    persistColumnMap?: boolean;
  },
): Promise<{ datapoint: VendorDatapointRecord; import: InvoiceImportSummary }> {
  const datapoint = await getVendorDatapoint(database, datapointId);
  if (!datapoint || !datapoint.active) {
    throw new Error('Vendor datapoint was not found.');
  }

  const headers = extractImportHeaders(input.fileName, input.content);
  const resolvedColumnMap = mergeInvoiceTableColumnMap(
    input.columnMap && Object.keys(input.columnMap).length > 0 ? input.columnMap : datapoint.columnMap,
    headers,
  );

  if (Object.keys(resolvedColumnMap).length === 0) {
    throw new Error('Map at least one column before importing this vendor datapoint.');
  }

  const datapointVendorId = vendorDatapointVendorId(datapoint.id);
  const nextKnownHeaders = mergeKnownHeaders(datapoint.knownHeaders, headers, mappedColumnHeaders(resolvedColumnMap));

  const imported = await importMappedInvoiceTableCsv(database, {
    vendorId: 'custom-table',
    linkedIntegrationId: datapoint.linkedIntegrationId,
    dataSourceKey: datapoint.dataSourceKey,
    datapointId: datapoint.id,
    datapointVendorId,
    storageVendorIdOverride: datapoint.linkedIntegrationId ? undefined : datapointVendorId,
    fileName: input.fileName,
    content: input.content,
    columnMap: resolvedColumnMap,
    sourceType: datapoint.sourceType as IntegrationDataSourceType,
    syncMode: datapoint.syncMode,
    importMode: 'merge',
  });

  const shouldPersistColumnMap = input.persistColumnMap ?? Object.keys(datapoint.columnMap).length === 0;
  const updatedDatapoint = await database.query<VendorDatapointRow>(
    `update vendor_datapoints
        set column_map = case when $2 then $3::jsonb else column_map end,
            known_headers = $4::jsonb,
            last_imported_at = now(),
            last_import_file_name = $5,
            last_import_row_count = $6,
            updated_at = now()
      where id = $1::uuid
      returning id,
                display_name,
                description,
                linked_integration_id,
                data_source_key,
                source_type,
                sync_mode,
                column_map,
                known_headers,
                default_import_mode,
                active,
                last_imported_at,
                last_import_file_name,
                last_import_row_count,
                created_at,
                updated_at`,
    [
      datapoint.id,
      shouldPersistColumnMap,
      JSON.stringify(resolvedColumnMap),
      JSON.stringify(nextKnownHeaders),
      input.fileName,
      imported.rowCount,
    ],
  );

  const row = updatedDatapoint.rows[0];
  if (!row) {
    throw new Error('Unable to update vendor datapoint after import.');
  }

  return {
    datapoint: mapVendorDatapointRow(row),
    import: imported,
  };
}

function assertDatapointSourceType(sourceType: string) {
  if (
    sourceType !== 'user-license-detail' &&
    sourceType !== 'customer-product-breakdown' &&
    sourceType !== 'reseller-product-total' &&
    sourceType !== 'device-count' &&
    sourceType !== 'invoice' &&
    sourceType !== 'license-count'
  ) {
    throw new Error(`Unsupported vendor datapoint source type "${sourceType}".`);
  }
}

function assertLinkedIntegrationId(linkedIntegrationId: IntegrationId | undefined) {
  if (linkedIntegrationId && !getIntegrationSettingsDefinition(linkedIntegrationId)) {
    throw new Error(`Linked integration "${linkedIntegrationId}" is not registered.`);
  }
}

function assertDataSourceKey(
  linkedIntegrationId: IntegrationId | undefined,
  dataSourceKey: string | undefined,
  sourceType: string,
) {
  if (!dataSourceKey) return;
  const integrationId = linkedIntegrationId ?? 'custom-table';
  const source = getIntegrationDataSourceByKey(integrationId, dataSourceKey);
  if (!source) {
    throw new Error(`Data stream "${dataSourceKey}" is not registered for integration "${integrationId}".`);
  }
  if (source.sourceType !== sourceType) {
    throw new Error(`Data stream "${dataSourceKey}" expects source type "${source.sourceType}".`);
  }
}

function mapVendorDatapointRow(row: VendorDatapointRow): VendorDatapointRecord {
  const columnMap =
    typeof row.column_map === 'string'
      ? (JSON.parse(row.column_map) as InvoiceTableColumnMap)
      : (row.column_map ?? {});
  const knownHeaders = parseKnownHeaders(row.known_headers, columnMap);

  return {
    id: row.id,
    vendorId: vendorDatapointVendorId(row.id),
    displayName: row.display_name,
    description: row.description ?? undefined,
    linkedIntegrationId: row.linked_integration_id ? (row.linked_integration_id as IntegrationId) : undefined,
    ...(row.data_source_key ? { dataSourceKey: row.data_source_key } : {}),
    sourceType: row.source_type,
    syncMode: row.sync_mode === 'info-only' ? 'info-only' : 'full-vendor-sync',
    columnMap,
    knownHeaders,
    defaultImportMode: 'merge',
    active: row.active,
    lastImportedAt: row.last_imported_at ? new Date(row.last_imported_at).toISOString() : undefined,
    lastImportFileName: row.last_import_file_name ?? undefined,
    lastImportRowCount:
      row.last_import_row_count === null || typeof row.last_import_row_count === 'undefined'
        ? undefined
        : Number(row.last_import_row_count),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function parseKnownHeaders(value: string[] | string | null | undefined, columnMap: InvoiceTableColumnMap) {
  if (Array.isArray(value)) {
    return mergeKnownHeaders(
      value.filter((item): item is string => typeof item === 'string'),
      mappedColumnHeaders(columnMap),
    );
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return mergeKnownHeaders(
          parsed.filter((item): item is string => typeof item === 'string'),
          mappedColumnHeaders(columnMap),
        );
      }
    } catch {
      return mergeKnownHeaders([], mappedColumnHeaders(columnMap));
    }
  }

  return mergeKnownHeaders([], mappedColumnHeaders(columnMap));
}

function extractImportHeaders(fileName: string, content: string) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.json')) {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] && !Array.isArray(parsed[0])) {
      return Object.keys(parsed[0] as Record<string, unknown>);
    }
    if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) {
      for (const key of ['rows', 'data', 'items', 'records', 'results']) {
        const rows = (parsed as Record<string, unknown>)[key];
        if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object' && rows[0] && !Array.isArray(rows[0])) {
          return Object.keys(rows[0] as Record<string, unknown>);
        }
      }
    }
    return [];
  }

  const firstLine = content.replace(/^\uFEFF/, '').split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  return parseCsvLine(firstLine);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      values.push(field);
      field = '';
      continue;
    }
    field += char;
  }

  values.push(field);
  return values.map((value) => value.trim()).filter(Boolean);
}
