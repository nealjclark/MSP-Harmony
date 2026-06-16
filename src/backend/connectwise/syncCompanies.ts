import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { requireDatabaseSettings, toPoolConfig } from '../database/config';
import { syncConnectWiseCompanies } from './operations';

loadDotEnv({ override: false });

async function run() {
  const provider = createIntegrationSettingsProvider();
  const pageSize = Number.parseInt(process.env.CONNECTWISE_SYNC_PAGE_SIZE ?? '100', 10);
  const maxPages = Number.parseInt(process.env.CONNECTWISE_SYNC_MAX_PAGES ?? '1', 10);
  const pool = new Pool(toPoolConfig(requireDatabaseSettings()));

  try {
    const result = await syncConnectWiseCompanies({
      pool,
      provider,
      pageSize,
      maxPages,
    });
    console.log('ConnectWise company sync complete:', {
      syncRunId: result.syncRunId,
      recordsRead: result.recordsRead,
      recordsWritten: result.recordsWritten,
    });
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
