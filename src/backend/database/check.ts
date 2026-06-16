import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { describeDatabaseSettings, getDatabaseSettings, requireDatabaseSettings, toPoolConfig } from './config';

loadDotEnv({ override: false });

async function run() {
  const settings = getDatabaseSettings();
  console.log('Database settings:', describeDatabaseSettings(settings));
  const pool = new Pool(toPoolConfig(requireDatabaseSettings(settings)));

  try {
    const connection = await pool.query<{
      current_database: string;
      current_user: string;
      server_version: string;
    }>('select current_database(), current_user, version() as server_version');
    const tables = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    );

    console.log('Connected database:', {
      database: connection.rows[0]?.current_database,
      user: connection.rows[0]?.current_user,
      tableCount: tables.rowCount,
      tables: tables.rows.map((row) => row.table_name),
    });
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
