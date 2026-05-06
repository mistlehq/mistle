import { Cron } from "croner";

const CronResolutionMs = 60 * 1000;

export type ScheduledLocalSlot = Readonly<{
  localScheduledDate: string;
  localScheduledTime: string;
}>;

export type ScheduleOccurrence = ScheduledLocalSlot &
  Readonly<{
    scheduledAt: Date;
  }>;

export type FindNextScheduleOccurrenceInput = Readonly<{
  cronExpression: string;
  timezone: string;
  after: Date;
  endAt?: Date | null;
}>;

export type FindPreviousScheduleOccurrenceInput = Readonly<{
  cronExpression: string;
  timezone: string;
  before: Date;
  endAt?: Date | null;
}>;

export function findNextScheduleOccurrence(
  input: FindNextScheduleOccurrenceInput,
): ScheduleOccurrence | null {
  const cron = createPausedScheduleCron({
    cronExpression: input.cronExpression,
    timezone: input.timezone,
  });
  const nextRun = cron.nextRun(input.after);
  if (nextRun === null) {
    return null;
  }

  if (
    input.endAt !== undefined &&
    input.endAt !== null &&
    nextRun.getTime() > input.endAt.getTime()
  ) {
    return null;
  }

  return createScheduleOccurrence({
    scheduledAt: nextRun,
    timezone: input.timezone,
  });
}

export function findPreviousScheduleOccurrence(
  input: FindPreviousScheduleOccurrenceInput,
): ScheduleOccurrence | null {
  const cron = createPausedScheduleCron({
    cronExpression: input.cronExpression,
    timezone: input.timezone,
  });
  const reference =
    input.endAt !== undefined &&
    input.endAt !== null &&
    input.endAt.getTime() < input.before.getTime()
      ? new Date(input.endAt.getTime() + CronResolutionMs)
      : input.before;
  const previousRun = cron
    .previousRuns(2, reference)
    .find(
      (run) =>
        run.getTime() < input.before.getTime() &&
        (input.endAt === undefined ||
          input.endAt === null ||
          run.getTime() <= input.endAt.getTime()),
    );
  if (previousRun === undefined) {
    return null;
  }

  return createScheduleOccurrence({
    scheduledAt: previousRun,
    timezone: input.timezone,
  });
}

function createPausedScheduleCron(input: { cronExpression: string; timezone: string }): Cron {
  validateScheduleCronExpression(input.cronExpression);
  validateIanaTimezone(input.timezone);

  return new Cron(input.cronExpression, {
    mode: "5-part",
    paused: true,
    timezone: input.timezone,
  });
}

export function getScheduledLocalSlot(input: {
  scheduledAt: Date;
  timezone: string;
}): ScheduledLocalSlot {
  validateIanaTimezone(input.timezone);

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: input.timezone,
    year: "numeric",
  }).formatToParts(input.scheduledAt);

  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");
  const hour = getRequiredDatePart(parts, "hour");
  const minute = getRequiredDatePart(parts, "minute");

  return {
    localScheduledDate: `${year}-${month}-${day}`,
    localScheduledTime: `${hour}:${minute}`,
  };
}

function createScheduleOccurrence(input: {
  scheduledAt: Date;
  timezone: string;
}): ScheduleOccurrence {
  return {
    scheduledAt: new Date(input.scheduledAt.getTime()),
    ...getScheduledLocalSlot(input),
  };
}

export function validateScheduleCronExpression(cronExpression: string): void {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Schedule cron expression must use exactly 5 fields.");
  }

  new Cron(cronExpression, {
    mode: "5-part",
    paused: true,
  });
}

export function validateIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch (error) {
    throw new Error(`Invalid IANA timezone: ${timezone}`, { cause: error });
  }
}

function getRequiredDatePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`Formatted date did not include ${type}.`);
  }

  return part.value;
}
