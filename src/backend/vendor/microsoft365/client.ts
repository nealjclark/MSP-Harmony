import { randomUUID } from 'node:crypto';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type Microsoft365Credentials = {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

export type Microsoft365AccessToken = {
  accessToken: string;
  tokenType: string;
  expiresOn?: number;
};

export type Microsoft365Tenant = {
  tenantId: string;
  displayName?: string;
  defaultDomainName?: string;
  contractType?: string;
  raw?: unknown;
};

export type Microsoft365AssignedLicense = {
  skuId: string;
  skuPartNumber?: string;
  skuName?: string;
  disabledPlans: string[];
  servicePlans: Microsoft365ServicePlan[];
  raw: unknown;
};

export type Microsoft365CustomerUser = {
  id: string;
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
  accountEnabled?: boolean;
  assignedLicenses: Microsoft365AssignedLicense[];
  raw: unknown;
};

export type Microsoft365ServicePlan = {
  id?: string;
  displayName?: string;
  serviceName?: string;
  capabilityStatus?: string;
  targetType?: string;
  raw: unknown;
};

export type Microsoft365SubscribedSku = {
  skuId: string;
  skuPartNumber?: string;
  skuName?: string;
  subscriptionIds: string[];
  servicePlans: Microsoft365ServicePlan[];
  consumedUnits?: number;
  enabledUnits?: number;
  suspendedUnits?: number;
  warningUnits?: number;
  lockedOutUnits?: number;
  capabilityStatus?: string;
  appliesTo?: string;
  accountId?: string;
  accountName?: string;
  raw: unknown;
};

export type Microsoft365CompanySubscription = {
  id: string;
  commerceSubscriptionId?: string;
  skuId?: string;
  skuPartNumber?: string;
  status?: string;
  totalLicenses?: number;
  isTrial?: boolean;
  createdDateTime?: string;
  nextLifecycleDateTime?: string;
  ownerId?: string;
  ownerTenantId?: string;
  ownerType?: string;
  serviceStatus: Microsoft365ServicePlan[];
  raw: unknown;
};

export type Microsoft365ListOptions = {
  pageSize?: number;
  maxPages?: number;
};

type GraphCollection<T> = {
  value?: T[];
  '@odata.nextLink'?: string;
};

type Microsoft365TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_on?: string | number;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
};

type Microsoft365RequestOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  retryCount?: number;
};

type TenantToken = Microsoft365AccessToken & {
  tenantId: string;
};

const authorityHost = 'https://login.microsoftonline.com';
const maxRetryCount = 3;

export class Microsoft365ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
    public readonly requestId?: string | null,
    public readonly correlationId?: string | null,
  ) {
    super(message);
  }
}

export class Microsoft365Client {
  private readonly baseUrl: string;
  private readonly tokenCache = new Map<string, TenantToken>();

  constructor(private readonly credentials: Microsoft365Credentials) {
    this.baseUrl = normalizeGraphEndpoint(credentials.endpoint);
  }

  async authenticate(tenantId: string): Promise<Microsoft365AccessToken> {
    const cached = this.tokenCache.get(tenantId);
    if (cached && !tokenExpiresSoon(cached)) {
      return cached;
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: `${this.baseUrl}/.default`,
    });
    const response = await fetch(
      `${authorityHost}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );
    const responseText = await response.text();
    const parsed = parseJson<Microsoft365TokenResponse>(responseText);

    if (!response.ok || !parsed?.access_token) {
      throw new Microsoft365ApiError(
        parsed?.error_description ?? parsed?.error ?? `Microsoft 365 token request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
        response.headers.get('request-id'),
        response.headers.get('client-request-id'),
      );
    }

    const token: TenantToken = {
      tenantId,
      accessToken: parsed.access_token,
      tokenType: parsed.token_type ?? 'Bearer',
      expiresOn: tokenExpiry(parsed),
    };
    this.tokenCache.set(tenantId, token);

    return token;
  }

  async listTenantUsers(tenantId: string, options: Microsoft365ListOptions = {}): Promise<Microsoft365CustomerUser[]> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 999));
    const path =
      `/v1.0/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,assignedLicenses&$top=${pageSize}`;
    const rows = await this.listGraphCollection<Record<string, unknown>>(tenantId, path, options);

    return rows.map(parseUser).filter((user): user is Microsoft365CustomerUser => Boolean(user));
  }

  async listTenantSubscribedSkus(tenantId: string): Promise<Microsoft365SubscribedSku[]> {
    const rows = await this.listGraphCollection<Record<string, unknown>>(
      tenantId,
      '/v1.0/subscribedSkus?$select=accountId,accountName,appliesTo,skuId,skuPartNumber,subscriptionIds,consumedUnits,prepaidUnits,capabilityStatus,servicePlans',
      { maxPages: 10 },
    );

    return rows.map(parseSubscribedSku).filter((sku): sku is Microsoft365SubscribedSku => Boolean(sku));
  }

  async listTenantDirectorySubscriptions(tenantId: string): Promise<Microsoft365CompanySubscription[]> {
    const rows = await this.listGraphCollection<Record<string, unknown>>(
      tenantId,
      '/v1.0/directory/subscriptions?$select=createdDateTime,commerceSubscriptionId,id,isTrial,nextLifecycleDateTime,ownerId,ownerTenantId,ownerType,serviceStatus,skuId,skuPartNumber,status,totalLicenses',
      { maxPages: 25 },
    );

    return rows
      .map(parseCompanySubscription)
      .filter((subscription): subscription is Microsoft365CompanySubscription => Boolean(subscription));
  }

  async listPartnerCustomerContracts(options: Microsoft365ListOptions = {}): Promise<Microsoft365Tenant[]> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 999));
    const rows = await this.listGraphCollection<Record<string, unknown>>(
      this.credentials.tenantId,
      `/v1.0/contracts?$select=id,customerId,displayName,defaultDomainName,contractType&$top=${pageSize}`,
      options,
    );

    return rows.map(parseCustomerContract).filter((tenant): tenant is Microsoft365Tenant => Boolean(tenant));
  }

  private async listGraphCollection<T>(
    tenantId: string,
    initialPath: string,
    options: Microsoft365ListOptions = {},
  ): Promise<T[]> {
    const maxPages = Math.max(1, options.maxPages ?? 100);
    const rows: T[] = [];
    let path: string | undefined = initialPath;

    for (let page = 0; path && page < maxPages; page += 1) {
      const collection: GraphCollection<T> = await this.request<GraphCollection<T>>(tenantId, path);
      rows.push(...(Array.isArray(collection.value) ? collection.value : []));
      path = collection['@odata.nextLink'];
    }

    return rows;
  }

  private async request<T>(tenantId: string, pathOrUrl: string, options: Microsoft365RequestOptions = {}): Promise<T> {
    const token = await this.authenticate(tenantId);

    try {
      return await this.rawRequest<T>(pathOrUrl, token, options);
    } catch (error) {
      if (error instanceof Microsoft365ApiError && error.status === 401) {
        this.tokenCache.delete(tenantId);
        return this.rawRequest<T>(pathOrUrl, await this.authenticate(tenantId), options);
      }

      throw error;
    }
  }

  private async rawRequest<T>(
    pathOrUrl: string,
    token: Microsoft365AccessToken,
    options: Microsoft365RequestOptions = {},
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const url = absoluteUrl(pathOrUrl, this.baseUrl);
    const requestId = randomUUID();
    const headers = {
      Accept: 'application/json',
      'client-request-id': requestId,
      ...(options.headers ?? {}),
      Authorization: `${token.tokenType} ${token.accessToken}`,
    };

    const response = await fetch(url, {
      method,
      headers,
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
      const errorRecord = recordValue(recordValue(parsed).error ?? parsed);
      throw new Microsoft365ApiError(
        stringValue(errorRecord.message) ??
          stringValue(errorRecord.error_description) ??
          `Microsoft Graph request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
        response.headers.get('request-id'),
        response.headers.get('client-request-id') ?? requestId,
      );
    }

    return parsed as T;
  }
}

export function microsoft365CredentialsFromSettings(settings: IntegrationRuntimeSettings): Microsoft365Credentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'MICROSOFT365_ENDPOINT'),
    clientId: requiredValue(settings.nonSecrets.clientId, 'MICROSOFT365_CLIENT_ID'),
    tenantId: requiredValue(settings.nonSecrets.tenantId, 'MICROSOFT365_TENANT_ID'),
    clientSecret: requiredValue(settings.secrets.clientSecret, 'mspharmony-microsoft365-client-secret'),
  };
}

export function productKeyForLicense(license: Microsoft365AssignedLicense) {
  return license.skuPartNumber ?? license.skuId;
}

function parseUser(record: Record<string, unknown>): Microsoft365CustomerUser | undefined {
  const id = stringValue(record.id);
  if (!id) {
    return undefined;
  }

  return {
    id,
    userPrincipalName: stringValue(record.userPrincipalName),
    mail: stringValue(record.mail),
    displayName: stringValue(record.displayName),
    accountEnabled: booleanValue(record.accountEnabled),
    assignedLicenses: parseAssignedLicenses(record.assignedLicenses),
    raw: record,
  };
}

function parseAssignedLicenses(value: unknown): Microsoft365AssignedLicense[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => recordValue(item))
    .map((record): Microsoft365AssignedLicense | undefined => {
      const skuId = stringValue(record.skuId);
      if (!skuId) {
        return undefined;
      }

      return {
        skuId,
        disabledPlans: parseStringArray(record.disabledPlans),
        servicePlans: [] as Microsoft365ServicePlan[],
        raw: record,
      };
    })
    .filter((license): license is Microsoft365AssignedLicense => Boolean(license));
}

function parseSubscribedSku(record: Record<string, unknown>): Microsoft365SubscribedSku | undefined {
  const skuId = stringValue(record.skuId);
  if (!skuId) {
    return undefined;
  }
  const prepaidUnits = recordValue(record.prepaidUnits);

  return {
    skuId,
    skuPartNumber: stringValue(record.skuPartNumber),
    skuName: stringValue(record.skuPartNumber),
    subscriptionIds: parseStringArray(record.subscriptionIds),
    servicePlans: parseServicePlans(record.servicePlans),
    consumedUnits: numberValue(record.consumedUnits),
    enabledUnits: numberValue(prepaidUnits.enabled),
    suspendedUnits: numberValue(prepaidUnits.suspended),
    warningUnits: numberValue(prepaidUnits.warning),
    lockedOutUnits: numberValue(prepaidUnits.lockedOut),
    capabilityStatus: stringValue(record.capabilityStatus),
    appliesTo: stringValue(record.appliesTo),
    accountId: stringValue(record.accountId),
    accountName: stringValue(record.accountName),
    raw: record,
  };
}

function parseCompanySubscription(record: Record<string, unknown>): Microsoft365CompanySubscription | undefined {
  const id = stringValue(record.id) ?? stringValue(record.commerceSubscriptionId);
  if (!id) {
    return undefined;
  }

  return {
    id,
    commerceSubscriptionId: stringValue(record.commerceSubscriptionId),
    skuId: stringValue(record.skuId),
    skuPartNumber: stringValue(record.skuPartNumber),
    status: stringValue(record.status),
    totalLicenses: numberValue(record.totalLicenses),
    isTrial: booleanValue(record.isTrial),
    createdDateTime: stringValue(record.createdDateTime),
    nextLifecycleDateTime: stringValue(record.nextLifecycleDateTime),
    ownerId: stringValue(record.ownerId),
    ownerTenantId: stringValue(record.ownerTenantId),
    ownerType: stringValue(record.ownerType),
    serviceStatus: parseServicePlans(record.serviceStatus),
    raw: record,
  };
}

function parseCustomerContract(record: Record<string, unknown>): Microsoft365Tenant | undefined {
  const tenantId = stringValue(record.customerId);
  if (!tenantId) {
    return undefined;
  }

  return {
    tenantId,
    displayName: stringValue(record.displayName) ?? stringValue(record.defaultDomainName),
    defaultDomainName: stringValue(record.defaultDomainName),
    contractType: stringValue(record.contractType),
    raw: record,
  };
}

function parseServicePlans(value: unknown): Microsoft365ServicePlan[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => recordValue(item))
    .map((record) => ({
      id: stringValue(record.servicePlanId) ?? stringValue(record.id),
      displayName: stringValue(record.servicePlanName) ?? stringValue(record.displayName),
      serviceName: stringValue(record.servicePlanName) ?? stringValue(record.serviceName),
      capabilityStatus: stringValue(record.provisioningStatus) ?? stringValue(record.capabilityStatus),
      targetType: stringValue(record.appliesTo) ?? stringValue(record.targetType),
      raw: record,
    }));
}

function normalizeGraphEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '').replace(/\/v1\.0$/i, '');
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

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
    : [];
}

function tokenExpiry(response: Microsoft365TokenResponse) {
  const expiresOn = numberValue(response.expires_on);
  if (expiresOn) {
    return expiresOn;
  }

  const expiresIn = numberValue(response.expires_in);
  return expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;
}

function tokenExpiresSoon(token: Microsoft365AccessToken) {
  return typeof token.expiresOn === 'number' && token.expiresOn - Math.floor(Date.now() / 1000) < 300;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing Microsoft 365 setting: ${name}.`);
  }

  return value.trim();
}
