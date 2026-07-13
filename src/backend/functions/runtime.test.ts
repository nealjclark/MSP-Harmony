import assert from 'node:assert/strict';
import { readJsonBody, requireMutatingRequestOrigin } from './runtime';

const originalAllowedOrigins = process.env.APP_ALLOWED_ORIGINS;

async function run() {
  process.env.APP_ALLOWED_ORIGINS = 'https://app.example.com';

  const parsed = await readJsonBody<{ name: string }>(request({
    method: 'POST',
    origin: 'https://app.example.com',
    body: JSON.stringify({ name: 'MSP Harmony' }),
  }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.body.name, 'MSP Harmony');
  }

  const invalid = await readJsonBody(request({
    method: 'POST',
    origin: 'https://app.example.com',
    body: '{',
  }));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.response.jsonBody as { code?: string }).code, 'invalid_json');
  }

  const tooLarge = await readJsonBody(request({
    method: 'POST',
    origin: 'https://app.example.com',
    body: JSON.stringify({ name: 'too-large' }),
    contentLength: '999',
  }), { maxBytes: 8 });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) {
    assert.equal(tooLarge.response.status, 413);
  }

  assert.equal(requireMutatingRequestOrigin(request({
    method: 'GET',
    body: '',
  })), undefined);

  const missingOrigin = requireMutatingRequestOrigin(request({
    method: 'POST',
    body: '{}',
  }));
  assert.equal(missingOrigin?.status, 403);

  const allowedOrigin = requireMutatingRequestOrigin(request({
    method: 'POST',
    origin: 'https://app.example.com/settings',
    body: '{}',
  }));
  assert.equal(allowedOrigin, undefined);

  console.log('runtime helper tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  restoreEnv('APP_ALLOWED_ORIGINS', originalAllowedOrigins);
});

function request(options: {
  method: string;
  origin?: string;
  body: string;
  contentLength?: string;
}) {
  const headers = new Headers();
  if (options.origin) {
    headers.set('origin', options.origin);
  }
  if (options.contentLength) {
    headers.set('content-length', options.contentLength);
  }

  return {
    method: options.method,
    url: 'https://func.example.com/api/test',
    headers,
    async text() {
      return options.body;
    },
  } as never;
}

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
