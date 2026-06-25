import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localFunctionUrls = ['http://127.0.0.1:7071', 'http://127.0.0.1:7072'];
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type LocalSettings = {
  Values?: Record<string, string | undefined>;
};

let localSettings: LocalSettings | undefined;

function hasCurrentFunctionsHost(baseUrl: string) {
  return new Promise<boolean>((resolve) => {
    const req = request(`${baseUrl}/api/integrations`, { method: 'GET', timeout: 3000 }, (response) => {
      response.resume();
      resolve(response.statusCode !== 404 && (response.statusCode ?? 500) < 500);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function resolveFunctionsUrl() {
  const configuredUrl = process.env.VITE_FUNCTIONS_URL ?? process.env.FUNCTIONS_URL;

  if (configuredUrl) {
    return configuredUrl;
  }

  for (const baseUrl of localFunctionUrls) {
    if (await hasCurrentFunctionsHost(baseUrl)) {
      return baseUrl;
    }
  }

  return localFunctionUrls[0];
}

function readLocalSetting(name: string) {
  const envValue = process.env[name];
  if (envValue) {
    return envValue;
  }

  if (!localSettings) {
    try {
      localSettings = JSON.parse(readFileSync(resolve(workspaceRoot, 'local.settings.json'), 'utf8')) as LocalSettings;
    } catch {
      localSettings = {};
    }
  }

  return localSettings.Values?.[name];
}

function truthySetting(value: string | undefined) {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

function localAuthHeaders() {
  if (!truthySetting(readLocalSetting('ALLOW_HEADER_ROLE_AUTH'))) {
    return undefined;
  }

  const email = readLocalSetting('DEV_AUTH_EMAIL') ?? 'local.admin@example.com';
  const role = readLocalSetting('DEV_AUTH_ROLE') ?? 'Admin';
  const principal = Buffer.from(
    JSON.stringify({
      userId: `local-${email}`,
      userDetails: email,
      userRoles: ['authenticated', role],
    }),
  ).toString('base64');

  return {
    'x-ms-client-principal': principal,
    'x-ms-client-principal-id': `local-${email}`,
    'x-ms-client-principal-name': email,
    'x-ms-client-principal-role': role,
  };
}

export default defineConfig(async () => {
  const functionsUrl = await resolveFunctionsUrl();
  const authHeaders = localAuthHeaders();

  return {
    server: {
      proxy: {
        '/api': {
          target: functionsUrl,
          changeOrigin: true,
          ...(authHeaders ? { headers: authHeaders } : {}),
        },
      },
    },
  };
});
