import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { Pool } from 'pg';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import { getDatabaseSettings } from '../database/config';
import { getSharedDatabasePool } from '../database/pool';

export type OptionalPostgresSettingsRepository = {
  missingDatabaseSettings: string[];
  pool?: Pool;
  repository?: PostgresIntegrationSettingsRepository;
  close: () => Promise<void>;
};

export async function createOptionalPostgresSettingsRepository(): Promise<OptionalPostgresSettingsRepository> {
  const settings = getDatabaseSettings();

  if (settings.missing.length > 0) {
    return {
      missingDatabaseSettings: settings.missing,
      close: async () => {},
    };
  }

  const pool = await getSharedDatabasePool();

  return {
    missingDatabaseSettings: [],
    pool,
    repository: new PostgresIntegrationSettingsRepository(pool),
    close: async () => {},
  };
}

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: sanitizeServerResponse(status, body),
  };
}

export type JsonBodyLimit = 'default' | 'import';

export type ReadJsonBodyOptions<T> = {
  limit?: JsonBodyLimit;
  maxBytes?: number;
  fallback?: T;
};

export type ReadJsonBodyResult<T> =
  | {
      ok: true;
      body: T;
    }
  | {
      ok: false;
      response: HttpResponseInit;
    };

class RequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export async function readJsonBody<T>(
  request: HttpRequest,
  options: ReadJsonBodyOptions<T> = {},
): Promise<ReadJsonBodyResult<T>> {
  try {
    const body = await parseJsonBody<T>(request, options);
    return {
      ok: true,
      body,
    };
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return {
        ok: false,
        response: jsonResponse(error.status, {
          error: error.message,
          code: error.code,
        }),
      };
    }

    return {
      ok: false,
      response: jsonResponse(400, {
        error: 'Request body must be valid JSON.',
        code: 'invalid_json',
      }),
    };
  }
}

export function requireMutatingRequestOrigin(request: HttpRequest): HttpResponseInit | undefined {
  if (isSafeHttpMethod(request.method)) {
    return undefined;
  }

  const allowedOrigins = getAllowedOrigins(request);
  const origin = normalizedOrigin(request.headers.get('origin'));
  const refererOrigin = normalizedOrigin(request.headers.get('referer'));
  const candidate = origin ?? refererOrigin;

  if (!candidate || !allowedOrigins.has(candidate)) {
    return jsonResponse(403, {
      error: 'This request did not come from an allowed MSP Harmony origin.',
      code: 'invalid_origin',
    });
  }

  return undefined;
}

export function serverErrorResponse(
  context: InvocationContext,
  error: unknown,
  fallback: string,
  code = 'internal_error',
): HttpResponseInit {
  logUnhandledError(context, error, fallback);

  return jsonResponse(500, {
    error: fallback,
    code,
    requestId: context.invocationId,
  });
}

export function logUnhandledError(context: InvocationContext | undefined, error: unknown, message: string) {
  const logger = context?.error ?? context?.log;
  if (typeof logger === 'function') {
    logger.call(context, message, error);
  }
}

async function parseJsonBody<T>(request: HttpRequest, options: ReadJsonBodyOptions<T>): Promise<T> {
  const maxBytes = options.maxBytes ?? configuredBodyLimit(options.limit ?? 'default');
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestValidationError(413, 'request_too_large', 'Request body is too large.');
  }

  const textReader = (request as unknown as { text?: () => Promise<string> }).text;
  if (typeof textReader === 'function') {
    const rawBody = await textReader.call(request);
    const actualBytes = Buffer.byteLength(rawBody, 'utf8');
    if (actualBytes > maxBytes) {
      throw new RequestValidationError(413, 'request_too_large', 'Request body is too large.');
    }

    if (!rawBody.trim()) {
      return fallbackJsonBody(options);
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch {
      throw new RequestValidationError(400, 'invalid_json', 'Request body must be valid JSON.');
    }
  }

  const jsonReader = (request as unknown as { json?: () => Promise<unknown> }).json;
  if (typeof jsonReader === 'function') {
    const parsed = await jsonReader.call(request);
    return (parsed ?? fallbackJsonBody(options)) as T;
  }

  return fallbackJsonBody(options);
}

function fallbackJsonBody<T>(options: ReadJsonBodyOptions<T>) {
  if ('fallback' in options) {
    return options.fallback as T;
  }

  throw new RequestValidationError(400, 'invalid_json', 'Request body must be valid JSON.');
}

function configuredBodyLimit(limit: JsonBodyLimit) {
  const envKey = limit === 'import' ? 'MAX_IMPORT_BODY_BYTES' : 'MAX_JSON_BODY_BYTES';
  const fallback = limit === 'import' ? 10 * 1024 * 1024 : 256 * 1024;
  const configured = Number.parseInt(process.env[envKey] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function getAllowedOrigins(request: HttpRequest) {
  const origins = new Set<string>();
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => normalizedOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  for (const origin of configured) {
    origins.add(origin);
  }

  for (const origin of defaultAllowedOrigins()) {
    origins.add(origin);
  }

  const requestOrigin = normalizedOrigin(request.url);
  if (requestOrigin) {
    origins.add(requestOrigin);
  }

  return origins;
}

function defaultAllowedOrigins() {
  return [
    'https://wonderful-bay-0fe59020f.7.azurestaticapps.net',
    'http://localhost:4280',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ];
}

function normalizedOrigin(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value.trim());
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function isSafeHttpMethod(method: string | undefined) {
  return !method || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function sanitizeServerResponse(status: number, body: unknown) {
  if (status < 500 || !isAzureRuntime() || !hasErrorBody(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  const sanitized: { error: string; code: string; requestId?: string } = {
    error: 'An internal server error occurred.',
    code: typeof record.code === 'string' ? record.code : 'internal_error',
  };
  if (typeof record.requestId === 'string') {
    sanitized.requestId = record.requestId;
  }
  return sanitized;
}

function hasErrorBody(body: unknown): body is { error: unknown } {
  return typeof body === 'object' && body !== null && 'error' in body;
}

function isAzureRuntime() {
  return Boolean(process.env.WEBSITE_SITE_NAME || process.env.FUNCTIONS_EXTENSION_VERSION);
}
