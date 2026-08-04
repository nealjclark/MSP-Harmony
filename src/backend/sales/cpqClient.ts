import { createHash } from 'node:crypto';
import type { QuoteLineSnapshot } from '../../shared/sales';

export type CpqCredentials = {
  endpoint: string;
  accessKey: string;
  publicKey: string;
  privateKey: string;
  templatesPath: string;
  quotesPath: string;
  quoteItemsPath: string;
  quoteTabsPath: string;
  testCompanyId: string;
  siteUrl?: string;
  hardwareTabId?: string;
};

export type CpqQuoteSnapshot = {
  id: string;
  name?: string;
  status?: string;
  url?: string;
  updatedAt?: string;
  lines: QuoteLineSnapshot[];
  raw: unknown;
};

export class CpqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string,
  ) {
    super(message);
    this.name = 'CpqApiError';
  }
}

export class ConnectWiseCpqClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly credentials: CpqCredentials) {
    this.baseUrl = credentials.endpoint.replace(/\/+$/, '');
    this.headers = {
      Authorization: `Basic ${Buffer.from(
        `${credentials.accessKey}+${credentials.publicKey}:${credentials.privateKey}`,
      ).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json; version=1.0',
    };
  }

  async listTemplates() {
    const response = await this.request<unknown>(this.credentials.templatesPath);
    return arrayFromResponse(response, ['templates', 'items', 'data']).map((item) => normalizeTemplate(item));
  }

  getTemplate(templateId: string) {
    return this.request<unknown>(joinPath(this.credentials.templatesPath, templateId));
  }

  async createDraft(input: {
    templateId: string;
    name: string;
    companyId: number;
    opportunityId: number;
    requestId: string;
  }): Promise<CpqQuoteSnapshot> {
    const copied = normalizeQuote(
      await this.request<unknown>(joinPath(this.credentials.quotesPath, 'copyById', input.templateId), {
        method: 'POST',
      }),
    );
    if (!copied.id) {
      throw new Error('ConnectWise CPQ did not return a quote identifier after copying the template.');
    }

    await this.request<unknown>(joinPath(this.credentials.quotesPath, copied.id), {
      method: 'PATCH',
      body: JSON.stringify([
        { op: 'replace', path: '/name', value: input.name },
        { op: 'replace', path: '/crmOpportunityId', value: String(input.opportunityId) },
        { op: 'replace', path: '/requestId', value: input.requestId },
      ]),
    });

    return this.getQuote(copied.id);
  }

  async getQuote(quoteId: string): Promise<CpqQuoteSnapshot> {
    const [quote, lineItems] = await Promise.all([
      this.request<unknown>(joinPath(this.credentials.quotesPath, quoteId)),
      this.listQuoteItems(quoteId),
    ]);
    return normalizeQuote(quote, lineItems, this.quoteUrl(quoteId));
  }

  async configureTemplateLine(
    quoteId: string,
    lineId: string,
    input: { included: boolean; quantity: number },
  ) {
    return this.request<unknown>(joinPath(this.credentials.quoteItemsPath, lineId), {
      method: 'PATCH',
      body: JSON.stringify([
        { op: 'replace', path: '/quantity', value: input.quantity },
        { op: 'replace', path: '/isHiddenItem', value: !input.included },
        { op: 'replace', path: '/isSelected', value: input.included },
        { op: 'replace', path: '/isPrinted', value: input.included },
      ]),
    });
  }

  async addLine(
    quoteId: string,
    input: {
      sku?: string;
      description: string;
      quantity: number;
      unitCost?: number;
      unitPrice?: number;
      sourceReference: string;
    },
  ) {
    const quoteTabs = await this.listQuoteTabs(quoteId);
    const tabId =
      this.credentials.hardwareTabId ??
      quoteTabs
        .map((tab) => recordValue(tab))
        .find((tab) => /\b(hw|hardware)\b/i.test(stringValue(tab.name) ?? ''))?.id ??
      quoteTabs
        .map((tab) => recordValue(tab))
        .find((tab) => tab.canAddItems !== false && tab.isHidden !== true)?.id;
    if (!tabId) {
      throw new Error(
        'ConnectWise CPQ requires a quote tab for Dell line insertion. Configure the CPQ Hardware Tab ID or add a line to the template hardware tab.',
      );
    }

    return this.request<unknown>(this.credentials.quoteItemsPath, {
      method: 'POST',
      body: JSON.stringify({
        idQuote: quoteId,
        idQuoteTabs: String(tabId),
        manufacturerPartNumber: input.sku,
        quosalDescription: input.description,
        shortDescription: input.description,
        quantity: input.quantity,
        cost: input.unitCost,
        quoteItemPrice: input.unitPrice,
        overridePrice: input.unitPrice,
        externalReference: input.sourceReference,
        source: 'Dell Premier eQuote',
        isHiddenItem: false,
        isOptional: false,
        isSelected: true,
        isPrinted: true,
      }),
    });
  }

  async setStatus(quoteId: string, status: string): Promise<CpqQuoteSnapshot> {
    await this.request<unknown>(joinPath(this.credentials.quotesPath, quoteId), {
      method: 'PATCH',
      body: JSON.stringify([{ op: 'replace', path: '/quoteStatus', value: status }]),
    });
    return this.getQuote(quoteId);
  }

  async verifyCapabilities() {
    const templates = await this.listTemplates();
    return {
      reachable: true,
      templateCount: templates.length,
      templates: templates.slice(0, 25),
      testCompanyId: this.credentials.testCompanyId,
      writeOperationsVerified: false,
      note: 'Write operations require an AI-PILOT request against the configured test company.',
    };
  }

  private async listQuoteItems(quoteId: string) {
    const quoteTabs = await this.listQuoteTabs(quoteId);
    const items: unknown[] = [];
    for (const tab of quoteTabs) {
      const tabId = stringValue(recordValue(tab).id);
      if (!tabId) continue;
      const response = await this.request<unknown>(
        joinPath(this.credentials.quoteTabsPath, tabId, 'quoteItems'),
      );
      items.push(...arrayFromResponse(response, ['quoteItems', 'items', 'data']));
    }
    return items.filter((item) => {
      const itemQuoteId = stringValue(recordValue(item).idQuote);
      return !itemQuoteId || itemQuoteId === quoteId;
    });
  }

  private async listQuoteTabs(quoteId: string) {
    const query = new URLSearchParams({
      includeFields: 'id,name,quote,canAddItems,isHidden',
      conditions: `quote/id = "${quoteId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      page: '1',
      pageSize: '50',
    });
    const response = await this.request<unknown>(`${this.credentials.quoteTabsPath}?${query}`);
    return arrayFromResponse(response, ['quoteTabs', 'items', 'data']);
  }

  private quoteUrl(quoteId: string) {
    const siteUrl = this.credentials.siteUrl?.replace(/\/+$/, '');
    if (!siteUrl) return undefined;
    const url = new URL('/QuosalWeb/quote.dashboard', siteUrl);
    url.searchParams.set('accesskey', this.credentials.accessKey);
    url.searchParams.set('idquotemain', quoteId);
    return url.toString();
  }

  private async request<T>(
    path: string,
    init: Pick<RequestInit, 'method' | 'body'> = {},
  ): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${normalizedPath(path)}`);
    if (url.protocol !== 'https:' || url.origin !== new URL(this.baseUrl).origin) {
      throw new Error('CPQ API path resolved outside the configured endpoint.');
    }
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: this.headers,
      body: init.body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new CpqApiError(
        `ConnectWise CPQ request failed with HTTP ${response.status}: ${safeRemoteError(text)}`,
        response.status,
        text.slice(0, 500),
      );
    }
    if (!text.trim()) return {} as T;
    return JSON.parse(text) as T;
  }
}

export function cpqCredentialsFromSettings(settings: {
  nonSecrets: Record<string, string | undefined>;
  secrets: Record<string, string | undefined>;
}): CpqCredentials {
  return {
    endpoint: required(settings.nonSecrets.endpoint, 'CONNECTWISE_CPQ_ENDPOINT'),
    accessKey: required(settings.nonSecrets.accessKey, 'CONNECTWISE_CPQ_ACCESS_KEY'),
    publicKey: required(settings.secrets.publicKey, 'CONNECTWISE_CPQ_PUBLIC_KEY'),
    privateKey: required(settings.secrets.privateKey, 'CONNECTWISE_CPQ_PRIVATE_KEY'),
    templatesPath: required(settings.nonSecrets.templatesPath, 'CONNECTWISE_CPQ_TEMPLATES_PATH'),
    quotesPath: required(settings.nonSecrets.quotesPath, 'CONNECTWISE_CPQ_QUOTES_PATH'),
    quoteItemsPath: required(settings.nonSecrets.quoteItemsPath, 'CONNECTWISE_CPQ_QUOTE_ITEMS_PATH'),
    quoteTabsPath: required(settings.nonSecrets.quoteTabsPath, 'CONNECTWISE_CPQ_QUOTE_TABS_PATH'),
    testCompanyId: required(settings.nonSecrets.testCompanyId, 'CONNECTWISE_CPQ_TEST_COMPANY_ID'),
    siteUrl: optional(settings.nonSecrets.siteUrl),
    hardwareTabId: optional(settings.nonSecrets.hardwareTabId),
  };
}

export function cpqSnapshotHash(snapshot: CpqQuoteSnapshot | unknown) {
  return createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function normalizeTemplate(value: unknown) {
  const row = recordValue(value);
  return {
    id: stringValue(firstValue(row, ['id', 'templateId', 'quoteTemplateId'])) ?? '',
    name: stringValue(firstValue(row, ['name', 'templateName', 'description'])) ?? 'Unnamed template',
    updatedAt: stringValue(firstValue(row, ['updatedAt', 'lastUpdated', 'modifiedDate'])),
    raw: value,
  };
}

function normalizeQuote(value: unknown, lineItems?: unknown[], fallbackUrl?: string): CpqQuoteSnapshot {
  const root = unwrap(recordValue(value), ['quote', 'data', 'result']);
  const rawLines = lineItems ?? arrayFromResponse(root, ['lines', 'lineItems', 'items', 'products']);
  return {
    id: stringValue(firstValue(root, ['id', 'quoteId', 'documentId'])) ?? '',
    name: stringValue(firstValue(root, ['name', 'quoteName', 'title'])),
    status:
      stringValue(firstValue(root, ['quoteStatus', 'status', 'statusName'])) ??
      stringValue(recordValue(root.status).name),
    url: stringValue(firstValue(root, ['url', 'quoteUrl', 'webUrl'])) ?? fallbackUrl,
    updatedAt: stringValue(firstValue(root, ['modifyDate', 'updatedAt', 'lastUpdated', 'modifiedDate'])),
    lines: rawLines.map((entry, index) => normalizeQuoteLine(entry, index)),
    raw: lineItems ? { quote: value, lineItems } : value,
  };
}

function normalizeQuoteLine(value: unknown, index: number): QuoteLineSnapshot {
  const row = recordValue(value);
  const quantity = numberValue(firstValue(row, ['quantity', 'qty'])) ?? 0;
  const unitCost = numberValue(firstValue(row, ['cost', 'netCost', 'unitCost']));
  const unitPrice = numberValue(
    firstValue(row, ['quoteItemPrice', 'overridePrice', 'unitPrice', 'price', 'sellPrice']),
  );
  const hidden = firstValue(row, ['isHiddenItem', 'hidden', 'isHidden']) === true;
  const selected = firstValue(row, ['selected', 'isSelected']);
  return {
    lineId: stringValue(firstValue(row, ['id', 'lineId', 'itemId'])) ?? `line-${index + 1}`,
    source:
      stringValue(firstValue(row, ['source', 'sourceType', 'externalReference']))?.toLowerCase().includes('dell')
        ? 'dell-equote'
        : 'template',
    sku: stringValue(firstValue(row, ['sku', 'manufacturerPartNumber', 'partNumber', 'productCode'])),
    description:
      stringValue(
        firstValue(row, ['quosalDescription', 'shortDescription', 'longDescription', 'description', 'name', 'productName']),
      ) ?? `Quote line ${index + 1}`,
    quantity,
    unitCost,
    unitPrice,
    listPrice: numberValue(firstValue(row, ['listPrice', 'msrp'])),
    discountPercent: numberValue(firstValue(row, ['discountPercent', 'discount'])),
    extendedCost: numberValue(firstValue(row, ['extendedCost', 'totalCost'])),
    extendedPrice: numberValue(firstValue(row, ['extendedPrice', 'totalPrice', 'lineTotal'])),
    included: !hidden && selected !== false,
  };
}

function joinPath(...segments: string[]) {
  return segments
    .map((segment, index) => (index === 0 ? normalizedPath(segment) : encodeURIComponent(segment)))
    .join('/')
    .replace(/\/+/g, '/');
}

function normalizedPath(value: string) {
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function arrayFromResponse(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const row = recordValue(value);
  for (const key of keys) if (Array.isArray(row[key])) return row[key] as unknown[];
  return [];
}

function unwrap(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return record;
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
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

function optional(value: string | undefined) {
  return value?.trim() || undefined;
}

function safeRemoteError(value: string) {
  try {
    const parsed = recordValue(JSON.parse(value));
    return (
      stringValue(firstValue(parsed, ['message', 'error_description', 'error', 'detail'])) ??
      'Remote service error.'
    ).slice(0, 500);
  } catch {
    return value.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
