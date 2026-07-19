import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type ProofpointCredentials = {
  endpoint: string;
  organizationDomain: string;
  username: string;
  password: string;
};

export type ProofpointOrganization = {
  primaryDomain: string;
  name?: string;
  eid?: string;
  activeUsers?: number;
  userLicenses?: number;
  licensingPackage?: string;
  renewalDate?: string;
  raw: Record<string, unknown>;
};

export type ProofpointDomain = {
  name: string;
  isActive?: boolean;
  raw: Record<string, unknown>;
};

export type ProofpointUser = {
  primaryEmail: string;
  isActive: boolean;
  isBillable: boolean;
  type?: string;
  raw: Record<string, unknown>;
};

type ProofpointEnvelope = Record<string, unknown>;

const apiVersionPath = '/api/v1';

export class ProofpointApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class ProofpointClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: ProofpointCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async listOrganizations(): Promise<ProofpointOrganization[]> {
    const envelope = await this.request(`/orgs/${encodeURIComponent(this.credentials.organizationDomain)}/orgs`);
    return arrayValue(envelope.orgs ?? envelope.organizations)
      .map(parseOrganization)
      .filter((organization): organization is ProofpointOrganization => Boolean(organization));
  }

  async listDomains(organizationDomain: string): Promise<ProofpointDomain[]> {
    const envelope = await this.request(`/orgs/${encodeURIComponent(organizationDomain)}/domains`);
    return arrayValue(envelope.domains)
      .map(parseDomain)
      .filter((domain): domain is ProofpointDomain => Boolean(domain));
  }

  async listUsers(organizationDomain: string): Promise<ProofpointUser[]> {
    const envelope = await this.request(`/orgs/${encodeURIComponent(organizationDomain)}/users`);
    return arrayValue(envelope.users)
      .map(parseUser)
      .filter((user): user is ProofpointUser => Boolean(user));
  }

  private async request(path: string): Promise<ProofpointEnvelope> {
    const response = await fetch(`${this.baseUrl}${apiVersionPath}${path}`, {
      headers: {
        Accept: 'application/json',
        'X-Password': this.credentials.password,
        'X-Terms-Update': 'true',
        'X-User': this.credentials.username,
      },
    });
    const responseText = await response.text();

    if (!response.ok) {
      const explanation = response.status === 401
        ? ' Check the Proofpoint username and password.'
        : response.status === 403
          ? ' The account must be a Proofpoint Essentials administrator with API access to this organization.'
          : '';
      throw new ProofpointApiError(
        `Proofpoint Essentials request failed (${response.status}) for ${path}.${explanation}`,
        response.status,
        responseText,
      );
    }

    if (!responseText.trim()) return {};
    try {
      const parsed = JSON.parse(responseText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object.');
      }
      return parsed as ProofpointEnvelope;
    } catch {
      throw new ProofpointApiError(
        `Proofpoint Essentials returned invalid JSON for ${path}.`,
        response.status,
        responseText,
      );
    }
  }
}

export function proofpointCredentialsFromSettings(settings: IntegrationRuntimeSettings): ProofpointCredentials {
  const endpoint = (settings.nonSecrets.endpoint ?? settings.definition.endpoint)?.trim();
  const organizationDomain = settings.nonSecrets.organizationDomain?.trim().toLowerCase();
  const username = settings.secrets.username?.trim();
  const password = settings.secrets.password?.trim();

  if (!endpoint) throw new ProofpointApiError('Proofpoint Essentials stack URL is not configured.');
  if (!organizationDomain) throw new ProofpointApiError('Proofpoint Essentials organization domain is not configured.');
  if (!username) throw new ProofpointApiError('Proofpoint Essentials username is not configured.');
  if (!password) throw new ProofpointApiError('Proofpoint Essentials password is not configured.');

  return { endpoint, organizationDomain, username, password };
}

export function proofpointCredentialSetsFromSettings(settings: IntegrationRuntimeSettings): ProofpointCredentials[] {
  const primary = proofpointCredentialsFromSettings(settings);
  const credentialSets = new Map<string, ProofpointCredentials>([
    [normalizeEndpoint(primary.endpoint), { ...primary, endpoint: normalizeEndpoint(primary.endpoint) }],
  ]);
  const lines = (settings.nonSecrets.additionalEndpoints ?? '')
    .replace(/,/g, '\n')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [endpointValue, organizationValue, ...unexpected] = line.split('|').map((part) => part.trim());
    if (!endpointValue || unexpected.length > 0) {
      throw new ProofpointApiError(
        `Invalid additional Proofpoint stack entry "${line}". Use: Stack URL | Partner Domain or UUID.`,
      );
    }
    const endpoint = normalizeEndpoint(endpointValue);
    credentialSets.set(endpoint, {
      ...primary,
      endpoint,
      organizationDomain: organizationValue?.toLowerCase() || primary.organizationDomain,
    });
  }

  return [...credentialSets.values()];
}

export function parseOrganization(value: unknown): ProofpointOrganization | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const domains = arrayValue(record.domains).map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item));
  const primaryDomain = stringValue(
    record.primary_domain ?? record.primaryDomain ?? record.domain ?? record.domain_name ?? domains[0]?.name,
  )?.toLowerCase();
  if (!primaryDomain) return undefined;
  return {
    primaryDomain,
    name: stringValue(record.name ?? record.organization_name ?? record.company_name),
    eid: stringValue(record.eid ?? record.id),
    activeUsers: numberValue(record.active_users ?? record.activeUsers),
    userLicenses: numberValue(record.user_licenses ?? record.userLicenses),
    licensingPackage: stringValue(record.licensing_package ?? record.licensingPackage),
    renewalDate: stringValue(record.when_renewal ?? record.renewalDate),
    raw: record,
  };
}

export function parseDomain(value: unknown): ProofpointDomain | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const name = stringValue(record.name ?? record.domain_name ?? record.domain)?.toLowerCase();
  if (!name) return undefined;
  return {
    name,
    isActive: booleanValue(record.is_active ?? record.isActive ?? record.active),
    raw: record,
  };
}

export function parseUser(value: unknown): ProofpointUser | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const primaryEmail = stringValue(record.primary_email ?? record.primaryEmail ?? record.email)?.toLowerCase();
  if (!primaryEmail || !primaryEmail.includes('@')) return undefined;
  return {
    primaryEmail,
    isActive: booleanValue(record.is_active ?? record.isActive ?? record.active) !== false,
    isBillable: booleanValue(record.is_billable ?? record.isBillable ?? record.billable) !== false,
    type: stringValue(record.type ?? record.user_type),
    raw: record,
  };
}

function normalizeEndpoint(endpoint: string) {
  let normalized = endpoint.trim().replace(/\/+$/, '');
  if (!normalized) throw new ProofpointApiError('Proofpoint Essentials stack URL is empty.');
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  normalized = normalized.replace(/\/api\/v1$/i, '');
  return normalized;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}
