import assert from 'node:assert/strict';
import { sendGraphEmail } from './graphEmailSender';

async function run() {
  await testSendGraphEmailPostsSendMail();
  console.log('graphEmailSender tests passed');
}

async function testSendGraphEmailPostsSendMail() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'graph-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/sendMail')) {
      return new Response(null, { status: 202 });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await sendGraphEmail(
      {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        sendAsMailbox: 'billing@example.com',
      },
      {
        subject: 'Past due reminder',
        body: '<!DOCTYPE html><html><body><p>Hello Avery,</p></body></html>',
        bodyContentType: 'HTML',
        to: [{ address: 'avery@example.com', name: 'Avery' }],
        cc: [{ address: 'cc@example.com' }],
        bcc: [{ address: 'bcc@example.com' }],
      },
    );

    assert.equal(result.sendAsMailbox, 'billing@example.com');
    assert.equal(result.recipientCount, 3);
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? '', /login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token/);
    assert.equal(
      calls[1]?.url,
      'https://graph.microsoft.com/v1.0/users/billing%40example.com/sendMail',
    );
    assert.equal(
      calls[1]?.init?.headers && (calls[1].init.headers as Record<string, string>).Authorization,
      'Bearer graph-token',
    );
    const payload = JSON.parse(String(calls[1]?.init?.body ?? '{}')) as {
      message?: {
        subject?: string;
        body?: { contentType?: string; content?: string };
        toRecipients?: Array<{ emailAddress?: { address?: string } }>;
      };
    };
    assert.equal(payload.message?.subject, 'Past due reminder');
    assert.equal(payload.message?.body?.contentType, 'HTML');
    assert.match(payload.message?.body?.content ?? '', /<!DOCTYPE html>/);
    assert.equal(payload.message?.toRecipients?.[0]?.emailAddress?.address, 'avery@example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
