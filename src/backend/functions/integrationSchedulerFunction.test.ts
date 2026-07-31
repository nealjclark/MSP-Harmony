import assert from 'node:assert/strict';
import type { IntegrationSyncScheduleEntry } from '../../shared/integrationSchedules';
import { dispatchDueIntegrationSyncs } from './integrationSchedulerFunction';

const entries: IntegrationSyncScheduleEntry[] = [
  {
    integrationId: 'opentext-appriver',
    operationKey: 'subscription-snapshots',
    frequency: 'weekly',
    scheduledHour: 6,
    weekdays: [2, 4],
    dayOfMonth: 1,
    timeZone: 'America/New_York',
  },
  {
    integrationId: 'cove',
    operationKey: 'usage-snapshots',
    frequency: 'daily',
    scheduledHour: 6,
    weekdays: [],
    dayOfMonth: 1,
    timeZone: 'America/New_York',
  },
  {
    integrationId: 'microsoft-365',
    operationKey: 'm365-licenses',
    frequency: 'daily',
    scheduledHour: 6,
    weekdays: [],
    dayOfMonth: 1,
    timeZone: 'America/New_York',
  },
];

async function run() {
  const claims: Array<{ integrationId: string; operationKey: string; slot: string }> = [];
  const messages = await dispatchDueIntegrationSyncs({
    now: new Date('2026-07-28T10:00:00.000Z'),
    repository: {
      async listSyncScheduleEntries() {
        return entries;
      },
      async claimScheduledSync(input) {
        claims.push({
          integrationId: input.integrationId,
          operationKey: input.operationKey,
          slot: input.slot,
        });
        return `job-${claims.length}`;
      },
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(claims.length, 2);
  assert.equal(messages[0]?.integrationId, 'opentext-appriver');
  assert.equal(messages[0]?.jobId, 'job-1');
  assert.equal(messages[1]?.integrationId, 'cove');

  let sqlReads = 0;
  const outsideWindow = await dispatchDueIntegrationSyncs({
    now: new Date('2026-07-28T09:00:00.000Z'),
    repository: {
      async listSyncScheduleEntries() {
        sqlReads += 1;
        return entries;
      },
      async claimScheduledSync() {
        return undefined;
      },
    },
  });
  assert.deepEqual(outsideWindow, []);
  assert.equal(sqlReads, 0);

  console.log('integration scheduler function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
