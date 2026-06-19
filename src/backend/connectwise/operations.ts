import type { Pool } from 'pg';
import {
  createIntegrationSettingsProvider,
  type IntegrationRuntimeSettings,
  type IntegrationSettingsProvider,
} from '../config/settingsProvider';
import { ConnectWiseClient, connectWiseCredentialsFromSettings, type ConnectWiseCompany } from './client';
import type { ConnectWiseAgreement, ConnectWiseAgreementAddition } from './client';

export type ConnectWiseConnectionTestResult = {
  integrationId: 'connectwise';
  testedAt: string;
  companyCount: number;
  sampleCompanies: Array<{
    id: number;
    identifier?: string;
    name: string;
    status?: string;
  }>;
  runtimeSettings: Pick<IntegrationRuntimeSettings, 'definition' | 'nonSecrets' | 'validation'>;
};

export type ConnectWiseCompanySyncResult = {
  syncRunId: string;
  recordsRead: number;
  recordsWritten: number;
};

export type ConnectWiseAgreementReportSyncResult = ConnectWiseCompanySyncResult & {
  customersRead: number;
  customersWritten: number;
  agreementsRead: number;
  agreementsWritten: number;
  agreementsSkipped: number;
  productsWritten: number;
  additionsRead: number;
  additionsWritten: number;
  additionsSkipped: number;
  historyWritten: number;
};

const REPORT_CUSTOMER_CONDITION = '(status/name like "Active" OR Status/Name like "Special Info") AND isVendorFlag=False';
export const REPORT_AGREEMENT_CONDITION =
  'AgreementStatus NOT Like "Expired" AND AgreementStatus Not Like "Cancelled" AND AgreementStatus Not Like "Inactive"';
export const REPORT_ADDITION_CONDITION =
  'AgreementStatus not like "Expired" AND AgreementStatus not like "Cancelled" AND AgreementStatus Not Like "Inactive" AND AdditionStatus Not Like "Expired" AND AdditionStatus Not Like "Cancelled" AND AdditionStatus Not Like "Inactive"';
const INACTIVE_STATUS_PATTERN = /expired|cancelled|canceled|inactive/i;

export async function testConnectWiseConnection(
  provider: IntegrationSettingsProvider = createIntegrationSettingsProvider({ loadLocalEnv: true }),
): Promise<ConnectWiseConnectionTestResult> {
  const settings = await provider.getIntegrationSettings('connectwise');
  assertConnectWiseReady(settings);

  const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
  const [count, companies] = await Promise.all([
    client.getCompanyCount(),
    client.listCompanies({ page: 1, pageSize: 5, orderBy: 'name' }),
  ]);

  return {
    integrationId: 'connectwise',
    testedAt: new Date().toISOString(),
    companyCount: count.count,
    sampleCompanies: companies.map((company) => ({
      id: company.id,
      identifier: company.identifier,
      name: company.name,
      status: company.status?.name,
    })),
    runtimeSettings: {
      definition: settings.definition,
      nonSecrets: settings.nonSecrets,
      validation: settings.validation,
    },
  };
}

export async function syncConnectWiseCompanies(input: {
  pool: Pool;
  provider?: IntegrationSettingsProvider;
  pageSize?: number;
  maxPages?: number;
}): Promise<ConnectWiseCompanySyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('connectwise');
  assertConnectWiseReady(settings);

  const pageSize = input.pageSize ?? 100;
  const maxPages = input.maxPages ?? 1;
  const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
  const syncRunId = await startSyncRun(input.pool, 'companies');

  try {
    let recordsRead = 0;
    let recordsWritten = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const companies = await client.listCompanies({ page, pageSize, orderBy: 'name' });
      if (companies.length === 0) break;

      recordsRead += companies.length;
      for (const company of companies) {
        await upsertCompany(input.pool, company);
        recordsWritten += 1;
      }

      if (companies.length < pageSize) break;
    }

    await completeSyncRun(input.pool, syncRunId, recordsRead, recordsWritten);

    return {
      syncRunId,
      recordsRead,
      recordsWritten,
    };
  } catch (error) {
    await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export async function syncConnectWiseAgreementReport(input: {
  pool: Pool;
  provider?: IntegrationSettingsProvider;
  pageSize?: number;
  maxPages?: number;
}): Promise<ConnectWiseAgreementReportSyncResult> {
  const provider = input.provider ?? createIntegrationSettingsProvider({ loadLocalEnv: true });
  const settings = await provider.getIntegrationSettings('connectwise');
  assertConnectWiseReady(settings);

  const pageSize = input.pageSize ?? 100;
  const maxPages = input.maxPages ?? 50;
  const client = new ConnectWiseClient(connectWiseCredentialsFromSettings(settings));
  const syncRunId = await startSyncRun(input.pool, 'agreement-report');

  try {
    const customerIdsByConnectWiseId = new Map<string, string>();
    let customersWritten = 0;
    let agreementsWritten = 0;
    let productsWritten = 0;
    const productCodesWritten = new Set<string>();
    let additionsRead = 0;
    let additionsWritten = 0;
    let historyWritten = 0;

    const companies = (
      await listAllPages((page) =>
        client.listCompanies({
          page,
          pageSize,
          orderBy: 'name',
          conditions: REPORT_CUSTOMER_CONDITION,
        }),
      maxPages)
    ).filter(isReportCustomer);

    for (const company of companies) {
      const customerId = await upsertCompany(input.pool, company);
      customerIdsByConnectWiseId.set(String(company.id), customerId);
      customersWritten += 1;
    }

    const rawAgreements = await listAllPages((page) =>
      client.listAgreements({
        page,
        pageSize,
        conditions: REPORT_AGREEMENT_CONDITION,
      }),
    maxPages);
    const agreements: ConnectWiseAgreement[] = [];
    let agreementsSkipped = 0;
    let additionsSkipped = 0;

    for (const agreement of rawAgreements) {
      if (isInactiveAgreement(agreement)) {
        await markAgreementInactive(input.pool, agreement);
        agreementsSkipped += 1;
      } else {
        agreements.push(agreement);
      }
    }

    for (const agreement of agreements) {
      const customerId = await ensureAgreementCustomer(input.pool, agreement, customerIdsByConnectWiseId);
      const agreementId = await upsertAgreement(input.pool, agreement, customerId);
      agreementsWritten += 1;

      const additions = await listAllPages((page) =>
        client.listAgreementAdditions(agreement.id, {
          page,
          pageSize,
          conditions: REPORT_ADDITION_CONDITION,
        }),
      maxPages);
      additionsRead += additions.length;

      for (const addition of additions) {
        if (isInactiveAddition(addition)) {
          await markAgreementAdditionInactive(input.pool, addition);
          additionsSkipped += 1;
          continue;
        }

        const productId = await upsertProduct(input.pool, addition);
        productCodesWritten.add(productCodeForAddition(addition));
        productsWritten = productCodesWritten.size;

        const result = await upsertAgreementAdditionAndHistory(input.pool, {
          addition,
          agreement,
          agreementId,
          customerId,
          productId,
          syncRunId,
        });
        additionsWritten += result.additionWritten;
        historyWritten += result.historyWritten;
      }
    }

    await completeSyncRun(input.pool, syncRunId, additionsRead, additionsWritten, {
      customersRead: companies.length,
      customersWritten,
      agreementsRead: rawAgreements.length,
      agreementsSkipped,
      agreementsWritten,
      productsWritten,
      additionsRead,
      additionsWritten,
      additionsSkipped,
      historyWritten,
    });

    return {
      syncRunId,
      recordsRead: additionsRead,
      recordsWritten: additionsWritten,
      customersRead: companies.length,
      customersWritten,
      agreementsRead: rawAgreements.length,
      agreementsWritten,
      agreementsSkipped,
      productsWritten,
      additionsRead,
      additionsWritten,
      additionsSkipped,
      historyWritten,
    };
  } catch (error) {
    await failSyncRun(input.pool, syncRunId, error);
    throw error;
  }
}

export function assertConnectWiseReady(settings: IntegrationRuntimeSettings) {
  if (settings.validation.missingSecrets.length === 0 && settings.validation.missingNonSecrets.length === 0) {
    return;
  }

  throw new Error(
    `ConnectWise settings are not connected. Missing secrets: ${settings.validation.missingSecrets
      .map((secret) => secret.keyVaultSecretName)
      .join(', ') || 'none'}. Missing non-secrets: ${settings.validation.missingNonSecrets
      .map((setting) => setting.envVar)
      .join(', ') || 'none'}.`,
  );
}

async function startSyncRun(pool: Pool, entity: 'companies' | 'agreement-report') {
  const result = await pool.query<{ id: string }>(
    `insert into sync_runs (integration_id, status, metadata)
     values ('connectwise', 'running', $1::jsonb)
     returning id`,
    [JSON.stringify({ entity })],
  );
  const syncRunId = result.rows[0]?.id;

  if (!syncRunId) {
    throw new Error(`Unable to create ConnectWise ${entity} sync run.`);
  }

  return syncRunId;
}

async function completeSyncRun(
  pool: Pool,
  syncRunId: string,
  recordsRead: number,
  recordsWritten: number,
  metadata?: Record<string, number>,
) {
  await pool.query(
    `update sync_runs
     set status = 'complete',
         completed_at = now(),
         records_read = $2,
         records_written = $3,
         metadata = metadata || $4::jsonb
     where id = $1`,
    [syncRunId, recordsRead, recordsWritten, JSON.stringify(metadata ?? {})],
  );
}

async function failSyncRun(pool: Pool, syncRunId: string, error: unknown) {
  await pool.query(
    `update sync_runs
     set status = 'failed',
         completed_at = now(),
         error_message = $2
     where id = $1`,
    [syncRunId, error instanceof Error ? error.message : String(error)],
  );
}

async function upsertCompany(pool: Pool, company: ConnectWiseCompany) {
  const result = await pool.query<{ id: string }>(
    `insert into customers (connectwise_company_id, name, status, aliases, raw_payload, updated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, now())
     on conflict (connectwise_company_id)
     do update set
       name = excluded.name,
       status = excluded.status,
       aliases = excluded.aliases,
       raw_payload = excluded.raw_payload,
       updated_at = now()
     returning id`,
    [
      String(company.id),
      company.name,
      company.deletedFlag ? 'inactive' : company.status?.name ?? 'active',
      JSON.stringify(company.identifier ? [company.identifier] : []),
      JSON.stringify(company),
    ],
  );

  return requireReturnedId(result.rows[0]?.id, 'customer');
}

async function ensureAgreementCustomer(
  pool: Pool,
  agreement: ConnectWiseAgreement,
  customerIdsByConnectWiseId: Map<string, string>,
) {
  const company = agreement.company;
  const connectWiseCompanyId = String(company?.id ?? `agreement-${agreement.id}`);
  const existingCustomerId = customerIdsByConnectWiseId.get(connectWiseCompanyId);

  if (existingCustomerId) {
    return existingCustomerId;
  }

  const result = await pool.query<{ id: string }>(
    `insert into customers (connectwise_company_id, name, status, aliases, raw_payload, updated_at)
     values ($1, $2, 'active', $3::jsonb, $4::jsonb, now())
     on conflict (connectwise_company_id)
     do update set
       name = excluded.name,
       aliases = case
         when excluded.aliases = '[]'::jsonb then customers.aliases
         else excluded.aliases
       end,
       raw_payload = case
         when customers.raw_payload = '{}'::jsonb then excluded.raw_payload
         else customers.raw_payload
       end,
       updated_at = now()
     returning id`,
    [
      connectWiseCompanyId,
      company?.name ?? `Agreement ${agreement.id} company`,
      JSON.stringify(company?.identifier ? [company.identifier] : []),
      JSON.stringify(company ?? { id: connectWiseCompanyId, name: `Agreement ${agreement.id} company` }),
    ],
  );
  const customerId = requireReturnedId(result.rows[0]?.id, 'agreement customer');
  customerIdsByConnectWiseId.set(connectWiseCompanyId, customerId);

  return customerId;
}

async function upsertAgreement(pool: Pool, agreement: ConnectWiseAgreement, customerId: string) {
  const result = await pool.query<{ id: string }>(
    `insert into agreements (
       customer_id,
       connectwise_agreement_id,
       name,
       status,
       billing_month,
       default_currency,
       raw_payload,
       updated_at
     )
     values ($1, $2, $3, $4, $5, 'USD', $6::jsonb, now())
     on conflict (connectwise_agreement_id)
     do update set
       customer_id = excluded.customer_id,
       name = excluded.name,
       status = excluded.status,
       billing_month = excluded.billing_month,
       default_currency = excluded.default_currency,
       raw_payload = excluded.raw_payload,
       updated_at = now()
     returning id`,
    [
      customerId,
      String(agreement.id),
      agreement.name,
      agreementStatus(agreement),
      currentBillingMonth(),
      JSON.stringify(agreement),
    ],
  );

  return requireReturnedId(result.rows[0]?.id, 'agreement');
}

async function upsertProduct(pool: Pool, addition: ConnectWiseAgreementAddition) {
  const productCode = productCodeForAddition(addition);
  const productName = productNameForAddition(addition);
  const result = await pool.query<{ id: string }>(
    `insert into products (
       vendor_id,
       display_name,
       connectwise_product_id,
       connectwise_product_code,
       billing_basis,
       raw_payload,
       updated_at
     )
     values ('connectwise', $1, $2, $3, 'agreement-addition', $4::jsonb, now())
     on conflict (vendor_id, connectwise_product_code)
     do update set
       display_name = excluded.display_name,
       connectwise_product_id = coalesce(excluded.connectwise_product_id, products.connectwise_product_id),
       raw_payload = excluded.raw_payload,
       updated_at = now()
     returning id`,
    [
      productName,
      addition.product?.id ? String(addition.product.id) : null,
      productCode,
      JSON.stringify(addition.product ?? { identifier: productCode, description: productName }),
    ],
  );

  return requireReturnedId(result.rows[0]?.id, 'product');
}

async function upsertAgreementAdditionAndHistory(
  pool: Pool,
  input: {
    addition: ConnectWiseAgreementAddition;
    agreement: ConnectWiseAgreement;
    agreementId: string;
    customerId: string;
    productId: string;
    syncRunId: string;
  },
) {
  const { addition, agreement, agreementId, customerId, productId, syncRunId } = input;
  const connectwiseAdditionId = String(addition.id);
  const existing = await pool.query<{ id: string; quantity: string | number }>(
    `select id, quantity
     from agreement_additions
     where connectwise_addition_id = $1`,
    [connectwiseAdditionId],
  );
  const previousQuantity = existing.rows[0]?.quantity ?? null;
  const productCode = productCodeForAddition(addition);
  const productName = productNameForAddition(addition);
  const observedQuantity = numericValue(addition.quantity);
  const unitPrice = nullableNumericValue(addition.unitPrice);
  const rawPayload = agreementAdditionReportPayload(agreement, addition);
  const status = additionStatus(addition);

  const result = await pool.query<{ id: string }>(
    `insert into agreement_additions (
       customer_id,
       agreement_id,
       product_id,
       connectwise_addition_id,
       product_code,
       product_name,
       quantity,
       unit_price,
       addition_status,
       raw_payload,
       updated_from_connectwise_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, now())
     on conflict (connectwise_addition_id)
     do update set
       customer_id = excluded.customer_id,
       agreement_id = excluded.agreement_id,
       product_id = excluded.product_id,
       product_code = excluded.product_code,
       product_name = excluded.product_name,
       quantity = excluded.quantity,
       unit_price = excluded.unit_price,
       addition_status = excluded.addition_status,
       raw_payload = excluded.raw_payload,
       updated_from_connectwise_at = excluded.updated_from_connectwise_at,
       updated_at = now()
     returning id`,
    [
      customerId,
      agreementId,
      productId,
      connectwiseAdditionId,
      productCode,
      productName,
      observedQuantity,
      unitPrice,
      status,
      JSON.stringify(rawPayload),
      connectWiseUpdatedAt(addition),
    ],
  );
  const agreementAdditionId = requireReturnedId(result.rows[0]?.id, 'agreement addition');

  await pool.query(
    `insert into addition_history (
       agreement_addition_id,
       sync_run_id,
       customer_id,
       agreement_id,
       product_code,
       previous_quantity,
       observed_quantity,
       unit_price,
       addition_status,
       raw_payload
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      agreementAdditionId,
      syncRunId,
      customerId,
      agreementId,
      productCode,
      previousQuantity,
      observedQuantity,
      unitPrice,
      status,
      JSON.stringify(rawPayload),
    ],
  );

  return {
    additionWritten: 1,
    historyWritten: 1,
  };
}

async function markAgreementInactive(pool: Pool, agreement: ConnectWiseAgreement) {
  const storedStatus = isPastDate(agreementEndDate(agreement), currentDateKey()) && !INACTIVE_STATUS_PATTERN.test(agreementStatus(agreement))
    ? 'Expired'
    : agreementStatus(agreement);
  const result = await pool.query<{ id: string }>(
    `update agreements
     set status = $2,
         raw_payload = raw_payload || $3::jsonb,
         updated_at = now()
     where connectwise_agreement_id = $1
     returning id`,
    [String(agreement.id), storedStatus, JSON.stringify(agreement)],
  );
  const agreementId = result.rows[0]?.id;

  if (!agreementId) {
    return;
  }

  await pool.query(
    `update agreement_additions
     set addition_status = case
           when addition_status ~* 'expired|cancelled|canceled|inactive' then addition_status
           else $2
         end,
         updated_at = now()
     where agreement_id = $1`,
    [agreementId, storedStatus],
  );
}

async function markAgreementAdditionInactive(pool: Pool, addition: ConnectWiseAgreementAddition) {
  const status = inactiveAdditionStatus(addition);

  await pool.query(
    `update agreement_additions
     set addition_status = $2,
         raw_payload = raw_payload || $3::jsonb,
         updated_from_connectwise_at = coalesce($4::timestamptz, updated_from_connectwise_at),
         updated_at = now()
     where connectwise_addition_id = $1`,
    [
      String(addition.id),
      status,
      JSON.stringify({
        ...addition,
        additionStatus: status,
      }),
      connectWiseUpdatedAt(addition),
    ],
  );
}

async function listAllPages<T>(fetchPage: (page: number) => Promise<T[]>, maxPages: number) {
  const records: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const pageRecords = await fetchPage(page);
    if (pageRecords.length === 0) break;

    records.push(...pageRecords);
  }

  return records;
}

function isReportCustomer(company: ConnectWiseCompany) {
  const typeNames = (company.types ?? []).map((type) => type.name?.toLowerCase()).filter(Boolean);
  return !typeNames.includes('prospect') && !typeNames.includes('former client');
}

function agreementStatus(agreement: ConnectWiseAgreement) {
  const status =
    agreement.agreementStatus ??
    stringField(agreement, 'AgreementStatus') ??
    stringField(agreement, 'agreementStatus') ??
    stringField(agreement, 'statusName');
  if (status) return status;
  if (typeof agreement.status === 'string') return agreement.status;
  if (agreement.status?.name) return agreement.status.name;

  return 'Active';
}

export function isInactiveAgreement(agreement: ConnectWiseAgreement, today = currentDateKey()) {
  return INACTIVE_STATUS_PATTERN.test(agreementStatus(agreement)) || isPastDate(agreementEndDate(agreement), today);
}

function agreementAdditionReportPayload(agreement: ConnectWiseAgreement, addition: ConnectWiseAgreementAddition) {
  return {
    ...addition,
    Company: agreement.company?.name,
    Agreement: agreement.name,
    ProductName: productCodeForAddition(addition),
    agreementId: addition.agreementId ?? agreement.id,
    agreementStatus: addition.agreementStatus ?? agreementStatus(agreement),
    additionStatus: additionStatus(addition),
  };
}

function additionStatus(addition: ConnectWiseAgreementAddition) {
  const status =
    addition.additionStatus ??
    stringField(addition, 'additionStatus') ??
    stringField(addition, 'AdditionStatus') ??
    stringField(addition, 'status');
  if (status) return status;

  const nestedStatus = addition.status;
  if (nestedStatus && typeof nestedStatus === 'object' && 'name' in nestedStatus && typeof nestedStatus.name === 'string') {
    return nestedStatus.name;
  }

  return 'Active';
}

export function isInactiveAddition(addition: ConnectWiseAgreementAddition) {
  const agreementStatus =
    addition.agreementStatus ?? stringField(addition, 'agreementStatus') ?? stringField(addition, 'AgreementStatus');
  return INACTIVE_STATUS_PATTERN.test(additionStatus(addition)) || INACTIVE_STATUS_PATTERN.test(agreementStatus ?? '');
}

function inactiveAdditionStatus(addition: ConnectWiseAgreementAddition) {
  const status = additionStatus(addition);
  if (INACTIVE_STATUS_PATTERN.test(status)) return status;

  const agreementStatus =
    addition.agreementStatus ?? stringField(addition, 'agreementStatus') ?? stringField(addition, 'AgreementStatus');
  if (agreementStatus && INACTIVE_STATUS_PATTERN.test(agreementStatus)) return agreementStatus;

  return 'Inactive';
}

function productCodeForAddition(addition: ConnectWiseAgreementAddition) {
  return String(
    addition.product?.identifier ??
      addition.product?.description ??
      stringField(addition, 'description') ??
      stringField(addition, 'invoiceDescription') ??
      addition.product?.id ??
      addition.id,
  );
}

function productNameForAddition(addition: ConnectWiseAgreementAddition) {
  return String(
    addition.product?.description ??
      addition.product?.identifier ??
      stringField(addition, 'description') ??
      stringField(addition, 'invoiceDescription') ??
      productCodeForAddition(addition),
  );
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function agreementEndDate(agreement: ConnectWiseAgreement) {
  return (
    agreement.endDate ??
    stringField(agreement, 'EndDate') ??
    stringField(agreement, 'dateEnd') ??
    stringField(agreement, 'DateEnd') ??
    stringField(agreement, 'expirationDate') ??
    stringField(agreement, 'ExpirationDate')
  );
}

function currentBillingMonth() {
  return new Date().toISOString().slice(0, 7);
}

function currentDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function isPastDate(value: string | undefined, today: string) {
  const dateKey = dateKeyFromValue(value);
  return Boolean(dateKey && dateKey < today);
}

function dateKeyFromValue(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const datePrefix = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (datePrefix) return datePrefix;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function numericValue(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumericValue(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function connectWiseUpdatedAt(addition: ConnectWiseAgreementAddition) {
  return addition._info?.lastUpdated ?? addition._info?.dateEntered ?? null;
}

function requireReturnedId(id: string | undefined, entity: string) {
  if (!id) {
    throw new Error(`Unable to persist ConnectWise ${entity}.`);
  }

  return id;
}
