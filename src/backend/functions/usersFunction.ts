import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import {
  createManagedAppUser,
  listManagedAppUsers,
  managedAppUserRoles,
  managedAppUserStatuses,
  updateManagedAppUser,
} from '../users/usersService';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function listUsersHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    const users = await listManagedAppUsers(repositoryContext.pool);

    return jsonResponse(200, {
      users,
      roles: managedAppUserRoles(),
      statuses: managedAppUserStatuses(),
    });
  } catch (error) {
    return userManagementErrorResponse(error, 'Unable to load application users.');
  } finally {
    await repositoryContext.close();
  }
}

export async function createUserHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  try {
    const result = await createManagedAppUser(repositoryContext.pool, body, auth.principal.name);

    return jsonResponse(result.created ? 201 : 200, {
      user: result.user,
      created: result.created,
      roles: managedAppUserRoles(),
      statuses: managedAppUserStatuses(),
    });
  } catch (error) {
    return userManagementErrorResponse(error, 'Unable to save application user.');
  } finally {
    await repositoryContext.close();
  }
}

export async function updateUserHttp(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const userId = request.params.userId;
  if (!userId) {
    return jsonResponse(400, {
      error: 'Missing user id route parameter.',
    });
  }

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  try {
    const user = await updateManagedAppUser(repositoryContext.pool, userId, body, auth.principal.name);

    return jsonResponse(200, {
      user,
      roles: managedAppUserRoles(),
      statuses: managedAppUserStatuses(),
    });
  } catch (error) {
    return userManagementErrorResponse(error, 'Unable to update application user.');
  } finally {
    await repositoryContext.close();
  }
}

app.http('listUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users',
  handler: listUsersHttp,
});

app.http('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users',
  handler: createUserHttp,
});

app.http('updateUser', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'users/{userId}',
  handler: updateUserHttp,
});

function missingDatabaseResponse(missingDatabaseSettings: string[]) {
  return jsonResponse(500, {
    error: 'PostgreSQL settings are required to manage users.',
    missingDatabaseSettings,
  });
}

function userManagementErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message.includes('not found') ? 404 : 400;

  return jsonResponse(status, {
    error: message,
  });
}
