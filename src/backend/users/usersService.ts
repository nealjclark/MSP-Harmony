import type { AppRole } from '../functions/auth';

export type AppUserStatus = 'active' | 'disabled';

export type ManagedAppUser = {
  id: string;
  aadUserId?: string;
  email: string;
  displayName?: string;
  role: AppRole;
  status: AppUserStatus;
  lastSeenAt?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateManagedAppUserInput = {
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
  status?: unknown;
};

export type UpdateManagedAppUserInput = {
  displayName?: unknown;
  role?: unknown;
  status?: unknown;
};

type QueryResult<T> = {
  rows: T[];
};

type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

type AppUserRow = {
  id: string;
  aad_user_id: string | null;
  email: string;
  display_name: string | null;
  role: AppRole;
  status: AppUserStatus;
  last_seen_at: Date | string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const appRoles: AppRole[] = ['Admin', 'Approver', 'LicenseAdmin', 'Analyst'];
const appStatuses: AppUserStatus[] = ['active', 'disabled'];

const appUserColumns = `
  id::text,
  aad_user_id,
  email,
  display_name,
  role,
  status,
  last_seen_at,
  created_by,
  updated_by,
  created_at,
  updated_at
`;

export async function listManagedAppUsers(database: Queryable): Promise<ManagedAppUser[]> {
  const result = await database.query<AppUserRow>(
    `select ${appUserColumns}
     from app_users
     order by case status when 'active' then 0 else 1 end, lower(email)`,
  );

  return result.rows.map(mapAppUserRow);
}

export async function createManagedAppUser(
  database: Queryable,
  input: CreateManagedAppUserInput,
  actor: string,
): Promise<{ user: ManagedAppUser; created: boolean }> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error('Email is required.');
  }

  const role = parseRole(input.role);
  const status = input.status === undefined ? 'active' : parseStatus(input.status);
  const displayName = cleanDisplayName(input.displayName);

  const existing = await findUserByEmail(database, email);
  if (existing) {
    return {
      user: await updateManagedAppUser(
        database,
        existing.id,
        {
          displayName,
          role,
          status,
        },
        actor,
      ),
      created: false,
    };
  }

  const result = await database.query<AppUserRow>(
    `insert into app_users (email, display_name, role, status, created_by, updated_by)
     values (lower($1), $2, $3, $4, $5, $5)
     returning ${appUserColumns}`,
    [email, displayName, role, status, actor],
  );

  return {
    user: mapRequiredUserRow(result.rows[0]),
    created: true,
  };
}

export async function updateManagedAppUser(
  database: Queryable,
  userId: string,
  input: UpdateManagedAppUserInput,
  actor: string,
): Promise<ManagedAppUser> {
  const current = await findUserById(database, userId);
  if (!current) {
    throw new Error('User was not found.');
  }

  const nextRole = input.role === undefined ? current.role : parseRole(input.role);
  const nextStatus = input.status === undefined ? current.status : parseStatus(input.status);
  const nextDisplayName =
    input.displayName === undefined ? current.displayName ?? null : cleanDisplayName(input.displayName);

  await assertKeepsActiveAdmin(database, current, nextRole, nextStatus);

  const result = await database.query<AppUserRow>(
    `update app_users
     set display_name = $2,
         role = $3,
         status = $4,
         updated_by = $5,
         updated_at = now()
     where id = $1
     returning ${appUserColumns}`,
    [userId, nextDisplayName, nextRole, nextStatus, actor],
  );

  return mapRequiredUserRow(result.rows[0]);
}

export function managedAppUserRoles() {
  return [...appRoles];
}

export function managedAppUserStatuses() {
  return [...appStatuses];
}

async function findUserById(database: Queryable, userId: string) {
  const result = await database.query<AppUserRow>(
    `select ${appUserColumns}
     from app_users
     where id = $1
     limit 1`,
    [userId],
  );

  return result.rows[0] ? mapAppUserRow(result.rows[0]) : undefined;
}

async function findUserByEmail(database: Queryable, email: string) {
  const result = await database.query<AppUserRow>(
    `select ${appUserColumns}
     from app_users
     where lower(email) = lower($1)
     limit 1`,
    [email],
  );

  return result.rows[0] ? mapAppUserRow(result.rows[0]) : undefined;
}

async function assertKeepsActiveAdmin(
  database: Queryable,
  current: ManagedAppUser,
  nextRole: AppRole,
  nextStatus: AppUserStatus,
) {
  const removesActiveAdmin =
    current.role === 'Admin' && current.status === 'active' && (nextRole !== 'Admin' || nextStatus !== 'active');
  if (!removesActiveAdmin) {
    return;
  }

  const result = await database.query<{ count: string }>(
    `select count(*)::text
     from app_users
     where role = 'Admin'
       and status = 'active'
       and id <> $1`,
    [current.id],
  );
  const remainingActiveAdmins = Number(result.rows[0]?.count ?? '0');
  if (remainingActiveAdmins < 1) {
    throw new Error('At least one active Admin user is required.');
  }
}

function normalizeEmail(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!trimmed || !trimmed.includes('@') || trimmed.length > 320) {
    return undefined;
  }

  return trimmed;
}

function cleanDisplayName(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, 200) : null;
}

function parseRole(value: unknown): AppRole {
  if (typeof value === 'string' && appRoles.includes(value as AppRole)) {
    return value as AppRole;
  }

  throw new Error(`Role must be one of: ${appRoles.join(', ')}.`);
}

function parseStatus(value: unknown): AppUserStatus {
  if (typeof value === 'string' && appStatuses.includes(value as AppUserStatus)) {
    return value as AppUserStatus;
  }

  throw new Error(`Status must be one of: ${appStatuses.join(', ')}.`);
}

function mapRequiredUserRow(row: AppUserRow | undefined) {
  if (!row) {
    throw new Error('User save did not return a row.');
  }

  return mapAppUserRow(row);
}

function mapAppUserRow(row: AppUserRow): ManagedAppUser {
  return {
    id: row.id,
    aadUserId: row.aad_user_id ?? undefined,
    email: row.email,
    displayName: row.display_name ?? undefined,
    role: row.role,
    status: row.status,
    lastSeenAt: dateToIso(row.last_seen_at),
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    createdAt: dateToIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: dateToIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function dateToIso(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}
