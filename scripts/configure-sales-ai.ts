import 'dotenv/config';
import { PostgresIntegrationSettingsRepository } from '../src/backend/config/integrationSettingsRepository';
import { updateIntegrationSettings } from '../src/backend/config/settingsUpdater';
import { createResolvedDatabasePool } from '../src/backend/database/pool';

async function run() {
  const endpoint = process.argv[2]?.trim();
  const deployment = process.argv[3]?.trim();
  if (!endpoint || !deployment) {
    throw new Error('Usage: tsx scripts/configure-sales-ai.ts <endpoint> <deployment>');
  }
  const pool = await createResolvedDatabasePool();
  try {
    const result = await updateIntegrationSettings(
      {
        integrationId: 'azure-openai',
        actor: 'azure-ai-deployment',
        role: 'Admin',
        nonSecrets: { endpoint, deployment },
        secrets: {},
      },
      {
        setSecret: async () => {
          throw new Error('Azure OpenAI integration must not write model API keys.');
        },
      },
      new PostgresIntegrationSettingsRepository(pool),
    );
    console.log(
      JSON.stringify(
        {
          integrationId: result.integrationId,
          savedNonSecretKeys: result.savedNonSecretKeys,
          configuredStatus: result.validation.configuredStatus,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
