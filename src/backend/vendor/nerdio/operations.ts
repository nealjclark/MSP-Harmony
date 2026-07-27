import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../../config/settingsProvider';
import type { SyncProgressReporter } from '../../shared/syncProgress';
import {
  NerdioClient,
  nerdioCredentialsFromSettings,
  nerdioIntegrationId,
  type NerdioAccount,
  type NerdioInvoice,
} from './client';

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type NerdioUsageClient = Pick<NerdioClient, 'test' | 'listAccounts' | 'getAccountUsage' | 'listInvoices'>;

export async function testNerdioConnection(input: {
  provider?: IntegrationSettingsProvider;
  client?: NerdioUsageClient;
  now?: string;
} = {}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(nerdioIntegrationId);
  assertNerdioReady(settings);
  const client = input.client ?? new NerdioClient(nerdioCredentialsFromSettings(settings));
  await client.test();
  const accounts = await client.listAccounts();
  return {
    integrationId: nerdioIntegrationId,
    testedAt: input.now ?? new Date().toISOString(),
    accountCount: accounts.length,
    sampleAccounts: accounts.slice(0, 10).map(({ id, name }) => ({ id, name })),
  };
}

export async function syncNerdioBilling(input: {
  pool: Queryable;
  operationKey?: string;
  provider?: IntegrationSettingsProvider;
  client?: NerdioUsageClient;
  now?: string;
  onProgress?: SyncProgressReporter;
}) {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings(nerdioIntegrationId);
  assertNerdioReady(settings);
  const client = input.client ?? new NerdioClient(nerdioCredentialsFromSettings(settings));
  return input.operationKey === 'nerdio-live-usage'
    ? syncLiveUsage(input.pool, client, input.now, input.onProgress)
    : syncInvoices(input.pool, client, settings, input.now, input.onProgress);
}

async function syncInvoices(
  database: Queryable,
  client: NerdioUsageClient,
  settings: IntegrationRuntimeSettings,
  nowValue?: string,
  onProgress?: SyncProgressReporter,
) {
  const now = nowValue ? new Date(nowValue) : new Date();
  const lookbackMonths = boundedInteger(settings.nonSecrets.invoiceLookbackMonths, 4, 1, 24);
  // Nerdio invoices are finalized monthly. Its invoice endpoint expects US-style
  // calendar dates and rejects ISO timestamps or a date in the current/future period.
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookbackMonths, 1));
  const metadata = { entity: 'nerdio-invoices', periodStart: isoDate(periodStart), periodEnd: isoDate(periodEnd) };
  const syncRunId = await startSyncRun(database, metadata);
  try {
    const [invoices, accounts] = await Promise.all([
      client.listInvoices({
        periodStart: nerdioApiDate(periodStart),
        periodEnd: nerdioApiDate(periodEnd),
      }),
      client.listAccounts(),
    ]);
    const accountIdByName = new Map(accounts.map((account) => [account.name.toLowerCase(), account.id]));
    const total = invoices.reduce((sum, invoice) => sum + Math.max(invoice.invoiceItems.length, 1), 0);
    let completed = 0;
    let written = 0;
    await onProgress?.({ completed, total, unitLabel: 'invoice items' });
    for (const invoice of invoices) {
      const items = invoice.invoiceItems.length ? invoice.invoiceItems : [invoice.raw];
      for (const [index, item] of items.entries()) {
        written += await insertInvoiceItem(database, syncRunId, invoice, item, index, accountIdByName);
        completed += 1;
        await onProgress?.({ completed, total, currentItem: invoice.number ?? invoice.id, unitLabel: 'invoice items' });
      }
    }
    await completeSyncRun(database, syncRunId, total, written, { ...metadata, invoiceCount: invoices.length });
    return { syncRunId, recordsRead: total, recordsWritten: written, invoiceCount: invoices.length };
  } catch (error) {
    await failSyncRun(database, syncRunId, error);
    throw error;
  }
}

async function syncLiveUsage(
  database: Queryable,
  client: NerdioUsageClient,
  nowValue?: string,
  onProgress?: SyncProgressReporter,
) {
  const collectedAt = nowValue ?? new Date().toISOString();
  const syncRunId = await startSyncRun(database, { entity: 'nerdio-live-usage', collectedAt });
  try {
    const accounts = await client.listAccounts();
    let written = 0;
    await onProgress?.({ completed: 0, total: accounts.length, unitLabel: 'accounts' });
    for (const [index, account] of accounts.entries()) {
      const usages = await client.getAccountUsage(account);
      const latest = latestUsage(usages);
      await insertLiveUsage(database, syncRunId, account, latest, collectedAt);
      written += 1;
      await onProgress?.({
        completed: index + 1,
        total: accounts.length,
        currentItem: account.name,
        unitLabel: 'accounts',
      });
    }
    await completeSyncRun(database, syncRunId, accounts.length, written, {
      entity: 'nerdio-live-usage',
      collectedAt,
    });
    return { syncRunId, recordsRead: accounts.length, recordsWritten: written, accountCount: accounts.length };
  } catch (error) {
    await failSyncRun(database, syncRunId, error);
    throw error;
  }
}

async function insertInvoiceItem(
  database: Queryable,
  syncRunId: string,
  invoice: NerdioInvoice,
  item: Record<string, unknown>,
  index: number,
  accountIdByName: Map<string, string>,
) {
  const accountName = stringValue(item.accountName ?? item.name ?? item.customerName) ?? 'Unknown Nerdio account';
  const result = await database.query(
    `insert into nerdio_invoice_items (
       sync_run_id, external_invoice_id, invoice_number, billing_period_start, billing_period_end,
       account_id, account_name, item_number, item_type, metric, code, description,
       licenses, unit_price, value, currency, raw_payload
     ) values (
       $1::uuid, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17::jsonb
     )
     on conflict (sync_run_id, external_invoice_id, account_name, item_number, metric, code, value) do nothing
     returning id`,
    [
      syncRunId,
      invoice.id,
      invoice.number ?? null,
      dateValue(invoice.startBillingPeriod ?? item.startBillingPeriod),
      dateValue(invoice.endBillingPeriod ?? item.endBillingPeriod),
      stringValue(item.accountId ?? item.accountID) ?? accountIdByName.get(accountName.toLowerCase()),
      accountName,
      stringValue(item.itemNumber ?? item.lineNumber) ?? String(index + 1),
      stringValue(item.itemType ?? item.type),
      stringValue(item.metric ?? item.metricName),
      stringValue(item.code ?? item.sku),
      stringValue(item.description ?? item.name),
      numberValue(item.licenses ?? item.quantity ?? item.count),
      numberValue(item.unitPrice ?? item.rate),
      numberValue(item.value ?? item.amount ?? item.total),
      stringValue(item.currency ?? invoice.raw.currency) ?? 'USD',
      JSON.stringify({ invoice: invoice.raw, item }),
    ],
  );
  return result.rows.length;
}

async function insertLiveUsage(
  database: Queryable,
  syncRunId: string,
  account: NerdioAccount,
  usage: Record<string, unknown>,
  collectedAt: string,
) {
  await database.query(
    `insert into nerdio_live_usage_snapshots (
       sync_run_id, account_id, account_name, collected_at,
       avd_users, cpc_users, intune_users, monthly_active_users, raw_payload
     ) values ($1::uuid, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb)
     on conflict (sync_run_id, account_id) do nothing`,
    [
      syncRunId,
      account.id,
      account.name,
      collectedAt,
      metricValue(usage, ['desktopUsersCount', 'avdUsers', 'avd', 'wvdUsers', 'desktopUsers']),
      metricValue(usage, ['onlyCpcUsersCount', 'cpcUsers', 'cpc', 'cloudPcUsers']),
      metricValue(usage, ['onlyIntuneUsersCount', 'intuneUsers', 'intune']),
      metricValue(usage, ['mauCount', 'monthlyActiveUsers', 'activeUsers', 'mau']),
      JSON.stringify({ account: account.raw, usage }),
    ],
  );
}

function latestUsage(rows: Record<string, unknown>[]) {
  return [...rows].sort((left, right) => timestampValue(right) - timestampValue(left))[0] ?? {};
}

function timestampValue(value: Record<string, unknown>) {
  const parsed = Date.parse(String(
    value.collectDateTimeUtc ?? value.observedAt ?? value.date ?? value.periodEnd ?? value.createdAt ?? '',
  ));
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined) return numberValue(row[key]);
  }
  const metrics = recordValue(row.metrics);
  for (const key of keys) {
    if (metrics[key] !== undefined) return numberValue(metrics[key]);
  }
  return 0;
}

function assertNerdioReady(settings: IntegrationRuntimeSettings) {
  if (!settings.validation.missingSecrets.length && !settings.validation.missingNonSecrets.length) return;
  throw new Error('Nerdio settings are incomplete. Configure the tenant, client, API scope, and Key Vault client secret.');
}

async function startSyncRun(database: Queryable, metadata: Record<string, unknown>) {
  const result = await database.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ($1, 'running', $2::jsonb)
     returning id`,
    [nerdioIntegrationId, JSON.stringify(metadata)],
  );
  return result.rows[0].id;
}

async function completeSyncRun(
  database: Queryable,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata: Record<string, unknown>,
) {
  await database.query(
    `update sync_runs
     set status = 'complete', completed_at = now(), records_read = $2, records_written = $3, metadata = $4::jsonb
     where id = $1::uuid`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata)],
  );
}

async function failSyncRun(database: Queryable, syncRunId: string, error: unknown) {
  await database.query(
    `update sync_runs set status = 'failed', completed_at = now(), error_message = $2 where id = $1::uuid`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function nerdioApiDate(value: Date) {
  return [
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
    value.getUTCFullYear(),
  ].join('/');
}

function dateValue(value: unknown) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
