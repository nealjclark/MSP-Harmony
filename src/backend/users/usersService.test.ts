import assert from 'node:assert/strict';
import {
  createManagedAppUser,
  listManagedAppUsers,
  updateManagedAppUser,
  type ManagedAppUser,
} from './usersService';

type QueryCall = {
  sql: string;
  params?: unknown[];
};

class MockDatabase {
  calls: QueryCall[] = [];
  responses: Array<{ rows: unknown[] }> = [];

  async query<T>(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No mock database response was queued.');
    }

    return response as { rows: T[] };
  }
}

const baseRow = {
  id: 'user-1',
  aad_user_id: null,
  email: 'admin@example.com',
  display_name: 'Admin User',
  role: 'Admin',
  status: 'active',
  last_seen_at: null,
  created_by: 'seed',
  updated_by: 'seed',
  created_at: '2026-06-25T12:00:00.000Z',
  updated_at: '2026-06-25T12:00:00.000Z',
};

async function run() {
  const listDatabase = new MockDatabase();
  listDatabase.responses.push({ rows: [baseRow] });
  const listedUsers = await listManagedAppUsers(listDatabase);
  assert.equal(listedUsers[0]?.email, 'admin@example.com');
  assert.equal(listedUsers[0]?.role, 'Admin');

  await assert.rejects(
    () => createManagedAppUser(new MockDatabase(), { email: 'not-an-email', role: 'Analyst' }, 'admin@example.com'),
    /Email is required/,
  );

  const createDatabase = new MockDatabase();
  createDatabase.responses.push(
    { rows: [] },
    {
      rows: [
        {
          ...baseRow,
          id: 'user-2',
          email: 'analyst@example.com',
          display_name: null,
          role: 'Analyst',
        },
      ],
    },
  );
  const created = await createManagedAppUser(
    createDatabase,
    { email: 'ANALYST@example.com', role: 'Analyst' },
    'admin@example.com',
  );
  assert.equal(created.created, true);
  assert.equal(created.user.email, 'analyst@example.com');
  assert.equal(created.user.role, 'Analyst');

  const updateDatabase = new MockDatabase();
  updateDatabase.responses.push(
    { rows: [baseRow] },
    { rows: [{ count: '1' }] },
    {
      rows: [
        {
          ...baseRow,
          role: 'Approver',
          updated_by: 'admin@example.com',
        },
      ],
    },
  );
  const updated = await updateManagedAppUser(
    updateDatabase,
    'user-1',
    { displayName: 'Updated Admin', role: 'Approver', status: 'active' },
    'admin@example.com',
  );
  assert.equal(updated.role, 'Approver');

  const lockoutDatabase = new MockDatabase();
  lockoutDatabase.responses.push({ rows: [baseRow] }, { rows: [{ count: '0' }] });
  await assert.rejects(
    () => updateManagedAppUser(lockoutDatabase, 'user-1', { role: 'Analyst' }, 'admin@example.com'),
    /At least one active Admin/,
  );

  assertUserShape(updated);
  console.log('users service tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function assertUserShape(user: ManagedAppUser) {
  assert.equal(typeof user.id, 'string');
  assert.equal(typeof user.email, 'string');
  assert.equal(typeof user.createdAt, 'string');
  assert.equal(typeof user.updatedAt, 'string');
}
