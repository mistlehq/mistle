import {
  SandboxUsageEventTypes,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, asc, eq, gte, inArray, lt, min } from "drizzle-orm";

import type {
  SandboxUsageActivity,
  SandboxUsageSummaryInput,
  SandboxUsageSummaryResponse,
} from "../../sandbox/sandbox-usage/summary/schema.js";
import {
  aggregateSandboxUsage,
  type SandboxUsageInstanceMetadata,
} from "./sandbox-usage-aggregation.js";

const UsageActivities: readonly SandboxUsageActivity[] = [
  "user_sessions",
  "designer_sessions",
  "trigger_runs",
  "setup_assistants",
  "setup_script_checks",
  "snapshot_maintenance",
];

type ReadSandboxUsageSummaryContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances" | "sandboxUsageEvents">;
};

export async function readSandboxUsageSummary(
  ctx: ReadSandboxUsageSummaryContext,
  input: SandboxUsageSummaryInput,
): Promise<SandboxUsageSummaryResponse> {
  const periodStartMs = Date.parse(input.periodStart);
  const periodEndMs = Date.parse(input.periodEnd);
  if (
    !Number.isFinite(periodStartMs) ||
    !Number.isFinite(periodEndMs) ||
    periodEndMs <= periodStartMs
  ) {
    throw new Error("Usage period must have a valid start before end.");
  }

  const { sandboxInstances, sandboxUsageEvents } = ctx.tables;
  const [measurementRow] = await ctx.db
    .select({
      measuredFrom: min(sandboxUsageEvents.occurredAt),
    })
    .from(sandboxUsageEvents)
    .where(eq(sandboxUsageEvents.organizationId, input.organizationId));

  const events = await ctx.db
    .select({
      sandboxInstanceId: sandboxUsageEvents.sandboxInstanceId,
      computeGeneration: sandboxUsageEvents.computeGeneration,
      eventType: sandboxUsageEvents.eventType,
      occurredAt: sandboxUsageEvents.occurredAt,
      vcpuCount: sandboxUsageEvents.vcpuCount,
      memoryMb: sandboxUsageEvents.memoryMb,
      diskMb: sandboxUsageEvents.diskMb,
    })
    .from(sandboxUsageEvents)
    .where(
      and(
        eq(sandboxUsageEvents.organizationId, input.organizationId),
        lt(sandboxUsageEvents.occurredAt, input.periodEnd),
        inArray(sandboxUsageEvents.eventType, [
          SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          SandboxUsageEventTypes.SANDBOX_RESUMED,
          SandboxUsageEventTypes.SANDBOX_STOPPED,
          SandboxUsageEventTypes.SANDBOX_FAILED,
          SandboxUsageEventTypes.SANDBOX_REPLACED,
        ]),
      ),
    )
    .orderBy(
      asc(sandboxUsageEvents.sandboxInstanceId),
      asc(sandboxUsageEvents.computeGeneration),
      asc(sandboxUsageEvents.occurredAt),
    );

  const runs = await ctx.db
    .select({
      sandboxInstanceId: sandboxInstances.id,
      startedAt: sandboxInstances.startedAt,
    })
    .from(sandboxInstances)
    .where(
      and(
        eq(sandboxInstances.organizationId, input.organizationId),
        gte(sandboxInstances.startedAt, input.periodStart),
        lt(sandboxInstances.startedAt, input.periodEnd),
      ),
    );

  const instanceIds = Array.from(
    new Set([
      ...events.map((event) => event.sandboxInstanceId),
      ...runs.map((run) => run.sandboxInstanceId),
    ]),
  );
  const instanceRows =
    instanceIds.length === 0
      ? []
      : await ctx.db
          .select({
            id: sandboxInstances.id,
            sandboxProfileId: sandboxInstances.sandboxProfileId,
            purpose: sandboxInstances.purpose,
            source: sandboxInstances.source,
          })
          .from(sandboxInstances)
          .where(
            and(
              eq(sandboxInstances.organizationId, input.organizationId),
              inArray(sandboxInstances.id, instanceIds),
            ),
          );
  const instancesById = new Map<string, SandboxUsageInstanceMetadata>(
    instanceRows.map((instance) => [
      instance.id,
      {
        sandboxProfileId: instance.sandboxProfileId,
        purpose: instance.purpose,
        source: instance.source,
      },
    ]),
  );

  const aggregate = aggregateSandboxUsage({
    activityRows: UsageActivities,
    events: events.map((event) => ({
      ...event,
      occurredAt: normalizeDatabaseTimestampToIso(event.occurredAt),
    })),
    instancesById,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    requestedAt: input.requestedAt,
    runs: runs
      .filter(
        (run): run is { sandboxInstanceId: string; startedAt: string } => run.startedAt !== null,
      )
      .map((run) => ({
        sandboxInstanceId: run.sandboxInstanceId,
        startedAt: normalizeDatabaseTimestampToIso(run.startedAt),
      })),
  });
  const measuredFrom =
    measurementRow?.measuredFrom === null || measurementRow?.measuredFrom === undefined
      ? null
      : normalizeDatabaseTimestampToIso(measurementRow.measuredFrom);

  return {
    period: {
      start: input.periodStart,
      end: input.periodEnd,
    },
    measurement: {
      measuredFrom,
      complete: measuredFrom !== null && Date.parse(input.periodStart) >= Date.parse(measuredFrom),
    },
    summary: aggregate.summary,
    dailyUsage: [...aggregate.dailyUsage],
    profileBreakdown: aggregate.profileBreakdown.map((row) => ({
      sandboxProfileId: row.id,
      sandboxHours: row.sandboxHours,
      sandboxRuns: row.sandboxRuns,
      vcpuHours: row.vcpuHours,
      memoryGbHours: row.memoryGbHours,
      storageGbHours: row.storageGbHours,
    })),
    activityBreakdown: [...aggregate.activityBreakdown],
  };
}

export function normalizeDatabaseTimestampToIso(value: string): string {
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/u, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
  const timestampWithZone = /(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const date = new Date(timestampWithZone);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid database timestamp: ${value}`);
  }

  return date.toISOString();
}
