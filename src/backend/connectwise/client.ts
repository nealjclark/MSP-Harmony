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
  invoiceToEmailAddress?: string;
  invoiceCCEmailAddress?: string;
  billingContact?: {
    id?: number;
    name?: string;
  };
  billToCompany?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  deletedFlag?: boolean;
  _info?: {
    lastUpdated?: string;
  };
  [key: string]: unknown;
};

export type ConnectWiseContact = {
  id: number;
  firstName?: string;
  lastName?: string;
  company?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  defaultFlag?: boolean;
  defaultBillingFlag?: boolean;
  inactiveFlag?: boolean;
  communicationItems?: Array<{
    id?: number;
    type?: {
      id?: number;
      name?: string;
    };
    communicationType?: string;
    value?: string;
    defaultFlag?: boolean;
  }>;
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
  type?: {
    id?: number;
    name?: string;
  };
  status?: string | {
    id?: number;
    name?: string;
  };
  agreementStatus?: string;
  billingCycle?: {
    id?: number;
    name?: string;
  };
  billingTerms?: {
    id?: number;
    name?: string;
  };
  invoiceTemplate?: {
    id?: number;
    name?: string;
  };
  billAmount?: number;
  nextInvoiceDate?: string;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
};

export type ConnectWiseInvoice = {
  id: number;
  invoiceNumber?: string;
  type?: string;
  status?: {
    id?: number;
    name?: string;
    isClosed?: boolean;
  };
  company?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  billToCompany?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  agreement?: {
    id?: number;
    name?: string;
    type?: string;
  };
  applyToType?: string;
  applyToId?: number;
  billingTerms?: {
    id?: number;
    name?: string;
  };
  invoiceTemplate?: {
    id?: number;
    name?: string;
  };
  emailTemplateId?: number;
  date?: string;
  dueDate?: string;
  total?: number;
  subtotal?: number;
  balance?: number;
  payments?: number;
  credits?: number;
  serviceTotal?: number;
  productTotal?: number;
  agreementAmount?: number;
  _info?: {
    lastUpdated?: string;
    dateEntered?: string;
    updatedBy?: string;
    enteredBy?: string;
  };
  [key: string]: unknown;
};

export type ConnectWiseInvoiceEmailTemplate = {
  id: number;
  name: string;
  subject?: string;
  body?: string;
  cc?: string;
  bcc?: string;
  _info?: {
    lastUpdated?: string;
    updatedBy?: string;
  };
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
  lessIncluded?: number;
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

export type ConnectWiseBoard = {
  id: number;
  name: string;
  inactiveFlag?: boolean;
  [key: string]: unknown;
};

export type ConnectWiseBoardType = {
  id: number;
  name: string;
  board?: {
    id?: number;
    name?: string;
  };
  inactiveFlag?: boolean;
  [key: string]: unknown;
};

export type ConnectWiseBoardSubType = {
  id: number;
  name: string;
  board?: {
    id?: number;
    name?: string;
  };
  inactiveFlag?: boolean;
  [key: string]: unknown;
};

export type ConnectWiseBoardStatus = {
  id: number;
  name: string;
  board?: {
    id?: number;
    name?: string;
  };
  inactiveFlag?: boolean;
  defaultFlag?: boolean;
  closedStatus?: boolean;
  [key: string]: unknown;
};

export type ConnectWiseServiceTicket = {
  id: number;
  summary?: string;
  closedFlag?: boolean;
  closedDate?: string;
  actualHours?: number;
  board?: {
    id?: number;
    name?: string;
  };
  type?: {
    id?: number;
    name?: string;
  };
  subType?: {
    id?: number;
    name?: string;
  };
  status?: {
    id?: number;
    name?: string;
  };
  company?: {
    id?: number;
    name?: string;
    identifier?: string;
  };
  initialDescription?: string;
  [key: string]: unknown;
};

export type ConnectWiseCreateServiceTicketRequest = {
  summary: string;
  board: { id: number };
  company: { id: number };
  type: { id: number };
  subType?: { id: number };
  status?: { id: number };
  initialDescription?: string;
};

export type ConnectWiseTimeEntry = {
  id: number;
  chargeToId?: number;
  chargeToType?: string;
  member?: {
    id?: number;
    identifier?: string;
    name?: string;
  };
  notes?: string;
  timeStart?: string;
  timeEnd?: string;
  actualHours?: number;
  billableOption?: string;
  workType?: {
    id?: number;
    name?: string;
  };
  workRole?: {
    id?: number;
    name?: string;
  };
  dateEntered?: string;
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

export type ConnectWisePatchOperation = {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: string | number | boolean | null;
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

  async getCompany(companyId: number | string) {
    return this.request<ConnectWiseCompany>(`/company/companies/${encodeURIComponent(String(companyId))}`);
  }

  async listContacts(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseContact[]>(`/company/contacts?${listParams(options).toString()}`);
  }

  async listAgreements(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseAgreement[]>(`/finance/agreements?${listParams(options).toString()}`);
  }

  async getAgreement(agreementId: number | string) {
    return this.request<ConnectWiseAgreement>(`/finance/agreements/${encodeURIComponent(String(agreementId))}`);
  }

  async listAgreementAdditions(agreementId: number | string, options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseAgreementAddition[]>(
      `/finance/agreements/${encodeURIComponent(String(agreementId))}/additions?${listParams(options).toString()}`,
    );
  }

  async listInvoices(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseInvoice[]>(`/finance/invoices?${listParams(options).toString()}`);
  }

  async getInvoice(invoiceId: number | string) {
    return this.request<ConnectWiseInvoice>(`/finance/invoices/${encodeURIComponent(String(invoiceId))}`);
  }

  async getInvoicePdf(invoiceId: number | string) {
    return this.requestBinary(`/finance/invoices/${encodeURIComponent(String(invoiceId))}/pdf`, {
      accept: 'application/pdf',
    });
  }

  async getInvoiceEmailTemplate(templateId: number | string) {
    return this.request<ConnectWiseInvoiceEmailTemplate>(
      `/finance/invoiceEmailTemplates/${encodeURIComponent(String(templateId))}`,
    );
  }

  async patchAgreementAddition(
    agreementId: number | string,
    additionId: number | string,
    operations: ConnectWisePatchOperation[],
  ) {
    return this.request<ConnectWiseAgreementAddition>(
      `/finance/agreements/${encodeURIComponent(String(agreementId))}/additions/${encodeURIComponent(String(additionId))}`,
      {
        method: 'PATCH',
        body: JSON.stringify(operations),
      },
    );
  }

  async listProducts(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseProduct[]>(`/procurement/products?${listParams(options).toString()}`);
  }

  async listCatalogItems(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseCatalogItem[]>(`/procurement/catalog?${listParams(options).toString()}`);
  }

  async listBoards(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseBoard[]>(`/service/boards?${listParams(options).toString()}`);
  }

  async listBoardTypes(boardId: number | string, options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseBoardType[]>(
      `/service/boards/${encodeURIComponent(String(boardId))}/types?${listParams(options).toString()}`,
    );
  }

  async listBoardSubTypes(boardId: number | string, options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseBoardSubType[]>(
      `/service/boards/${encodeURIComponent(String(boardId))}/subtypes?${listParams(options).toString()}`,
    );
  }

  async listBoardStatuses(boardId: number | string, options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseBoardStatus[]>(
      `/service/boards/${encodeURIComponent(String(boardId))}/statuses?${listParams(options).toString()}`,
    );
  }

  async listServiceTickets(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseServiceTicket[]>(`/service/tickets?${listParams(options).toString()}`);
  }

  async createServiceTicket(payload: ConnectWiseCreateServiceTicketRequest) {
    return this.request<ConnectWiseServiceTicket>('/service/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getServiceTicket(ticketId: number | string) {
    return this.request<ConnectWiseServiceTicket>(
      `/service/tickets/${encodeURIComponent(String(ticketId))}`,
    );
  }

  async listTimeEntries(options: ConnectWiseListOptions = {}) {
    return this.request<ConnectWiseTimeEntry[]>(`/time/entries?${listParams(options).toString()}`);
  }

  async getSystemInfo() {
    return this.request<ConnectWiseSystemInfo>('/system/info');
  }

  private async request<T>(path: string, init: Pick<RequestInit, 'method' | 'body'> = {}): Promise<T> {
    const response = await this.fetchResponse(path, init);

    return response.json() as Promise<T>;
  }

  private async requestBinary(
    path: string,
    options: { accept: string } & Pick<RequestInit, 'method' | 'body'> = { accept: 'application/pdf' },
  ): Promise<Buffer> {
    const response = await this.fetchResponse(path, {
      method: options.method,
      body: options.body,
      headers: {
        Accept: options.accept,
      },
    });

    return Buffer.from(await response.arrayBuffer());
  }

  private async fetchResponse(
    path: string,
    init: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...this.headers,
        ...(init.headers ?? {}),
      },
      body: init.body,
    });

    if (!response.ok) {
      const responseText = await response.text();
      const responseDetails = responseText.trim().slice(0, 500);
      throw new ConnectWiseApiError(
        responseDetails.length > 0
          ? `ConnectWise API request failed with HTTP ${response.status}: ${responseDetails}`
          : `ConnectWise API request failed with HTTP ${response.status}.`,
        response.status,
        responseDetails,
      );
    }

    return response;
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
