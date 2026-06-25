import type { HttpRequest, HttpResponseInit } from '@azure/functions';

export type AppRole = 'Admin' | 'Approver' | 'Analyst';

export type AuthPrincipal = {
  id?: string;
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
  Approver: 2,
  Admin: 3,
};

const appRoles: AppRole[] = ['Admin', 'Approver', 'Analyst'];

export function requireRole(
  request: HttpRequest,
  minimumRole: AppRole,
): { principal: AuthPrincipal; response?: undefined } | { principal?: undefined; response: HttpResponseInit } {
  const principal = readAuthPrincipal(request);

  if (!principal) {
    return {
      response: authJsonResponse(401, {
        error: 'Authentication is required.',
      }),
    };
  }

  if (!hasMinimumRole(principal, minimumRole)) {
    return {
      response: authJsonResponse(403, {
        error: `The ${minimumRole} role is required for this action.`,
      }),
    };
  }

  return { principal };
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
    name: principalName || principalId || 'unknown',
    roles: uniqueRoles,
  };
}

export function hasMinimumRole(principal: AuthPrincipal, minimumRole: AppRole) {
  const requiredRank = roleRank[minimumRole];
  return principal.roles.some((role) => roleRank[role] >= requiredRank);
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
