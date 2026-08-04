import 'dotenv/config';
import { PostgresIntegrationSettingsRepository } from '../src/backend/config/integrationSettingsRepository';
import { createIntegrationSettingsProvider } from '../src/backend/config/settingsProvider';
import { createResolvedDatabasePool } from '../src/backend/database/pool';
import { ConnectWiseCpqClient, cpqCredentialsFromSettings } from '../src/backend/sales/cpqClient';

async function run() {
  const quoteId = process.argv[2]?.trim();
  const pool = await createResolvedDatabasePool();
  try {
    const provider = createIntegrationSettingsProvider({
      metadataReader: new PostgresIntegrationSettingsRepository(pool),
    });
    const settings = await provider.getIntegrationSettings('connectwise-cpq');
    if (settings.validation.configuredStatus !== 'connected') {
      const missing = [
        ...settings.validation.missingSecrets.map((item) => item.label),
        ...settings.validation.missingNonSecrets.map((item) => item.label),
      ];
      throw new Error(`ConnectWise CPQ is not configured: ${missing.join(', ')}`);
    }

    const client = new ConnectWiseCpqClient(cpqCredentialsFromSettings(settings));
    const result = await client.verifyCapabilities();
    const quote = quoteId ? await client.getQuote(quoteId) : undefined;
    console.log(
      JSON.stringify(
        {
          reachable: result.reachable,
          endpoint: settings.nonSecrets.endpoint,
          accessKey: settings.nonSecrets.accessKey,
          secretSource: settings.secretSource,
          templateCount: result.templateCount,
          templates: result.templates.map((template) => ({
            id: template.id,
            name: template.name,
          })),
          writeOperationsVerified: result.writeOperationsVerified,
          note: result.note,
          quoteRead: quote
            ? {
                id: quote.id,
                name: quote.name,
                status: quote.status,
                lineCount: quote.lines.length,
                deepLinkGenerated: Boolean(quote.url),
              }
            : undefined,
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
