import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxUsageEventTypes,
} from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { SandboxUsageActivities } from "../../sandbox/sandbox-usage/summary/schema.js";
import { aggregateSandboxUsage, type SandboxUsageEventRow } from "./sandbox-usage-aggregation.js";

const PeriodStart = "2026-06-01T00:00:00.000Z";
const PeriodEnd = "2026-07-01T00:00:00.000Z";
const RequestedAt = "2026-06-29T12:00:00.000Z";
const ActivityRows = SandboxUsageActivities;

describe("aggregateSandboxUsage", () => {
  it("clips runtime intervals to the requested usage period", () => {
    const result = aggregateSandboxUsage({
      activityRows: ActivityRows,
      periodStart: PeriodStart,
      periodEnd: PeriodEnd,
      requestedAt: RequestedAt,
      events: [
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-05-30T10:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-03T12:00:00.000Z",
        }),
      ],
      instancesById: new Map([
        [
          "sandbox-1",
          {
            sandboxProfileId: "profile-1",
            purpose: SandboxInstancePurposes.SESSION,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
      ]),
      runs: [],
    });

    expect(result.summary).toEqual({
      sandboxHours: 60,
      sandboxRuns: 0,
      vcpuHours: 120,
      memoryGbHours: 240,
      storageGbHours: 600,
    });
    expect(result.dailyUsage.slice(0, 3)).toEqual([
      { day: "2026-06-01", sandboxHours: 24, runCount: 0 },
      { day: "2026-06-02", sandboxHours: 24, runCount: 0 },
      { day: "2026-06-03", sandboxHours: 12, runCount: 0 },
    ]);
  });

  it("uses requestedAt for still-running intervals in the current period", () => {
    const result = aggregateSandboxUsage({
      activityRows: ActivityRows,
      periodStart: PeriodStart,
      periodEnd: PeriodEnd,
      requestedAt: "2026-06-02T06:00:00.000Z",
      events: [
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
      instancesById: new Map([
        [
          "sandbox-1",
          {
            sandboxProfileId: "profile-1",
            purpose: SandboxInstancePurposes.SESSION,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
      ]),
      runs: [],
    });

    expect(result.summary.sandboxHours).toBe(30);
  });

  it("counts resumed runtime intervals for the same compute generation", () => {
    const result = aggregateSandboxUsage({
      activityRows: ActivityRows,
      periodStart: PeriodStart,
      periodEnd: PeriodEnd,
      requestedAt: RequestedAt,
      events: [
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-06-01T00:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-01T02:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_RESUMED,
          occurredAt: "2026-06-01T05:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-1",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-01T08:00:00.000Z",
        }),
      ],
      instancesById: new Map([
        [
          "sandbox-1",
          {
            sandboxProfileId: "profile-1",
            purpose: SandboxInstancePurposes.SESSION,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
      ]),
      runs: [],
    });

    expect(result.summary).toEqual({
      sandboxHours: 5,
      sandboxRuns: 0,
      vcpuHours: 10,
      memoryGbHours: 20,
      storageGbHours: 50,
    });
    expect(result.dailyUsage[0]).toEqual({
      day: "2026-06-01",
      sandboxHours: 5,
      runCount: 0,
    });
  });

  it("counts runs only when the sandbox lifecycle started in the period", () => {
    const result = aggregateSandboxUsage({
      activityRows: ActivityRows,
      periodStart: PeriodStart,
      periodEnd: PeriodEnd,
      requestedAt: RequestedAt,
      events: [
        usageEvent({
          sandboxInstanceId: "sandbox-before-period",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-05-31T23:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-before-period",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-01T01:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-in-period",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-06-02T00:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "sandbox-in-period",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-02T02:00:00.000Z",
        }),
      ],
      instancesById: new Map([
        [
          "sandbox-before-period",
          {
            sandboxProfileId: "profile-1",
            purpose: SandboxInstancePurposes.SESSION,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
        [
          "sandbox-in-period",
          {
            sandboxProfileId: "profile-1",
            purpose: SandboxInstancePurposes.SESSION,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
      ]),
      runs: [{ sandboxInstanceId: "sandbox-in-period", startedAt: "2026-06-02T00:00:00.000Z" }],
    });

    expect(result.summary.sandboxHours).toBe(3);
    expect(result.summary.sandboxRuns).toBe(1);
    expect(result.profileBreakdown).toEqual([
      {
        id: "profile-1",
        sandboxHours: 3,
        sandboxRuns: 1,
        vcpuHours: 6,
        memoryGbHours: 12,
        storageGbHours: 30,
      },
    ]);
  });

  it("classifies designer-purpose sandboxes as designer session activity", () => {
    const result = aggregateSandboxUsage({
      activityRows: ActivityRows,
      periodStart: PeriodStart,
      periodEnd: PeriodEnd,
      requestedAt: RequestedAt,
      events: [
        usageEvent({
          sandboxInstanceId: "designer-sandbox",
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          occurredAt: "2026-06-05T00:00:00.000Z",
        }),
        usageEvent({
          sandboxInstanceId: "designer-sandbox",
          eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
          occurredAt: "2026-06-05T03:00:00.000Z",
        }),
      ],
      instancesById: new Map([
        [
          "designer-sandbox",
          {
            sandboxProfileId: "designer-profile",
            purpose: SandboxInstancePurposes.DESIGNER,
            source: SandboxInstanceSources.DASHBOARD,
          },
        ],
      ]),
      runs: [{ sandboxInstanceId: "designer-sandbox", startedAt: "2026-06-05T00:00:00.000Z" }],
    });

    expect(result.activityBreakdown).toContainEqual({
      activity: "designer_sessions",
      sandboxHours: 3,
      sandboxRuns: 1,
      vcpuHours: 6,
      memoryGbHours: 12,
      storageGbHours: 30,
    });
    expect(result.activityBreakdown).toContainEqual({
      activity: "user_sessions",
      sandboxHours: 0,
      sandboxRuns: 0,
      vcpuHours: 0,
      memoryGbHours: 0,
      storageGbHours: 0,
    });
  });
});

function usageEvent(input: {
  sandboxInstanceId: string;
  eventType: SandboxUsageEventRow["eventType"];
  occurredAt: string;
}): SandboxUsageEventRow {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    computeGeneration: 1,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    vcpuCount: 2,
    memoryMb: 4096,
    diskMb: 10240,
  };
}
