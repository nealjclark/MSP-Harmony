import assert from 'node:assert/strict';
import { ConnectWiseClient, connectWiseCredentialsFromSettings } from './client';
import type { IntegrationRuntimeSettings } from '../config/settingsProvider';
import type { IntegrationSettingsDefinition, IntegrationSettingsValidation } from '../../shared/integrationSettings';

const settings = {
  definition: { integrationId: 'connectwise' } as IntegrationSettingsDefinition,
  nonSecrets: {
    endpoint: 'https://api-na.myconnectwise.net',
    companyId: 'company',
    clientId: 'client-id',
  },
  secrets: {
    publicKey: 'public-key',
    privateKey: 'private-key',
  },
  validation: { configuredStatus: 'connected' } as IntegrationSettingsValidation,
  secretSource: 'environment',
} satisfies IntegrationRuntimeSettings;

async function run() {
  const credentials = connectWiseCredentialsFromSettings(settings);
  assert.equal(credentials.endpoint, 'https://api-na.myconnectwise.net');
  assert.equal(credentials.companyId, 'company');
  assert.equal(credentials.clientId, 'client-id');

  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
    });

    return new Response(JSON.stringify([{ id: 1, identifier: 'ABC', name: 'Acme' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = new ConnectWiseClient(credentials);
  const companies = await client.listCompanies({ page: 2, pageSize: 10, orderBy: 'name' });
  await client.listAgreements({ pageSize: 5, conditions: 'company/id=123' });
  await client.listAgreementAdditions(123, { pageSize: 100 });
  await client.listProducts({ pageSize: 5 });
  await client.listCatalogItems({ pageSize: 5 });
  await client.getSystemInfo();
  globalThis.fetch = originalFetch;

  assert.equal(companies[0]?.name, 'Acme');
  assert.equal(requests[0]?.url, 'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/company/companies?page=2&pageSize=10&orderBy=name');
  assert.equal(requests[0]?.headers.clientId, 'client-id');
  assert.equal(
    requests[0]?.headers.Authorization,
    `Basic ${Buffer.from('company+public-key:private-key').toString('base64')}`,
  );
  assert.equal(
    requests[1]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements?page=1&pageSize=5&conditions=company%2Fid%3D123',
  );
  assert.equal(
    requests[2]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements/123/additions?page=1&pageSize=100',
  );
  assert.equal(
    requests[3]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/procurement/products?page=1&pageSize=5',
  );
  assert.equal(
    requests[4]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/procurement/catalog?page=1&pageSize=5',
  );
  assert.equal(requests[5]?.url, 'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/system/info');

  assert.throws(
    () =>
      connectWiseCredentialsFromSettings({
        ...settings,
        secrets: {},
      }),
    /mspharmony-connectwise-public-key/,
  );

  console.log('connectwise client tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
