import type { HttpResponseInit } from '@azure/functions';
import { Pool } from 'pg';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import { getDatabaseSettings } from '../database/config';
import { getSharedDatabasePool } from '../database/pool';

export type OptionalPostgresSettingsRepository = {
  missingDatabaseSettings: string[];
  pool?: Pool;
  repository?: PostgresIntegrationSettingsRepository;
  close: () => Promise<void>;
};

export async function createOptionalPostgresSettingsRepository(): Promise<OptionalPostgresSettingsRepository> {
  const settings = getDatabaseSettings();

  if (settings.missing.length > 0) {
    return {
      missingDatabaseSettings: settings.missing,
      close: async () => {},
    };
  }

  const pool = await getSharedDatabasePool();

  return {
    missingDatabaseSettings: [],
    pool,
    repository: new PostgresIntegrationSettingsRepository(pool),
    close: async () => {},
  };
}

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}
