import { config as loadDotEnv } from 'dotenv';
import { describeDatabaseSettings, getDatabaseSettings } from './config';
import { runSchemaMigration } from './migrationRunner';
import { createResolvedDatabasePool } from './pool';

loadDotEnv({ override: false });

async function run() {
  const settings = getDatabaseSettings();
  console.log('Database settings:', describeDatabaseSettings(settings));
  const pool = await createResolvedDatabasePool();

  try {
    const result = await runSchemaMigration({ pool });
    console.log('Schema migration:', {
      name: result.name,
      status: result.status,
      checksum: result.checksum,
    });
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
