import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { config as loadDotEnv } from 'dotenv';
import {
  getCommunicationSettings,
  recordEmailDeliveryTestResult,
  resolveGraphEmailDeliveryCredentials,
  updateCommunicationSettings,
} from '../config/communicationSettingsService';
import { sendGraphEmail } from '../email/graphEmailSender';
import { isValidEmail } from '../../shared/communicationSettings';
import { requireRole } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, readJsonBody, requireMutatingRequestOrigin } from './runtime';

loadDotEnv({ override: false });

export async function getCommunicationSettingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Analyst');
  if (auth.response) return auth.response;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  try {
    const settings = await getCommunicationSettings(repositoryContext.pool);
    return jsonResponse(200, { settings });
  } catch (error) {
    return communicationSettingsErrorResponse(error, 'Unable to load communication settings.');
  } finally {
    await repositoryContext.close();
  }
}

export async function updateCommunicationSettingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  const bodyResult = await readJsonBody<unknown>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  const payload = body as Record<string, unknown>;
  const hasSecretUpdate =
    typeof payload.graphClientSecret === 'string' && payload.graphClientSecret.trim().length > 0;

  try {
    const settings = await updateCommunicationSettings(
      repositoryContext.pool,
      payload,
      auth.principal.email ?? auth.principal.name,
      {
        keyVaultUrl: process.env.KEY_VAULT_URL,
      },
    );
    return jsonResponse(200, {
      settings,
      secretWritten: hasSecretUpdate,
    });
  } catch (error) {
    return communicationSettingsErrorResponse(error, 'Unable to save communication settings.');
  } finally {
    await repositoryContext.close();
  }
}

export async function testCommunicationSettingsHttp(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireRole(request, 'Admin');
  if (auth.response) return auth.response;

  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const repositoryContext = await createOptionalPostgresSettingsRepository();
  if (!repositoryContext.pool) {
    return missingDatabaseResponse(repositoryContext.missingDatabaseSettings);
  }

  const bodyResult = await readJsonBody<unknown>(request);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
    });
  }

  const recipientEmail = textValue((body as Record<string, unknown>).recipientEmail);
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    return jsonResponse(400, {
      error: 'A valid recipientEmail is required for the delivery test.',
    });
  }

  const actor = auth.principal.email ?? auth.principal.name;

  try {
    const credentials = await resolveGraphEmailDeliveryCredentials(repositoryContext.pool, {
      keyVaultUrl: process.env.KEY_VAULT_URL,
    });
    await sendGraphEmail(credentials, {
      subject: 'MSP Harmony email delivery test',
      body: [
        'This is a test message from MSP Harmony.',
        '',
        `Sent as: ${credentials.sendAsMailbox}`,
        `Requested by: ${actor}`,
        `Sent at: ${new Date().toISOString()}`,
      ].join('\n'),
      to: [{ address: recipientEmail }],
    });

    const settings = await recordEmailDeliveryTestResult(repositoryContext.pool, {
      result: 'success',
      actor,
    });

    return jsonResponse(200, {
      ok: true,
      recipientEmail,
      sendAsMailbox: credentials.sendAsMailbox,
      settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send test email.';
    try {
      const settings = await recordEmailDeliveryTestResult(repositoryContext.pool, {
        result: 'failed',
        error: message,
        actor,
      });
      return jsonResponse(400, {
        error: message,
        settings,
      });
    } catch {
      return jsonResponse(400, {
        error: message,
      });
    }
  } finally {
    await repositoryContext.close();
  }
}

app.http('getCommunicationSettings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'settings/communication',
  handler: getCommunicationSettingsHttp,
});

app.http('updateCommunicationSettings', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'settings/communication',
  handler: updateCommunicationSettingsHttp,
});

app.http('testCommunicationSettings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'settings/communication/test',
  handler: testCommunicationSettingsHttp,
});

function missingDatabaseResponse(missingDatabaseSettings: string[]) {
  return jsonResponse(500, {
    error: 'PostgreSQL settings are required to manage communication settings.',
    missingDatabaseSettings,
  });
}

function communicationSettingsErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return jsonResponse(400, {
    error: message,
  });
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
