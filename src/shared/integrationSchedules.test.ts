import assert from 'node:assert/strict';
import {
  dueIntegrationSyncSchedule,
  isIntegrationSchedulerBusinessHour,
  validateIntegrationSyncSchedule,
  type IntegrationSyncScheduleEntry,
} from './integrationSchedules';

const appRiverSchedule: IntegrationSyncScheduleEntry = {
  integrationId: 'opentext-appriver',
  operationKey: 'subscription-snapshots',
  frequency: 'weekly',
  scheduledHour: 6,
  weekdays: [2, 4],
  dayOfMonth: 1,
  timeZone: 'America/New_York',
};

const tuesdayAtSixEastern = new Date('2026-07-28T10:00:00.000Z');
const tuesdayAtSevenEastern = new Date('2026-07-28T11:00:00.000Z');
const wednesdayAtSixEastern = new Date('2026-07-29T10:00:00.000Z');

assert.equal(dueIntegrationSyncSchedule(appRiverSchedule, tuesdayAtSixEastern)?.slot, 'weekly:2026-07-28:06');
assert.equal(dueIntegrationSyncSchedule(appRiverSchedule, tuesdayAtSevenEastern)?.slot, 'weekly:2026-07-28:06');
assert.equal(dueIntegrationSyncSchedule(appRiverSchedule, wednesdayAtSixEastern), undefined);
assert.equal(
  dueIntegrationSyncSchedule(
    { ...appRiverSchedule, lastEnqueuedSlot: 'weekly:2026-07-28:06' },
    tuesdayAtSevenEastern,
  ),
  undefined,
);

assert.equal(
  dueIntegrationSyncSchedule(
    {
      ...appRiverSchedule,
      frequency: 'monthly',
      weekdays: [],
      dayOfMonth: 31,
    },
    new Date('2026-06-30T10:00:00.000Z'),
  )?.slot,
  'monthly:2026-06-30:06',
);

assert.equal(isIntegrationSchedulerBusinessHour(new Date('2026-07-28T09:00:00.000Z')), false);
assert.equal(isIntegrationSchedulerBusinessHour(tuesdayAtSixEastern), true);
assert.equal(isIntegrationSchedulerBusinessHour(new Date('2026-07-28T21:00:00.000Z')), true);
assert.equal(isIntegrationSchedulerBusinessHour(new Date('2026-07-28T22:00:00.000Z')), false);

const validated = validateIntegrationSyncSchedule('opentext-appriver', {
  frequency: 'weekly',
  scheduledHour: 6,
  weekdays: [4, 2, 2],
  dayOfMonth: 1,
  timeZone: 'America/New_York',
  operationKeys: ['subscription-snapshots'],
});
assert.deepEqual(validated.weekdays, [2, 4]);

assert.throws(
  () =>
    validateIntegrationSyncSchedule('opentext-appriver', {
      frequency: 'weekly',
      scheduledHour: 6,
      weekdays: [],
      dayOfMonth: 1,
      timeZone: 'America/New_York',
      operationKeys: ['subscription-snapshots'],
    }),
  /at least one weekday/i,
);

const azureSchedules = validateIntegrationSyncSchedule('microsoft-azure', {
  frequency: 'manual',
  scheduledHour: 6,
  weekdays: [],
  dayOfMonth: 2,
  timeZone: 'America/New_York',
  operationKeys: [],
  operationSchedules: [
    {
      operationKey: 'azure-cost-usage',
      frequency: 'daily',
      scheduledHour: 6,
      weekdays: [],
      dayOfMonth: 1,
    },
    {
      operationKey: 'azure-cost-monthly',
      frequency: 'monthly',
      scheduledHour: 7,
      weekdays: [],
      dayOfMonth: 2,
    },
  ],
});
assert.deepEqual(azureSchedules.operationKeys, ['azure-cost-usage', 'azure-cost-monthly']);
assert.equal(azureSchedules.frequency, 'daily');
assert.equal(azureSchedules.dayOfMonth, 2);
assert.equal(azureSchedules.operationSchedules?.[1]?.frequency, 'monthly');

console.log('integration schedule tests passed');
