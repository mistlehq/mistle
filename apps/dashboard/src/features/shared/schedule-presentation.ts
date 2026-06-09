import { findNextScheduleOccurrence, validateScheduleCronExpression } from "@mistle/time";

import type { StringComboboxOption } from "../forms/string-combobox-options.js";

const BrowserTimezoneOptions = Intl.supportedValuesOf("timeZone").map((timezone) => ({
  label: timezone,
  value: timezone,
}));

const MonthFieldLabels = new Map([
  ["1", "January"],
  ["2", "February"],
  ["3", "March"],
  ["4", "April"],
  ["5", "May"],
  ["6", "June"],
  ["7", "July"],
  ["8", "August"],
  ["9", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"],
  ["JAN", "January"],
  ["FEB", "February"],
  ["MAR", "March"],
  ["APR", "April"],
  ["MAY", "May"],
  ["JUN", "June"],
  ["JUL", "July"],
  ["AUG", "August"],
  ["SEP", "September"],
  ["OCT", "October"],
  ["NOV", "November"],
  ["DEC", "December"],
]);

const DayOfWeekFieldLabels = new Map([
  ["0", "Sun"],
  ["1", "Mon"],
  ["2", "Tue"],
  ["3", "Wed"],
  ["4", "Thu"],
  ["5", "Fri"],
  ["6", "Sat"],
  ["7", "Sun"],
  ["SUN", "Sun"],
  ["MON", "Mon"],
  ["TUE", "Tue"],
  ["WED", "Wed"],
  ["THU", "Thu"],
  ["FRI", "Fri"],
  ["SAT", "Sat"],
]);

export const SchedulePreviewPrompt =
  "Enter a valid cron expression and timezone to preview the schedule.";

export type CronExpressionBreakdown = Readonly<{
  minute: string;
  hour: string;
  hourDescription: string;
  dayOfMonthExpression: string;
  dayOfMonth: string;
  monthExpression: string;
  month: string;
  dayOfWeekExpression: string;
  dayOfWeek: string;
}>;

export function createTimezoneOptions(
  persistedTimezone: string | null,
): readonly StringComboboxOption[] {
  if (
    persistedTimezone === null ||
    persistedTimezone.trim().length === 0 ||
    BrowserTimezoneOptions.some((option) => option.value === persistedTimezone)
  ) {
    return BrowserTimezoneOptions;
  }

  return [
    {
      label: persistedTimezone,
      value: persistedTimezone,
    },
    ...BrowserTimezoneOptions,
  ];
}

export function resolveCronExpressionBreakdown(
  cronExpression: string,
): CronExpressionBreakdown | null {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  try {
    validateScheduleCronExpression(cronExpression);
  } catch {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    return null;
  }

  return {
    minute,
    hour,
    hourDescription: formatHourFieldLabel(hour),
    dayOfMonthExpression: dayOfMonth,
    dayOfMonth: describeCronField({
      everyLabel: "Every day",
      field: dayOfMonth,
      labelMap: null,
    }),
    monthExpression: month,
    month: describeCronField({
      everyLabel: "Every month",
      field: month,
      labelMap: MonthFieldLabels,
    }),
    dayOfWeekExpression: dayOfWeek,
    dayOfWeek: describeCronField({
      everyLabel: "Every day",
      field: dayOfWeek,
      labelMap: DayOfWeekFieldLabels,
    }),
  };
}

function describeCronField(input: {
  everyLabel: string;
  field: string;
  labelMap: ReadonlyMap<string, string> | null;
}): string {
  if (input.field === "*") {
    return input.everyLabel;
  }

  const parts = input.field.split(",");
  const labels = parts.map((part) =>
    describeCronFieldPart({
      part,
      labelMap: input.labelMap,
    }),
  );
  if (labels.length === 1) {
    const label = labels[0];
    if (label === undefined) {
      throw new Error("Cron field part did not produce a label.");
    }
    return label;
  }

  return labels.join(", ");
}

function describeCronFieldPart(input: {
  part: string;
  labelMap: ReadonlyMap<string, string> | null;
}): string {
  const stepParts = input.part.split("/");
  const basePart = stepParts[0];
  const step = stepParts[1];
  if (basePart === undefined || stepParts.length > 2) {
    return input.part;
  }

  if (step !== undefined && step.trim().length > 0) {
    const baseDescription =
      basePart === "*"
        ? ""
        : ` in ${describeCronFieldPart({
            part: basePart,
            labelMap: input.labelMap,
          })}`;

    return `Every ${step}${baseDescription}`;
  }

  if (basePart.includes("-")) {
    const [start, end] = basePart.split("-");
    if (start !== undefined && end !== undefined) {
      return `${describeCronFieldPart({
        part: start,
        labelMap: input.labelMap,
      })}-${describeCronFieldPart({
        part: end,
        labelMap: input.labelMap,
      })}`;
    }
  }

  const mappedLabel = input.labelMap?.get(basePart.toUpperCase());
  if (mappedLabel !== undefined) {
    return mappedLabel;
  }

  return basePart;
}

export function formatCronExpressionBreakdownDiagram(input: CronExpressionBreakdown): string {
  return [
    `${input.minute} ${input.hour} ${input.dayOfMonthExpression} ${input.monthExpression} ${input.dayOfWeekExpression}`,
    "| | | | |",
    `| | | | day of week: ${input.dayOfWeek}`,
    `| | | month: ${input.month.toLowerCase()}`,
    `| | day of month: ${input.dayOfMonth.toLowerCase()}`,
    `| hour: ${lowerLeadingEvery(input.hourDescription)}`,
    `minute: ${formatMinuteLabel(input.minute)}`,
  ].join("\n");
}

function formatMinuteLabel(minute: string): string {
  if (minute === "*") {
    return "every minute";
  }

  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `every ${interval} minutes`;
  }

  return `at minute ${minute}`;
}

function formatHourFieldLabel(hour: string): string {
  return formatHourFieldLabelStrict(hour) ?? hour;
}

function formatHourFieldLabelStrict(hour: string): string | null {
  if (hour === "*") {
    return "Every hour";
  }

  const labels = hour.split(",").map(formatHourFieldPartLabel);
  if (labels.some((label) => label === null)) {
    return null;
  }

  return labels.join(", ");
}

function formatHourFieldPartLabel(part: string): string | null {
  const stepParts = part.split("/");
  const basePart = stepParts[0];
  const step = stepParts[1];
  if (basePart === undefined || stepParts.length > 2) {
    return null;
  }

  if (step !== undefined) {
    if (!isPositiveIntegerString(step)) {
      return null;
    }

    if (basePart === "*") {
      return `Every ${step} hours`;
    }

    const rangeLabel = formatHourRangeLabel(basePart);
    return rangeLabel === null ? null : `Every ${step} hours from ${rangeLabel}`;
  }

  const rangeLabel = formatHourRangeLabel(basePart);
  if (rangeLabel !== null) {
    return rangeLabel;
  }

  const singleHourLabel = formatSingleHourFieldLabel(basePart);
  return singleHourLabel === null ? null : singleHourLabel;
}

function formatHourRangeLabel(value: string): string | null {
  const [start, end] = value.split("-");
  if (start === undefined || end === undefined || !value.includes("-")) {
    return null;
  }

  const startLabel = formatSingleHourFieldLabel(start);
  const endLabel = formatSingleHourFieldLabel(end);
  if (startLabel === null || endLabel === null) {
    return null;
  }

  return `${startLabel} to ${endLabel}`;
}

function formatSingleHourFieldLabel(value: string): string | null {
  return isIntegerString(value) ? formatHourValueLabel(value) : null;
}

function isIntegerString(value: string): boolean {
  return /^-?\d+$/u.test(value);
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/u.test(value) && Number(value) > 0;
}

function formatHourValueLabel(hour: string): string {
  const hourNumber = Number(hour);
  if (!Number.isInteger(hourNumber) || hourNumber < 0 || hourNumber > 23) {
    return hour;
  }

  if (hourNumber === 0) {
    return "12 AM";
  }

  if (hourNumber < 12) {
    return `${hourNumber} AM`;
  }

  if (hourNumber === 12) {
    return "12 PM";
  }

  return `${hourNumber - 12} PM`;
}

export function formatCronExpressionReadableSummary(cronExpression: string): string | null {
  const breakdown = resolveCronExpressionBreakdown(cronExpression);
  if (breakdown === null) {
    return null;
  }

  const timeSummary = formatTimeSummary(breakdown);
  if (
    timeSummary === null ||
    hasUnsupportedReadableDateField(breakdown.dayOfMonthExpression) ||
    hasUnsupportedReadableDateField(breakdown.monthExpression) ||
    hasUnsupportedReadableDateField(breakdown.dayOfWeekExpression)
  ) {
    return null;
  }

  const parts = [timeSummary];
  if (breakdown.dayOfMonthExpression !== "*") {
    parts.push(lowerLeadingEvery(breakdown.dayOfMonth));
  }
  if (breakdown.monthExpression !== "*") {
    parts.push(lowerLeadingEvery(breakdown.month));
  }
  if (breakdown.dayOfWeekExpression !== "*") {
    parts.push(lowerLeadingEvery(breakdown.dayOfWeek));
  }

  return sentenceCase(parts.join(", "));
}

function hasUnsupportedReadableDateField(field: string): boolean {
  return field.includes("/");
}

function formatTimeSummary(input: CronExpressionBreakdown): string | null {
  const singleHourLabel = formatSingleHourFieldLabel(input.hour);
  if (singleHourLabel !== null && isIntegerString(input.minute)) {
    return formatClockTimeSummary({
      hour: input.hour,
      minute: input.minute,
    });
  }

  const hourSummary = formatHourFieldLabelStrict(input.hour);
  if (hourSummary === null) {
    return null;
  }

  if (input.minute === "0") {
    return lowerLeadingEvery(hourSummary);
  }

  if (isIntegerString(input.minute)) {
    return `${lowerLeadingEvery(hourSummary)} at minute ${input.minute}`;
  }

  const minuteInterval = resolveMinuteInterval(input.minute);
  if (minuteInterval === null) {
    return null;
  }

  if (input.hour === "*") {
    return `every ${minuteInterval} minutes`;
  }

  if (singleHourLabel !== null) {
    return `every ${minuteInterval} minutes during ${singleHourLabel}`;
  }

  const hourRangeLabel = formatHourRangeLabel(input.hour);
  if (hourRangeLabel !== null) {
    return `every ${minuteInterval} minutes from ${hourRangeLabel}`;
  }

  return null;
}

function resolveMinuteInterval(minute: string): string | null {
  if (!minute.startsWith("*/")) {
    return null;
  }

  const interval = minute.slice(2);
  return isPositiveIntegerString(interval) ? interval : null;
}

function formatClockTimeSummary(input: { hour: string; minute: string }): string {
  const minuteNumber = Number(input.minute);
  if (!Number.isInteger(minuteNumber) || minuteNumber < 0 || minuteNumber > 59) {
    return `${lowerLeadingEvery(formatHourValueLabel(input.hour))} at ${formatMinuteLabel(
      input.minute,
    )}`;
  }

  const hourNumber = Number(input.hour);
  const period = hourNumber < 12 ? "AM" : "PM";
  const hour = hourNumber === 0 ? 12 : hourNumber > 12 ? hourNumber - 12 : hourNumber;
  return `${hour}:${String(minuteNumber).padStart(2, "0")} ${period}`;
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function lowerLeadingEvery(value: string): string {
  return value.startsWith("Every ") ? `every ${value.slice("Every ".length)}` : value;
}

export function resolveScheduleBehaviorDescription(input: {
  after: Date;
  cronExpression: string;
  occurrenceLabel: string;
  previewPrompt: string;
  timezone: string;
}): string {
  const cronExpression = input.cronExpression.trim();
  const timezone = input.timezone.trim();
  if (cronExpression.length === 0 || timezone.length === 0) {
    return input.previewPrompt;
  }

  try {
    const occurrence = findNextScheduleOccurrence({
      after: input.after,
      cronExpression,
      timezone,
    });

    if (occurrence === null) {
      return `No future ${input.occurrenceLabel.toLowerCase()} is scheduled.`;
    }

    return `Next ${input.occurrenceLabel.toLowerCase()}: ${occurrence.localScheduledDate} ${occurrence.localScheduledTime} ${timezone}.`;
  } catch {
    return input.previewPrompt;
  }
}

export function resolveSnapshotRefreshScheduleBehaviorDescription(input: {
  after: Date;
  cronExpression: string;
  timezone: string;
}): string {
  return resolveScheduleBehaviorDescription({
    ...input,
    occurrenceLabel: "refresh",
    previewPrompt: SchedulePreviewPrompt,
  });
}
