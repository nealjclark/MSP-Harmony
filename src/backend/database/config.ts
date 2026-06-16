import type { PoolConfig } from 'pg';

export type DatabaseEnvironment = Record<string, string | undefined>;

export type DatabaseSettings = {
  connectionString?: string;
  host?: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  ssl: boolean;
  missing: string[];
};

export function getDatabaseSettings(env: DatabaseEnvironment = process.env): DatabaseSettings {
  const connectionString = clean(env.DATABASE_URL);
  const host = clean(env.DATABASE_HOST);
  const database = clean(env.DATABASE_NAME);
  const user = clean(env.DATABASE_USER);
  const password = clean(env.DATABASE_PASSWORD);
  const ssl = env.DATABASE_SSL ? env.DATABASE_SSL.toLowerCase() !== 'false' : true;
  const port = Number.parseInt(env.DATABASE_PORT ?? '5432', 10);
  const missing = connectionString ? [] : requiredMissing({ DATABASE_HOST: host, DATABASE_NAME: database, DATABASE_USER: user, DATABASE_PASSWORD: password });

  return {
    connectionString,
    host,
    port: Number.isNaN(port) ? 5432 : port,
    database,
    user,
    password,
    ssl,
    missing,
  };
}

export function requireDatabaseSettings(settings: DatabaseSettings = getDatabaseSettings()) {
  if (settings.missing.length > 0) {
    throw new Error(`Missing database settings: ${settings.missing.join(', ')}`);
  }

  return settings;
}

export function toPoolConfig(settings: DatabaseSettings = requireDatabaseSettings()): PoolConfig {
  const ssl = settings.ssl ? { rejectUnauthorized: false } : false;

  if (settings.connectionString) {
    return {
      connectionString: settings.connectionString,
      ssl,
    };
  }

  return {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl,
  };
}

export function describeDatabaseSettings(settings: DatabaseSettings = getDatabaseSettings()) {
  return {
    source: settings.connectionString ? 'DATABASE_URL' : 'DATABASE_*',
    host: settings.connectionString ? redactConnectionStringHost(settings.connectionString) : settings.host,
    port: settings.connectionString ? undefined : settings.port,
    database: settings.connectionString ? undefined : settings.database,
    user: settings.connectionString ? undefined : settings.user,
    ssl: settings.ssl,
    missing: settings.missing,
  };
}

function requiredMissing(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function redactConnectionStringHost(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    return parsed.host;
  } catch {
    return 'unparseable connection string';
  }
}
