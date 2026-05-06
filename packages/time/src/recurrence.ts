import { Cron } from "croner";

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

export function findNextScheduleOccurrence(
  input: FindNextScheduleOccurrenceInput,
): ScheduleOccurrence | null {
  validateScheduleCronExpression(input.cronExpression);
  validateIanaTimezone(input.timezone);

  const cron = new Cron(input.cronExpression, {
    mode: "5-part",
    paused: true,
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

  return {
    scheduledAt: new Date(nextRun.getTime()),
    ...getScheduledLocalSlot({
      scheduledAt: nextRun,
      timezone: input.timezone,
    }),
  };
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
