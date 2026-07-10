import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type SentinelOneCredentials = {
  endpoint: string;
  apiToken: string;
};

export type SentinelOneAccount = {
  accountId: string;
  accountName?: string;
  raw: unknown;
};

export type SentinelOneSite = {
  siteId: string;
  siteName?: string;
  accountId?: string;
  accountName?: string;
  raw: unknown;
};

export type SentinelOneAgent = {
  agentId: string;
  computerName?: string;
  machineType: 'server' | 'workstation' | 'unknown';
  siteId?: string;
  siteName?: string;
  accountId?: string;
  accountName?: string;
  osType?: string;
  lastActiveDate?: string;
  raw: unknown;
};

export type SentinelOneListOptions = {
  pageSize?: number;
  maxPages?: number;
};

type SentinelOneEnvelope<T> = {
  data?: T;
  pagination?: {
    nextCursor?: string | null;
    totalItems?: number;
  };
  errors?: Array<{ code?: number; detail?: string; title?: string }>;
};

type SentinelOneRequestOptions = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: string;
};

const defaultPageSize = 1000;
const apiVersionPath = '/web/api/v2.1';

export class SentinelOneApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class SentinelOneClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: SentinelOneCredentials) {
    this.baseUrl = normalizeApiEndpoint(credentials.endpoint);
  }

  async listAccounts(options: SentinelOneListOptions = {}): Promise<SentinelOneAccount[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/accounts', options);
    return rows.map(parseAccount).filter((account): account is SentinelOneAccount => Boolean(account));
  }

  async listSites(options: SentinelOneListOptions = {}): Promise<SentinelOneSite[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/sites', options);
    return rows.map(parseSite).filter((site): site is SentinelOneSite => Boolean(site));
  }

  async listAgents(options: SentinelOneListOptions = {}): Promise<SentinelOneAgent[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/agents', options);
    return rows.map(parseAgent).filter((agent): agent is SentinelOneAgent => Boolean(agent));
  }

  private async listPaged<T>(path: string, options: SentinelOneListOptions = {}): Promise<T[]> {
    const pageSize = options.pageSize ?? defaultPageSize;
    const maxPages = options.maxPages ?? 100;
    const rows: T[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const envelope = await this.request<T[]>(path, {
        query: {
          limit: pageSize,
          cursor,
        },
      });
      const pageRows = Array.isArray(envelope.data) ? envelope.data : [];
      rows.push(...pageRows);

      const nextCursor = envelope.pagination?.nextCursor;
      if (!nextCursor || pageRows.length === 0) {
        break;
      }

      cursor = nextCursor;
    }

    return rows;
  }

  private async request<T>(path: string, options: SentinelOneRequestOptions = {}): Promise<SentinelOneEnvelope<T>> {
    const url = new URL(`${this.baseUrl}${apiVersionPath}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (typeof value === 'undefined') {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `ApiToken ${this.credentials.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: options.body,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new SentinelOneApiError(
        `SentinelOne request failed (${response.status}) for ${path}.`,
        response.status,
        responseText,
      );
    }

    let envelope: SentinelOneEnvelope<T>;
    try {
      envelope = JSON.parse(responseText) as SentinelOneEnvelope<T>;
    } catch {
      throw new SentinelOneApiError(`SentinelOne returned invalid JSON for ${path}.`, response.status, responseText);
    }

    if (envelope.errors?.length) {
      const detail = envelope.errors.map((error) => error.detail ?? error.title ?? 'Unknown error').join('; ');
      throw new SentinelOneApiError(`SentinelOne API error for ${path}: ${detail}`, response.status, responseText);
    }

    return envelope;
  }
}

export function sentinelOneCredentialsFromSettings(settings: IntegrationRuntimeSettings): SentinelOneCredentials {
  const endpoint = (settings.nonSecrets.endpoint ?? settings.definition.endpoint)?.trim();
  const apiToken = settings.secrets.apiToken?.trim();

  if (!endpoint) {
    throw new SentinelOneApiError('SentinelOne endpoint is not configured.');
  }

  if (!apiToken) {
    throw new SentinelOneApiError('SentinelOne API token is not configured.');
  }

  assertTokenNotExpired(apiToken);

  return {
    endpoint,
    apiToken,
  };
}

export function machineTypeForAgent(record: Record<string, unknown>) {
  const machineType = stringValue(record.machineType ?? record.MachineType);
  if (machineType && /server/i.test(machineType)) {
    return 'server' as const;
  }

  if (machineType && /(desktop|laptop|workstation)/i.test(machineType)) {
    return 'workstation' as const;
  }

  const osType = stringValue(record.osType ?? record.osName ?? record.OsType);
  if (osType && /windows server|linux server|server/i.test(osType)) {
    return 'server' as const;
  }

  if (osType) {
    return 'workstation' as const;
  }

  return 'unknown' as const;
}

function parseAccount(record: Record<string, unknown>): SentinelOneAccount | undefined {
  const accountId = stringValue(record.id ?? record.accountId ?? record.AccountId);
  if (!accountId) {
    return undefined;
  }

  return {
    accountId,
    accountName: stringValue(record.name ?? record.accountName ?? record.AccountName),
    raw: record,
  };
}

function parseSite(record: Record<string, unknown>): SentinelOneSite | undefined {
  const siteId = stringValue(record.id ?? record.siteId ?? record.SiteId);
  if (!siteId) {
    return undefined;
  }

  return {
    siteId,
    siteName: stringValue(record.name ?? record.siteName ?? record.SiteName),
    accountId: stringValue(record.accountId ?? record.AccountId),
    accountName: stringValue(record.accountName ?? record.AccountName),
    raw: record,
  };
}

export function parseAgent(record: Record<string, unknown>): SentinelOneAgent | undefined {
  const agentId = stringValue(record.id ?? record.agentId ?? record.AgentId ?? record.uuid);
  if (!agentId) {
    return undefined;
  }

  return {
    agentId,
    computerName: stringValue(record.computerName ?? record.ComputerName ?? record.hostName ?? record.hostname),
    machineType: machineTypeForAgent(record),
    siteId: stringValue(record.siteId ?? record.SiteId),
    siteName: stringValue(record.siteName ?? record.SiteName),
    accountId: stringValue(record.accountId ?? record.AccountId),
    accountName: stringValue(record.accountName ?? record.AccountName),
    osType: stringValue(record.osType ?? record.osName ?? record.OsType),
    lastActiveDate: stringValue(record.lastActiveDate ?? record.LastActiveDate ?? record.lastSeen),
    raw: record,
  };
}

function normalizeApiEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new SentinelOneApiError('SentinelOne endpoint is empty.');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function assertTokenNotExpired(apiToken: string) {
  const expiresAt = tokenExpiresAt(apiToken);
  if (!expiresAt || expiresAt.getTime() > Date.now()) {
    return;
  }

  throw new SentinelOneApiError(
    `SentinelOne API token expired on ${expiresAt.toISOString()}. Generate a new SentinelOne API token and update mspharmony-sentinelone-api-token in Key Vault or SENTINELONE_API_TOKEN locally.`,
  );
}

function tokenExpiresAt(apiToken: string) {
  const [, payload] = apiToken.split('.');
  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) {
      return undefined;
    }

    return new Date(parsed.exp * 1000);
  } catch {
    return undefined;
  }
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
