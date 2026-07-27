import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export const ingramIntegrationId = 'ingram-micro' as const;

export type IngramCredentials = {
  endpoint: string;
  apiUsername: string;
  apiSecret: string;
  subscriptionKey: string;
  marketplace: string;
};

export type IngramReport = {
  id: string;
  name: string;
  format?: string;
  status?: string;
  createdAt?: string;
  downloadUrl?: string;
  raw: Record<string, unknown>;
};

export type IngramReportDateRange = {
  from: string;
  to: string;
};

type TokenResponse = {
  token?: string;
  access_token?: string;
  expiresInSeconds?: number;
  expires_in?: number;
};

export class IngramApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseText?: string,
  ) {
    super(message);
  }
}

export class IngramClient {
  private token?: { value: string; expiresAt: number };
  private readonly endpoint: string;

  constructor(private readonly credentials: IngramCredentials) {
    this.endpoint = credentials.endpoint.replace(/\/+$/, '');
  }

  async authenticate() {
    if (this.token && this.token.expiresAt > Date.now() + 120_000) return this.token.value;
    const basic = Buffer.from(`${this.credentials.apiUsername}:${this.credentials.apiSecret}`).toString('base64');
    const response = await fetch(`${this.endpoint}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'X-Subscription-Key': this.credentials.subscriptionKey,
      },
      body: JSON.stringify({ marketplace: this.credentials.marketplace }),
    });
    const responseText = await response.text();
    const parsed = parseJson<TokenResponse>(responseText);
    const value = parsed?.token ?? parsed?.access_token;
    if (!response.ok || !value) {
      throw new IngramApiError(`Ingram authentication failed with HTTP ${response.status}.`, response.status, responseText);
    }
    const expiresIn = Number(parsed?.expiresInSeconds ?? parsed?.expires_in ?? 3600);
    this.token = { value, expiresAt: Date.now() + Math.max(300, expiresIn) * 1000 };
    return value;
  }

  async listReports(dateRange: IngramReportDateRange = ingramReportDateRange()): Promise<IngramReport[]> {
    const query = new URLSearchParams({
      from: dateRange.from,
      to: dateRange.to,
      limit: '500',
    });
    const response = await this.request<Record<string, unknown>>(`/reports?${query.toString()}`);
    const rows = arrayValue(response.data ?? response.value ?? response);
    return rows.map(reportFromRecord).filter((report): report is IngramReport => Boolean(report));
  }

  async getReport(reportId: string): Promise<IngramReport> {
    const response = await this.request<Record<string, unknown>>(`/reports/${encodeURIComponent(reportId)}`);
    const record = recordValue(response.data ?? response);
    const report = reportFromRecord(record);
    if (!report) throw new IngramApiError('Ingram report response did not include an ID and name.');
    return report;
  }

  async downloadReport(downloadUrl: string) {
    const resolvedUrl = new URL(downloadUrl, `${this.endpoint}/`).toString();
    const isMarketplaceApiUrl = resolvedUrl.startsWith(`${this.endpoint}/`);
    const token = isMarketplaceApiUrl ? await this.authenticate() : undefined;
    const response = await fetch(resolvedUrl, {
      headers: isMarketplaceApiUrl
        ? {
            Authorization: `Bearer ${token}`,
            'X-Subscription-Key': this.credentials.subscriptionKey,
          }
        : undefined,
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new IngramApiError(
        `Ingram report download failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.authenticate();
    const response = await fetch(`${this.endpoint}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Subscription-Key': this.credentials.subscriptionKey,
      },
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new IngramApiError(`Ingram request failed with HTTP ${response.status}.`, response.status, responseText);
    }
    const parsed = parseJson<T>(responseText);
    if (!parsed) throw new IngramApiError('Ingram returned an invalid JSON response.', response.status, responseText);
    return parsed;
  }
}

export function ingramCredentialsFromSettings(settings: IntegrationRuntimeSettings): IngramCredentials {
  return {
    endpoint: String(settings.nonSecrets.endpoint ?? settings.definition.endpoint),
    apiUsername: String(settings.nonSecrets.apiUsername ?? ''),
    apiSecret: String(settings.secrets.apiSecret ?? ''),
    subscriptionKey: String(settings.secrets.subscriptionKey ?? ''),
    marketplace: String(settings.nonSecrets.marketplace ?? 'us'),
  };
}

export function ingramReportDateRange(now: Date | string = new Date()): IngramReportDateRange {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new Error('Ingram report range requires a valid date.');
  const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 11, 1));
  const to = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function reportFromRecord(value: unknown): IngramReport | undefined {
  const record = recordValue(value);
  const id = stringValue(record.id ?? record.reportId);
  const name = stringValue(record.name ?? record.fileName);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    format: stringValue(record.format),
    status: stringValue(record.status),
    createdAt: stringValue(record.createdAt ?? record.createdDate ?? record.creationDate),
    downloadUrl: stringValue(record.downloadUrl ?? record.url),
    raw: record,
  };
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

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}
