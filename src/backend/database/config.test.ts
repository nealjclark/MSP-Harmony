import assert from 'node:assert/strict';
import { describeDatabaseSettings, getDatabaseSettings, requireDatabaseSettings, toPoolConfig } from './config';
import { checksumSql } from './migrationRunner';

const missing = getDatabaseSettings({});
assert.deepEqual(missing.missing, ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD']);
assert.throws(() => requireDatabaseSettings(missing), /Missing database settings/);

const discrete = getDatabaseSettings({
  DATABASE_HOST: 'msp-harmony.postgres.database.azure.com',
  DATABASE_NAME: 'mspharmony',
  DATABASE_USER: 'mspadmin',
  DATABASE_PASSWORD: 'secret',
});
assert.deepEqual(discrete.missing, []);
assert.equal(discrete.port, 5432);
assert.equal(discrete.ssl, true);
assert.equal(discrete.authMode, 'password');

const poolConfig = toPoolConfig(discrete);
assert.equal(poolConfig.host, 'msp-harmony.postgres.database.azure.com');
assert.equal(poolConfig.database, 'mspharmony');
assert.equal(typeof poolConfig.ssl, 'object');

const urlSettings = getDatabaseSettings({
  DATABASE_URL: 'postgres://user:password@example.postgres.database.azure.com:5432/mspharmony',
  DATABASE_SSL: 'false',
});
assert.deepEqual(urlSettings.missing, []);
assert.equal(urlSettings.ssl, false);
assert.equal(toPoolConfig(urlSettings).connectionString, 'postgres://user:password@example.postgres.database.azure.com:5432/mspharmony');
assert.equal(describeDatabaseSettings(urlSettings).host, 'example.postgres.database.azure.com:5432');

const entra = getDatabaseSettings({
  DATABASE_HOST: 'msp-harmony.postgres.database.azure.com',
  DATABASE_NAME: 'mspharmony',
  DATABASE_USER: 'func-mspharmony-flex',
  DATABASE_AUTH_MODE: 'entra',
});
assert.deepEqual(entra.missing, []);
assert.equal(entra.authMode, 'entra');
assert.equal(describeDatabaseSettings(entra).authMode, 'entra');

assert.equal(checksumSql('select 1;').length, 64);

console.log('database config tests passed');
