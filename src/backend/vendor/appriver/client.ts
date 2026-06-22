import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export const appRiverIntegrationId = 'opentext-appriver' as const;
export const appRiverSubscriptionSource = 'appriver-securecloud-subscription' as const;

export type AppRiverCredentials = {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  refreshTokenCachePath?: string;
};

export type AppRiverAccessToken = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresOn?: number;
  scope?: string;
};

export type AppRiverCustomer = {
  customerId: string;
  name: string;
  customerType?: string;
  externalCustomerAccountNumber?: string;
  raw: unknown;
};

export type AppRiverSubscription = {
  subscriptionKey: string;
  productName?: string;
  productCode?: string;
  status?: string;
  raw: unknown;
};

export type AppRiverSubscriptionDetail = AppRiverSubscription & {
  totalLicenses?: number;
  assignedLicenses?: number;
  unassignedLicenses?: number;
  subscriptionQuantity?: number;
  commitmentEndDate?: string;
  expirationDate?: string;
  subscriptionTerm?: string;
  billingFrequency?: string;
  isTrial?: boolean;
  expirationBehavior?: string;
  domain?: string;
  notes?: string;
};

export type AppRiverChargeEvent = {
  customerName?: string;
  productName?: string;
  eventType?: string;
  quantity?: number;
  previousQuantity?: number;
  effectiveDate?: string;
  raw: unknown;
};

export type AppRiverListOptions = {
  pageSize?: number;
  maxPages?: number;
};

type AppRiverClientOptions = {
  onRefreshTokenRotated?: (refreshToken: string) => Promise<void> | void;
};

type AppRiverRequestOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  retryCount?: number;
};

type AppRiverTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: string | number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const defaultPageSize = 1000;
const maxRetryCount = 3;
const refreshTokenPersistRetryCount = 3;

export class AppRiverApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class AppRiverClient {
  private readonly baseUrl: string;
  private accessToken?: AppRiverAccessToken;
  private refreshToken: string;

  constructor(
    private readonly credentials: AppRiverCredentials,
    private readonly options: AppRiverClientOptions = {},
  ) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
    this.refreshToken = credentials.refreshToken;
  }

  async authenticate(): Promise<AppRiverAccessToken> {
    return this.ensureAccessToken();
  }

  async listCustomers(options: AppRiverListOptions = {}): Promise<AppRiverCustomer[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/service/api/securecloud/customers', ['Customers'], options);

    return rows.map(parseCustomer).filter((customer): customer is AppRiverCustomer => Boolean(customer));
  }

  async listCustomerSubscriptions(
    customerId: string,
    options: AppRiverListOptions = {},
  ): Promise<AppRiverSubscription[]> {
    const rows = await this.listPaged<Record<string, unknown>>(
      `/service/api/securecloud/customers/${encodeURIComponent(customerId)}/subscriptions`,
      ['Subscriptions'],
      options,
    );

    return rows
      .map(parseSubscription)
      .filter((subscription): subscription is AppRiverSubscription => Boolean(subscription));
  }

  async getCustomerSubscriptionDetails(
    customerId: string,
    subscriptionKey: string,
  ): Promise<AppRiverSubscriptionDetail> {
    const response = await this.request<unknown>(
      `/service/api/securecloud/customers/${encodeURIComponent(customerId)}/subscriptions/${encodeURIComponent(subscriptionKey)}?limit=100`,
    );
    const wrappedSubscriptions = arrayFromResponse<Record<string, unknown>>(response, ['Subscriptions']);
    const parsed = parseSubscriptionDetail(wrappedSubscriptions[0] ?? recordValue(response));

    if (!parsed) {
      throw new AppRiverApiError(`AppRiver subscription "${subscriptionKey}" did not return a valid detail payload.`);
    }

    return parsed;
  }

  async listChargeEvents(options: AppRiverListOptions = {}): Promise<AppRiverChargeEvent[]> {
    const rows = await this.listPaged<Record<string, unknown>>(
      '/service/api/securecloud/usage/charges/events',
      ['Attributes'],
      options,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          SubscriptionChargesEventFilterFields: {
            SubscriptionCanceled: false,
            Total: 'gt:0',
          },
          Sorting: {
            Parameters: {
              EffectiveDate: 'Descending',
            },
          },
        }),
      },
    );

    return rows.map(parseChargeEvent);
  }

  private async listPaged<T>(
    path: string,
    keys: string[],
    options: AppRiverListOptions,
    requestOptions: AppRiverRequestOptions = {},
  ): Promise<T[]> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? defaultPageSize, 1000));
    const maxPages = Math.max(1, options.maxPages ?? 100);
    const rows: T[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(absoluteUrl(path, this.baseUrl));
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(page * pageSize));

      const response = await this.request<unknown>(url.toString(), requestOptions);
      const pageRows = arrayFromResponse<T>(response, keys);
      rows.push(...pageRows);

      if (pageRows.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async ensureAccessToken(): Promise<AppRiverAccessToken> {
    if (this.accessToken && !tokenExpiresSoon(this.accessToken)) {
      return this.accessToken;
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<AppRiverAccessToken> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      scope: '*',
    });
    const response = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const responseText = await response.text();
    const parsed = parseJson<AppRiverTokenResponse>(responseText);

    if (!response.ok || !parsed?.access_token) {
      throw new AppRiverApiError(
        parsed?.error_description ?? parsed?.error ?? `AppRiver token refresh failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }

    if (!parsed.refresh_token) {
      throw new AppRiverApiError('AppRiver token refresh did not include a rotated refresh token.', response.status, responseText.slice(0, 500));
    }

    const token: AppRiverAccessToken = {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      tokenType: parsed.token_type ?? 'Bearer',
      expiresOn: tokenExpiry(parsed),
      scope: parsed.scope,
    };

    if (token.refreshToken !== this.refreshToken) {
      await this.persistRotatedRefreshToken(token.refreshToken);
    }

    this.refreshToken = token.refreshToken;
    this.accessToken = token;

    return token;
  }

  private async persistRotatedRefreshToken(refreshToken: string) {
    const writer = this.options.onRefreshTokenRotated;
    if (!writer) {
      return;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < refreshTokenPersistRetryCount; attempt += 1) {
      try {
        await writer(refreshToken);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < refreshTokenPersistRetryCount - 1) {
          await delay(250 * 2 ** attempt);
        }
      }
    }

    throw new AppRiverApiError(
      `AppRiver rotated the refresh token, but MSP Harmony could not persist it before using the access token. ${errorMessage(lastError)}`,
    );
  }

  private async request<T>(pathOrUrl: string, options: AppRiverRequestOptions = {}): Promise<T> {
    const token = await this.ensureAccessToken();

    try {
      return await this.rawRequest<T>(pathOrUrl, token, options);
    } catch (error) {
      if (error instanceof AppRiverApiError && error.status === 401) {
        this.accessToken = undefined;
        return this.rawRequest<T>(pathOrUrl, await this.refreshAccessToken(), options);
      }

      throw error;
    }
  }

  private async rawRequest<T>(
    pathOrUrl: string,
    token: AppRiverAccessToken,
    options: AppRiverRequestOptions = {},
  ): Promise<T> {
    const response = await fetch(absoluteUrl(pathOrUrl, this.baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {}),
        Authorization: `${token.tokenType} ${token.accessToken}`,
      },
      body: options.body,
    });
    const responseText = await response.text();

    if (shouldRetry(response.status) && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.rawRequest<T>(pathOrUrl, token, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    const parsed = responseText.trim().length > 0 ? parseJson<unknown>(responseText) : undefined;
    if (!response.ok) {
      const errorRecord = recordValue(parsed);
      throw new AppRiverApiError(
        stringValue(errorRecord.message) ??
          stringValue(errorRecord.error_description) ??
          stringValue(errorRecord.error) ??
          `AppRiver API request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }

    return parsed as T;
  }
}

export function appRiverCredentialsFromSettings(settings: IntegrationRuntimeSettings): AppRiverCredentials {
  const refreshTokenCachePath =
    settings.secretSource === 'environment'
      ? process.env.OPENTEXT_APPRIVER_REFRESH_TOKEN_CACHE_PATH?.trim()
      : undefined;
  const cachedRefreshToken = refreshTokenCachePath ? readCachedRefreshToken(refreshTokenCachePath) : undefined;

  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'OPENTEXT_APPRIVER_ENDPOINT'),
    clientId: requiredValue(settings.nonSecrets.clientId, 'OPENTEXT_APPRIVER_CLIENT_ID'),
    clientSecret: requiredValue(settings.secrets.clientSecret, 'mspharmony-opentext-appriver-client-secret'),
    refreshToken: requiredValue(cachedRefreshToken ?? settings.secrets.refreshToken, 'mspharmony-opentext-appriver-refresh-token'),
    refreshTokenCachePath,
  };
}

export function appRiverProductKeyForSubscription(detail: AppRiverSubscriptionDetail) {
  const parts = [
    detail.productCode ?? detail.productName ?? detail.subscriptionKey,
    detail.subscriptionTerm,
    detail.billingFrequency,
  ]
    .map(formatProductKeyPart)
    .filter((part): part is string => Boolean(part));

  return parts.join('|') || detail.subscriptionKey;
}

export function appRiverLicenseQuantity(detail: AppRiverSubscriptionDetail) {
  return detail.subscriptionQuantity ?? detail.totalLicenses ?? 0;
}

export function fallbackAppRiverProductCode(vendorProductKey: string) {
  return vendorProductKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'APPRIVER-SUBSCRIPTION';
}

function parseCustomer(record: Record<string, unknown>): AppRiverCustomer | undefined {
  const customerId = stringValue(valueByKeys(record, ['CustomerID', 'CustomerId', 'customerId', 'Id', 'id']));
  const name = stringValue(valueByKeys(record, ['Name', 'CompanyName', 'CustomerName', 'name']));
  if (!customerId || !name) {
    return undefined;
  }

  return {
    customerId,
    name,
    customerType: stringValue(valueByKeys(record, ['CustomerType', 'customerType'])),
    externalCustomerAccountNumber: stringValue(valueByKeys(record, ['ExternalCustomerAccountNumber', 'CustomerAccountNumber', 'CWID'])),
    raw: record,
  };
}

function parseSubscription(record: Record<string, unknown>): AppRiverSubscription | undefined {
  const subscriptionKey = stringValue(valueByKeys(record, ['SubscriptionKey', 'subscriptionKey', 'Key', 'key']));
  if (!subscriptionKey) {
    return undefined;
  }

  return {
    subscriptionKey,
    productName: stringValue(valueByKeys(record, ['ProductName', 'Product', 'Name', 'productName'])),
    productCode: stringValue(valueByKeys(record, ['ProductCode', 'Sku', 'SkuCode', 'productCode'])),
    status: stringValue(valueByKeys(record, ['Status', 'SubscriptionStatus', 'status'])),
    raw: record,
  };
}

function parseSubscriptionDetail(record: Record<string, unknown>): AppRiverSubscriptionDetail | undefined {
  const base = parseSubscription(record);
  if (!base) {
    return undefined;
  }

  const readonlyDetails = detailLookup(valueByKeys(record, ['ReadonlySubscriptionDetails', 'ReadOnlySubscriptionDetails']));
  const configurableDetails = detailLookup(valueByKeys(record, ['ConfigurableSubscriptionDetails']));
  const commitmentEndDate =
    stringValue(readonlyDetails.CommitmentEndDate) ??
    stringValue(valueByKeys(record, ['CommitmentEndDate', 'commitmentEndDate']));
  const expirationDate = stringValue(valueByKeys(record, ['ExpirationDate', 'expirationDate']));

  return {
    ...base,
    totalLicenses: numberValue(readonlyDetails.TotalLicenses),
    assignedLicenses: numberValue(readonlyDetails.AssignedLicenses),
    unassignedLicenses: numberValue(readonlyDetails.UnassignedLicenses),
    subscriptionQuantity: numberValue(configurableDetails.SubscriptionQuantity),
    commitmentEndDate: commitmentEndDate ?? expirationDate,
    expirationDate,
    subscriptionTerm: stringValue(valueByKeys(record, ['SubscriptionTerm', 'Term', 'subscriptionTerm'])),
    billingFrequency: stringValue(valueByKeys(record, ['BillingFrequency', 'billingFrequency'])),
    isTrial: booleanValue(valueByKeys(record, ['IsTrial', 'isTrial'])),
    expirationBehavior: stringValue(valueByKeys(record, ['ExpirationBehavior', 'expirationBehavior'])),
    domain: stringValue(valueByKeys(record, ['Domain', 'PrimaryDomain', 'domain'])),
    notes: stringValue(valueByKeys(record, ['Notes', 'notes'])),
  };
}

function parseChargeEvent(record: Record<string, unknown>): AppRiverChargeEvent {
  return {
    customerName: stringValue(valueByKeys(record, ['CustomerName', 'customerName'])),
    productName: stringValue(valueByKeys(record, ['ProductName', 'productName'])),
    eventType: stringValue(valueByKeys(record, ['EventType', 'eventType'])),
    quantity: numberValue(valueByKeys(record, ['Quantity', 'quantity'])),
    previousQuantity: numberValue(valueByKeys(record, ['PreviousQuantity', 'previousQuantity'])),
    effectiveDate: stringValue(valueByKeys(record, ['EffectiveDate', 'effectiveDate'])),
    raw: record,
  };
}

function arrayFromResponse<T>(response: unknown, keys: string[]): T[] {
  const record = recordValue(response);
  for (const key of keys) {
    const direct = valueByKeys(record, [key, lowerFirst(key)]);
    if (Array.isArray(direct)) {
      return direct.map(recordValue) as T[];
    }
  }

  const data = recordValue(valueByKeys(record, ['data', 'Data']));
  for (const key of keys) {
    const wrapped = valueByKeys(data, [key, lowerFirst(key)]);
    if (Array.isArray(wrapped)) {
      return wrapped.map(recordValue) as T[];
    }
  }

  return [];
}

function detailLookup(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    value
      .map(recordValue)
      .map((item) => [stringValue(item.Name ?? item.name), item.Value ?? item.value] as const)
      .filter((entry): entry is readonly [string, unknown] => Boolean(entry[0])),
  );
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function valueByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function lowerFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
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

function tokenExpiry(response: AppRiverTokenResponse) {
  const expiresIn = numberValue(response.expires_in);
  return expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;
}

function tokenExpiresSoon(token: AppRiverAccessToken) {
  return typeof token.expiresOn === 'number' && token.expiresOn - Math.floor(Date.now() / 1000) < 60;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing AppRiver - OpenText setting: ${name}.`);
  }

  return value.trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readCachedRefreshToken(cachePath: string) {
  const resolved = resolve(cachePath);
  if (!existsSync(resolved)) {
    return undefined;
  }

  const token = readFileSync(resolved, 'utf8').trim();
  return token.length > 0 ? token : undefined;
}

function formatProductKeyPart(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}
