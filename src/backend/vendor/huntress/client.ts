import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  huntressProductClassForKey,
  huntressProductClasses,
  huntressVendorProductKey,
  isHuntressProductClass,
  type HuntressProductClass,
} from './rules';

export type HuntressCredentials = {
  endpoint: string;
  apiKey: string;
  apiSecret: string;
};

export type HuntressActor = {
  reseller?: {
    id?: string;
    name?: string;
  };
  account?: {
    id?: string;
    name?: string;
    subdomain?: string;
    status?: string;
  };
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
  raw: unknown;
};

export type HuntressOrganization = {
  organizationId: string;
  organizationName?: string;
  accountId?: string;
  key?: string;
  agentsCount?: number;
  billableIdentityCount?: number;
  logsSourcesCount?: number;
  satLearnerCount?: number;
  raw: unknown;
};

export type HuntressAgent = {
  agentId: string;
  organizationId?: string;
  accountId?: string;
  hostname?: string;
  platform?: string;
  os?: string;
  version?: string;
  lastCallbackAt?: string;
  raw: unknown;
};

export type HuntressInvoice = {
  invoiceId: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  hasUsage?: boolean;
  raw: unknown;
};

export type HuntressOrganizationUsageLineItem = {
  lineItemId: string;
  periodStart?: string;
  periodEnd?: string;
  accountId?: string;
  accountName?: string;
  organizationId: string;
  organizationName?: string;
  actualUsage: Partial<Record<HuntressProductClass, number>>;
  raw: unknown;
};

export type HuntressListOptions = {
  pageSize?: number;
  maxPages?: number;
};

type HuntressRequestOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  retryCount?: number;
};

type HuntressListResponse = {
  pagination?: {
    next_page_token?: string;
    next_page_url?: string;
  };
};

const defaultPageSize = 500;
const defaultMaxPages = 100;
const maxRetryCount = 3;

export class HuntressApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class HuntressClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: HuntressCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async getActor(): Promise<HuntressActor> {
    return parseActor(await this.request<unknown>('/v1/actor'));
  }

  async listOrganizations(options: HuntressListOptions = {}): Promise<HuntressOrganization[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/v1/organizations', 'organizations', options);
    return rows.map(parseOrganization).filter((organization): organization is HuntressOrganization => Boolean(organization));
  }

  async listAgents(options: HuntressListOptions = {}): Promise<HuntressAgent[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/v1/agents', 'agents', options);
    return rows.map(parseAgent).filter((agent): agent is HuntressAgent => Boolean(agent));
  }

  async listResellerInvoices(options: HuntressListOptions = {}): Promise<HuntressInvoice[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/v1/reseller/invoices', 'invoices', options);
    return rows.map(parseInvoice).filter((invoice): invoice is HuntressInvoice => Boolean(invoice));
  }

  async listResellerOrganizationUsageLineItems(
    invoiceId: string,
    options: HuntressListOptions = {},
  ): Promise<HuntressOrganizationUsageLineItem[]> {
    const rows = await this.listPaged<Record<string, unknown>>(
      `/v1/reseller/invoices/${encodeURIComponent(invoiceId)}/organization_usage_line_items`,
      'organization_usage_line_items',
      options,
    );

    return rows
      .map(parseOrganizationUsageLineItem)
      .filter((lineItem): lineItem is HuntressOrganizationUsageLineItem => Boolean(lineItem));
  }

  private async listPaged<T>(
    path: string,
    collectionKey: string,
    options: HuntressListOptions = {},
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T[]> {
    const limit = Math.max(1, Math.min(options.pageSize ?? defaultPageSize, 500));
    const maxPages = Math.max(1, options.maxPages ?? defaultMaxPages);
    const rows: T[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.request<unknown>(path, {
        query: {
          ...query,
          limit,
          page_token: pageToken,
        },
      });
      const pageRows = arrayFromResponse<T>(response, collectionKey);
      rows.push(...pageRows);

      pageToken = recordValue(recordValue(response).pagination).next_page_token as string | undefined;
      if (!pageToken || pageRows.length === 0) {
        break;
      }
    }

    return rows;
  }

  private async request<T>(pathOrUrl: string, options: HuntressRequestOptions = {}): Promise<T> {
    const url = new URL(absoluteUrl(pathOrUrl, this.baseUrl));
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (typeof value !== 'undefined') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString('base64')}`,
      },
    });
    const responseText = await response.text();

    if (shouldRetry(response.status) && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.request<T>(pathOrUrl, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    const parsed = responseText.trim().length > 0 ? parseJson<unknown>(responseText) : undefined;
    if (!response.ok) {
      const errorRecord = recordValue(parsed);
      throw new HuntressApiError(
        stringValue(valueByKeys(errorRecord, ['message', 'error', 'detail'])) ??
          `Huntress API request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }

    return parsed as T;
  }
}

export function huntressCredentialsFromSettings(settings: IntegrationRuntimeSettings): HuntressCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint ?? settings.definition.endpoint, 'HUNTRESS_ENDPOINT'),
    apiKey: requiredValue(settings.secrets.apiKey, 'mspharmony-huntress-api-key'),
    apiSecret: requiredValue(settings.secrets.apiSecret, 'mspharmony-huntress-api-secret'),
  };
}

export function huntressProductClassesFromSettings(settings: IntegrationRuntimeSettings): HuntressProductClass[] {
  const configured = settings.nonSecrets.productClasses?.trim() || 'itdr';
  if (/^all$/i.test(configured)) {
    return [...huntressProductClasses];
  }

  const classes = configured
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/-/g, '_'))
    .filter(isHuntressProductClass);

  return classes.length > 0 ? [...new Set(classes)] : ['itdr'];
}

export function parseOrganization(record: Record<string, unknown>): HuntressOrganization | undefined {
  const organizationId = stringValue(valueByKeys(record, ['id', 'organization_id', 'organizationId']));
  if (!organizationId) {
    return undefined;
  }

  return {
    organizationId,
    organizationName: stringValue(valueByKeys(record, ['name', 'organization_name', 'organizationName'])),
    accountId: stringValue(valueByKeys(record, ['account_id', 'accountId'])),
    key: stringValue(record.key),
    agentsCount: numberValue(valueByKeys(record, ['agents_count', 'agentsCount'])),
    billableIdentityCount: numberValue(valueByKeys(record, ['billable_identity_count', 'billableIdentityCount'])),
    logsSourcesCount: numberValue(valueByKeys(record, ['logs_sources_count', 'logsSourcesCount'])),
    satLearnerCount: numberValue(valueByKeys(record, ['sat_learner_count', 'satLearnerCount'])),
    raw: record,
  };
}

export function parseAgent(record: Record<string, unknown>): HuntressAgent | undefined {
  const agentId = stringValue(valueByKeys(record, ['id', 'agent_id', 'agentId']));
  if (!agentId) {
    return undefined;
  }

  return {
    agentId,
    organizationId: stringValue(valueByKeys(record, ['organization_id', 'organizationId'])),
    accountId: stringValue(valueByKeys(record, ['account_id', 'accountId'])),
    hostname: stringValue(record.hostname),
    platform: stringValue(record.platform),
    os: stringValue(record.os),
    version: stringValue(record.version),
    lastCallbackAt: stringValue(valueByKeys(record, ['last_callback_at', 'lastCallbackAt'])),
    raw: record,
  };
}

export function parseInvoice(record: Record<string, unknown>): HuntressInvoice | undefined {
  const invoiceId = stringValue(valueByKeys(record, ['id', 'invoice_id', 'invoiceId']));
  if (!invoiceId) {
    return undefined;
  }

  return {
    invoiceId,
    status: stringValue(record.status),
    createdAt: stringValue(valueByKeys(record, ['created_at', 'createdAt'])),
    updatedAt: stringValue(valueByKeys(record, ['updated_at', 'updatedAt'])),
    hasUsage: booleanValue(valueByKeys(record, ['has_usage', 'hasUsage'])),
    raw: record,
  };
}

export function parseOrganizationUsageLineItem(
  record: Record<string, unknown>,
): HuntressOrganizationUsageLineItem | undefined {
  const organization = recordValue(valueByKeys(record, ['organization', 'Organization']));
  const organizationId = stringValue(valueByKeys(organization, ['id', 'organization_id', 'organizationId']));
  if (!organizationId) {
    return undefined;
  }

  const account = recordValue(valueByKeys(record, ['account', 'Account']));
  const actualUsage = productUsageFromRecord(recordValue(valueByKeys(record, ['actual_usage', 'actualUsage'])));
  return {
    lineItemId: stringValue(valueByKeys(record, ['id', 'line_item_id', 'lineItemId'])) ?? `${organizationId}:usage`,
    periodStart: stringValue(valueByKeys(record, ['period_start', 'periodStart'])),
    periodEnd: stringValue(valueByKeys(record, ['period_end', 'periodEnd'])),
    accountId: stringValue(valueByKeys(account, ['id', 'account_id', 'accountId'])),
    accountName: stringValue(valueByKeys(account, ['name', 'account_name', 'accountName'])),
    organizationId,
    organizationName: stringValue(valueByKeys(organization, ['name', 'organization_name', 'organizationName'])),
    actualUsage,
    raw: record,
  };
}

export function huntressExternalAccountId(organizationId: string, productClass: HuntressProductClass) {
  return `${organizationId}|${huntressVendorProductKey(productClass)}`;
}

export function huntressProductClassForExternalAccountId(externalAccountId: string) {
  const [, vendorProductKey] = externalAccountId.split('|');
  return vendorProductKey ? huntressProductClassForKey(vendorProductKey) : undefined;
}

function parseActor(response: unknown): HuntressActor {
  const record = recordValue(response);
  const reseller = recordValue(record.reseller);
  const account = recordValue(record.account);
  const user = recordValue(record.user);

  return {
    reseller: Object.keys(reseller).length
      ? {
          id: stringValue(reseller.id),
          name: stringValue(reseller.name),
        }
      : undefined,
    account: Object.keys(account).length
      ? {
          id: stringValue(account.id),
          name: stringValue(account.name),
          subdomain: stringValue(account.subdomain),
          status: stringValue(account.status),
        }
      : undefined,
    user: Object.keys(user).length
      ? {
          id: stringValue(user.id),
          email: stringValue(user.email),
          name: stringValue(user.name),
        }
      : undefined,
    raw: response,
  };
}

function productUsageFromRecord(record: Record<string, unknown>): Partial<Record<HuntressProductClass, number>> {
  const usage: Partial<Record<HuntressProductClass, number>> = {};

  for (const productClass of huntressProductClasses) {
    const directValue = valueByKeys(record, [productClass, productClass.replace(/_/g, '-')]);
    const quantity = numberValue(directValue);
    if (typeof quantity === 'number') {
      usage[productClass] = quantity;
    }
  }

  return usage;
}

function arrayFromResponse<T>(response: unknown, collectionKey: string): T[] {
  const record = recordValue(response) as HuntressListResponse & Record<string, unknown>;
  const rows = record[collectionKey];
  return Array.isArray(rows) ? (rows.map(recordValue) as T[]) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function valueByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }

  return undefined;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new HuntressApiError(`Missing Huntress setting: ${name}.`);
  }

  return value.trim();
}

function normalizeEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  const withoutVersion = trimmed.replace(/\/v1$/i, '');
  if (!withoutVersion) {
    throw new HuntressApiError('Huntress endpoint is empty.');
  }

  return /^https?:\/\//i.test(withoutVersion) ? withoutVersion : `https://${withoutVersion}`;
}

function absoluteUrl(pathOrUrl: string, baseUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${path}`;
}

function shouldRetry(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: Response, retryCount: number) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  return 250 * 2 ** retryCount;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
