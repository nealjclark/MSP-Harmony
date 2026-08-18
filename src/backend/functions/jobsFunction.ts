import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import {
  dismissBackgroundJob,
  dismissCompletedBackgroundJobs,
  listBackgroundJobs,
  type BackgroundJobSource,
} from '../jobs/backgroundJobs';
import { getAuthSession } from './auth';
import {
  createOptionalPostgresSettingsRepository,
  jsonResponse,
  readJsonBody,
  requireMutatingRequestOrigin,
  serverErrorResponse,
} from './runtime';

type DismissJobsBody = {
  source?: unknown;
  jobId?: unknown;
  allCompleted?: unknown;
};

const backgroundJobSources = new Set<BackgroundJobSource>([
  'integration-sync',
  'software-inventory',
  'appriver-license-cleanup',
  'sales-quote',
]);

export async function listBackgroundJobsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const session = await getAuthSession(request);
  if (!session) return jsonResponse(401, { error: 'Authentication is required.' });
  if (session.state !== 'authorized') return jsonResponse(403, { error: session.message ?? 'Application access is required.' });

  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) {
    return jsonResponse(400, {
      error: 'Active jobs need PostgreSQL settings.',
      missingDatabaseSettings: repository.missingDatabaseSettings,
    });
  }
  try {
    const requestedLimit = Number(request.query.get('recentLimit'));
    const jobs = await listBackgroundJobs({
      database: repository.pool,
      integrationRepository: repository.repository,
      principal: session.principal,
      recentLimit: Number.isFinite(requestedLimit) ? requestedLimit : 10,
    });
    return jsonResponse(200, { jobs });
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to load active jobs.', 'background_jobs_load_failed');
  } finally {
    await repository.close();
  }
}

export async function dismissBackgroundJobsHttp(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const session = await getAuthSession(request);
  if (!session) return jsonResponse(401, { error: 'Authentication is required.' });
  if (session.state !== 'authorized') return jsonResponse(403, { error: session.message ?? 'Application access is required.' });
  const originResponse = requireMutatingRequestOrigin(request);
  if (originResponse) return originResponse;

  const bodyResult = await readJsonBody<DismissJobsBody>(request, { fallback: {} });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const dismissAll = body.allCompleted === true;
  if (!dismissAll && (
    typeof body.source !== 'string'
    || !backgroundJobSources.has(body.source as BackgroundJobSource)
    || typeof body.jobId !== 'string'
    || !body.jobId.trim()
  )) {
    return jsonResponse(400, { error: 'Provide a valid source and jobId, or set allCompleted to true.' });
  }

  const repository = await createOptionalPostgresSettingsRepository();
  if (!repository.pool || !repository.repository) {
    return jsonResponse(400, {
      error: 'Active job dismissal needs PostgreSQL settings.',
      missingDatabaseSettings: repository.missingDatabaseSettings,
    });
  }
  try {
    if (dismissAll) {
      const result = await dismissCompletedBackgroundJobs({
        database: repository.pool,
        integrationRepository: repository.repository,
        principal: session.principal,
      });
      const jobs = await listBackgroundJobs({
        database: repository.pool,
        integrationRepository: repository.repository,
        principal: session.principal,
        recentLimit: 10,
      });
      return jsonResponse(200, { ...result, jobs });
    }

    const result = await dismissBackgroundJob({
      database: repository.pool,
      integrationRepository: repository.repository,
      principal: session.principal,
      source: body.source as BackgroundJobSource,
      jobId: String(body.jobId).trim(),
    });
    if (!result.dismissed) return jsonResponse(409, result);
    const jobs = await listBackgroundJobs({
      database: repository.pool,
      integrationRepository: repository.repository,
      principal: session.principal,
      recentLimit: 10,
    });
    return jsonResponse(200, { ...result, jobs });
  } catch (error) {
    return serverErrorResponse(context, error, 'Unable to dismiss active job history.', 'background_jobs_dismiss_failed');
  } finally {
    await repository.close();
  }
}

app.http('listBackgroundJobs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs',
  handler: listBackgroundJobsHttp,
});

app.http('dismissBackgroundJobs', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'jobs/dismiss',
  handler: dismissBackgroundJobsHttp,
});
