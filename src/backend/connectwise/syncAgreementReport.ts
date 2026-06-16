import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { requireDatabaseSettings, toPoolConfig } from '../database/config';
import { syncConnectWiseAgreementReport } from './operations';

loadDotEnv({ override: false });

async function run() {
  const provider = createIntegrationSettingsProvider();
  const pageSize = Number.parseInt(process.env.CONNECTWISE_SYNC_PAGE_SIZE ?? '100', 10);
  const maxPages = Number.parseInt(process.env.CONNECTWISE_SYNC_MAX_PAGES ?? '50', 10);
  const pool = new Pool(toPoolConfig(requireDatabaseSettings()));

  try {
    const result = await syncConnectWiseAgreementReport({
      pool,
      provider,
      pageSize,
      maxPages,
    });
    console.log('ConnectWise agreement report sync complete:', {
      syncRunId: result.syncRunId,
      customersRead: result.customersRead,
      agreementsRead: result.agreementsRead,
      additionsRead: result.additionsRead,
      additionsWritten: result.additionsWritten,
      historyWritten: result.historyWritten,
    });
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
