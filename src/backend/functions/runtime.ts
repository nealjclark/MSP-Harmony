import type { HttpResponseInit } from '@azure/functions';
import { Pool } from 'pg';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import { getDatabaseSettings, toPoolConfig } from '../database/config';

export type OptionalPostgresSettingsRepository = {
  missingDatabaseSettings: string[];
  pool?: Pool;
  repository?: PostgresIntegrationSettingsRepository;
  close: () => Promise<void>;
};

export function createOptionalPostgresSettingsRepository(): OptionalPostgresSettingsRepository {
  const settings = getDatabaseSettings();

  if (settings.missing.length > 0) {
    return {
      missingDatabaseSettings: settings.missing,
      close: async () => {},
    };
  }

  const pool = new Pool(toPoolConfig(settings));

  return {
    missingDatabaseSettings: [],
    pool,
    repository: new PostgresIntegrationSettingsRepository(pool),
    close: async () => {
      await pool.end();
    },
  };
}

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}
