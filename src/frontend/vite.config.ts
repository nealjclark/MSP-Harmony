import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localFunctionsUrl = 'http://127.0.0.1:7072';
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type LocalSettings = {
  Values?: Record<string, string | undefined>;
};

let localSettings: LocalSettings | undefined;

function resolveFunctionsUrl() {
  const configuredUrl = process.env.VITE_FUNCTIONS_URL ?? process.env.FUNCTIONS_URL;
  return configuredUrl ?? localFunctionsUrl;
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

export default defineConfig(() => {
  const functionsUrl = resolveFunctionsUrl();
  const authHeaders = localAuthHeaders();

  return {
    optimizeDeps: {
      include: ['@e965/xlsx'],
    },
    server: {
      port: 5274,
      strictPort: true,
      fs: {
        allow: [workspaceRoot],
      },
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
