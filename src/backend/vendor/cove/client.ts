import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export type CoveCredentials = {
  endpoint: string;
  partnerName: string;
  username: string;
  password: string;
};

export type CoveLoginResult = {
  partnerId: number;
  visa: string;
  username?: string;
};

export type CoveDeviceStatistic = {
  accountId?: number;
  partnerId?: number;
  customerName?: string;
  computerName?: string;
  deviceType: 'workstation' | 'server' | 'undefined';
  physicality?: string;
  os?: string;
  clientVersion?: string;
  selectedStorageGb: number;
  usedStorageGb: number;
  dataSources?: string;
  creationDate?: string;
  expirationDate?: string;
  lastComplete?: string;
  raw: unknown;
};

export type CoveAccountStatisticsOptions = {
  partnerId?: number;
  pageSize?: number;
  maxPages?: number;
};

type CoveJsonRpcEnvelope<T> = {
  visa?: string;
  result?: {
    result?: T;
    Result?: T;
  };
  error?: {
    message?: string;
    code?: number;
  };
};

type CoveAccountStatisticRecord = {
  AccountId?: number;
  accountId?: number;
  PartnerId?: number;
  partnerId?: number;
  Settings?: unknown;
  settings?: unknown;
  [key: string]: unknown;
};

const coveStatisticColumns = ['I8', 'I1', 'I32', 'I16', 'I17', 'I4', 'I5', 'TL', 'I78', 'T3', 'US', 'I81'] as const;
const bytesPerGb = 1073741824;

export class CoveApiError extends Error {
  constructor(
    message: string,
    public readonly responseText?: string,
  ) {
    super(message);
  }
}

export class CoveClient {
  private readonly endpoint: string;
  private visa?: string;
  private partnerId?: number;

  constructor(private readonly credentials: CoveCredentials) {
    this.endpoint = normalizeJsonApiEndpoint(credentials.endpoint);
  }

  async login(): Promise<CoveLoginResult> {
    const response = await this.request<CoveLoginResult>({
      method: 'Login',
      params: {
        partner: this.credentials.partnerName,
        username: this.credentials.username,
        password: this.credentials.password,
      },
      includeVisa: false,
    });

    this.partnerId = response.partnerId;
    this.visa = response.visa;

    return response;
  }

  async listAccountStatistics(options: CoveAccountStatisticsOptions = {}): Promise<CoveDeviceStatistic[]> {
    if (!this.visa || !this.partnerId) {
      await this.login();
    }

    const partnerId = options.partnerId ?? this.partnerId;
    if (!partnerId) {
      throw new CoveApiError('Cove login did not return a partner ID.');
    }

    const pageSize = options.pageSize ?? 10000;
    const maxPages = options.maxPages ?? 1;
    const devices: CoveDeviceStatistic[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const records = await this.request<CoveAccountStatisticRecord[]>({
        method: 'EnumerateAccountStatistics',
        params: {
          query: {
            PartnerId: partnerId,
            StartRecordNumber: page * pageSize,
            RecordsCount: pageSize,
            SelectionMode: 'Merged',
            Columns: [...coveStatisticColumns],
          },
        },
        includeVisa: true,
      });

      devices.push(...records.map(parseCoveDeviceStatistic));
      if (records.length < pageSize) break;
    }

    return devices;
  }

  private async request<T>(input: {
    method: string;
    params?: Record<string, unknown>;
    includeVisa: boolean;
  }): Promise<T extends CoveLoginResult ? CoveLoginResult : T> {
    const body = {
      jsonrpc: '2.0',
      id: 'jsonrpc',
      ...(input.includeVisa ? { visa: this.visa } : {}),
      method: input.method,
      ...(input.params ? { params: input.params } : {}),
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new CoveApiError(`Cove API request failed with HTTP ${response.status}.`, responseText.slice(0, 500));
    }

    const envelope = JSON.parse(responseText) as CoveJsonRpcEnvelope<unknown>;
    if (envelope.error) {
      throw new CoveApiError(envelope.error.message ?? `Cove API method "${input.method}" failed.`, responseText.slice(0, 500));
    }

    if (envelope.visa) {
      this.visa = envelope.visa;
    }

    const result = envelope.result?.result ?? envelope.result?.Result;
    if (input.method === 'Login') {
      const login = recordValue(result);
      const partnerId = numberValue(login.PartnerId) ?? numberValue(login.partnerId);
      if (!partnerId || !envelope.visa) {
        throw new CoveApiError('Cove login response did not include partner ID and visa.', responseText.slice(0, 500));
      }

      return {
        partnerId,
        visa: envelope.visa,
        username: stringValue(login.Name) ?? stringValue(login.EmailAddress),
      } as T extends CoveLoginResult ? CoveLoginResult : T;
    }

    return (result ?? []) as T extends CoveLoginResult ? CoveLoginResult : T;
  }
}

export function coveCredentialsFromSettings(settings: IntegrationRuntimeSettings): CoveCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'COVE_ENDPOINT'),
    partnerName: requiredValue(settings.nonSecrets.partnerName, 'COVE_PARTNER_NAME'),
    username: requiredValue(settings.secrets.username, 'mspharmony-cove-username'),
    password: requiredValue(settings.secrets.password, 'mspharmony-cove-password'),
  };
}

export function parseCoveDeviceStatistic(record: CoveAccountStatisticRecord): CoveDeviceStatistic {
  const settings = settingsRecord(record.Settings ?? record.settings);

  return {
    accountId: numberValue(record.AccountId) ?? numberValue(record.accountId),
    partnerId: numberValue(record.PartnerId) ?? numberValue(record.partnerId),
    customerName: stringValue(settings.I8),
    computerName: stringValue(settings.I1),
    deviceType: deviceType(settings.I32),
    physicality: stringValue(settings.I81),
    os: stringValue(settings.I16),
    clientVersion: stringValue(settings.I17),
    selectedStorageGb: bytesToRoundedGb(settings.T3),
    usedStorageGb: bytesToRoundedGb(settings.US),
    dataSources: formatDataSources(stringValue(settings.I78)),
    creationDate: epochToIso(settings.I4),
    expirationDate: epochToIso(settings.I5),
    lastComplete: epochToIso(settings.TL),
    raw: record,
  };
}

export function getCoveStatisticColumns() {
  return [...coveStatisticColumns];
}

function normalizeJsonApiEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/jsonapi') ? trimmed : `${trimmed}/jsonapi`;
}

function settingsRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (!Array.isArray(value) && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  if (!Array.isArray(value)) {
    return {};
  }

  return value.reduce<Record<string, unknown>>((settings, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return settings;
    }

    return {
      ...settings,
      ...(item as Record<string, unknown>),
    };
  }, {});
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function bytesToRoundedGb(value: unknown) {
  const bytes = numberValue(value);
  return bytes ? Math.round(bytes / bytesPerGb) : 0;
}

function epochToIso(value: unknown) {
  const epoch = numberValue(value);
  if (!epoch) {
    return undefined;
  }

  return new Date(epoch * 1000).toISOString();
}

function deviceType(value: unknown): CoveDeviceStatistic['deviceType'] {
  const type = stringValue(value);
  if (type === '1') return 'workstation';
  if (type === '2') return 'server';
  return 'undefined';
}

function formatDataSources(sources: string | undefined) {
  if (!sources) {
    return undefined;
  }

  const labels: Record<string, string> = {
    D01: 'Files and Folders',
    D02: 'System State',
    D03: 'MsSql',
    D04: 'VssExchange',
    D06: 'NetworkShares',
    D07: 'VssSystemState',
    D08: 'VMware Virtual Machines',
    D10: 'VssMsSql',
    D11: 'VssSharePoint',
    D12: 'Oracle',
    D14: 'Hyper-V',
    D15: 'MySql',
    D16: 'Virtual Disaster Recovery',
    D17: 'Bare Metal Restore',
    D18: 'Linux System State',
  };

  return [...sources.matchAll(/D\d\d/g)]
    .map(([code]) => labels[code] ?? code)
    .join(', ');
}

function requiredValue(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing Cove setting: ${name}.`);
  }

  return value;
}
