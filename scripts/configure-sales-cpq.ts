import 'dotenv/config';
import { PostgresIntegrationSettingsRepository } from '../src/backend/config/integrationSettingsRepository';
import { updateIntegrationSettings } from '../src/backend/config/settingsUpdater';
import { createResolvedDatabasePool } from '../src/backend/database/pool';

async function run() {
  const accessKey = process.argv[2]?.trim();
  const siteUrl = process.argv[3]?.trim();
  const requestedTestCompanyId = process.argv[4]?.trim();
  if (!accessKey || !siteUrl) {
    throw new Error(
      'Usage: tsx scripts/configure-sales-cpq.ts <access-key> <site-url> [pilot-test-company-id]',
    );
  }

  const pool = await createResolvedDatabasePool();
  try {
    const repository = new PostgresIntegrationSettingsRepository(pool);
    const existing = await repository.loadMetadata('connectwise-cpq');
    const testCompanyId = requestedTestCompanyId ?? existing?.nonSecrets.testCompanyId;
    if (!testCompanyId) {
      throw new Error(
        'Pilot Test Company ID is not already configured. Pass it as the third argument.',
      );
    }

    const result = await updateIntegrationSettings(
      {
        integrationId: 'connectwise-cpq',
        actor: 'connectwise-cpq-endpoint-fix',
        role: 'Admin',
        nonSecrets: {
          endpoint: 'https://sellapi.quosalsell.com',
          accessKey,
          templatesPath: '/api/templates',
          quotesPath: '/api/quotes',
          quoteItemsPath: '/api/quoteItems',
          quoteTabsPath: '/api/quoteTabs',
          testCompanyId,
          siteUrl,
          hardwareTabId: existing?.nonSecrets.hardwareTabId,
        },
        secrets: {},
        existingKeyVaultSecretNames: existing?.availableKeyVaultSecrets,
      },
      {
        setSecret: async () => {
          throw new Error('This command updates CPQ non-secret settings only.');
        },
      },
      repository,
    );

    console.log(
      JSON.stringify(
        {
          integrationId: result.integrationId,
          endpoint: 'https://sellapi.quosalsell.com',
          accessKey,
          siteUrl,
          savedNonSecretKeys: result.savedNonSecretKeys,
          configuredStatus: result.validation.configuredStatus,
          preservedSecretReferences: existing?.availableKeyVaultSecrets.length ?? 0,
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
