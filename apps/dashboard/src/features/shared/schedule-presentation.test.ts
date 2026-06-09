import { describe, expect, it } from "vitest";

import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  formatCronExpressionReadableSummary,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
} from "./schedule-presentation.js";

describe("schedule presentation", () => {
  it("resolves cron field breakdowns", () => {
    expect(resolveCronExpressionBreakdown("0 9 * * 1,3,5")).toEqual({
      minute: "0",
      hour: "9",
      hourDescription: "9 AM",
      dayOfMonthExpression: "*",
      dayOfMonth: "Every day",
      monthExpression: "*",
      month: "Every month",
      dayOfWeekExpression: "1,3,5",
      dayOfWeek: "Mon, Wed, Fri",
    });

    const hourlyBreakdown = resolveCronExpressionBreakdown("15 * * * *");
    expect(hourlyBreakdown).not.toBeNull();
    if (hourlyBreakdown === null) {
      throw new Error("Expected hourly cron breakdown to resolve.");
    }
    const hourlyDiagram = formatCronExpressionBreakdownDiagram(hourlyBreakdown);
    expect(hourlyDiagram).toContain("| hour: every hour");
    expect(hourlyDiagram).toContain("minute: at minute 15");

    const intervalBreakdown = resolveCronExpressionBreakdown("*/30 9-17 * * 1-5");
    if (intervalBreakdown === null) {
      throw new Error("Expected interval cron breakdown to resolve.");
    }
    expect(intervalBreakdown.dayOfWeek).toBe("Mon-Fri");
    const intervalDiagram = formatCronExpressionBreakdownDiagram(intervalBreakdown);
    expect(intervalDiagram).toContain("minute: every 30 minutes");
    expect(intervalDiagram).toContain("| hour: 9 AM to 5 PM");

    expect(resolveCronExpressionBreakdown("not a cron expression")).toBeNull();
  });

  it("formats stepped weekday cron ranges for readable schedule previews", () => {
    const breakdown = resolveCronExpressionBreakdown("0 8-18/2 * * 1-5");

    expect(breakdown).not.toBeNull();
    if (breakdown === null) {
      throw new Error("Expected cron breakdown to resolve.");
    }

    expect(breakdown.hourDescription).toBe("Every 2 hours from 8 AM to 6 PM");
    expect(breakdown.dayOfWeek).toBe("Mon-Fri");
    expect(formatCronExpressionBreakdownDiagram(breakdown)).toContain(
      "| hour: every 2 hours from 8 AM to 6 PM",
    );
    expect(formatCronExpressionReadableSummary("0 8-18/2 * * 1-5")).toBe(
      "Every 2 hours from 8 AM to 6 PM, Mon-Fri",
    );
  });

  it("omits unrestricted cron fields from readable summaries", () => {
    expect(formatCronExpressionReadableSummary("27 10 * * *")).toBe("10:27 AM");
  });

  it("keeps minute summaries compact without malformed prepositions", () => {
    expect(formatCronExpressionReadableSummary("15 * * * *")).toBe("Every hour at minute 15");
    expect(formatCronExpressionReadableSummary("*/15 9 * * *")).toBe(
      "Every 15 minutes during 9 AM",
    );
    expect(formatCronExpressionReadableSummary("*/15 9-17 * * 1-5")).toBe(
      "Every 15 minutes from 9 AM to 5 PM, Mon-Fri",
    );
  });

  it("falls back when stepped date fields would produce incomplete summaries", () => {
    expect(formatCronExpressionReadableSummary("0 9 */2 * *")).toBeNull();
    expect(formatCronExpressionReadableSummary("0 9 * */2 *")).toBeNull();
    expect(formatCronExpressionReadableSummary("0 9 * * 1-5/2")).toBeNull();
  });

  it("resolves snapshot refresh behavior descriptions", () => {
    expect(
      resolveSnapshotRefreshScheduleBehaviorDescription({
        after: new Date("2026-04-28T00:00:00.000Z"),
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
      }),
    ).toBe("Next refresh: 2026-04-28 09:00 Asia/Singapore.");

    expect(
      resolveSnapshotRefreshScheduleBehaviorDescription({
        after: new Date("2026-04-28T00:00:00.000Z"),
        cronExpression: "*/15 9 * * *",
        timezone: "Asia/Singapore",
      }),
    ).toBe("Next refresh: 2026-04-28 09:00 Asia/Singapore.");
  });

  it("keeps persisted timezone values selectable when the browser list does not include them", () => {
    expect(createTimezoneOptions("Custom/Zone")[0]).toEqual({
      label: "Custom/Zone",
      value: "Custom/Zone",
    });
  });
});
