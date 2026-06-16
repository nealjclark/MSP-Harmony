import type { IntegrationRuntimeSettings } from '../config/settingsProvider';

export type ConnectWiseCredentials = {
  endpoint: string;
  companyId: string;
  clientId: string;
  publicKey: string;
  privateKey: string;
};

export type ConnectWiseCompany = {
  id: number;
  identifier?: string;
  name: string;
  status?: {
    id?: number;
    name?: string;
  };
  types?: Array<{
    id?: number;
    name?: string;
  }>;
  deletedFlag?: boolean;
  _info?: {
    lastUpdated?: string;
  };
  [key: string]: unknown;
};

export type ConnectWiseAgreement = {
  id: number;
  name: string;
  company?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  status?: string | {
    id?: number;
    name?: string;
  };
  agreementStatus?: string;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
};

export type ConnectWiseAgreementAddition = {
  id: number;
  agreementId?: number;
  product?: {
    id?: number;
    identifier?: string;
    description?: string;
  };
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
  billCustomer?: string;
  effectiveDate?: string;
  agreementStatus?: string;
  additionStatus?: string;
  _info?: {
    lastUpdated?: string;
    dateEntered?: string;
  };
  [key: string]: unknown;
};

export type ConnectWiseProduct = {
  id: number;
  identifier?: string;
  description?: string;
  [key: string]: unknown;
};

export type ConnectWiseCatalogItem = {
  id: number;
  identifier?: string;
  description?: string;
  [key: string]: unknown;
};

export type ConnectWiseSystemInfo = {
  version?: string;
  serverTime?: string;
  [key: string]: unknown;
};

export type ConnectWiseCountResponse = {
  count: number;
};

export type ConnectWiseListOptions = {
  page?: number;
  pageSize?: number;
  conditions?: string;
  orderBy?: string;
};

export class ConnectWiseApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseText: string,
  ) {
    super(message);
  }
}

export class ConnectWiseClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly credentials: ConnectWiseCredentials) {
    this.baseUrl = normalizeBaseUrl(credentials.endpoint);
    this.headers = {
      Authorization: `Basic ${Buffer.from(`${credentials.companyId}+${credentials.publicKey}:${credentials.privateKey}`).toString('base64')}`,
      clientId: credentials.clientId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  async getCompanyCount(conditions?: string) {
    const params = new URLSearchParams();
    if (conditions) params.set('conditions', conditions);

    return this.request<ConnectWiseCountResponse>(`/company/companies/count?${params.toString()}`);
  }

  async listCompanies(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseCompany[]>(`/company/companies?${listParams(options).toString()}`);
  }

  async listAgreements(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseAgreement[]>(`/finance/agreements?${listParams(options).toString()}`);
  }

  async listAgreementAdditions(agreementId: number | string, options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseAgreementAddition[]>(
      `/finance/agreements/${encodeURIComponent(String(agreementId))}/additions?${listParams(options).toString()}`,
    );
  }

  async listProducts(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseProduct[]>(`/procurement/products?${listParams(options).toString()}`);
  }

  async listCatalogItems(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseCatalogItem[]>(`/procurement/catalog?${listParams(options).toString()}`);
  }

  async getSystemInfo() {
    return this.request<ConnectWiseSystemInfo>('/system/info');
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new ConnectWiseApiError(
        `ConnectWise API request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }

    return response.json() as Promise<T>;
  }
}

export function connectWiseCredentialsFromSettings(settings: IntegrationRuntimeSettings): ConnectWiseCredentials {
  const credentials = {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'CONNECTWISE_ENDPOINT'),
    companyId: requiredValue(settings.nonSecrets.companyId, 'CONNECTWISE_COMPANY_ID'),
    clientId: requiredValue(settings.nonSecrets.clientId, 'CONNECTWISE_CLIENT_ID'),
    publicKey: requiredValue(settings.secrets.publicKey, 'mspharmony-connectwise-public-key'),
    privateKey: requiredValue(settings.secrets.privateKey, 'mspharmony-connectwise-private-key'),
  };

  return credentials;
}

function normalizeBaseUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');

  if (trimmed.includes('/v4_6_release/apis/3.0')) {
    return trimmed;
  }

  return `${trimmed}/v4_6_release/apis/3.0`;
}

function listParams(options: ConnectWiseListOptions) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('pageSize', String(options.pageSize ?? 25));
  if (options.conditions) params.set('conditions', options.conditions);
  if (options.orderBy) params.set('orderBy', options.orderBy);

  return params;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ConnectWise setting: ${name}`);
  }

  return value;
}
