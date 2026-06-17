import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type NcentralCredentials = {
  endpoint: string;
  apiToken: string;
};

export type NcentralAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  accessExpirySeconds?: number;
  refreshExpirySeconds?: number;
};

export type NcentralDeviceFilter = {
  filterId: string;
  filterName: string;
  description?: string;
  raw: unknown;
};

export type NcentralDeviceSummary = {
  deviceId: number;
  uri?: string;
  longName?: string;
  deviceClass?: string;
  description?: string;
  osId?: string;
  supportedOs?: string;
  orgUnitId?: number;
  soId?: number;
  customerId?: number;
  siteId?: number;
  customerName?: string;
  siteName?: string;
  lastLoggedInUser?: string;
  stillLoggedIn?: boolean;
  raw: unknown;
};

export type NcentralDeviceDetail = NcentralDeviceSummary & {
  isProbe?: boolean;
  licenseMode?: string;
  lastApplianceCheckinTime?: string;
};

export type NcentralListOptions = {
  pageSize?: number;
  maxPages?: number;
};

type NcentralEnvelope<T> = {
  data?: T;
  totalItems?: number;
  pageNumber?: number;
  pageSize?: number;
  status?: number;
  message?: string;
  tokens?: {
    access?: {
      token?: string;
      expirySeconds?: number;
    };
    refresh?: {
      token?: string;
      expirySeconds?: number;
    };
  };
};

type NcentralRequestOptions = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: string;
  headers?: Record<string, string>;
  authenticated?: boolean;
  retryCount?: number;
};

const defaultPageSize = 500;
const maxRetryCount = 3;

export class NcentralApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class NcentralClient {
  private readonly baseUrl: string;
  private tokens?: NcentralAuthTokens;

  constructor(private readonly credentials: NcentralCredentials) {
    this.baseUrl = normalizeApiEndpoint(credentials.endpoint);
  }

  async authenticate(): Promise<NcentralAuthTokens> {
    const envelope = await this.rawRequest<NcentralEnvelope<unknown>>('/auth/authenticate', {
      method: 'POST',
      authenticated: false,
      headers: {
        Authorization: `Bearer ${this.credentials.apiToken}`,
      },
    });
    const accessToken = envelope.tokens?.access?.token;
    if (!accessToken) {
      throw new NcentralApiError('N-central authentication response did not include an access token.');
    }

    this.tokens = {
      accessToken,
      refreshToken: envelope.tokens?.refresh?.token,
      accessExpirySeconds: envelope.tokens?.access?.expirySeconds,
      refreshExpirySeconds: envelope.tokens?.refresh?.expirySeconds,
    };

    return this.tokens;
  }

  async validateToken() {
    await this.request<unknown>('/auth/validate');
  }

  async listDeviceFilters(options: NcentralListOptions = {}): Promise<NcentralDeviceFilter[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/device-filters', options, {
      viewScope: 'ALL',
    });

    return rows.map(parseDeviceFilter).filter((filter): filter is NcentralDeviceFilter => Boolean(filter));
  }

  async listDevicesByFilter(filterId: string, options: NcentralListOptions = {}): Promise<NcentralDeviceSummary[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/devices', options, {
      filterId,
    });

    return rows.map(parseDeviceSummary).filter((device): device is NcentralDeviceSummary => Boolean(device));
  }

  async getDevice(deviceId: number): Promise<NcentralDeviceDetail> {
    const record = await this.request<Record<string, unknown>>(`/devices/${encodeURIComponent(String(deviceId))}`);
    const parsed = parseDeviceSummary(record);
    if (!parsed) {
      throw new NcentralApiError(`N-central device ${deviceId} did not return a valid device payload.`);
    }

    return {
      ...parsed,
      isProbe: booleanValue(record.isProbe),
      licenseMode: stringValue(record.licenseMode),
      lastApplianceCheckinTime: stringValue(record.lastApplianceCheckinTime),
    };
  }

  async enrichDevicesWithDetails(
    devices: NcentralDeviceSummary[],
    options: { concurrency?: number } = {},
  ): Promise<Map<number, NcentralDeviceDetail>> {
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 10));
    const details = new Map<number, NcentralDeviceDetail>();
    let nextIndex = 0;

    const worker = async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const device = devices[index];
        if (!device) {
          return;
        }

        details.set(device.deviceId, await this.getDevice(device.deviceId));
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, devices.length) }, () => worker()));
    return details;
  }

  private async listPaged<T>(
    path: string,
    options: NcentralListOptions,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? defaultPageSize, 1000));
    const maxPages = Math.max(1, options.maxPages ?? 100);
    const rows: T[] = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const envelope = await this.request<T[]>(path, {
        query: {
          ...query,
          pageNumber,
          pageSize,
        },
      });
      rows.push(...envelope);

      if (envelope.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async request<T>(path: string, options: NcentralRequestOptions = {}): Promise<T> {
    if (!this.tokens?.accessToken) {
      await this.authenticate();
    }

    try {
      return await this.rawRequest<T>(path, {
        ...options,
        authenticated: true,
      });
    } catch (error) {
      if (error instanceof NcentralApiError && error.status === 401 && this.tokens?.refreshToken) {
        await this.refresh();
        return this.rawRequest<T>(path, {
          ...options,
          authenticated: true,
        });
      }

      throw error;
    }
  }

  private async refresh() {
    if (!this.tokens?.refreshToken) {
      await this.authenticate();
      return;
    }

    const envelope = await this.rawRequest<NcentralEnvelope<unknown>>('/auth/refresh', {
      method: 'POST',
      authenticated: false,
      body: this.tokens.refreshToken,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
    const accessToken = envelope.tokens?.access?.token;
    if (!accessToken) {
      throw new NcentralApiError('N-central refresh response did not include an access token.');
    }

    this.tokens = {
      accessToken,
      refreshToken: envelope.tokens?.refresh?.token ?? this.tokens.refreshToken,
      accessExpirySeconds: envelope.tokens?.access?.expirySeconds,
      refreshExpirySeconds: envelope.tokens?.refresh?.expirySeconds,
    };
  }

  private async rawRequest<T>(path: string, options: NcentralRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (typeof value !== 'undefined') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Accept: 'application/json',
      ...(options.headers ?? {}),
      ...(options.authenticated && this.tokens?.accessToken ? { Authorization: `Bearer ${this.tokens.accessToken}` } : {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: options.body,
    });
    const responseText = await response.text();

    if (response.status === 429 && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.rawRequest<T>(path, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    let parsed: unknown = undefined;
    if (responseText.trim().length > 0) {
      try {
        parsed = JSON.parse(responseText) as unknown;
      } catch {
        parsed = responseText;
      }
    }

    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as NcentralEnvelope<unknown>)
      : undefined;
    if (!response.ok) {
      throw new NcentralApiError(
        envelope?.message ?? `N-central API request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }
    if (envelope?.message && envelope.status && envelope.status >= 400) {
      throw new NcentralApiError(envelope.message, envelope.status, responseText.slice(0, 500));
    }

    if (envelope && Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      return envelope.data as T;
    }

    return parsed as T;
  }
}

export function ncentralCredentialsFromSettings(settings: IntegrationRuntimeSettings): NcentralCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'NCENTRAL_ENDPOINT'),
    apiToken: requiredValue(settings.secrets.apiToken, 'mspharmony-ncentral-api-token'),
  };
}

function normalizeApiEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function parseDeviceFilter(record: Record<string, unknown>): NcentralDeviceFilter | undefined {
  const filterId = stringValue(record.filterId);
  const filterName = stringValue(record.filterName);
  if (!filterId || !filterName) {
    return undefined;
  }

  return {
    filterId,
    filterName,
    description: stringValue(record.description),
    raw: record,
  };
}

function parseDeviceSummary(record: Record<string, unknown>): NcentralDeviceSummary | undefined {
  const deviceId = numberValue(record.deviceId);
  if (!deviceId) {
    return undefined;
  }

  return {
    deviceId,
    uri: stringValue(record.uri),
    longName: stringValue(record.longName),
    deviceClass: stringValue(record.deviceClass),
    description: stringValue(record.description),
    osId: stringValue(record.osId),
    supportedOs: stringValue(record.supportedOs),
    orgUnitId: numberValue(record.orgUnitId),
    soId: numberValue(record.soId),
    customerId: numberValue(record.customerId),
    siteId: numberValue(record.siteId),
    customerName: stringValue(record.customerName),
    siteName: stringValue(record.siteName),
    lastLoggedInUser: stringValue(record.lastLoggedInUser),
    stillLoggedIn: booleanValue(record.stillLoggedIn),
    raw: record,
  };
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing N-central setting: ${name}.`);
  }

  return value.trim();
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

function retryDelayMs(response: Response, retryCount: number) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
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
