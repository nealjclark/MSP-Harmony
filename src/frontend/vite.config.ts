import { defineConfig } from 'vite';
import { request } from 'node:http';

const localFunctionUrls = ['http://127.0.0.1:7071', 'http://127.0.0.1:7072'];

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

export default defineConfig(async () => {
  const functionsUrl = await resolveFunctionsUrl();

  return {
    server: {
      proxy: {
        '/api': {
          target: functionsUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
