import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import { getAuthSession } from './auth';
import { jsonResponse } from './runtime';

loadDotEnv({ override: false });

export async function getAuthSessionHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const session = await getAuthSession(request);

  if (!session) {
    return jsonResponse(401, {
      status: 'unauthenticated',
      error: 'Authentication is required.',
    });
  }

  if (session.state === 'database-unavailable') {
    return jsonResponse(503, {
      status: session.state,
      error: session.message ?? 'Unable to verify application access.',
      user: serializeUser(session),
    });
  }

  return jsonResponse(200, {
    status: session.state,
    roles: session.principal.roles,
    user: serializeUser(session),
    message: session.message,
  });
}

function serializeUser(session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>) {
  return {
    appUserId: session.principal.appUserId,
    email: session.principal.email,
    name: session.principal.name,
    providerId: session.principal.id,
  };
}

app.http('getAuthSession', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/session',
  handler: getAuthSessionHttp,
});
