import type { IntegrationId } from '../../shared/integrationSettings';

export type IntegrationSyncRequest = {
  operationKey?: string;
  pageSize?: number;
  maxPages?: number;
  subscriptionPageSize?: number;
  subscriptionMaxPages?: number;
  seatPageSize?: number;
  seatMaxPages?: number;
  includeBcdr?: boolean;
  dataset?: 'users' | 'licenses';
};

export type SyncableIntegrationId = Extract<
  IntegrationId,
  | 'connectwise'
  | 'cove'
  | 'ncentral'
  | 'cavelo'
  | 'datto'
  | 'opentext-appriver'
  | 'microsoft-365'
  | 'sentinelone'
  | 'proofpoint'
  | 'huntress'
  | 'microsoft-azure'
  | 'ingram-micro'
  | 'nerdio'
>;

export type IntegrationSyncQueueMessage = IntegrationSyncRequest & {
  jobId: string;
  integrationId: SyncableIntegrationId;
  requestedBy: string;
  requestedAt: string;
};

export function buildIntegrationSyncQueueMessage(
  integrationId: SyncableIntegrationId,
  body: IntegrationSyncRequest,
  requestedBy: string,
  requestedAt: string,
): Omit<IntegrationSyncQueueMessage, 'jobId'> {
  if (integrationId === 'connectwise') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 100),
      maxPages: safePositiveInteger(body.maxPages, 50),
    };
  }

  if (integrationId === 'cove') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 10000),
      maxPages: safePositiveInteger(body.maxPages, 1),
    };
  }

  if (integrationId === 'ncentral') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 500),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'datto') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      ...(body.operationKey ? { operationKey: body.operationKey } : {}),
      pageSize: safePositiveInteger(body.pageSize, 100),
      maxPages: safePositiveInteger(body.maxPages, 100),
      seatPageSize: safePositiveInteger(body.seatPageSize, 500),
      seatMaxPages: safePositiveInteger(body.seatMaxPages, 100),
      includeBcdr: body.includeBcdr !== false,
    };
  }

  if (integrationId === 'opentext-appriver') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 1000),
      maxPages: safePositiveInteger(body.maxPages, 100),
      subscriptionPageSize: safePositiveInteger(body.subscriptionPageSize, 100),
      subscriptionMaxPages: safePositiveInteger(body.subscriptionMaxPages, 25),
    };
  }

  if (integrationId === 'sentinelone') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 1000),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'proofpoint') {
    return { integrationId, requestedBy, requestedAt };
  }

  if (integrationId === 'cavelo') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 100),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'huntress') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      pageSize: safePositiveInteger(body.pageSize, 500),
      maxPages: safePositiveInteger(body.maxPages, 100),
    };
  }

  if (integrationId === 'ingram-micro' || integrationId === 'nerdio' || integrationId === 'microsoft-azure') {
    return {
      integrationId,
      requestedBy,
      requestedAt,
      ...(body.operationKey ? { operationKey: body.operationKey } : {}),
    };
  }

  return {
    integrationId,
    requestedBy,
    requestedAt,
    ...(body.operationKey ? { operationKey: body.operationKey } : {}),
    dataset: body.dataset ?? 'users',
    pageSize: safePositiveInteger(body.pageSize, 100),
    maxPages: safePositiveInteger(body.maxPages, 100),
  };
}

function safePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
