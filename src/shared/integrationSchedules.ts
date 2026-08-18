import {
  getIntegrationSettingsDefinition,
  listIntegrationApiOperations,
  type IntegrationId,
} from './integrationSettings';

export type IntegrationSyncScheduleFrequency = 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly';

export type IntegrationOperationSchedule = {
  operationKey: string;
  frequency: IntegrationSyncScheduleFrequency;
  scheduledHour: number;
  weekdays: number[];
  dayOfMonth: number;
};

export type IntegrationSyncSchedule = {
  frequency: IntegrationSyncScheduleFrequency;
  scheduledHour: number;
  weekdays: number[];
  dayOfMonth: number;
  timeZone: string;
  operationKeys: string[];
  operationSchedules?: IntegrationOperationSchedule[];
  lastEnqueuedAt?: string;
};

export type IntegrationSyncScheduleEntry = {
  integrationId: IntegrationId;
  operationKey: string;
  frequency: Exclude<IntegrationSyncScheduleFrequency, 'manual'>;
  scheduledHour: number;
  weekdays: number[];
  dayOfMonth: number;
  timeZone: string;
  lastEnqueuedSlot?: string;
  lastEnqueuedAt?: string;
};

export type DueIntegrationSyncSchedule = IntegrationSyncScheduleEntry & {
  slot: string;
};

export const integrationSchedulerTimeZone = 'America/New_York';
export const integrationSchedulerFirstHour = 6;
export const integrationSchedulerLastHour = 17;

export function defaultIntegrationSyncSchedule(integrationId: IntegrationId): IntegrationSyncSchedule {
  return {
    frequency: 'manual',
    scheduledHour: integrationSchedulerFirstHour,
    weekdays: integrationId === 'opentext-appriver' ? [2, 4] : [],
    dayOfMonth: 1,
    timeZone: integrationSchedulerTimeZone,
    operationKeys: listIntegrationApiOperations(integrationId).map((operation) => operation.key),
  };
}

export function validateIntegrationSyncSchedule(
  integrationId: IntegrationId,
  schedule: IntegrationSyncSchedule,
): IntegrationSyncSchedule {
  const definition = getIntegrationSettingsDefinition(integrationId);
  if (!definition?.capabilities.includes('live-api')) {
    throw new Error(`${definition?.displayName ?? integrationId} does not support scheduled API synchronization.`);
  }

  if (schedule.timeZone !== integrationSchedulerTimeZone) {
    throw new Error(`Sync schedules currently use the ${integrationSchedulerTimeZone} time zone.`);
  }

  const allowedOperationKeys = new Set(listIntegrationApiOperations(integrationId).map((operation) => operation.key));
  if (schedule.operationSchedules && schedule.operationSchedules.length > 0) {
    const operationSchedules = schedule.operationSchedules.map((item) =>
      validateOperationSchedule(item, allowedOperationKeys),
    );
    const enabled = operationSchedules.filter((item) => item.frequency !== 'manual');
    return {
      frequency: enabled[0]?.frequency ?? 'manual',
      scheduledHour: enabled[0]?.scheduledHour ?? schedule.scheduledHour ?? integrationSchedulerFirstHour,
      weekdays: enabled[0]?.weekdays ?? [],
      dayOfMonth: enabled.find((item) => item.frequency === 'monthly')?.dayOfMonth ?? 2,
      timeZone: schedule.timeZone,
      operationKeys: enabled.map((item) => item.operationKey),
      operationSchedules,
      lastEnqueuedAt: schedule.lastEnqueuedAt,
    };
  }

  validateScheduleTiming(schedule.frequency, schedule.scheduledHour, schedule.weekdays, schedule.dayOfMonth);
  const weekdays = [...new Set(schedule.weekdays)].sort((left, right) => left - right);
  const operationKeys = [...new Set(schedule.operationKeys)];
  const unknownOperationKeys = operationKeys.filter((operationKey) => !allowedOperationKeys.has(operationKey));
  if (unknownOperationKeys.length > 0) {
    throw new Error(`Unknown scheduled sync operations: ${unknownOperationKeys.join(', ')}`);
  }
  if (schedule.frequency !== 'manual' && operationKeys.length === 0) {
    throw new Error('Automatic sync schedules require at least one selected operation.');
  }

  return {
    frequency: schedule.frequency,
    scheduledHour: schedule.scheduledHour,
    weekdays,
    dayOfMonth: schedule.dayOfMonth,
    timeZone: schedule.timeZone,
    operationKeys,
    lastEnqueuedAt: schedule.lastEnqueuedAt,
  };
}

function validateOperationSchedule(
  schedule: IntegrationOperationSchedule,
  allowedOperationKeys: Set<string>,
): IntegrationOperationSchedule {
  if (!allowedOperationKeys.has(schedule.operationKey)) {
    throw new Error(`Unknown scheduled sync operations: ${schedule.operationKey}`);
  }
  validateScheduleTiming(schedule.frequency, schedule.scheduledHour, schedule.weekdays, schedule.dayOfMonth);
  return {
    operationKey: schedule.operationKey,
    frequency: schedule.frequency,
    scheduledHour: schedule.scheduledHour,
    weekdays: [...new Set(schedule.weekdays)].sort((left, right) => left - right),
    dayOfMonth: schedule.dayOfMonth,
  };
}

function validateScheduleTiming(
  frequency: IntegrationSyncScheduleFrequency,
  scheduledHour: number,
  weekdays: number[],
  dayOfMonth: number,
) {
  if (!['manual', 'hourly', 'daily', 'weekly', 'monthly'].includes(frequency)) {
    throw new Error(`Unsupported sync schedule frequency "${String(frequency)}".`);
  }
  if (
    !Number.isInteger(scheduledHour) ||
    scheduledHour < integrationSchedulerFirstHour ||
    scheduledHour > integrationSchedulerLastHour
  ) {
    throw new Error(
      `Scheduled sync hour must be between ${integrationSchedulerFirstHour}:00 and ${integrationSchedulerLastHour}:00 Eastern.`,
    );
  }
  if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Scheduled weekdays must use values from 0 (Sunday) through 6 (Saturday).');
  }
  if (frequency === 'weekly' && weekdays.length === 0) {
    throw new Error('Weekly sync schedules require at least one weekday.');
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error('Monthly sync day must be between 1 and 31.');
  }
}

export function dueIntegrationSyncSchedule(
  schedule: IntegrationSyncScheduleEntry,
  now = new Date(),
): DueIntegrationSyncSchedule | undefined {
  const local = zonedDateParts(now, schedule.timeZone);
  const scheduledToday =
    schedule.frequency === 'hourly' ||
    schedule.frequency === 'daily' ||
    (schedule.frequency === 'weekly' && schedule.weekdays.includes(local.weekday)) ||
    (schedule.frequency === 'monthly' && local.day === Math.min(schedule.dayOfMonth, local.daysInMonth));

  if (!scheduledToday) return undefined;
  if (schedule.frequency !== 'hourly' && local.hour < schedule.scheduledHour) return undefined;

  const slot =
    schedule.frequency === 'hourly'
      ? `${schedule.frequency}:${local.date}:${String(local.hour).padStart(2, '0')}`
      : `${schedule.frequency}:${local.date}:${String(schedule.scheduledHour).padStart(2, '0')}`;
  if (schedule.lastEnqueuedSlot === slot) return undefined;

  return { ...schedule, slot };
}

export function isIntegrationSchedulerBusinessHour(now = new Date()) {
  const hour = zonedDateParts(now, integrationSchedulerTimeZone).hour;
  return hour >= integrationSchedulerFirstHour && hour <= integrationSchedulerLastHour;
}

function zonedDateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    month: '2-digit',
    timeZone,
    weekday: 'short',
    year: 'numeric',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));

  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    day,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    hour: Number(value('hour')),
    weekday,
  };
}
