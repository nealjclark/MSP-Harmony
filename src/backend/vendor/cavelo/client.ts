import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type CaveloCredentials = {
  endpoint: string;
  apiKey: string;
};

export type CaveloOrganization = {
  organizationUuid: string;
  organizationId?: string;
  name?: string;
  raw: Record<string, unknown>;
};

export type CaveloAgent = {
  agentId: string;
  hostname?: string;
  enabled?: boolean;
  latestHeartbeatTime?: string;
  operatingSystem?: string;
  organizationUuid?: string;
  raw: Record<string, unknown>;
};

type CaveloEnvelope<T> = {
  data?: T;
  message?: string;
  error?: string;
};

export class CaveloApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class CaveloClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: CaveloCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async listOrganizations(): Promise<CaveloOrganization[]> {
    const rows = await this.requestList<Record<string, unknown>>('/organizations');
    return rows.map(parseOrganization).filter((row): row is CaveloOrganization => Boolean(row));
  }

  async listOrganizationAgents(organizationUuid: string): Promise<CaveloAgent[]> {
    const encodedUuid = encodeURIComponent(organizationUuid);
    const rows = await this.requestList<Record<string, unknown>>(`/organizations/${encodedUuid}/agents`);
    return rows
      .map((row) => parseAgent(row, organizationUuid))
      .filter((agent): agent is CaveloAgent => Boolean(agent));
  }

  private async requestList<T>(path: string): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': this.credentials.apiKey,
      },
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new CaveloApiError(`Cavelo request failed (${response.status}) for ${path}.`, response.status, responseText);
    }

    let parsed: CaveloEnvelope<T[]> | T[];
    try {
      parsed = JSON.parse(responseText) as CaveloEnvelope<T[]> | T[];
    } catch {
      throw new CaveloApiError(`Cavelo returned invalid JSON for ${path}.`, response.status, responseText);
    }

    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.data)) return parsed.data;

    const detail = parsed.error ?? parsed.message;
    throw new CaveloApiError(
      detail ? `Cavelo API error for ${path}: ${detail}` : `Cavelo returned an unexpected response for ${path}.`,
      response.status,
      responseText,
    );
  }
}

export function caveloCredentialsFromSettings(settings: IntegrationRuntimeSettings): CaveloCredentials {
  const endpoint = (settings.nonSecrets.endpoint ?? settings.definition.endpoint)?.trim();
  const apiKey = settings.secrets.apiKey?.trim();

  if (!endpoint) throw new CaveloApiError('Cavelo endpoint is not configured.');
  if (!apiKey) throw new CaveloApiError('Cavelo API key is not configured.');

  return { endpoint, apiKey };
}

export function parseOrganization(record: Record<string, unknown>): CaveloOrganization | undefined {
  const organizationUuid = stringValue(
    record.organizationUuid ?? record.organizationUUID ?? record.uuid ?? record.id,
  );
  if (!organizationUuid) return undefined;

  return {
    organizationUuid,
    organizationId: stringValue(record.id ?? record.organizationId),
    name: stringValue(record.name ?? record.organizationName),
    raw: record,
  };
}

export function parseAgent(record: Record<string, unknown>, organizationUuid?: string): CaveloAgent | undefined {
  const agentId = stringValue(record.id ?? record.agentId ?? record.agentUuid ?? record.agentUUID ?? record.uuid);
  if (!agentId) return undefined;

  return {
    agentId,
    hostname: stringValue(record.hostname ?? record.hostName ?? record.computerName),
    enabled: booleanValue(record.enabled),
    latestHeartbeatTime: stringValue(record.latestHeartbeatTime ?? record.lastHeartbeatTime ?? record.lastSeen),
    operatingSystem: stringValue(
      record.operatingSystemVersionShort ?? record.operatingSystem ?? record.osName,
    ),
    organizationUuid: stringValue(record.organizationUuid ?? record.organizationUUID) ?? organizationUuid,
    raw: record,
  };
}

function normalizeEndpoint(endpoint: string) {
  const normalized = endpoint.trim().replace(/\/+$/, '');
  if (!normalized) throw new CaveloApiError('Cavelo endpoint is empty.');
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
  return undefined;
}
