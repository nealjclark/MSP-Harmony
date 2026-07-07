import assert from 'node:assert/strict';
import { ConnectWiseApiError, ConnectWiseClient, connectWiseCredentialsFromSettings } from './client';
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

  const requests: Array<{ url: string; method?: string; body?: BodyInit | null; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: init?.body,
      headers: init?.headers as Record<string, string>,
    });

    return new Response(JSON.stringify([{ id: 1, identifier: 'ABC', name: 'Acme' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = new ConnectWiseClient(credentials);
  const companies = await client.listCompanies({ page: 2, pageSize: 10, orderBy: 'name' });
  await client.listContacts({ pageSize: 10, conditions: 'company/id=123 and defaultBillingFlag=true' });
  await client.listAgreements({ pageSize: 5, conditions: 'company/id=123' });
  await client.getAgreement(123);
  await client.listInvoices({ page: 3, pageSize: 50, conditions: 'balance>0', orderBy: 'dueDate asc' });
  await client.getInvoice(789);
  await client.getInvoiceEmailTemplate(2);
  await client.listAgreementAdditions(123, { pageSize: 100 });
  await client.listProducts({ pageSize: 5 });
  await client.listCatalogItems({ pageSize: 5 });
  await client.patchAgreementAddition(123, 456, [
    { op: 'replace', path: '/quantity', value: 110 },
    { op: 'replace', path: '/lessIncluded', value: 5 },
  ]);
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
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/company/contacts?page=1&pageSize=10&conditions=company%2Fid%3D123+and+defaultBillingFlag%3Dtrue',
  );
  assert.equal(
    requests[2]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements?page=1&pageSize=5&conditions=company%2Fid%3D123',
  );
  assert.equal(
    requests[3]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements/123',
  );
  assert.equal(
    requests[4]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/invoices?page=3&pageSize=50&conditions=balance%3E0&orderBy=dueDate+asc',
  );
  assert.equal(
    requests[5]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/invoices/789',
  );
  assert.equal(
    requests[6]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/invoiceEmailTemplates/2',
  );
  assert.equal(
    requests[7]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements/123/additions?page=1&pageSize=100',
  );
  assert.equal(
    requests[8]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/procurement/products?page=1&pageSize=5',
  );
  assert.equal(
    requests[9]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/procurement/catalog?page=1&pageSize=5',
  );
  assert.equal(
    requests[10]?.url,
    'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/finance/agreements/123/additions/456',
  );
  assert.equal(requests[10]?.method, 'PATCH');
  assert.equal(
    requests[10]?.body,
    JSON.stringify([
      { op: 'replace', path: '/quantity', value: 110 },
      { op: 'replace', path: '/lessIncluded', value: 5 },
    ]),
  );
  assert.equal(requests[11]?.url, 'https://api-na.myconnectwise.net/v4_6_release/apis/3.0/system/info');

  assert.throws(
    () =>
      connectWiseCredentialsFromSettings({
        ...settings,
        secrets: {},
      }),
    /mspharmony-connectwise-public-key/,
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: 'ApiFindCondition', message: 'Enum value supplied was invalid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    () => client.listAgreements({ conditions: 'AgreementStatus Not Like "Canceled"' }),
    (error: unknown) => {
      assert.equal(error instanceof ConnectWiseApiError, true);
      assert.match((error as Error).message, /HTTP 400/);
      assert.match((error as Error).message, /Enum value supplied was invalid/);
      return true;
    },
  );
  globalThis.fetch = originalFetch;

  console.log('connectwise client tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
