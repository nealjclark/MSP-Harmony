import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { IntegrationRuntimeSettings } from '../../config/settingsProvider';

export const azureIntegrationId = 'microsoft-azure' as const;

export type AzureCredentials = {
  endpoint: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type AzureSubscription = {
  subscriptionId: string;
  displayName?: string;
  tenantId?: string;
  tenantName?: string;
  tenantDefaultDomain?: string;
  state?: string;
  raw: unknown;
};

export type AzureTenant = {
  tenantId: string;
  displayName?: string;
  defaultDomain?: string;
  domains: string[];
  tenantCategory?: string;
  raw: Record<string, unknown>;
};

export type AzureLighthouseDelegation = {
  subscriptionId?: string;
  manageeTenantId?: string;
  manageeTenantName?: string;
  managedByTenantId?: string;
  managedByTenantName?: string;
  offerName?: string;
};

export type AzureTenantLookupClient = {
  listTenants?: (maxPages?: number) => Promise<AzureTenant[]>;
  listLighthouseDelegations?: (maxPages?: number) => Promise<AzureLighthouseDelegation[]>;
  listLighthouseDelegationsForSubscription?: (
    subscriptionId: string,
    maxPages?: number,
  ) => Promise<AzureLighthouseDelegation[]>;
};

export type AzureCostUsageRow = {
  subscriptionId: string;
  usageDate?: string;
  serviceName?: string;
  resourceId?: string;
  resourceGroup?: string;
  resourceType?: string;
  meterCategory?: string;
  chargeType?: string;
  cost: number;
  usageQuantity: number;
  currency?: string;
  raw: unknown;
};

export type AzureCostReportProgress = {
  phase: 'requesting' | 'waiting' | 'polling' | 'ready' | 'downloading' | 'parsing' | 'complete' | 'no-data';
  message: string;
  pollCount?: number;
  retryAfterMs?: number;
  blobIndex?: number;
  blobCount?: number;
  rowCount?: number;
};

export type AzureCostReportRequest =
  | {
      subscriptionId: string;
      state: 'no-data';
    }
  | {
      subscriptionId: string;
      state: 'pending';
      location: string;
      nextPollAt: number;
      pollCount: number;
    }
  | {
      subscriptionId: string;
      state: 'ready';
      blobs: Array<{ blobLink: string; byteCount?: number }>;
    };

export type AzureAdvisorRecommendation = {
  recommendationId: string;
  category?: string;
  impact?: string;
  impactedResourceId?: string;
  impactedResourceType?: string;
  resourceGroup?: string;
  shortDescription?: string;
  problem?: string;
  solution?: string;
  annualSavings?: number;
  currency?: string;
  raw: Record<string, unknown>;
};

export type AzureResource = {
  id: string;
  name: string;
  type?: string;
  resourceGroup?: string;
  location?: string;
  tags: Record<string, unknown>;
  properties: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type AzureMetricDailyValue = {
  date: string;
  metricName: string;
  average?: number;
  maximum?: number;
  total?: number;
  unit?: string;
  raw: Record<string, unknown>;
};

type AzureTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
};

type AzureCollection<T> = {
  value?: T[];
  nextLink?: string;
};

type CostDetailsOperationResult = {
  name?: string;
  status?: 'Completed' | 'NoDataFound' | 'Failed' | string;
  validTill?: string;
  error?: {
    code?: string;
    message?: string;
  };
  manifest?: {
    blobCount?: number;
    byteCount?: number;
    compressData?: boolean;
    dataFormat?: string;
    manifestVersion?: string;
    blobs?: Array<{
      blobLink?: string;
      byteCount?: number;
    }>;
  };
};

const authorityHost = 'https://login.microsoftonline.com';
const maxRetryCount = 5;
const costManagementMinimumRequestIntervalMs = 1_000;
const costDetailsReportMaxPollCount = 30;
const costManagementClientType = 'MSPHarmonyAzureCostSync';

export type AzureThrottleScope = 'qpu' | 'entity' | 'tenant' | 'client' | 'unknown';

export class AzureApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
    public readonly requestId?: string | null,
    public readonly retryAfterMs?: number,
    public readonly throttleScope?: AzureThrottleScope,
  ) {
    super(message);
  }
}

export class AzureCostManagementClient {
  private readonly baseUrl: string;
  private token?: { accessToken: string; tokenType: string; expiresOn?: number };
  private nextCostManagementRequestAt = 0;

  constructor(private readonly credentials: AzureCredentials) {
    this.baseUrl = normalizeEndpoint(credentials.endpoint);
  }

  async authenticate() {
    if (this.token && !tokenExpiresSoon(this.token)) {
      return this.token;
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: `${this.baseUrl}/.default`,
    });
    const response = await fetch(
      `${authorityHost}/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    const responseText = await response.text();
    const parsed = parseJson<AzureTokenResponse>(responseText);

    if (!response.ok || !parsed?.access_token) {
      throw new AzureApiError(
        parsed?.error_description ?? parsed?.error ?? `Azure token request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 500),
        response.headers.get('request-id'),
      );
    }

    const expiresIn = numberValue(parsed.expires_in);
    this.token = {
      accessToken: parsed.access_token,
      tokenType: parsed.token_type ?? 'Bearer',
      expiresOn: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    };
    return this.token;
  }

  async listSubscriptions(maxPages = 100): Promise<AzureSubscription[]> {
    const subscriptions: AzureSubscription[] = [];
    let nextUrl: string | undefined = '/subscriptions?api-version=2022-12-01';

    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      subscriptions.push(
        ...(response.value ?? [])
          .map(parseSubscription)
          .filter((subscription): subscription is AzureSubscription => Boolean(subscription)),
      );
      nextUrl = response.nextLink;
    }

    return subscriptions;
  }

  async listTenants(maxPages = 100): Promise<AzureTenant[]> {
    const tenants: AzureTenant[] = [];
    let nextUrl: string | undefined = '/tenants?api-version=2022-12-01';

    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      tenants.push(
        ...(response.value ?? [])
          .map(parseTenant)
          .filter((tenant): tenant is AzureTenant => Boolean(tenant)),
      );
      nextUrl = response.nextLink;
    }

    return tenants;
  }

  async listLighthouseDelegations(maxPages = 100): Promise<AzureLighthouseDelegation[]> {
    return this.listLighthouseDelegationPages(
      '/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01&$expandRegistrationDefinition=true',
      maxPages,
    );
  }

  async listLighthouseDelegationsForSubscription(
    subscriptionId: string,
    maxPages = 20,
  ): Promise<AzureLighthouseDelegation[]> {
    return this.listLighthouseDelegationPages(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01&$expandRegistrationDefinition=true`,
      maxPages,
    );
  }

  private async listLighthouseDelegationPages(path: string, maxPages: number) {
    const delegations: AzureLighthouseDelegation[] = [];
    let nextUrl: string | undefined = path;
    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      delegations.push(
        ...(response.value ?? [])
          .map(parseLighthouseDelegation)
          .filter((delegation): delegation is AzureLighthouseDelegation => Boolean(delegation)),
      );
      nextUrl = response.nextLink;
    }
    return delegations;
  }

  async queryCostUsage(input: {
    subscriptionId: string;
    from: string;
    to: string;
    onProgress?: (progress: AzureCostReportProgress) => void | Promise<void>;
  }): Promise<AzureCostUsageRow[]> {
    const request = await this.requestCostUsageReport(input);
    return this.collectCostUsageReport(request, { onProgress: input.onProgress });
  }

  async requestCostUsageReport(input: {
    subscriptionId: string;
    from: string;
    to: string;
    onProgress?: (progress: AzureCostReportProgress) => void | Promise<void>;
  }): Promise<AzureCostReportRequest> {
    // Sync windows use an exclusive `to` boundary. Cost Details uses inclusive
    // calendar dates, so send the day immediately before that boundary. This
    // preserves the checkpoint contract and prevents partial current-day data.
    const start = reportDate(input.from);
    const end = shiftReportDate(reportDate(input.to), -1);
    if (end < start) {
      await input.onProgress?.({ phase: 'no-data', message: 'Azure reported no cost data', rowCount: 0 });
      return { subscriptionId: input.subscriptionId, state: 'no-data' };
    }

    const path =
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}` +
      '/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2025-03-01';
    await input.onProgress?.({
      phase: 'requesting',
      message: 'Requesting the cost details report from Azure',
    });
    await this.waitForCostManagementRequestSlot();
    const response = await this.requestResponse(path, {
      method: 'POST',
      body: JSON.stringify({
        metric: 'ActualCost',
        timePeriod: { start, end },
      }),
      headers: {
        ClientType: costManagementClientType,
        'Content-Type': 'application/json',
      },
    });
    return this.readCostUsageReportResponse(response, input.subscriptionId, 0, input.onProgress);
  }

  async collectCostUsageReport(
    initialRequest: AzureCostReportRequest,
    input: { onProgress?: (progress: AzureCostReportProgress) => void | Promise<void> } = {},
  ): Promise<AzureCostUsageRow[]> {
    let request = initialRequest;
    while (request.state === 'pending') {
      await delay(Math.max(0, request.nextPollAt - Date.now()));
      const pollCount = request.pollCount + 1;
      await input.onProgress?.({
        phase: 'polling',
        message: `Checking Azure report status · attempt ${pollCount}`,
        pollCount,
      });
      await this.waitForCostManagementRequestSlot();
      const response = await this.requestResponse(request.location, {
        headers: { ClientType: costManagementClientType },
      });
      request = await this.readCostUsageReportResponse(
        response,
        request.subscriptionId,
        pollCount,
        input.onProgress,
      );
    }

    if (request.state === 'no-data') return [];
    const rows: AzureCostUsageRow[] = [];
    for (const [blobIndex, blob] of request.blobs.entries()) {
      await input.onProgress?.({
        phase: 'downloading',
        message: `Downloading cost CSV ${blobIndex + 1} of ${request.blobs.length}`,
        blobIndex: blobIndex + 1,
        blobCount: request.blobs.length,
      });
      const csv = await this.downloadCostDetailsBlob(blob.blobLink);
      await input.onProgress?.({
        phase: 'parsing',
        message: `Reading cost CSV ${blobIndex + 1} of ${request.blobs.length}`,
        blobIndex: blobIndex + 1,
        blobCount: request.blobs.length,
      });
      rows.push(...parseCostDetailsCsv(request.subscriptionId, csv));
    }
    await input.onProgress?.({
      phase: 'complete',
      message: `Cost report loaded · ${rows.length.toLocaleString('en-US')} rows`,
      rowCount: rows.length,
      blobCount: request.blobs.length,
    });
    return rows;
  }

  private async readCostUsageReportResponse(
    response: Response,
    subscriptionId: string,
    pollCount: number,
    onProgress?: (progress: AzureCostReportProgress) => void | Promise<void>,
  ): Promise<AzureCostReportRequest> {
    if (response.status === 204) {
      await onProgress?.({ phase: 'no-data', message: 'Azure reported no cost data', rowCount: 0 });
      return { subscriptionId, state: 'no-data' };
    }
    if (response.status === 200) {
      const result = await parseResponseJson<CostDetailsOperationResult>(response);
      if (result.status === 'NoDataFound') {
        await onProgress?.({ phase: 'no-data', message: 'Azure reported no cost data', rowCount: 0 });
        return { subscriptionId, state: 'no-data' };
      }
      if (result.status === 'Failed') {
        throw new Error(
          result.error?.message ?? result.error?.code ?? 'Azure Cost Details report generation failed.',
        );
      }
      if (result.status && result.status !== 'Completed') {
        throw new Error(`Azure Cost Details report returned unexpected status "${result.status}".`);
      }
      if (result.manifest?.dataFormat && result.manifest.dataFormat.toLowerCase() !== 'csv') {
        throw new Error(`Azure Cost Details report returned unsupported format "${result.manifest.dataFormat}".`);
      }
      if (!result.manifest) {
        throw new Error('Azure Cost Details report completed without a manifest.');
      }
      const blobs = result.manifest.blobs?.filter(
        (blob): blob is { blobLink: string; byteCount?: number } => Boolean(blob.blobLink),
      ) ?? [];
      if (blobs.length === 0) {
        throw new Error('Azure Cost Details report completed without a downloadable CSV blob.');
      }
      await onProgress?.({
        phase: 'ready',
        message: `Azure report ready · ${blobs.length} CSV ${blobs.length === 1 ? 'file' : 'files'}`,
        blobCount: blobs.length,
      });
      return { subscriptionId, state: 'ready', blobs };
    }
    if (response.status !== 202) {
      throw new Error(`Azure Cost Details report returned unexpected HTTP ${response.status}.`);
    }
    if (pollCount >= costDetailsReportMaxPollCount) {
      throw new Error('Azure Cost Details report did not finish before the polling limit.');
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('Azure Cost Details report returned HTTP 202 without a Location header.');
    assertArmOperationUrl(location, this.baseUrl);
    const retryAfterMs = costDetailsPollDelayMs(response);
    await onProgress?.({
      phase: 'waiting',
      message: `Azure is generating the report · checking again in ${formatWaitDuration(retryAfterMs)}`,
      pollCount: pollCount + 1,
      retryAfterMs,
    });
    return {
      subscriptionId,
      state: 'pending',
      location,
      nextPollAt: Date.now() + retryAfterMs,
      pollCount,
    };
  }

  private async downloadCostDetailsBlob(blobLink: string, retryCount = 0): Promise<string> {
    const url = new URL(blobLink);
    if (url.protocol !== 'https:') throw new Error('Azure Cost Details report returned a non-HTTPS blob URL.');
    const response = await fetch(url);
    if (shouldRetry(response.status) && retryCount < maxRetryCount) {
      await delay(retryDelayMs(response, retryCount));
      return this.downloadCostDetailsBlob(blobLink, retryCount + 1);
    }
    if (!response.ok) {
      const responseText = await response.text();
      throw new AzureApiError(
        `Azure Cost Details CSV download failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 1_000),
        response.headers.get('request-id') ?? response.headers.get('x-ms-request-id'),
      );
    }
    const input = Buffer.from(await response.arrayBuffer());
    const bytes = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
    return bytes.toString('utf8');
  }

  private async waitForCostManagementRequestSlot() {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextCostManagementRequestAt - now);
    this.nextCostManagementRequestAt = Math.max(now, this.nextCostManagementRequestAt) +
      costManagementMinimumRequestIntervalMs;
    if (waitMs > 0) {
      await delay(waitMs);
    }
  }

  async listAdvisorRecommendations(subscriptionId: string, maxPages = 100): Promise<AzureAdvisorRecommendation[]> {
    const recommendations: AzureAdvisorRecommendation[] = [];
    let nextUrl: string | undefined =
      `/subscriptions/${encodeURIComponent(subscriptionId)}` +
      "/providers/Microsoft.Advisor/recommendations?api-version=2025-01-01";
    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      recommendations.push(
        ...(response.value ?? [])
          .map(parseAdvisorRecommendation)
          .filter((item): item is AzureAdvisorRecommendation => Boolean(item)),
      );
      nextUrl = response.nextLink;
    }
    return recommendations;
  }

  async listResources(subscriptionId: string, maxPages = 100): Promise<AzureResource[]> {
    const resources: AzureResource[] = [];
    let nextUrl: string | undefined =
      `/subscriptions/${encodeURIComponent(subscriptionId)}/resources?api-version=2021-04-01`;
    for (let page = 0; nextUrl && page < Math.max(1, maxPages); page += 1) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      resources.push(
        ...(response.value ?? [])
          .map(parseResource)
          .filter((resource): resource is AzureResource => Boolean(resource)),
      );
      nextUrl = response.nextLink;
    }
    return resources;
  }

  async getVmInstanceView(resourceId: string) {
    return this.request<Record<string, unknown>>(`${resourceId}/instanceView?api-version=2024-07-01`);
  }

  async queryDailyMetrics(input: {
    resourceId: string;
    metricNames: string[];
    from: string;
    to: string;
  }): Promise<AzureMetricDailyValue[]> {
    const query = new URLSearchParams({
      'api-version': '2018-01-01',
      metricnames: input.metricNames.join(','),
      timespan: `${input.from}/${input.to}`,
      interval: 'P1D',
      aggregation: 'Average,Maximum,Total',
    });
    const response = await this.request<AzureCollection<Record<string, unknown>>>(
      `${input.resourceId}/providers/microsoft.insights/metrics?${query.toString()}`,
    );
    return (response.value ?? []).flatMap((metric) => {
      const metricName = stringValue(recordValue(metric.name).value ?? recordValue(metric.name).localizedValue) ?? 'metric';
      const unit = stringValue(metric.unit);
      return arrayValue(metric.timeseries).flatMap((series) =>
        arrayValue(recordValue(series).data).flatMap((point) => {
          const row = recordValue(point);
          const timestamp = stringValue(row.timeStamp ?? row.timestamp);
          if (!timestamp) return [];
          return [{
            date: timestamp.slice(0, 10),
            metricName,
            average: numberValue(row.average),
            maximum: numberValue(row.maximum),
            total: numberValue(row.total),
            unit,
            raw: row,
          } satisfies AzureMetricDailyValue];
        }),
      );
    });
  }

  async getAvdActivity(hostPoolResourceId: string) {
    const hosts = await this.listAzureCollection(
      `${hostPoolResourceId}/sessionHosts?api-version=2024-04-03`,
    );
    let activeSessions = 0;
    let disconnectedSessions = 0;
    const sessionHosts: Record<string, unknown>[] = [];
    for (const host of hosts) {
      const hostId = stringValue(host.id);
      const sessions = hostId
        ? await this.listAzureCollection(`${hostId}/userSessions?api-version=2024-04-03`)
        : [];
      for (const session of sessions) {
        const state = String(recordValue(session.properties).sessionState ?? '').toLowerCase();
        if (state === 'active') activeSessions += 1;
        else disconnectedSessions += 1;
      }
      sessionHosts.push({ ...host, userSessions: sessions });
    }
    return { activeSessions, disconnectedSessions, sessionHosts };
  }

  private async listAzureCollection(pathOrUrl: string) {
    const values: Record<string, unknown>[] = [];
    let nextUrl: string | undefined = pathOrUrl;
    while (nextUrl) {
      const response: AzureCollection<Record<string, unknown>> = await this.request(nextUrl);
      values.push(...(response.value ?? []));
      nextUrl = response.nextLink;
    }
    return values;
  }

  private async request<T>(
    pathOrUrl: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      retryCount?: number;
    } = {},
  ): Promise<T> {
    const response = await this.requestResponse(pathOrUrl, options);
    const responseText = await response.text();
    return (responseText.trim() ? parseJson<unknown>(responseText) : undefined) as T;
  }

  private async requestResponse(
    pathOrUrl: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      retryCount?: number;
    } = {},
  ): Promise<Response> {
    const token = await this.authenticate();
    const requestId = randomUUID();
    const response = await fetch(absoluteUrl(pathOrUrl, this.baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `${token.tokenType} ${token.accessToken}`,
        'client-request-id': requestId,
        ...(options.headers ?? {}),
      },
      body: options.body,
    });

    if (shouldRetry(response.status) && (options.retryCount ?? 0) < maxRetryCount) {
      await delay(retryDelayMs(response, options.retryCount ?? 0));
      return this.requestResponse(pathOrUrl, {
        ...options,
        retryCount: (options.retryCount ?? 0) + 1,
      });
    }

    if (!response.ok) {
      const responseText = await response.text();
      const parsed = responseText.trim() ? parseJson<unknown>(responseText) : undefined;
      if (response.status === 401) {
        this.token = undefined;
      }
      const error = recordValue(recordValue(parsed).error ?? parsed);
      throw new AzureApiError(
        stringValue(error.message) ?? stringValue(error.code) ?? `Azure request failed with HTTP ${response.status}.`,
        response.status,
        responseText.slice(0, 1000),
        response.headers.get('request-id') ?? requestId,
        response.status === 429 ? retryDelayMs(response, options.retryCount ?? 0) : undefined,
        response.status === 429 ? throttleScope(response) : undefined,
      );
    }

    return response;
  }
}

export function azureCredentialsFromSettings(settings: IntegrationRuntimeSettings): AzureCredentials {
  return {
    endpoint: requiredValue(settings.nonSecrets.endpoint, 'AZURE_ENDPOINT'),
    tenantId: requiredValue(settings.nonSecrets.tenantId, 'AZURE_TENANT_ID'),
    clientId: requiredValue(settings.nonSecrets.clientId, 'AZURE_CLIENT_ID'),
    clientSecret: requiredValue(settings.secrets.clientSecret, 'mspharmony-azure-client-secret'),
  };
}

export function azureSubscriptionAllowlist(settings: IntegrationRuntimeSettings) {
  return String(settings.nonSecrets.subscriptionIds ?? settings.nonSecrets.subscriptionId ?? '')
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function discoverDelegatedAzureTenants(
  client: AzureTenantLookupClient,
  subscriptions: AzureSubscription[] = [],
) {
  const tenantsById = new Map<string, AzureTenant>();
  const warnings: string[] = [];
  const directoryTask = client.listTenants
    ? client.listTenants(100).catch((error: unknown) => {
      warnings.push(`Tenant names could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
      return [] as AzureTenant[];
    })
    : Promise.resolve([] as AzureTenant[]);
  const lighthouseTask = client.listLighthouseDelegations
    ? client.listLighthouseDelegations(100).catch((error: unknown) => {
      warnings.push(`Lighthouse tenant names could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
      return [] as AzureLighthouseDelegation[];
    })
    : Promise.resolve([] as AzureLighthouseDelegation[]);
  const [directoryTenants, lighthouseDelegations] = await Promise.all([directoryTask, lighthouseTask]);
  for (const tenant of directoryTenants) mergeAzureTenant(tenantsById, tenant);
  for (const delegation of lighthouseDelegations) {
    mergeAzureTenant(tenantsById, tenantFromLighthouseDelegation(delegation));
  }

  const missingTenantIds = uniqueMissingTenantIds(subscriptions, tenantsById);
  if (missingTenantIds.length > 0 && client.listLighthouseDelegationsForSubscription) {
    const subscriptionByTenant = new Map<string, string>();
    for (const subscription of subscriptions) {
      const tenantId = subscription.tenantId?.toLowerCase();
      if (tenantId && missingTenantIds.includes(tenantId) && !subscriptionByTenant.has(tenantId)) {
        subscriptionByTenant.set(tenantId, subscription.subscriptionId);
      }
    }
    const results = await Promise.allSettled(
      [...subscriptionByTenant.values()].map((subscriptionId) =>
        client.listLighthouseDelegationsForSubscription?.(subscriptionId, 20) ?? Promise.resolve([]),
      ),
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const delegation of result.value) {
        mergeAzureTenant(tenantsById, tenantFromLighthouseDelegation(delegation));
      }
    }
  }

  const stillMissing = uniqueMissingTenantIds(subscriptions, tenantsById);
  return {
    tenantsById,
    warning: stillMissing.length > 0 || subscriptions.length === 0 ? warnings[0] : undefined,
  };
}

export function enrichSubscriptionsWithTenants(
  subscriptions: AzureSubscription[],
  tenantsById: Map<string, AzureTenant>,
) {
  return subscriptions.map((subscription) => {
    const tenant = subscription.tenantId ? tenantsById.get(subscription.tenantId.toLowerCase()) : undefined;
    return {
      ...subscription,
      tenantName: readableAzureTenantName(tenant?.displayName, subscription.tenantId) ?? readableAzureTenantName(subscription.tenantName, subscription.tenantId),
      tenantDefaultDomain: tenant?.defaultDomain ?? subscription.tenantDefaultDomain,
    };
  });
}

function parseSubscription(record: Record<string, unknown>): AzureSubscription | undefined {
  const subscriptionId = stringValue(record.subscriptionId);
  if (!subscriptionId) return undefined;
  return {
    subscriptionId,
    displayName: stringValue(record.displayName),
    tenantId: stringValue(record.tenantId),
    state: stringValue(record.state),
    raw: record,
  };
}

function parseResource(record: Record<string, unknown>): AzureResource | undefined {
  const id = stringValue(record.id);
  const name = stringValue(record.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    type: stringValue(record.type),
    resourceGroup: resourceGroupFromId(id),
    location: stringValue(record.location),
    tags: recordValue(record.tags),
    properties: recordValue(record.properties),
    raw: record,
  };
}

function parseTenant(record: Record<string, unknown>): AzureTenant | undefined {
  const idParts = stringValue(record.id)?.split('/').filter(Boolean) ?? [];
  const tenantId = stringValue(record.tenantId) ?? idParts[idParts.length - 1];
  if (!tenantId) return undefined;
  return {
    tenantId,
    displayName: readableAzureTenantName(stringValue(record.displayName), tenantId),
    defaultDomain: stringValue(record.defaultDomain),
    domains: Array.isArray(record.domains)
      ? record.domains.map(stringValue).filter((domain): domain is string => Boolean(domain))
      : [],
    tenantCategory: stringValue(record.tenantCategory),
    raw: record,
  };
}

function parseLighthouseDelegation(record: Record<string, unknown>): AzureLighthouseDelegation | undefined {
  const properties = recordValue(record.properties);
  const definition = recordValue(properties.registrationDefinition);
  const definitionProperties = recordValue(definition.properties);
  const id = stringValue(record.id) ?? stringValue(definition.id) ?? '';
  const subscriptionId = id.match(/\/subscriptions\/([^/]+)/i)?.[1];
  const manageeTenantId =
    stringValue(definitionProperties.manageeTenantId) ??
    stringValue(properties.manageeTenantId);
  const manageeTenantName = readableAzureTenantName(
    stringValue(definitionProperties.manageeTenantName) ?? stringValue(properties.manageeTenantName),
    manageeTenantId,
  );
  const managedByTenantId =
    stringValue(definitionProperties.managedByTenantId) ??
    stringValue(properties.managedByTenantId);
  if (!subscriptionId && !manageeTenantId) return undefined;
  return {
    subscriptionId,
    manageeTenantId,
    manageeTenantName,
    managedByTenantId,
    managedByTenantName: readableAzureTenantName(
      stringValue(definitionProperties.managedByTenantName) ?? stringValue(properties.managedByTenantName),
      managedByTenantId,
    ),
    offerName:
      stringValue(definitionProperties.registrationDefinitionName) ??
      stringValue(definitionProperties.description),
  };
}

function tenantFromLighthouseDelegation(delegation: AzureLighthouseDelegation): AzureTenant | undefined {
  if (!delegation.manageeTenantId) return undefined;
  return {
    tenantId: delegation.manageeTenantId,
    displayName: delegation.manageeTenantName,
    defaultDomain: undefined,
    domains: [],
    raw: { source: 'azure-lighthouse', ...delegation },
  };
}

function mergeAzureTenant(tenantsById: Map<string, AzureTenant>, tenant: AzureTenant | undefined) {
  if (!tenant?.tenantId) return;
  const key = tenant.tenantId.toLowerCase();
  const existing = tenantsById.get(key);
  if (!existing) {
    tenantsById.set(key, tenant);
    return;
  }
  tenantsById.set(key, {
    ...existing,
    displayName: existing.displayName ?? tenant.displayName,
    defaultDomain: existing.defaultDomain ?? tenant.defaultDomain,
    domains: existing.domains.length > 0 ? existing.domains : tenant.domains,
    tenantCategory: existing.tenantCategory ?? tenant.tenantCategory,
  });
}

function uniqueMissingTenantIds(subscriptions: AzureSubscription[], tenantsById: Map<string, AzureTenant>) {
  return [...new Set(
    subscriptions
      .map((subscription) => subscription.tenantId?.toLowerCase())
      .filter((tenantId): tenantId is string => {
        if (!tenantId) return false;
        return !tenantsById.get(tenantId)?.displayName;
      }),
  )];
}

function readableAzureTenantName(name: string | undefined, tenantId?: string) {
  if (!name) return undefined;
  if (tenantId && name.toLowerCase() === tenantId.toLowerCase()) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return undefined;
  return name;
}

function parseCostDetailsCsv(subscriptionId: string, csv: string): AzureCostUsageRow[] {
  const records = parseCsvRecords(csv);
  const columns = (records[0] ?? []).map((column, index) =>
    (index === 0 ? column.replace(/^\uFEFF/, '') : column).trim(),
  );
  const dataRows = records.slice(1).filter((row) => row.some((value) => value.trim().length > 0));
  if (columns.length === 0 || dataRows.length === 0) return [];
  const names = columns.map((column) => column.toLowerCase());
  const indexOf = (...candidates: string[]) =>
    candidates.map((candidate) => names.indexOf(candidate.toLowerCase())).find((index) => index >= 0) ?? -1;
  const costIndex = indexOf('PreTaxCost', 'CostInBillingCurrency', 'Cost', 'totalCost');
  const quantityIndex = indexOf('UsageQuantity', 'Quantity', 'ConsumedQuantity', 'totalUsage');
  if (costIndex < 0 || quantityIndex < 0) {
    const missing = [
      costIndex < 0 ? 'cost (PreTaxCost or CostInBillingCurrency)' : '',
      quantityIndex < 0 ? 'quantity (UsageQuantity or Quantity)' : '',
    ].filter(Boolean);
    throw new Error(`Azure Cost Details CSV omitted required ${missing.join(' and ')} columns.`);
  }

  return dataRows.map((row) => {
    const value = (...candidates: string[]) => {
      const index = indexOf(...candidates);
      return index >= 0 ? row[index] : undefined;
    };
    const resourceId = stringValue(value('ResourceId', 'InstanceId', 'InstanceName'));
    return {
      subscriptionId,
      usageDate: usageDateValue(value('UsageDate', 'UsageDateTime', 'Date')),
      serviceName:
        stringValue(value('ServiceName', 'ProductName', 'Product', 'ServiceFamily', 'ConsumedService')),
      resourceId,
      resourceGroup:
        stringValue(value('ResourceGroup', 'ResourceGroupName')) ?? resourceGroupFromId(resourceId),
      resourceType: stringValue(value('ResourceType', 'ConsumedService')),
      meterCategory: stringValue(value('MeterCategory')),
      chargeType: stringValue(value('ChargeType')),
      cost: numberValue(row[costIndex]) ?? 0,
      usageQuantity: numberValue(row[quantityIndex]) ?? 0,
      currency: stringValue(value('BillingCurrency', 'BillingCurrencyCode', 'Currency', 'PricingCurrency')),
      raw: Object.fromEntries(columns.map((column, index) => [column || `column${index}`, row[index] ?? ''])),
    };
  });
}

function parseCsvRecords(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function parseAdvisorRecommendation(record: Record<string, unknown>): AzureAdvisorRecommendation | undefined {
  const properties = recordValue(record.properties);
  const shortDescription = recordValue(properties.shortDescription);
  const extended = recordValue(properties.extendedProperties);
  const impactedResourceId = stringValue(
    properties.resourceMetadataResourceId ??
    extended.resourceId ??
    (String(properties.impactedField ?? '').toLowerCase() === 'microsoft.compute/virtualmachines'
      ? properties.impactedValue
      : undefined),
  );
  const recommendationId = stringValue(record.id) ?? stringValue(record.name);
  if (!recommendationId) return undefined;
  return {
    recommendationId,
    category: stringValue(properties.category),
    impact: stringValue(properties.impact),
    impactedResourceId,
    impactedResourceType: stringValue(properties.impactedField),
    resourceGroup: stringValue(properties.resourceGroup) ?? resourceGroupFromId(impactedResourceId),
    shortDescription: stringValue(shortDescription.solution) ?? stringValue(shortDescription.problem),
    problem: stringValue(shortDescription.problem),
    solution: stringValue(shortDescription.solution),
    annualSavings:
      numberValue(extended.annualSavingsAmount) ??
      numberValue(extended.annualSavings) ??
      numberValue(extended.savingsAmount),
    currency: stringValue(extended.currency) ?? stringValue(extended.savingsCurrency),
    raw: record,
  };
}

function usageDateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return undefined;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  const usDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if (usDate) {
    return `${usDate[3]}-${usDate[1]?.padStart(2, '0')}-${usDate[2]?.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function reportDate(value: string) {
  const direct = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Azure cost report date "${value}".`);
  return parsed.toISOString().slice(0, 10);
}

function shiftReportDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resourceGroupFromId(resourceId?: string) {
  if (!resourceId) return undefined;
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
  return match?.[1];
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

function absoluteUrl(pathOrUrl: string, baseUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function assertArmOperationUrl(value: string, baseUrl: string) {
  const operation = new URL(value);
  const base = new URL(baseUrl);
  if (operation.protocol !== 'https:' || operation.origin.toLowerCase() !== base.origin.toLowerCase()) {
    throw new Error('Azure Cost Details report returned an unexpected operation URL.');
  }
}

function shouldRetry(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: Response, retryCount: number) {
  const serviceRetrySeconds = [
    'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after',
    'x-ms-ratelimit-microsoft.costmanagement-entity-retry-after',
    'x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after',
    'x-ms-ratelimit-microsoft.costmanagement-client-retry-after',
  ]
    .map((header) => numericHeader(response, header))
    .filter((value): value is number => value !== undefined)
    .map((seconds) => seconds * 1_000);
  const retryAfterMs = numericHeader(response, 'retry-after-ms');
  const retryAfter = retryAfterDelayMs(response.headers.get('retry-after'));
  const serverDelays = [
    ...serviceRetrySeconds,
    retryAfterMs,
    retryAfter,
  ].filter((value): value is number => value !== undefined);

  if (serverDelays.length > 0) {
    return Math.max(...serverDelays);
  }

  // Cost Management's shortest documented quota window is ten seconds. A
  // longer fallback keeps headerless 429 responses from exhausting every
  // retry inside the same throttling window.
  return response.status === 429
    ? Math.min(60_000, 2_000 * 2 ** retryCount)
    : Math.min(30_000, 500 * 2 ** retryCount);
}

function throttleScope(response: Response): AzureThrottleScope {
  if (response.headers.has('x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after')) return 'qpu';
  if (response.headers.has('x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after')) return 'tenant';
  if (response.headers.has('x-ms-ratelimit-microsoft.costmanagement-client-retry-after')) return 'client';
  if (response.headers.has('x-ms-ratelimit-microsoft.costmanagement-entity-retry-after')) return 'entity';
  return 'unknown';
}

function numericHeader(response: Response, header: string) {
  const raw = response.headers.get(header);
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function retryAfterDelayMs(value: string | null) {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

function costDetailsPollDelayMs(response: Response) {
  return Math.min(60_000, retryAfterDelayMs(response.headers.get('retry-after')) ?? 10_000);
}

function formatWaitDuration(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1_000);
  if (seconds <= 0) return 'a moment';
  if (seconds < 60) return `${seconds} seconds`;
  return '1 minute';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function parseResponseJson<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  const parsed = responseText.trim() ? parseJson<T>(responseText) : undefined;
  if (!parsed) throw new Error('Azure Cost Details report returned an invalid JSON response.');
  return parsed;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function tokenExpiresSoon(token: { expiresOn?: number }) {
  return typeof token.expiresOn === 'number' && token.expiresOn - Math.floor(Date.now() / 1000) < 300;
}

function requiredValue(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`Missing Azure - Lighthouse setting: ${name}.`);
  return value.trim();
}
