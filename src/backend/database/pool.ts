import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { Pool } from 'pg';
import { getDatabaseSettings, toPoolConfig, type DatabaseEnvironment, type DatabaseSettings } from './config';

let sharedPool: Pool | undefined;
let sharedPoolPromise: Promise<Pool> | undefined;
let cachedEntraPassword:
  | {
      token: string;
      expiresOnTimestamp: number;
    }
  | undefined;

const postgresEntraScope = 'https://ossrdbms-aad.database.windows.net/.default';

export function isKeyVaultAppSettingReference(value: string | undefined) {
  return Boolean(value?.trim().startsWith('@Microsoft.KeyVault'));
}

export async function resolveDatabasePassword(
  settings: DatabaseSettings,
  env: DatabaseEnvironment = process.env,
): Promise<string | undefined> {
  const password = settings.password;

  if (!password || !isKeyVaultAppSettingReference(password)) {
    return password;
  }

  const keyVaultUrl = env.KEY_VAULT_URL?.trim();
  if (!keyVaultUrl) {
    throw new Error('DATABASE_PASSWORD uses a Key Vault reference but KEY_VAULT_URL is not configured.');
  }

  const secretName = env.DATABASE_PASSWORD_SECRET_NAME?.trim() || 'mspharmony-postgres-admin-password';
  const client = new SecretClient(keyVaultUrl, new DefaultAzureCredential());
  const secret = await client.getSecret(secretName);

  return secret.value;
}

export async function createResolvedDatabasePool(env: DatabaseEnvironment = process.env): Promise<Pool> {
  const settings = getDatabaseSettings(env);

  if (settings.missing.length > 0) {
    throw new Error(`Missing database settings: ${settings.missing.join(', ')}`);
  }

  if (settings.authMode === 'entra') {
    const config = toPoolConfig({
      ...settings,
      password: undefined,
    });
    config.password = () => getPostgresEntraPassword();
    return new Pool(config);
  }

  const resolvedSettings: DatabaseSettings = {
    ...settings,
    password: await resolveDatabasePassword(settings, env),
  };

  if (!resolvedSettings.connectionString && !resolvedSettings.password) {
    throw new Error('Database password could not be resolved.');
  }

  return new Pool(toPoolConfig(resolvedSettings));
}

export async function getSharedDatabasePool(env: DatabaseEnvironment = process.env): Promise<Pool> {
  if (sharedPool) {
    return sharedPool;
  }

  if (!sharedPoolPromise) {
    sharedPoolPromise = createResolvedDatabasePool(env).then((pool) => {
      sharedPool = pool;
      return pool;
    });
  }

  return sharedPoolPromise;
}

async function getPostgresEntraPassword() {
  const now = Date.now();
  if (cachedEntraPassword && cachedEntraPassword.expiresOnTimestamp - now > 5 * 60 * 1000) {
    return cachedEntraPassword.token;
  }

  const credential = new DefaultAzureCredential();
  const token = await credential.getToken(postgresEntraScope);
  if (!token?.token) {
    throw new Error('Unable to acquire an Entra access token for PostgreSQL.');
  }

  cachedEntraPassword = {
    token: token.token,
    expiresOnTimestamp: token.expiresOnTimestamp,
  };
  return cachedEntraPassword.token;
}
