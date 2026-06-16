import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { describeDatabaseSettings, getDatabaseSettings, requireDatabaseSettings, toPoolConfig } from './config';
import { runSchemaMigration } from './migrationRunner';

loadDotEnv({ override: false });

async function run() {
  const settings = getDatabaseSettings();
  console.log('Database settings:', describeDatabaseSettings(settings));
  const pool = new Pool(toPoolConfig(requireDatabaseSettings(settings)));

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
