import assert from 'node:assert/strict';
import type { IntegrationRuntimeSettings, IntegrationSettingsProvider } from '../../config/settingsProvider';
import { syncNerdioBilling } from './operations';

const settings = {
  definition: { integrationId: 'nerdio' },
  nonSecrets: { invoiceLookbackMonths: '4' },
  secrets: {},
  validation: { missingSecrets: [], missingNonSecrets: [] },
} as unknown as IntegrationRuntimeSettings;
const provider: IntegrationSettingsProvider = {
  async getIntegrationSettings() {
    return settings;
  },
  async listIntegrationSettings() {
    return [settings];
  },
};

async function run() {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    async query<T>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes('insert into sync_runs')) return { rows: [{ id: '00000000-0000-0000-0000-000000000001' }] as T[] };
      if (sql.includes('returning id')) return { rows: [{ id: 'item-1' }] as T[] };
      return { rows: [] as T[] };
    },
  };
  const client = {
    invoiceRequest: undefined as { periodStart: string; periodEnd: string } | undefined,
    async test() {
      return {};
    },
    async listAccounts() {
      return [{ id: 'account-1', name: 'Example Client', raw: {} }];
    },
    async getAccountUsage() {
      return [{
        collectDateTimeUtc: '2026-07-01T00:00:00Z',
        desktopUsersCount: 12,
        onlyCpcUsersCount: 3,
        onlyIntuneUsersCount: 2,
        mauCount: 15,
      }];
    },
    async listInvoices(input: { periodStart: string; periodEnd: string }) {
      this.invoiceRequest = input;
      return [{
        id: 'invoice-1',
        number: 'INV-1',
        startBillingPeriod: '2026-06-01',
        endBillingPeriod: '2026-06-30',
        invoiceItems: [{
          accountId: 'account-1',
          accountName: 'Example Client',
          metric: 'avd',
          licenses: 12,
          unitPrice: 10,
          value: 120,
        }],
        raw: {},
      }];
    },
  };

  const invoice = await syncNerdioBilling({
    pool: database,
    provider,
    client,
    now: '2026-07-26T12:00:00.000Z',
    operationKey: 'nerdio-invoices',
  });
  assert.equal(invoice.recordsRead, 1);
  assert.deepEqual(client.invoiceRequest, {
    periodStart: '03/01/2026',
    periodEnd: '06/30/2026',
  });
  assert.ok(queries.some((query) => query.sql.includes('insert into nerdio_invoice_items')));

  queries.length = 0;
  const live = await syncNerdioBilling({
    pool: database,
    provider,
    client,
    now: '2026-07-26T12:00:00.000Z',
    operationKey: 'nerdio-live-usage',
  });
  assert.equal(live.recordsWritten, 1);
  const liveInsert = queries.find((query) => query.sql.includes('insert into nerdio_live_usage_snapshots'));
  assert.equal(liveInsert?.values?.[4], 12);
  assert.equal(liveInsert?.values?.[5], 3);
  assert.equal(liveInsert?.values?.[6], 2);
  assert.equal(liveInsert?.values?.[7], 15);
}

run()
  .then(() => console.log('Nerdio operations tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
