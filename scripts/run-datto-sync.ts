import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';
import { createIntegrationSettingsProvider, EnvironmentSecretReader } from '../src/backend/config/settingsProvider';
import { requireDatabaseSettings, getDatabaseSettings, toPoolConfig } from '../src/backend/database/config';
import { syncDattoUsageSnapshots, testDattoConnection } from '../src/backend/vendor/datto/operations';

loadDotEnv({ override: false });

async function run() {
  const provider = createIntegrationSettingsProvider({
    loadLocalEnv: true,
    env: process.env,
    secretReader: new EnvironmentSecretReader(process.env),
    keyVaultUrl: undefined,
  });
  const testResult = await testDattoConnection({ provider });
  console.log('Datto connection:', {
    integrationId: testResult.integrationId,
    testedAt: testResult.testedAt,
    bcdrAgentCount: testResult.bcdrAgentCount,
    saasDomainCount: testResult.saasDomainCount,
  });

  const pool = new Pool(toPoolConfig(requireDatabaseSettings(getDatabaseSettings())));
  try {
    const result = await syncDattoUsageSnapshots({
      pool,
      provider,
      pageSize: 100,
      maxPages: 100,
      seatPageSize: 500,
      seatMaxPages: 100,
      includeBcdr: true,
    });

    console.log('Datto sync:', result);
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
