import { randomUUID } from 'node:crypto';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export const azureIntegrationId = 'microsoft-azure' as const;

export type AzureCredentials = {
  endpoint: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type AzureSubscription = {
  subscriptionId: string;
  displayName?: string;
  tenantId?: string;
  state?: string;
  raw: unknown;
};

export type AzureCostUsageRow = {
  subscriptionId: string;
  usageDate?: string;
  serviceName?: string;
  resourceId?: string;
  resourceGroup?: string;
  meterCategory?: string;
  cost: number;
  usageQuantity: number;
  currency?: string;
  raw: unknown;
};

export type AzureResource = {
  id: string;
  name: string;
  type?: string;
  resourceGroup?: string;
  location?: string;
  tags: Record<string, unknown>;
  properties: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type AzureMetricDailyValue = {
  date: string;
  metricName: string;
  average?: number;
  maximum?: number;
  total?: number;
  unit?: string;
  raw: Record<string, unknown>;
};

type AzureTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
};

type AzureCollection<T> = {
  value?: T[];
  nextLink?: string;
};

type CostQueryResponse = {
  properties?: {
    nextLink?: string;
    columns?: Array<{ name?: string; type?: string }>;
    rows?: unknown[][];
  };
};

const authorityHost = 'https://login.microsoftonline.com';
const maxRetryCount = 3;

export class AzureApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
    public readonly requestId?: string | null,
  ) {
    super(message);
  }
}

export class AzureCostManagementClient {
  private readonly baseUrl: string;
  private token?: { accessToken: string; tokenType: string; expiresOn?: number };

  constructor(private readonly credentials: AzureCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async authenticate() {
    if (this.token && !tokenExpiresSoon(this.token)) {
      return this.token;
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: `${this.baseUrl}/.default`,
    });
    const response = await fetch(
      `${authorityHost}/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    const responseText = await response.text();
    const parsed = parseJson<AzureTokenResponse>(responseText);

    if (!response.ok || !parsed?.access_token) {
      throw new AzureApiError(
        parsed?.error_description ?? parsed?.error ?? `Azure token request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
        response.headers.get('request-id'),
      );
    }

    const expiresIn = numberValue(parsed.expires_in);
    this.token = {
      accessToken: parsed.access_token,
      tokenType: parsed.token_type ?? 'Bearer',
      expiresOn: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    };
    return this.token;
  }

  async listSubscriptions(maxPages = 100): Promise<AzureSubscription[]> {
    const subscriptions: AzureSubscription[] = [];
    let nextUrl: string | undefined = '/subscriptions?api-version=2022-12-01';

    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      subscriptions.push(
        ...(response.value ?? [])
          .map(parseSubscription)
          .filter((subscription): subscription is AzureSubscription => Boolean(subscription)),
      );
      nextUrl = response.nextLink;
    }

    return subscriptions;
  }

  async queryCostUsage(input: {
    subscriptionId: string;
    from: string;
    to: string;
  }): Promise<AzureCostUsageRow[]> {
    const body = {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: {
        from: input.from,
        to: input.to,
      },
      dataset: {
        granularity: 'Daily',
        aggregation: {
          totalCost: { name: 'PreTaxCost', function: 'Sum' },
          totalUsage: { name: 'UsageQuantity', function: 'Sum' },
        },
        grouping: [
          { type: 'Dimension', name: 'ServiceName' },
          { type: 'Dimension', name: 'ResourceId' },
        ],
      },
    };
    const rows: AzureCostUsageRow[] = [];
    let nextUrl: string | undefined =
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}` +
      '/providers/Microsoft.CostManagement/query?api-version=2025-03-01';

    while (nextUrl) {
      const response: CostQueryResponse = await this.request(nextUrl, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      rows.push(...parseCostRows(input.subscriptionId, response));
      nextUrl = response.properties?.nextLink;
    }

    return rows;
  }

  async listResources(subscriptionId: string, maxPages = 100): Promise<AzureResource[]> {
    const resources: AzureResource[] = [];
    let nextUrl: string | undefined =
      `/subscriptions/${encodeURIComponent(subscriptionId)}/resources?api-version=2021-04-01`;
    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      resources.push(
        ...(response.value ?? [])
          .map(parseResource)
          .filter((resource): resource is AzureResource => Boolean(resource)),
      );
      nextUrl = response.nextLink;
    }
    return resources;
  }

  async getVmInstanceView(resourceId: string) {
    return this.request<Record<string, unknown>>(`${resourceId}/instanceView?api-version=2024-07-01`);
  }

  async queryDailyMetrics(input: {
    resourceId: string;
    metricNames: string[];
    from: string;
    to: string;
  }): Promise<AzureMetricDailyValue[]> {
    const query = new URLSearchParams({
      'api-version': '2018-01-01',
      metricnames: input.metricNames.join(','),
      timespan: `${input.from}/${input.to}`,
      interval: 'P1D',
      aggregation: 'Average,Maximum,Total',
    });
    const response = await this.request<AzureCollection<Record<string, unknown>>>(
      `${input.resourceId}/providers/microsoft.insights/metrics?${query.toString()}`,
    );
    return (response.value ?? []).flatMap((metric) => {
      const metricName = stringValue(recordValue(metric.name).value ?? recordValue(metric.name).localizedValue) ?? 'metric';
      const unit = stringValue(metric.unit);
      return arrayValue(metric.timeseries).flatMap((series) =>
        arrayValue(recordValue(series).data).flatMap((point) => {
          const row = recordValue(point);
          const timestamp = stringValue(row.timeStamp ?? row.timestamp);
          if (!timestamp) return [];
          return [{
            date: timestamp.slice(0, 10),
            metricName,
            average: numberValue(row.average),
            maximum: numberValue(row.maximum),
            total: numberValue(row.total),
            unit,
            raw: row,
          } satisfies AzureMetricDailyValue];
        }),
      );
    });
  }

  async getAvdActivity(hostPoolResourceId: string) {
    const hosts = await this.listAzureCollection(
      `${hostPoolResourceId}/sessionHosts?api-version=2024-04-03`,
    );
    let activeSessions = 0;
    let disconnectedSessions = 0;
    const sessionHosts: Record<string, unknown>[] = [];
    for (const host of hosts) {
      const hostId = stringValue(host.id);
      const sessions = hostId
        ? await this.listAzureCollection(`${hostId}/userSessions?api-version=2024-04-03`)
        : [];
      for (const session of sessions) {
        const state = String(recordValue(session.properties).sessionState ?? '').toLowerCase();
        if (state === 'active') activeSessions += 1;
        else disconnectedSessions += 1;
      }
      sessionHosts.push({ ...host, userSessions: sessions });
    }
    return { activeSessions, disconnectedSessions, sessionHosts };
  }

  private async listAzureCollection(pathOrUrl: string) {
    const values: Record<string, unknown>[] = [];
    let nextUrl: string | undefined = pathOrUrl;
    while (nextUrl) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      values.push(...(response.value ?? []));
      nextUrl = response.nextLink;
    }
    return values;
  }

  private async request<T>(
    pathOrUrl: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      retryCount?: number;
    } = {},
  ): Promise<T> {
    const token = await this.authenticate();
    const requestId = randomUUID();
    const response = await fetch(absoluteUrl(pathOrUrl, this.baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `${token.tokenType} ${token.accessToken}`,
        'client-request-id': requestId,
        ...(options.headers ?? {}),
      },
      body: options.body,
    });
    const responseText = await response.text();

    if (shouldRetry(response.status) && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.request<T>(pathOrUrl, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    const parsed = responseText.trim() ? parseJson<unknown>(responseText) : undefined;
    if (!response.ok) {
      if (response.status === 401) {
        this.token = undefined;
      }
      const error = recordValue(recordValue(parsed).error ?? parsed);
      throw new AzureApiError(
        stringValue(error.message) ?? stringValue(error.code) ?? `Azure request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 1000),
        response.headers.get('request-id') ?? requestId,
      );
    }

    return parsed as T;
  }
}

export function azureCredentialsFromSettings(settings: IntegrationRuntimeSettings): AzureCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'AZURE_ENDPOINT'),
    tenantId: requiredValue(settings.nonSecrets.tenantId, 'AZURE_TENANT_ID'),
    clientId: requiredValue(settings.nonSecrets.clientId, 'AZURE_CLIENT_ID'),
    clientSecret: requiredValue(settings.secrets.clientSecret, 'mspharmony-azure-client-secret'),
  };
}

export function azureSubscriptionAllowlist(settings: IntegrationRuntimeSettings) {
  return String(settings.nonSecrets.subscriptionIds ?? settings.nonSecrets.subscriptionId ?? '')
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseSubscription(record: Record<string, unknown>): AzureSubscription | undefined {
  const subscriptionId = stringValue(record.subscriptionId);
  if (!subscriptionId) return undefined;
  return {
    subscriptionId,
    displayName: stringValue(record.displayName),
    tenantId: stringValue(record.tenantId),
    state: stringValue(record.state),
    raw: record,
  };
}

function parseResource(record: Record<string, unknown>): AzureResource | undefined {
  const id = stringValue(record.id);
  const name = stringValue(record.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    type: stringValue(record.type),
    resourceGroup: resourceGroupFromId(id),
    location: stringValue(record.location),
    tags: recordValue(record.tags),
    properties: recordValue(record.properties),
    raw: record,
  };
}

function parseCostRows(subscriptionId: string, response: CostQueryResponse): AzureCostUsageRow[] {
  const columns = response.properties?.columns ?? [];
  const names = columns.map((column) => String(column.name ?? '').toLowerCase());

  return (response.properties?.rows ?? []).map((values) => {
    const value = (name: string) => values[names.indexOf(name.toLowerCase())];
    const resourceId = stringValue(value('ResourceId'));
    return {
      subscriptionId,
      usageDate: usageDateValue(value('UsageDate')),
      serviceName: stringValue(value('ServiceName')),
      resourceId,
      resourceGroup: resourceGroupFromId(resourceId),
      meterCategory: stringValue(value('MeterCategory')),
      cost: numberValue(value('PreTaxCost')) ?? numberValue(value('Cost')) ?? numberValue(value('totalCost')) ?? 0,
      usageQuantity: numberValue(value('UsageQuantity')) ?? numberValue(value('totalUsage')) ?? 0,
      currency: stringValue(value('Currency')),
      raw: Object.fromEntries(columns.map((column, index) => [column.name ?? `column${index}`, values[index]])),
    };
  });
}

function usageDateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return undefined;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function resourceGroupFromId(resourceId?: string) {
  if (!resourceId) return undefined;
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
  return match?.[1];
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

function absoluteUrl(pathOrUrl: string, baseUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function shouldRetry(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: Response, retryCount: number) {
  const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  return Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** retryCount;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function tokenExpiresSoon(token: { expiresOn?: number }) {
  return typeof token.expiresOn === 'number' && token.expiresOn - Math.floor(Date.now() / 1000) < 300;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`Missing Microsoft Azure setting: ${name}.`);
  return value.trim();
}
