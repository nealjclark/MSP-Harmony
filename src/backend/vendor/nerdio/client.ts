import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export const nerdioIntegrationId = 'nerdio' as const;

export type NerdioCredentials = {
  endpoint: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  apiScope: string;
};

export type NerdioAccount = {
  id: string;
  name: string;
  raw: Record<string, unknown>;
};

export type NerdioInvoice = {
  id: string;
  number?: string;
  startBillingPeriod?: string;
  endBillingPeriod?: string;
  invoiceItems: Record<string, unknown>[];
  raw: Record<string, unknown>;
};

export class NerdioApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseText?: string,
  ) {
    super(message);
  }
}

export class NerdioClient {
  private token?: { value: string; expiresAt: number };
  private readonly endpoint: string;

  constructor(private readonly credentials: NerdioCredentials) {
    this.endpoint = credentials.endpoint.replace(/\/+$/, '');
  }

  async authenticate() {
    if (this.token && this.token.expiresAt > Date.now() + 120_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: this.credentials.apiScope,
    });
    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    const responseText = await response.text();
    const parsed = parseJson<{ access_token?: string; expires_in?: number; error_description?: string }>(responseText);
    if (!response.ok || !parsed?.access_token) {
      throw new NerdioApiError(
        parsed?.error_description ?? `Nerdio token request failed with HTTP ${response.status}.`,
        response.status,
        responseText,
      );
    }
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + Math.max(300, Number(parsed.expires_in ?? 3600)) * 1000,
    };
    return this.token.value;
  }

  async test() {
    return this.request<Record<string, unknown>>('/api/v1/test', { allowNonJsonSuccess: true });
  }

  async listAccounts(): Promise<NerdioAccount[]> {
    const response = await this.request<unknown>('/rest-api/v1/accounts');
    return arrayValue(unwrapCollection(response))
      .map((value) => {
        const record = recordValue(value);
        const id = stringValue(record.id ?? record.accountId);
        const name = stringValue(record.name ?? record.accountName);
        return id && name ? { id, name, raw: record } : undefined;
      })
      .filter((value): value is NerdioAccount => Boolean(value));
  }

  async getAccountUsage(account: NerdioAccount) {
    const response = await this.request<unknown>(`/rest-api/v1/accounts/${encodeURIComponent(account.id)}/usages`);
    return arrayValue(unwrapCollection(response)).map(recordValue);
  }

  async listInvoices(input: { periodStart: string; periodEnd: string }): Promise<NerdioInvoice[]> {
    const query = new URLSearchParams({ periodStart: input.periodStart, periodEnd: input.periodEnd });
    const response = await this.request<unknown>(`/rest-api/v1/invoices?${query.toString()}`);
    return arrayValue(unwrapCollection(response))
      .map((value, index) => {
        const record = recordValue(value);
        const id =
          stringValue(record.id ?? record.invoiceId ?? record.number ?? record.invoiceNumber) ??
          `${stringValue(record.endBillingPeriod) ?? 'invoice'}-${index + 1}`;
        return {
          id,
          number: stringValue(record.number ?? record.invoiceNumber),
          startBillingPeriod: stringValue(record.startBillingPeriod),
          endBillingPeriod: stringValue(record.endBillingPeriod),
          invoiceItems: arrayValue(record.invoiceItems).map(recordValue),
          raw: record,
        };
      });
  }

  private async request<T>(
    path: string,
    options: { allowNonJsonSuccess?: boolean } = {},
  ): Promise<T> {
    const token = await this.authenticate();
    const response = await fetch(`${this.endpoint}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new NerdioApiError(
        `Nerdio request ${path} failed with HTTP ${response.status}.`,
        response.status,
        responseText,
      );
    }
    const parsed = parseJson<T>(responseText);
    if (parsed === undefined && options.allowNonJsonSuccess) {
      return { responseText: responseText.trim(), contentType: response.headers.get('content-type') } as T;
    }
    if (parsed === undefined) {
      const contentType = response.headers.get('content-type') ?? 'unknown content type';
      const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 180);
      const hint = /text\/html/i.test(contentType) || /^</.test(preview)
        ? ' The configured Nerdio URL may be redirecting to an interactive sign-in page.'
        : '';
      throw new NerdioApiError(
        `Nerdio request ${path} returned invalid JSON (${contentType})${preview ? `: ${preview}` : '.'}${hint}`,
        response.status,
        responseText,
      );
    }
    return parsed;
  }
}

export function nerdioCredentialsFromSettings(settings: IntegrationRuntimeSettings): NerdioCredentials {
  return {
    endpoint: String(settings.nonSecrets.endpoint ?? settings.definition.endpoint),
    tenantId: String(settings.nonSecrets.tenantId ?? ''),
    clientId: String(settings.nonSecrets.clientId ?? ''),
    clientSecret: String(settings.secrets.clientSecret ?? ''),
    apiScope: String(settings.nonSecrets.apiScope ?? ''),
  };
}

function unwrapCollection(value: unknown) {
  const record = recordValue(value);
  return Array.isArray(value)
    ? value
    : record.data ?? record.value ?? record.items ?? record.usageItems ?? record.invoices ?? record.accounts ?? value;
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value.replace(/^\uFEFF/, '').trim()) as T;
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}
