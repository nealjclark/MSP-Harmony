import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';
import {
  dattoProductKeyForSaasProductLine,
  type DattoProductMappingKey,
} from './rules';

export const dattoIntegrationId = 'datto' as const;

export type DattoCredentials = {
  endpoint: string;
  apiKey: string;
  apiSecret: string;
};

export type DattoBcdrAgent = {
  organizationId?: string;
  agentUuid?: string;
  assetId?: string;
  shortCode?: string;
  customerName?: string;
  deviceHostname?: string;
  deviceSerial?: string;
  deviceModel?: string;
  agentName?: string;
  agentHostname?: string;
  agentType?: string;
  agentVersion?: string;
  protectedVolumesCount?: number;
  unprotectedVolumesCount?: number;
  protectedVolumeNames?: string[];
  unprotectedVolumeNames?: string[];
  isPaused?: boolean;
  isArchived?: boolean;
  latestOffsite?: number;
  localSnapshots?: number;
  lastSnapshot?: number;
  lastScreenshot?: number;
  screenshotSuccess?: boolean;
  volumeName?: string;
  shadowProtectVersion?: string;
  operatingSystem?: string;
  raw: unknown;
};

export type DattoSaasDomain = {
  saasCustomerId?: string;
  organizationId?: string;
  externalSubscriptionId?: string;
  customerName?: string;
  domain?: string;
  productName?: string;
  productType?: string;
  retentionType?: string;
  seatsUsed?: number;
  raw: unknown;
};

export type DattoSaasSeat = {
  remoteId?: string;
  displayName?: string;
  email?: string;
  seatType?: string;
  status?: string;
  licenseStatus?: string;
  backupStatus?: string;
  raw: unknown;
};

export type DattoSaasUsageSummary = {
  saasCustomerId?: string;
  organizationId?: string;
  externalSubscriptionId?: string;
  customerName?: string;
  domain?: string;
  productKey: DattoProductMappingKey;
  productType?: string;
  retentionType?: string;
  quantity: number;
  source: 'domain-seats-used' | 'seat-detail-fallback';
  raw: unknown;
};

export type DattoBcdrDevice = {
  organizationId?: string;
  customerName?: string;
  deviceHostname?: string;
  deviceSerial?: string;
  deviceModel?: string;
  agentCount?: number;
  raw: Record<string, unknown>;
};

export type DattoListOptions = {
  pageSize?: number;
  maxPages?: number;
};

export type DattoSaasUsageOptions = DattoListOptions & {
  seatPageSize?: number;
  seatMaxPages?: number;
};

type DattoRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  retryCount?: number;
};

type DattoPagingOptions = {
  paging: 'limit-offset' | 'page';
  query?: Record<string, string | number | boolean>;
};

const defaultPageSize = 100;
const defaultMaxPages = 100;
const maxRetryCount = 3;

export class DattoApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class DattoClient {
  private readonly baseUrl: string;

  constructor(private readonly credentials: DattoCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async listBcdrProtectedAgents(options: DattoListOptions = {}): Promise<DattoBcdrAgent[]> {
    const devices = await this.listPaged<Record<string, unknown>>('/v1/bcdr/device', ['items', 'Items', 'devices', 'Devices', 'data'], options, {
      paging: 'page',
      query: {
        showHiddenDevices: 0,
        showChildResellerDevices: 1,
      },
    }).then((rows) => rows.map(parseDattoBcdrDevice).filter((device): device is DattoBcdrDevice => Boolean(device)));

    const agents: DattoBcdrAgent[] = [];
    for (const device of devices) {
      if (!device.deviceSerial || (device.agentCount ?? 0) <= 0) {
        continue;
      }

      const response = await this.request<unknown>(`/v1/bcdr/device/${encodeURIComponent(device.deviceSerial)}/asset/agent`);
      agents.push(...parseDattoBcdrDeviceAgents(device, response));
    }

    return agents;
  }

  async listSaasDomains(options: DattoListOptions = {}): Promise<DattoSaasDomain[]> {
    const rows = await this.listPaged<Record<string, unknown>>('/v1/saas/domains', ['domains', 'Domains', 'items', 'Items', 'data'], options);

    return rows.map(parseSaasDomain).filter((domain): domain is DattoSaasDomain => Boolean(domain));
  }

  async listSaasSeats(saasCustomerId: string, options: DattoListOptions = {}): Promise<DattoSaasSeat[]> {
    const rows = await this.listPaged<Record<string, unknown>>(
      `/v1/saas/${encodeURIComponent(saasCustomerId)}/seats`,
      ['seats', 'Seats', 'items', 'Items', 'data'],
      options,
    );

    return rows.map(parseSaasSeat).filter((seat): seat is DattoSaasSeat => Boolean(seat));
  }

  async listSaasUsageSummaries(options: DattoSaasUsageOptions = {}): Promise<DattoSaasUsageSummary[]> {
    const domains = await this.listSaasDomains(options);
    const summaries: DattoSaasUsageSummary[] = [];

    for (const domain of domains) {
      const domainSummary = summaryFromDomainSeatsUsed(domain);
      if (domainSummary) {
        summaries.push(domainSummary);
        continue;
      }

      if (!domain.saasCustomerId) {
        continue;
      }

      const seats = await this.listSaasSeats(domain.saasCustomerId, {
        pageSize: options.seatPageSize ?? options.pageSize,
        maxPages: options.seatMaxPages ?? options.maxPages,
      });
      const fallbackSummary = summaryFromSeats(domain, seats);
      if (fallbackSummary) {
        summaries.push(fallbackSummary);
      }
    }

    return summaries;
  }

  private async listPaged<T>(
    path: string,
    keys: string[],
    options: DattoListOptions,
    pagingOptions: DattoPagingOptions = { paging: 'limit-offset' },
  ): Promise<T[]> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? defaultPageSize, 1000));
    const maxPages = Math.max(1, options.maxPages ?? defaultMaxPages);
    const rows: T[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(absoluteUrl(path, this.baseUrl));
      for (const [key, value] of Object.entries(pagingOptions.query ?? {})) {
        url.searchParams.set(key, String(value));
      }

      if (pagingOptions.paging === 'page') {
        url.searchParams.set('_page', String(page + 1));
        url.searchParams.set('_perPage', String(pageSize));
      } else {
        url.searchParams.set('limit', String(pageSize));
        url.searchParams.set('offset', String(page * pageSize));
      }

      const response = await this.request<unknown>(url.toString());
      const pageRows = arrayFromResponse<T>(response, keys);
      rows.push(...pageRows);

      if (pagingOptions.paging === 'page' && isFinalPage(response, page + 1)) {
        break;
      }

      if (pageRows.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async request<T>(pathOrUrl: string, options: DattoRequestOptions = {}): Promise<T> {
    const response = await fetch(absoluteUrl(pathOrUrl, this.baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {}),
        Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString('base64')}`,
      },
    });
    const responseText = await response.text();

    if (shouldRetry(response.status) && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.request<T>(pathOrUrl, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    const parsed = responseText.trim().length > 0 ? parseJson<unknown>(responseText) : undefined;
    if (!response.ok) {
      const errorRecord = recordValue(parsed);
      throw new DattoApiError(
        stringValue(valueByKeys(errorRecord, ['message', 'Message', 'error_description', 'error'])) ??
          `Datto REST API request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
      );
    }

    return parsed as T;
  }
}

export function dattoCredentialsFromSettings(settings: IntegrationRuntimeSettings): DattoCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'DATTO_ENDPOINT'),
    apiKey: requiredValue(settings.secrets.apiKey, 'mspharmony-datto-api-key'),
    apiSecret: requiredValue(settings.secrets.apiSecret, 'mspharmony-datto-api-secret'),
  };
}

export function parseDattoBcdrAgents(response: unknown): DattoBcdrAgent[] {
  const clients = Array.isArray(response)
    ? response.map(recordValue)
    : arrayFromResponse<Record<string, unknown>>(response, ['clients', 'Clients', 'items', 'Items', 'data']);
  const agents: DattoBcdrAgent[] = [];

  for (const client of clients) {
    const clientAgents = arrayFromUnknown<Record<string, unknown>>(valueByKeys(client, ['agents', 'Agents']));
    const organizationId = stringValueByKeys(client, ['organizationId', 'OrganizationId', 'clientId', 'ClientId']);
    const customerName = stringValueByKeys(client, [
      'organizationName',
      'OrganizationName',
      'clientCompanyName',
      'ClientCompanyName',
      'clientName',
      'ClientName',
      'customerName',
      'CustomerName',
    ]);

    for (const agent of clientAgents) {
      const protectedMachine = recordValue(valueByKeys(agent, ['protectedMachine', 'ProtectedMachine']));
      const hostname = stringValue(valueByKeys(agent, ['hostname', 'Hostname', 'name', 'Name']));
      const agentUuid = stringValue(valueByKeys(agent, ['uuid', 'UUID', 'id', 'Id']));

      agents.push({
        organizationId,
        agentUuid,
        shortCode: stringValue(valueByKeys(agent, ['shortCode', 'ShortCode'])),
        customerName,
        deviceHostname: hostname,
        deviceSerial: stringValue(valueByKeys(protectedMachine, ['serial', 'Serial'])),
        agentName: hostname ?? agentUuid,
        agentHostname: hostname,
        agentType: stringValue(valueByKeys(agent, ['type', 'Type'])),
        lastSnapshot: numberValue(valueByKeys(agent, ['lastSnapshot', 'LastSnapshot'])),
        lastScreenshot: numberValue(valueByKeys(agent, ['lastScreenshot', 'LastScreenshot'])),
        screenshotSuccess: booleanValue(valueByKeys(agent, ['screenshotSuccess', 'ScreenshotSuccess'])),
        operatingSystem: stringValue(valueByKeys(protectedMachine, ['os', 'OS', 'operatingSystem', 'OperatingSystem'])),
        raw: {
          client,
          agent,
        },
      });
    }
  }

  return agents;
}

export function parseDattoBcdrDevice(record: Record<string, unknown>): DattoBcdrDevice | undefined {
  const deviceSerial = stringValueByKeys(record, ['serialNumber', 'SerialNumber', 'serial', 'Serial']);
  const deviceHostname = stringValueByKeys(record, ['name', 'Name', 'hostname', 'Hostname']);
  const customerName = stringValueByKeys(record, [
    'organizationName',
    'OrganizationName',
    'clientCompanyName',
    'ClientCompanyName',
    'clientName',
    'ClientName',
    'customerName',
    'CustomerName',
    'companyName',
    'CompanyName',
    'accountName',
    'AccountName',
  ]);

  if (!deviceSerial && !deviceHostname && !customerName) {
    return undefined;
  }

  return {
    organizationId: stringValueByKeys(record, ['organizationId', 'OrganizationId']),
    customerName,
    deviceHostname,
    deviceSerial,
    deviceModel: stringValue(valueByKeys(record, ['model', 'Model'])),
    agentCount: numberValue(valueByKeys(record, ['agentCount', 'AgentCount'])),
    raw: record,
  };
}

export function parseDattoBcdrDeviceAgents(device: DattoBcdrDevice, response: unknown): DattoBcdrAgent[] {
  const assets = arrayFromResponse<Record<string, unknown>>(response, ['items', 'Items', 'agents', 'Agents', 'data']);

  return assets.map((asset) => {
    const protectedMachine = recordValue(valueByKeys(asset, ['protectedMachine', 'ProtectedMachine']));
    const agentName = stringValue(valueByKeys(asset, ['name', 'Name']));
    const fqdn = stringValue(valueByKeys(asset, ['fqdn', 'Fqdn', 'FQDN']));

    return {
      organizationId: device.organizationId,
      customerName: device.customerName,
      deviceHostname: device.deviceHostname,
      deviceSerial: device.deviceSerial,
      deviceModel: device.deviceModel,
      assetId: stringValue(valueByKeys(asset, ['assetId', 'AssetId'])),
      agentName,
      agentHostname: fqdn ?? agentName,
      agentType: 'agent',
      agentVersion: stringValue(valueByKeys(asset, ['agentVersion', 'AgentVersion'])),
      protectedVolumesCount: numberValue(valueByKeys(asset, ['protectedVolumesCount', 'ProtectedVolumesCount'])),
      unprotectedVolumesCount: numberValue(valueByKeys(asset, ['unprotectedVolumesCount', 'UnprotectedVolumesCount'])),
      protectedVolumeNames: stringArrayValue(valueByKeys(asset, ['protectedVolumeNames', 'ProtectedVolumeNames'])),
      unprotectedVolumeNames: stringArrayValue(valueByKeys(asset, ['unprotectedVolumeNames', 'UnprotectedVolumeNames'])),
      isPaused: booleanValue(valueByKeys(asset, ['isPaused', 'IsPaused'])),
      isArchived: booleanValue(valueByKeys(asset, ['isArchived', 'IsArchived'])),
      latestOffsite: numberValue(valueByKeys(asset, ['latestOffsite', 'LatestOffsite'])),
      localSnapshots: numberValue(valueByKeys(asset, ['localSnapshots', 'LocalSnapshots'])),
      lastSnapshot: numberValue(valueByKeys(asset, ['lastSnapshot', 'LastSnapshot'])),
      lastScreenshot: numberValue(valueByKeys(asset, ['lastScreenshotAttempt', 'LastScreenshotAttempt'])),
      screenshotSuccess: booleanValue(valueByKeys(asset, ['lastScreenshotAttemptStatus', 'LastScreenshotAttemptStatus'])),
      volumeName: stringValue(valueByKeys(asset, ['volume', 'Volume'])),
      operatingSystem:
        stringValue(valueByKeys(asset, ['os', 'OS', 'operatingSystem', 'OperatingSystem'])) ??
        stringValue(valueByKeys(protectedMachine, ['os', 'OS', 'operatingSystem', 'OperatingSystem'])),
      raw: {
        device: device.raw,
        asset,
      },
    };
  });
}

export function parseSaasDomain(record: Record<string, unknown>): DattoSaasDomain | undefined {
  const saasCustomerId = stringValueByKeys(record, [
    'saasCustomerId',
    'SaasCustomerId',
    'saas_customer_id',
    'customerId',
    'CustomerId',
    'id',
    'Id',
  ]);
  const domain = stringValueByKeys(record, ['domain', 'Domain', 'domainName', 'DomainName', 'name', 'Name']);
  const customerName = stringValueByKeys(record, [
    'saasCustomerName',
    'SaasCustomerName',
    'customerName',
    'CustomerName',
    'organizationName',
    'OrganizationName',
    'clientCompanyName',
    'ClientCompanyName',
    'companyName',
    'CompanyName',
    'accountName',
    'AccountName',
  ]);

  if (!saasCustomerId && !domain && !customerName) {
    return undefined;
  }

  return {
    saasCustomerId,
    organizationId: stringValueByKeys(record, ['organizationId', 'OrganizationId']),
    externalSubscriptionId: stringValue(
      valueByKeys(record, ['externalSubscriptionId', 'ExternalSubscriptionId', 'subscriptionId', 'SubscriptionId']),
    ),
    customerName,
    domain,
    productName: stringValue(valueByKeys(record, ['productName', 'ProductName', 'product', 'Product'])),
    productType: stringValue(valueByKeys(record, ['productType', 'ProductType'])),
    retentionType: stringValue(valueByKeys(record, ['retentionType', 'RetentionType'])),
    seatsUsed: numberValue(valueByKeys(record, ['seatsUsed', 'SeatsUsed'])),
    raw: record,
  };
}

export function parseSaasSeat(record: Record<string, unknown>): DattoSaasSeat | undefined {
  const remoteId = stringValue(valueByKeys(record, ['remoteId', 'RemoteId', 'id', 'Id', 'objectId', 'ObjectId']));
  const displayName = stringValue(valueByKeys(record, ['displayName', 'DisplayName', 'name', 'Name']));
  const email = stringValue(valueByKeys(record, ['email', 'Email', 'userPrincipalName', 'UserPrincipalName', 'upn', 'UPN']));
  const seatType = stringValue(valueByKeys(record, ['seat_type', 'seatType', 'SeatType', 'type', 'Type', 'objectType', 'ObjectType']));

  if (!remoteId && !displayName && !email && !seatType) {
    return undefined;
  }

  return {
    remoteId,
    displayName,
    email,
    seatType,
    status: stringValue(valueByKeys(record, ['status', 'Status'])),
    licenseStatus: stringValue(valueByKeys(record, ['licenseStatus', 'LicenseStatus', 'license_status'])),
    backupStatus: stringValue(valueByKeys(record, ['backupStatus', 'BackupStatus', 'backup_status'])),
    raw: record,
  };
}

function summaryFromDomainSeatsUsed(domain: DattoSaasDomain): DattoSaasUsageSummary | undefined {
  if (!domain.seatsUsed || domain.seatsUsed <= 0) {
    return undefined;
  }

  return {
    saasCustomerId: domain.saasCustomerId,
    organizationId: domain.organizationId,
    externalSubscriptionId: domain.externalSubscriptionId,
    customerName: domain.customerName,
    domain: domain.domain,
    productKey: dattoProductKeyForSaasProductLine(domain.productType, domain.retentionType),
    productType: domain.productType,
    retentionType: domain.retentionType,
    quantity: domain.seatsUsed,
    source: 'domain-seats-used',
    raw: {
      domain: domain.raw,
      productType: domain.productType,
      retentionType: domain.retentionType,
      seatsUsed: domain.seatsUsed,
    },
  };
}

function summaryFromSeats(domain: DattoSaasDomain, seats: DattoSaasSeat[]): DattoSaasUsageSummary | undefined {
  const quantity = seats.filter(isBillableSaasSeat).length;
  if (quantity <= 0) {
    return undefined;
  }

  return {
    saasCustomerId: domain.saasCustomerId,
    organizationId: domain.organizationId,
    externalSubscriptionId: domain.externalSubscriptionId,
    customerName: domain.customerName,
    domain: domain.domain,
    productKey: dattoProductKeyForSaasProductLine(domain.productType, domain.retentionType),
    productType: domain.productType,
    retentionType: domain.retentionType,
    quantity,
    source: 'seat-detail-fallback',
    raw: {
      domain: domain.raw,
      productType: domain.productType,
      retentionType: domain.retentionType,
      seatCount: quantity,
    },
  };
}

function isBillableSaasSeat(seat: DattoSaasSeat) {
  const raw = recordValue(seat.raw);
  const explicitLicensed = booleanValue(valueByKeys(raw, ['isLicensed', 'IsLicensed', 'licensed', 'Licensed', 'isProtected', 'IsProtected']));
  if (typeof explicitLicensed === 'boolean') {
    return explicitLicensed;
  }

  const status = [seat.status, seat.licenseStatus, stringValue(valueByKeys(raw, ['actionType', 'ActionType']))]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return !/\b(unlicensed|unlicense|paused|pause|deleted|disabled|inactive)\b/i.test(status);
}

function arrayFromResponse<T>(response: unknown, keys: string[]) {
  if (Array.isArray(response)) {
    return response.map(recordValue) as T[];
  }

  const record = recordValue(response);
  for (const key of keys) {
    const direct = valueByKeys(record, [key]);
    if (Array.isArray(direct)) {
      return direct.map(recordValue) as T[];
    }
  }

  const nestedData = recordValue(valueByKeys(record, ['data', 'Data']));
  for (const key of keys) {
    const nested = valueByKeys(nestedData, [key]);
    if (Array.isArray(nested)) {
      return nested.map(recordValue) as T[];
    }
  }

  return [];
}

function isFinalPage(response: unknown, currentPage: number) {
  const pagination = recordValue(valueByKeys(recordValue(response), ['pagination', 'Pagination']));
  const totalPages = numberValue(valueByKeys(pagination, ['totalPages', 'TotalPages']));
  return typeof totalPages === 'number' && currentPage >= totalPages;
}

function arrayFromUnknown<T extends Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value.map(recordValue) as T[];
  }

  const record = recordValue(value);
  return Object.keys(record).length > 0 ? [record as T] : [];
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.map(stringValue).filter((item): item is string => Boolean(item));
  return values.length > 0 ? values : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function valueByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function primitiveXmlValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return record['#text'] ?? record.text ?? value;
}

function stringValue(value: unknown) {
  const primitive = primitiveXmlValue(value);
  if (typeof primitive === 'string' && primitive.trim().length > 0) {
    return primitive.trim();
  }

  if (typeof primitive === 'number' && Number.isFinite(primitive)) {
    return String(primitive);
  }

  return undefined;
}

function stringValueByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function numberValue(value: unknown) {
  const primitive = primitiveXmlValue(value);
  if (typeof primitive === 'number' && Number.isFinite(primitive)) {
    return primitive;
  }

  if (typeof primitive === 'string' && primitive.trim().length > 0) {
    const parsed = Number.parseFloat(primitive);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function booleanValue(value: unknown) {
  const primitive = primitiveXmlValue(value);
  if (typeof primitive === 'boolean') {
    return primitive;
  }

  if (typeof primitive === 'string') {
    if (/^true$/i.test(primitive)) return true;
    if (/^false$/i.test(primitive)) return false;
  }

  return undefined;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

function absoluteUrl(pathOrUrl: string, baseUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${path}`;
}

function shouldRetry(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: Response, retryCount: number) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
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

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing Datto Backup setting: ${name}.`);
  }

  return value.trim();
}
