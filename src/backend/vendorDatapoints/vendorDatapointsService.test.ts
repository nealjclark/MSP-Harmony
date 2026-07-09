import assert from 'node:assert/strict';
import { mergeInvoiceTableColumnMap, suggestInvoiceTableColumnMap } from '../../shared/invoiceTableMapping';
import { vendorDatapointVendorId } from '../../shared/vendorDatapoints';
import {
  createVendorDatapoint,
  importVendorDatapointFile,
  listVendorDatapoints,
} from '../vendorDatapoints/vendorDatapointsService';

async function run() {
  const datapoints: Array<Record<string, unknown>> = [];
  const imports: Array<{ sql: string; values?: unknown[] }> = [];
  const lines: Array<{ sql: string; values?: unknown[] }> = [];
  const customerId = '11111111-1111-1111-1111-111111111111';
  const agreementId = '22222222-2222-2222-2222-222222222222';

  const database = {
    query: async <T = unknown>(sql: string, values?: unknown[]) => {
      if (sql.includes('insert into vendor_datapoints')) {
        datapoints.push({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          display_name: values?.[0],
          description: values?.[1],
          linked_integration_id: values?.[2],
          source_type: values?.[3],
          sync_mode: values?.[4],
          column_map: values?.[5],
          known_headers: values?.[6],
          default_import_mode: values?.[7],
          active: true,
          last_imported_at: null,
          last_import_file_name: null,
          last_import_row_count: null,
          created_at: '2026-07-08T00:00:00.000Z',
          updated_at: '2026-07-08T00:00:00.000Z',
        });
        return { rows: [datapoints[0]] as T[] };
      }

      if (sql.includes('from vendor_datapoints') && sql.includes('where id = $1::uuid')) {
        return { rows: datapoints as T[] };
      }

      if (sql.includes('from vendor_datapoints') && sql.includes('where active = true')) {
        return { rows: datapoints as T[] };
      }

      if (sql.includes('update vendor_datapoints')) {
        const current = datapoints[0];
        if (current) {
          if (values?.[3] !== undefined) {
            current.known_headers = values?.[3];
          }
          current.column_map = values?.[2];
          current.last_import_file_name = values?.[4];
          current.last_import_row_count = values?.[5];
        }
        return { rows: datapoints as T[] };
      }

      if (sql.includes('from vendor_account_mappings')) {
        return {
          rows: [
            {
              external_account_id: 'client-42',
              external_account_name: 'Client 42',
              customer_id: customerId,
              agreement_id: agreementId,
            },
          ] as T[],
        };
      }

      if (sql.includes('from vendor_product_mappings')) {
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into invoice_imports')) {
        imports.push({ sql, values });
        return { rows: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }] as T[] };
      }

      if (sql.includes('insert into invoice_line_items')) {
        lines.push({ sql, values });
        return { rows: [] as T[] };
      }

      if (sql.includes('insert into sync_runs')) {
        return { rows: [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }] as T[] };
      }

      if (
        sql.includes('delete from vendor_usage_snapshots') ||
        sql.includes('insert into vendor_usage_snapshots') ||
        sql.includes('update sync_runs') ||
        sql.includes('from sync_runs')
      ) {
        return { rows: [] as T[] };
      }

      if (sql.includes('from invoice_imports') && sql.includes('where id = $1::uuid')) {
        const importValues = imports[0]?.values ?? [];
        return {
          rows: [
            {
              id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              vendor_id: importValues[0],
              file_name: importValues[1],
              invoice_number: importValues[2],
              imported_at: '2026-07-08T00:00:00.000Z',
              invoice_date: importValues[3],
              billing_period_start: importValues[4],
              billing_period_end: importValues[5],
              row_count: importValues[6],
              matched_rows: importValues[7],
              exception_rows: importValues[8],
              status: importValues[9],
            },
          ] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  const created = await createVendorDatapoint(database, {
    displayName: 'SentinelOne device names',
    linkedIntegrationId: 'sentinelone',
    sourceType: 'device-count',
    syncMode: 'info-only',
  });

  assert.equal(created.vendorId, vendorDatapointVendorId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
  assert.equal(created.linkedIntegrationId, 'sentinelone');
  assert.deepEqual(created.columnMap, {});
  assert.deepEqual(created.knownHeaders, []);

  const listed = await listVendorDatapoints(database);
  assert.equal(listed.length, 1);

  const suggested = suggestInvoiceTableColumnMap(['Client', 'DeviceType', 'DeviceClass', 'Count']);
  assert.equal(suggested.externalAccountId, 'Client');
  assert.equal(suggested.deviceType, 'DeviceType');
  assert.equal(suggested.quantity, 'Count');

  const merged = mergeInvoiceTableColumnMap(
    {
      externalAccountId: 'Customer',
      deviceType: 'DeviceType',
      quantity: 'Qty',
    },
    ['Client', 'DeviceType', 'DeviceClass', 'Count'],
  );
  assert.equal(merged.externalAccountId, 'Client');
  assert.equal(merged.deviceType, 'DeviceType');
  assert.equal(merged.quantity, 'Count');

  const imported = await importVendorDatapointFile(database, created.id, {
    fileName: 'devices.csv',
    content: 'Client,DeviceType,DeviceClass,Count\nclient-42,Server,Virtual,2\n',
    columnMap: merged,
    persistColumnMap: true,
  });

  assert.equal(imported.import.vendorId, 'sentinelone');
  assert.equal(imported.datapoint.columnMap.externalAccountId, 'Client');
  assert.deepEqual(imported.datapoint.knownHeaders, ['Client', 'Count', 'DeviceClass', 'DeviceType']);
  assert.equal(JSON.parse(String(imports[0]?.values?.[10])).datapointId, created.id);

  console.log('vendor datapoint service tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
