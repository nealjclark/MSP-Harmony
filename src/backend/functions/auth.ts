import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { Pool } from 'pg';
import { getDatabaseSettings } from '../database/config';
import { getSharedDatabasePool } from '../database/pool';

export type AppRole = 'Admin' | 'Approver' | 'LicenseAdmin' | 'Analyst';

export type AuthPrincipal = {
  appUserId?: string;
  id?: string;
  email?: string;
  name: string;
  roles: AppRole[];
};

type StaticWebAppsPrincipal = {
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
};

const roleRank: Record<AppRole, number> = {
  Analyst: 1,
  LicenseAdmin: 1,
  Approver: 2,
  Admin: 3,
};

const appRoles: AppRole[] = ['Admin', 'Approver', 'LicenseAdmin', 'Analyst'];
let authPool: Pool | undefined;
let authPoolPromise: Promise<Pool> | undefined;

export async function requireRole(
  request: HttpRequest,
  minimumRole: AppRole,
): Promise<{ principal: AuthPrincipal; response?: undefined } | { principal?: undefined; response: HttpResponseInit }> {
  const headerPrincipal = readAuthPrincipal(request);

  if (!headerPrincipal) {
    return {
      response: authJsonResponse(401, {
        error: 'Authentication is required.',
      }),
    };
  }

  const principal = await resolveApplicationPrincipal(headerPrincipal);

  if (!hasMinimumRole(principal, minimumRole)) {
    return {
      response: authJsonResponse(403, {
        error: `The ${minimumRole} role is required for this action.`,
        user: {
          email: principal.email,
          name: principal.name,
        },
      }),
    };
  }

  return { principal };
}

export type AuthSessionState = 'authorized' | 'pending' | 'database-unavailable';

export type AuthSession = {
  state: AuthSessionState;
  principal: AuthPrincipal;
  message?: string;
};

export async function getAuthSession(request: HttpRequest): Promise<AuthSession | undefined> {
  const headerPrincipal = readAuthPrincipal(request);

  if (!headerPrincipal) {
    return undefined;
  }

  try {
    const principal = await resolveApplicationPrincipal(headerPrincipal);

    if (principal.roles.length > 0) {
      return {
        state: 'authorized',
        principal,
      };
    }

    return {
      state: 'pending',
      principal,
      message: 'Your Microsoft sign-in succeeded. Waiting for application access to be assigned in MSP Harmony.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify application access.';
    return {
      state: 'database-unavailable',
      principal: headerPrincipal,
      message,
    };
  }
}

export function readAuthPrincipal(request: HttpRequest): AuthPrincipal | undefined {
  const headers = request.headers;
  const principalHeader = headers?.get('x-ms-client-principal');
  const roleHeader = headers?.get('x-ms-client-principal-role') ?? headers?.get('x-ms-client-principal-roles');
  const nameHeader = headers?.get('x-ms-client-principal-name');
  const idHeader = headers?.get('x-ms-client-principal-id');
  const roles = normalizedRoles(roleHeader?.split(',') ?? []);
  let principalName = nameHeader?.trim();
  let principalId = idHeader?.trim();

  if (principalHeader) {
    const decoded = decodeStaticWebAppsPrincipal(principalHeader);
    if (decoded) {
      principalName = principalName || decoded.userDetails?.trim();
      principalId = principalId || decoded.userId?.trim();
      roles.push(...normalizedRoles(decoded.userRoles ?? []));
    }
  }

  const uniqueRoles = [...new Set(roles)];
  if (!principalName && !principalId) {
    return undefined;
  }

  return {
    id: principalId,
    email: normalizeEmail(principalName),
    name: principalName || principalId || 'unknown',
    roles: uniqueRoles,
  };
}

export function hasMinimumRole(principal: AuthPrincipal, minimumRole: AppRole) {
  const requiredRank = roleRank[minimumRole];
  return principal.roles.some((role) => roleRank[role] >= requiredRank);
}

export function hasLicenseActionRole(principal: AuthPrincipal) {
  return principal.roles.some((role) => role === 'Admin' || role === 'LicenseAdmin');
}

function decodeStaticWebAppsPrincipal(value: string): StaticWebAppsPrincipal | undefined {
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as StaticWebAppsPrincipal;
  } catch {
    return undefined;
  }
}

function normalizedRoles(values: string[]) {
  const roles = values.map((value) => value.trim()).filter(Boolean);
  return appRoles.filter((role) => roles.includes(role));
}

function authJsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}

async function resolveApplicationPrincipal(headerPrincipal: AuthPrincipal): Promise<AuthPrincipal> {
  const bootstrapRole = bootstrapRoleFor(headerPrincipal.email ?? headerPrincipal.name);
  if (bootstrapRole) {
    const appUserId = await upsertBootstrapUser(headerPrincipal, bootstrapRole).catch(() => undefined);
    return {
      ...headerPrincipal,
      appUserId,
      roles: [bootstrapRole],
    };
  }

  if (allowsHeaderRoleAuthFallback()) {
    return headerPrincipal;
  }

  const databasePrincipal = await readDatabasePrincipal(headerPrincipal).catch((error: unknown) => {
    if (isMissingAppUsersTable(error)) {
      return undefined;
    }

    throw error;
  });

  if (databasePrincipal) {
    return databasePrincipal;
  }

  return {
    ...headerPrincipal,
    roles: [],
  };
}

async function readDatabasePrincipal(headerPrincipal: AuthPrincipal): Promise<AuthPrincipal | undefined> {
  if (!hasDatabaseSettings()) {
    return undefined;
  }

  const pool = await getAuthPool();
  const result = await pool.query<{
    id: string;
    aad_user_id: string | null;
    email: string;
    display_name: string | null;
    role: AppRole;
    status: string;
  }>(
    `select id, aad_user_id, email, display_name, role, status
     from app_users
     where status = 'active'
       and (
         ($1::text is not null and aad_user_id = $1)
         or lower(email) = lower($2)
       )
     limit 1`,
    [headerPrincipal.id ?? null, headerPrincipal.email ?? headerPrincipal.name],
  );

  const user = result.rows[0];
  if (!user) {
    return undefined;
  }

  await pool.query(
    `update app_users
     set aad_user_id = coalesce(aad_user_id, $1),
         display_name = coalesce(nullif(display_name, ''), $2),
         last_seen_at = now(),
         updated_at = now()
     where id = $3`,
    [headerPrincipal.id ?? null, headerPrincipal.name, user.id],
  );

  return {
    appUserId: user.id,
    id: user.aad_user_id ?? headerPrincipal.id,
    email: user.email,
    name: user.display_name || user.email,
    roles: [user.role],
  };
}

async function upsertBootstrapUser(headerPrincipal: AuthPrincipal, role: AppRole) {
  if (!hasDatabaseSettings() || bootstrapUpsertDisabled()) {
    return undefined;
  }

  const email = headerPrincipal.email ?? normalizeEmail(headerPrincipal.name);
  if (!email) {
    return undefined;
  }

  const pool = await getAuthPool();
  const result = await pool.query<{ id: string }>(
    `insert into app_users (aad_user_id, email, display_name, role, status, created_by, updated_by, last_seen_at)
     values ($1, lower($2), $3, $4, 'active', 'bootstrap', 'bootstrap', now())
     on conflict (lower(email))
     do update set
       aad_user_id = coalesce(app_users.aad_user_id, excluded.aad_user_id),
       display_name = coalesce(nullif(app_users.display_name, ''), excluded.display_name),
       role = case when app_users.role = 'Admin' then app_users.role else excluded.role end,
       status = 'active',
       updated_by = 'bootstrap',
       updated_at = now(),
       last_seen_at = now()
     returning id`,
    [headerPrincipal.id ?? null, email, headerPrincipal.name, role],
  );

  return result.rows[0]?.id;
}

async function getAuthPool() {
  if (authPool) {
    return authPool;
  }

  if (!authPoolPromise) {
    authPoolPromise = getSharedDatabasePool().then((pool) => {
      authPool = pool;
      return pool;
    });
  }

  return authPoolPromise;
}

function hasDatabaseSettings() {
  return getDatabaseSettings().missing.length === 0;
}

function bootstrapRoleFor(value: string | undefined): AppRole | undefined {
  const email = normalizeEmail(value);
  if (!email) {
    return undefined;
  }

  const bootstrapEmails = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

  return bootstrapEmails.includes(email) ? 'Admin' : undefined;
}

function allowsHeaderRoleAuthFallback() {
  const enabled = ['1', 'true', 'yes'].includes((process.env.ALLOW_HEADER_ROLE_AUTH ?? '').trim().toLowerCase());
  return enabled && !isRunningInAzure();
}

function bootstrapUpsertDisabled() {
  return ['1', 'true', 'yes'].includes((process.env.AUTH_DISABLE_BOOTSTRAP_UPSERT ?? '').trim().toLowerCase());
}

function normalizeEmail(value: string | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.includes('@') ? trimmed : undefined;
}

function isRunningInAzure() {
  return Boolean(process.env.WEBSITE_SITE_NAME);
}

function isMissingAppUsersTable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
}
