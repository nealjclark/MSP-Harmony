import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { listBackgroundJobs } from '../jobs/backgroundJobs';
import { getAuthSession } from './auth';
import { createOptionalPostgresSettingsRepository, jsonResponse, serverErrorResponse } from './runtime';

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

app.http('listBackgroundJobs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'jobs',
  handler: listBackgroundJobsHttp,
});
