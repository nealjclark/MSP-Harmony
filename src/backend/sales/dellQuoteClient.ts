import type { QuoteLineSnapshot } from '../../shared/sales';

export type DellQuoteCredentials = {
  endpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  accountId: string;
  locale: string;
  quotesPath: string;
};

export type DellEquote = {
  number: string;
  version?: string;
  locale: string;
  customerName?: string;
  currency?: string;
  expiresAt?: string;
  lines: QuoteLineSnapshot[];
  raw: unknown;
};

let dellNextRequestAt = 0;

export class DellQuoteClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: DellQuoteCredentials) {
    this.baseUrl = credentials.endpoint.replace(/\/+$/, '');
  }

  async getEquote(input: { number: string; version?: string; locale?: string }): Promise<DellEquote> {
    await throttleDell();
    const token = await this.accessToken();
    const path = this.credentials.quotesPath.startsWith('/')
      ? this.credentials.quotesPath
      : `/${this.credentials.quotesPath}`;
    const url = new URL(`${this.baseUrl}${path.replace(/\/+$/, '')}/${encodeURIComponent(input.number)}`);
    url.searchParams.set('accountId', this.credentials.accountId);
    url.searchParams.set('locale', input.locale || this.credentials.locale);
    if (input.version) url.searchParams.set('version', input.version);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Dell Quote API failed with HTTP ${response.status}: ${safeError(body)}`);
    }
    const raw = JSON.parse(body) as unknown;
    return normalizeDellEquote(raw, {
      number: input.number,
      version: input.version,
      locale: input.locale || this.credentials.locale,
    });
  }

  private async accessToken() {
    const endpoint = new URL(this.credentials.tokenEndpoint);
    if (endpoint.protocol !== 'https:') throw new Error('Dell OAuth token endpoint must use HTTPS.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    const body = await response.text();
    const parsed = jsonObject(body);
    const token = stringValue(parsed.access_token);
    if (!response.ok || !token) {
      throw new Error(`Dell OAuth failed with HTTP ${response.status}: ${safeError(body)}`);
    }
    return token;
  }
}

export function dellQuoteCredentialsFromSettings(settings: {
  nonSecrets: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
}): DellQuoteCredentials {
  return {
    endpoint: required(settings.nonSecrets.endpoint, 'DELL_PREMIER_ENDPOINT'),
    tokenEndpoint: required(settings.nonSecrets.tokenEndpoint, 'DELL_PREMIER_TOKEN_ENDPOINT'),
    clientId: required(settings.nonSecrets.clientId, 'DELL_PREMIER_CLIENT_ID'),
    clientSecret: required(settings.secrets.clientSecret, 'DELL_PREMIER_CLIENT_SECRET'),
    accountId: required(settings.nonSecrets.accountId, 'DELL_PREMIER_ACCOUNT_ID'),
    locale: required(settings.nonSecrets.locale, 'DELL_PREMIER_LOCALE'),
    quotesPath: required(settings.nonSecrets.quotesPath, 'DELL_PREMIER_QUOTES_PATH'),
  };
}

export function validateDellEquote(equote: DellEquote, expectedCustomerName?: string) {
  const blockers: string[] = [];
  if (equote.expiresAt) {
    const expiration = Date.parse(equote.expiresAt);
    if (!Number.isFinite(expiration)) blockers.push('Dell eQuote returned an invalid expiration date.');
    else if (expiration < Date.now()) blockers.push(`Dell eQuote ${equote.number} expired on ${equote.expiresAt}.`);
  }
  if (equote.currency && equote.currency.toUpperCase() !== 'USD') {
    blockers.push(`Dell eQuote currency ${equote.currency} is not supported by the USD pilot.`);
  }
  if (
    expectedCustomerName &&
    equote.customerName &&
    normalizeName(expectedCustomerName) !== normalizeName(equote.customerName)
  ) {
    blockers.push(
      `Dell eQuote customer "${equote.customerName}" does not match resolved customer "${expectedCustomerName}".`,
    );
  }
  if (equote.lines.length === 0) blockers.push('Dell eQuote did not return any hardware line items.');
  return blockers;
}

function normalizeDellEquote(
  value: unknown,
  fallback: { number: string; version?: string; locale: string },
): DellEquote {
  const root = unwrapQuote(jsonRecord(value));
  const rawLines = firstArray(root, ['lineItems', 'items', 'products', 'quoteLines']);
  const lines = rawLines.map((entry, index) => {
    const row = jsonRecord(entry);
    const quantity = numberValue(firstValue(row, ['quantity', 'qty'])) ?? 0;
    const unitCost = numberValue(firstValue(row, ['unitCost', 'cost', 'unitPrice']));
    const unitPrice = numberValue(firstValue(row, ['unitPrice', 'sellPrice', 'price']));
    const sku = stringValue(firstValue(row, ['sku', 'manufacturerPartNumber', 'partNumber', 'dellSku']));
    const description =
      stringValue(firstValue(row, ['description', 'productDescription', 'name'])) ??
      sku ??
      `Dell line ${index + 1}`;
    return {
      lineId:
        stringValue(firstValue(row, ['id', 'lineId', 'lineNumber'])) ??
        `dell-${fallback.number}-${index + 1}`,
      source: 'dell-equote' as const,
      sku,
      description,
      quantity,
      unitCost,
      unitPrice,
      extendedCost: numberValue(firstValue(row, ['extendedCost', 'totalCost'])),
      extendedPrice: numberValue(firstValue(row, ['extendedPrice', 'totalPrice', 'lineTotal'])),
      included: true,
    };
  });
  return {
    number:
      stringValue(firstValue(root, ['equoteNumber', 'quoteNumber', 'number', 'id'])) ?? fallback.number,
    version: stringValue(firstValue(root, ['version', 'quoteVersion'])) ?? fallback.version,
    locale: stringValue(firstValue(root, ['locale', 'country'])) ?? fallback.locale,
    customerName: stringValue(firstValue(root, ['customerName', 'endUserName', 'companyName'])),
    currency: stringValue(firstValue(root, ['currency', 'currencyCode'])),
    expiresAt: stringValue(firstValue(root, ['expirationDate', 'expiresAt', 'expiryDate'])),
    lines,
    raw: value,
  };
}

function unwrapQuote(record: Record<string, unknown>) {
  for (const key of ['quote', 'eQuote', 'data', 'result']) {
    const candidate = record[key];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return record;
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

async function throttleDell() {
  const wait = Math.max(0, dellNextRequestAt - Date.now());
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  dellNextRequestAt = Date.now() + 1000;
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    return jsonRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function safeError(value: string) {
  const parsed = jsonObject(value);
  return (
    stringValue(parsed.error_description) ??
    stringValue(parsed.message) ??
    stringValue(parsed.error) ??
    value.replace(/\s+/g, ' ').trim().slice(0, 500) ??
    'Remote service error.'
  );
}
