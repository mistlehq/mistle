import { describe, expect, it } from "vitest";

import {
  findNextScheduleOccurrence,
  findPreviousScheduleOccurrence,
  getScheduledLocalSlot,
  validateIanaTimezone,
  validateScheduleCronExpression,
} from "./recurrence.js";

describe("@mistle/time recurrence", () => {
  it("returns the next UTC instant and local slot for a valid 5-field cron expression", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T00:00:00.000Z"),
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:00:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:00",
    });
  });

  it("does not return the consumed scheduled instant when advancing from that instant", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T01:00:00.000Z"),
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence?.scheduledAt.toISOString()).toBe("2026-04-29T01:00:00.000Z");
  });

  it("returns the previous scheduled instant before a boundary", () => {
    const occurrence = findPreviousScheduleOccurrence({
      before: new Date("2026-04-28T01:30:00.000Z"),
      cronExpression: "*/10 * * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:20:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:20",
    });
  });

  it("caps previous scheduled occurrence lookup at the end bound", () => {
    const occurrence = findPreviousScheduleOccurrence({
      before: new Date("2026-04-28T01:30:00.000Z"),
      cronExpression: "* * * * *",
      endAt: new Date("2026-04-28T01:00:00.000Z"),
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:00:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:00",
    });
  });

  it("returns null when the next occurrence is after the end bound", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T00:00:00.000Z"),
      cronExpression: "0 9 * * *",
      endAt: new Date("2026-04-28T00:59:59.000Z"),
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toBeNull();
  });

  it("rejects invalid cron expressions", () => {
    expect(() => {
      validateScheduleCronExpression("not a cron expression");
    }).toThrow("Schedule cron expression must use exactly 5 fields.");
  });

  it("rejects cron expressions with seconds", () => {
    expect(() => {
      validateScheduleCronExpression("0 0 9 * * *");
    }).toThrow("Schedule cron expression must use exactly 5 fields.");
  });

  it("supports multiple minute slots", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T01:00:00.000Z"),
      cronExpression: "0,30 9 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:30:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:30",
    });
  });

  it("supports multiple hour slots", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T00:00:00.000Z"),
      cronExpression: "0 8,9 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:00:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:00",
    });
  });

  it("supports stepped minute intervals", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T01:00:00.000Z"),
      cronExpression: "*/15 9 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:15:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:15",
    });
  });

  it("supports hourly schedules at a fixed minute", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T01:00:00.000Z"),
      cronExpression: "1 * * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T01:01:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "09:01",
    });
  });

  it("supports stepped hour intervals", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-04-28T01:00:00.000Z"),
      cronExpression: "0 */2 * * *",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-04-28T02:00:00.000Z"),
      localScheduledDate: "2026-04-28",
      localScheduledTime: "10:00",
    });
  });

  it("supports sub-hour weekday business-hour intervals", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-05-04T00:45:00.000Z"),
      cronExpression: "*/30 9-17 * * 1-5",
      timezone: "Asia/Singapore",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-05-04T01:00:00.000Z"),
      localScheduledDate: "2026-05-04",
      localScheduledTime: "09:00",
    });
  });

  it("rejects invalid timezones", () => {
    expect(() => {
      validateIanaTimezone("Mars/Olympus_Mons");
    }).toThrow("Invalid IANA timezone: Mars/Olympus_Mons");
  });

  it("follows Croner spring-forward normalization for nonexistent local minutes", () => {
    const occurrence = findNextScheduleOccurrence({
      after: new Date("2026-03-07T00:00:00.000Z"),
      cronExpression: "30 2 * * *",
      timezone: "America/New_York",
    });

    expect(occurrence).toEqual({
      scheduledAt: new Date("2026-03-07T07:30:00.000Z"),
      localScheduledDate: "2026-03-07",
      localScheduledTime: "02:30",
    });

    const springForwardOccurrence = findNextScheduleOccurrence({
      after: new Date("2026-03-07T07:30:00.000Z"),
      cronExpression: "30 2 * * *",
      timezone: "America/New_York",
    });

    expect(springForwardOccurrence).toEqual({
      scheduledAt: new Date("2026-03-08T07:30:00.000Z"),
      localScheduledDate: "2026-03-08",
      localScheduledTime: "03:30",
    });
  });

  it("derives the same fall-back local slot key for repeated local minutes", () => {
    const firstRepeatedSlot = getScheduledLocalSlot({
      scheduledAt: new Date("2026-11-01T05:30:00.000Z"),
      timezone: "America/New_York",
    });
    const secondRepeatedSlot = getScheduledLocalSlot({
      scheduledAt: new Date("2026-11-01T06:30:00.000Z"),
      timezone: "America/New_York",
    });

    expect(firstRepeatedSlot).toEqual({
      localScheduledDate: "2026-11-01",
      localScheduledTime: "01:30",
    });
    expect(secondRepeatedSlot).toEqual(firstRepeatedSlot);
  });
});
