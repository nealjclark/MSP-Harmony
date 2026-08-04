import assert from 'node:assert/strict';
import {
  ConnectWiseCpqClient,
  cpqCredentialsFromSettings,
  type CpqCredentials,
} from './cpqClient';

const credentials: CpqCredentials = {
  endpoint: 'https://sellapi.quosalsell.com',
  accessKey: 'bmb_azure',
  publicKey: 'public-key',
  privateKey: 'private-key',
  templatesPath: '/api/templates',
  quotesPath: '/api/quotes',
  quoteItemsPath: '/api/quoteItems',
  quoteTabsPath: '/api/quoteTabs',
  testCompanyId: '123',
  siteUrl: 'https://bmb.quosalsell.com',
};

async function run() {
  const parsed = cpqCredentialsFromSettings({
    nonSecrets: {
      endpoint: credentials.endpoint,
      accessKey: credentials.accessKey,
      templatesPath: credentials.templatesPath,
      quotesPath: credentials.quotesPath,
      quoteItemsPath: credentials.quoteItemsPath,
      quoteTabsPath: credentials.quoteTabsPath,
      testCompanyId: credentials.testCompanyId,
      siteUrl: credentials.siteUrl,
    },
    secrets: {
      publicKey: credentials.publicKey,
      privateKey: credentials.privateKey,
    },
  });
  assert.deepEqual(parsed, { ...credentials, hardwareTabId: undefined });

  const requests: Array<{
    url: URL;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    requests.push({
      url,
      method,
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    if (method === 'GET' && url.pathname === '/api/templates') {
      return json([{ id: 'template-1', name: 'Managed Services' }]);
    }
    if (method === 'POST' && url.pathname === '/api/quotes/copyById/template-1') {
      return json({ id: 'quote-1', name: 'Managed Services' });
    }
    if (method === 'GET' && url.pathname === '/api/quotes/quote-1') {
      return json({
        id: 'quote-1',
        name: 'AI-PILOT-123 Managed Services',
        quoteStatus: 'Draft',
        modifyDate: '2026-08-03T12:00:00Z',
      });
    }
    if (method === 'GET' && url.pathname === '/api/quoteTabs') {
      return json([
        {
          id: 'hardware-tab',
          name: 'Hardware',
          canAddItems: true,
          quote: { id: 'quote-1' },
        },
      ]);
    }
    if (method === 'GET' && url.pathname === '/api/quoteTabs/hardware-tab/quoteItems') {
      return json([
        {
          id: 'line-1',
          idQuote: 'quote-1',
          idQuoteTabs: 'hardware-tab',
          manufacturerPartNumber: 'SKU-1',
          quosalDescription: 'Managed workstation',
          quantity: 2,
          cost: 40,
          quoteItemPrice: 75,
          isHiddenItem: false,
          isSelected: true,
        },
      ]);
    }
    const segments = url.pathname.split('/');
    return json({ id: segments[segments.length - 1] });
  };

  try {
    const client = new ConnectWiseCpqClient(credentials);
    const templates = await client.listTemplates();
    const draft = await client.createDraft({
      templateId: 'template-1',
      name: 'AI-PILOT-123 Managed Services',
      companyId: 123,
      opportunityId: 456,
      requestId: 'request-1',
    });
    await client.configureTemplateLine('quote-1', 'line-1', { included: false, quantity: 3 });
    await client.addLine('quote-1', {
      sku: 'DELL-1',
      description: 'Dell Latitude',
      quantity: 4,
      unitCost: 800,
      unitPrice: 1000,
      sourceReference: 'eQuote 123',
    });
    await client.setStatus('quote-1', 'Ready for Delivery');

    assert.equal(templates[0]?.id, 'template-1');
    assert.equal(draft.id, 'quote-1');
    assert.equal(draft.status, 'Draft');
    assert.equal(draft.lines[0]?.description, 'Managed workstation');
    assert.equal(
      draft.url,
      'https://bmb.quosalsell.com/QuosalWeb/quote.dashboard?accesskey=bmb_azure&idquotemain=quote-1',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const first = requests[0];
  assert.equal(first?.url.toString(), 'https://sellapi.quosalsell.com/api/templates');
  assert.equal(
    first?.headers.Authorization,
    `Basic ${Buffer.from('bmb_azure+public-key:private-key').toString('base64')}`,
  );
  assert.equal(first?.headers['Content-Type'], 'application/json; version=1.0');

  const copyRequest = requests.find((request) => request.url.pathname.includes('/copyById/'));
  assert.equal(copyRequest?.method, 'POST');
  assert.equal(copyRequest?.body, undefined);

  const quotePatch = requests.find(
    (request) => request.method === 'PATCH' && request.url.pathname === '/api/quotes/quote-1',
  );
  assert.deepEqual(JSON.parse(quotePatch?.body ?? '[]'), [
    { op: 'replace', path: '/name', value: 'AI-PILOT-123 Managed Services' },
    { op: 'replace', path: '/crmOpportunityId', value: '456' },
    { op: 'replace', path: '/requestId', value: 'request-1' },
  ]);

  const tabLookup = requests.find(
    (request) => request.method === 'GET' && request.url.pathname === '/api/quoteTabs',
  );
  assert.equal(tabLookup?.url.searchParams.get('conditions'), 'quote/id = "quote-1"');
  assert.equal(tabLookup?.url.searchParams.get('pageSize'), '50');
  assert.ok(
    requests.some(
      (request) =>
        request.method === 'GET' &&
        request.url.pathname === '/api/quoteTabs/hardware-tab/quoteItems',
    ),
  );

  const linePatch = requests.find(
    (request) => request.method === 'PATCH' && request.url.pathname === '/api/quoteItems/line-1',
  );
  assert.deepEqual(JSON.parse(linePatch?.body ?? '[]'), [
    { op: 'replace', path: '/quantity', value: 3 },
    { op: 'replace', path: '/isHiddenItem', value: true },
    { op: 'replace', path: '/isSelected', value: false },
    { op: 'replace', path: '/isPrinted', value: false },
  ]);

  const itemPost = requests.find(
    (request) => request.method === 'POST' && request.url.pathname === '/api/quoteItems',
  );
  const postedItem = JSON.parse(itemPost?.body ?? '{}') as Record<string, unknown>;
  assert.equal(postedItem.idQuote, 'quote-1');
  assert.equal(postedItem.idQuoteTabs, 'hardware-tab');
  assert.equal(postedItem.manufacturerPartNumber, 'DELL-1');

  const statusPatches = requests.filter(
    (request) => request.method === 'PATCH' && request.url.pathname === '/api/quotes/quote-1',
  );
  assert.deepEqual(JSON.parse(statusPatches[statusPatches.length - 1]?.body ?? '[]'), [
    { op: 'replace', path: '/quoteStatus', value: 'Ready for Delivery' },
  ]);

  console.log('ConnectWise CPQ client tests passed.');
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
