import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

export type MigrationResult = {
  name: string;
  checksum: string;
  status: 'applied' | 'already-applied';
};

export type RunSchemaMigrationOptions = {
  pool: Pool;
  schemaPath?: string;
  name?: string;
};

export async function runSchemaMigration(options: RunSchemaMigrationOptions): Promise<MigrationResult> {
  const schemaPath = options.schemaPath ?? path.resolve(process.cwd(), 'infra/database/schema.sql');
  const name = options.name ?? 'initial_schema';
  const sql = await readFile(schemaPath, 'utf8');
  const checksum = checksumSql(sql);
  const client = await options.pool.connect();

  try {
    await client.query('begin');
    await ensureMigrationTable(client);

    const existing = await client.query<{ checksum: string }>(
      `select checksum
       from schema_migrations
       where name = $1
       order by applied_at desc
       limit 1`,
      [name],
    );

    if (existing.rows[0]?.checksum === checksum) {
      await client.query('commit');
      return {
        name,
        checksum,
        status: 'already-applied',
      };
    }

    await client.query(sql);
    await client.query(
      `insert into schema_migrations (name, checksum)
       values ($1, $2)`,
      [name, checksum],
    );
    await client.query('commit');

    return {
      name,
      checksum,
      status: 'applied',
    };
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export function checksumSql(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    create table if not exists schema_migrations (
      id bigserial primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function safeRollback(client: PoolClient) {
  try {
    await client.query('rollback');
  } catch {
    // Ignore rollback errors so the original migration failure remains visible.
  }
}
