import { config as loadDotEnv } from 'dotenv';
import { createIntegrationSettingsProvider } from '../config/settingsProvider';
import { ConnectWiseApiError } from './client';
import { testConnectWiseConnection } from './operations';

loadDotEnv({ override: false });

async function run() {
  const provider = createIntegrationSettingsProvider();
  const result = await testConnectWiseConnection(provider);

  console.log('ConnectWise connection OK:', {
    companyCount: result.companyCount,
    sampleCompanies: result.sampleCompanies,
  });
}

run().catch((error: unknown) => {
  if (error instanceof ConnectWiseApiError) {
    console.error({
      message: error.message,
      status: error.status,
      responseText: error.responseText,
    });
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
