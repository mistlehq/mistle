import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxUsageEventTypes,
  type SandboxInstancePurpose,
  type SandboxInstanceSource,
  type SandboxUsageEventType,
} from "@mistle/db/data-plane";

import type {
  SandboxUsageActivity,
  SandboxUsageTotals,
} from "../../sandbox/sandbox-usage/summary/schema.js";

export type SandboxUsageEventRow = {
  sandboxInstanceId: string;
  computeGeneration: number | null;
  eventType: SandboxUsageEventType;
  occurredAt: string;
  vcpuCount: number | null;
  memoryMb: number | null;
  diskMb: number | null;
};

export type SandboxUsageInstanceMetadata = {
  sandboxProfileId: string;
  purpose: SandboxInstancePurpose;
  source: SandboxInstanceSource;
};

export type SandboxUsageRunRow = {
  sandboxInstanceId: string;
  startedAt: string;
};

export type SandboxUsageAggregateInput = {
  activityRows: readonly SandboxUsageActivity[];
  events: readonly SandboxUsageEventRow[];
  instancesById: ReadonlyMap<string, SandboxUsageInstanceMetadata>;
  periodStart: string;
  periodEnd: string;
  requestedAt: string;
  runs: readonly SandboxUsageRunRow[];
};

export type SandboxUsageBreakdownTotals = SandboxUsageTotals & {
  id: string;
};

export type SandboxUsageAggregateResult = {
  summary: SandboxUsageTotals;
  dailyUsage: readonly {
    day: string;
    sandboxHours: number;
    runCount: number;
  }[];
  profileBreakdown: readonly SandboxUsageBreakdownTotals[];
  activityBreakdown: readonly (SandboxUsageTotals & {
    activity: SandboxUsageActivity;
  })[];
};

type ResolvedRuntimeInterval = {
  sandboxInstanceId: string;
  startMs: number;
  endMs: number | null;
  vcpuCount: number | null;
  memoryMb: number | null;
  diskMb: number | null;
};

const StartEventTypes = new Set<SandboxUsageEventType>([
  SandboxUsageEventTypes.SANDBOX_ALLOCATED,
  SandboxUsageEventTypes.SANDBOX_RESUMED,
]);
const TerminalEventTypes = new Set<SandboxUsageEventType>([
  SandboxUsageEventTypes.SANDBOX_STOPPED,
  SandboxUsageEventTypes.SANDBOX_FAILED,
  SandboxUsageEventTypes.SANDBOX_REPLACED,
]);
const MillisecondsPerHour = 60 * 60 * 1000;

export function aggregateSandboxUsage(
  input: SandboxUsageAggregateInput,
): SandboxUsageAggregateResult {
  const periodStartMs = parseTimestamp(input.periodStart);
  const periodEndMs = parseTimestamp(input.periodEnd);
  const requestedAtMs = parseTimestamp(input.requestedAt);
  const effectiveOpenEndMs = Math.min(periodEndMs, requestedAtMs);
  const summary = createEmptyTotals();
  const dailyTotals = createDailyTotals({ periodStartMs, periodEndMs });
  const profileTotals = new Map<string, SandboxUsageTotals>();
  const activityTotals = new Map<SandboxUsageActivity, SandboxUsageTotals>(
    input.activityRows.map((activity) => [activity, createEmptyTotals()]),
  );

  const eventsByIntervalKey = groupEventsByIntervalKey(input.events);
  for (const events of eventsByIntervalKey.values()) {
    for (const interval of resolveRuntimeIntervals(events)) {
      const instance = input.instancesById.get(interval.sandboxInstanceId);
      if (instance === undefined) {
        continue;
      }

      const clippedStartMs = Math.max(interval.startMs, periodStartMs);
      const clippedEndMs = Math.min(interval.endMs ?? effectiveOpenEndMs, periodEndMs);
      if (clippedEndMs <= clippedStartMs) {
        continue;
      }

      const hours = (clippedEndMs - clippedStartMs) / MillisecondsPerHour;
      const totals = createIntervalTotals({
        hours,
        vcpuCount: interval.vcpuCount,
        memoryMb: interval.memoryMb,
        diskMb: interval.diskMb,
      });
      addTotals(summary, totals);
      addTotals(getOrCreateTotals(profileTotals, instance.sandboxProfileId), totals);
      addTotals(getOrCreateTotals(activityTotals, resolveSandboxUsageActivity(instance)), totals);
      addDailyHours({
        dailyTotals,
        startMs: clippedStartMs,
        endMs: clippedEndMs,
      });
    }
  }

  for (const run of input.runs) {
    const instance = input.instancesById.get(run.sandboxInstanceId);
    if (instance === undefined) {
      continue;
    }

    summary.sandboxRuns += 1;
    getOrCreateTotals(profileTotals, instance.sandboxProfileId).sandboxRuns += 1;
    getOrCreateTotals(activityTotals, resolveSandboxUsageActivity(instance)).sandboxRuns += 1;

    const day = toUtcDay(run.startedAt);
    const dailyTotal = dailyTotals.get(day);
    if (dailyTotal !== undefined) {
      dailyTotal.runCount += 1;
    }
  }

  return {
    summary,
    dailyUsage: Array.from(dailyTotals.entries()).map(([day, totals]) => ({
      day,
      sandboxHours: totals.sandboxHours,
      runCount: totals.runCount,
    })),
    profileBreakdown: Array.from(profileTotals.entries())
      .map(([id, totals]) => ({ id, ...totals }))
      .sort(compareBreakdownRows),
    activityBreakdown: input.activityRows.map((activity) => ({
      activity,
      ...getOrCreateTotals(activityTotals, activity),
    })),
  };
}

function groupEventsByIntervalKey(
  events: readonly SandboxUsageEventRow[],
): Map<string, SandboxUsageEventRow[]> {
  const grouped = new Map<string, SandboxUsageEventRow[]>();
  for (const event of events) {
    if (event.computeGeneration === null) {
      continue;
    }

    const key = `${event.sandboxInstanceId}:${String(event.computeGeneration)}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [event]);
    } else {
      existing.push(event);
    }
  }

  for (const groupedEvents of grouped.values()) {
    groupedEvents.sort(
      (left, right) => parseTimestamp(left.occurredAt) - parseTimestamp(right.occurredAt),
    );
  }

  return grouped;
}

function resolveRuntimeIntervals(
  events: readonly SandboxUsageEventRow[],
): ResolvedRuntimeInterval[] {
  const intervals: ResolvedRuntimeInterval[] = [];
  let openStart: SandboxUsageEventRow | undefined;

  for (const event of events) {
    if (StartEventTypes.has(event.eventType)) {
      openStart = event;
      continue;
    }

    if (openStart === undefined || !TerminalEventTypes.has(event.eventType)) {
      continue;
    }

    intervals.push(createRuntimeInterval({ start: openStart, end: event }));
    openStart = undefined;
  }

  if (openStart !== undefined) {
    intervals.push(createRuntimeInterval({ start: openStart, end: null }));
  }

  return intervals;
}

function createRuntimeInterval(input: {
  start: SandboxUsageEventRow;
  end: SandboxUsageEventRow | null;
}): ResolvedRuntimeInterval {
  return {
    sandboxInstanceId: input.start.sandboxInstanceId,
    startMs: parseTimestamp(input.start.occurredAt),
    endMs: input.end === null ? null : parseTimestamp(input.end.occurredAt),
    vcpuCount: input.start.vcpuCount,
    memoryMb: input.start.memoryMb,
    diskMb: input.start.diskMb,
  };
}

function createEmptyTotals(): SandboxUsageTotals {
  return {
    sandboxHours: 0,
    sandboxRuns: 0,
    vcpuHours: 0,
    memoryGbHours: 0,
    storageGbHours: 0,
  };
}

function createIntervalTotals(input: {
  hours: number;
  vcpuCount: number | null;
  memoryMb: number | null;
  diskMb: number | null;
}): SandboxUsageTotals {
  return {
    sandboxHours: input.hours,
    sandboxRuns: 0,
    vcpuHours: input.hours * (input.vcpuCount ?? 0),
    memoryGbHours: input.hours * ((input.memoryMb ?? 0) / 1024),
    storageGbHours: input.hours * ((input.diskMb ?? 0) / 1024),
  };
}

function addTotals(target: SandboxUsageTotals, source: SandboxUsageTotals): void {
  target.sandboxHours += source.sandboxHours;
  target.sandboxRuns += source.sandboxRuns;
  target.vcpuHours += source.vcpuHours;
  target.memoryGbHours += source.memoryGbHours;
  target.storageGbHours += source.storageGbHours;
}

function getOrCreateTotals<Key>(map: Map<Key, SandboxUsageTotals>, key: Key): SandboxUsageTotals {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const created = createEmptyTotals();
  map.set(key, created);
  return created;
}

function compareBreakdownRows(
  left: SandboxUsageBreakdownTotals,
  right: SandboxUsageBreakdownTotals,
): number {
  if (right.sandboxHours !== left.sandboxHours) {
    return right.sandboxHours - left.sandboxHours;
  }

  return left.id.localeCompare(right.id);
}

function createDailyTotals(input: {
  periodStartMs: number;
  periodEndMs: number;
}): Map<string, { sandboxHours: number; runCount: number }> {
  const totals = new Map<string, { sandboxHours: number; runCount: number }>();
  let cursor = startOfUtcDay(input.periodStartMs);
  while (cursor < input.periodEndMs) {
    totals.set(toUtcDay(new Date(cursor).toISOString()), { sandboxHours: 0, runCount: 0 });
    cursor += 24 * MillisecondsPerHour;
  }
  return totals;
}

function addDailyHours(input: {
  dailyTotals: Map<string, { sandboxHours: number; runCount: number }>;
  startMs: number;
  endMs: number;
}): void {
  let cursor = input.startMs;
  while (cursor < input.endMs) {
    const nextDayStart = startOfUtcDay(cursor) + 24 * MillisecondsPerHour;
    const segmentEnd = Math.min(input.endMs, nextDayStart);
    const day = toUtcDay(new Date(cursor).toISOString());
    const totals = input.dailyTotals.get(day);
    if (totals !== undefined) {
      totals.sandboxHours += (segmentEnd - cursor) / MillisecondsPerHour;
    }
    cursor = segmentEnd;
  }
}

function resolveSandboxUsageActivity(input: SandboxUsageInstanceMetadata): SandboxUsageActivity {
  if (input.purpose === SandboxInstancePurposes.DESIGNER) {
    return "designer_sessions";
  }
  if (input.purpose === SandboxInstancePurposes.SETUP_ASSISTANT) {
    return "setup_assistants";
  }
  if (input.purpose === SandboxInstancePurposes.SETUP_CHECK) {
    return "setup_script_checks";
  }
  if (
    input.purpose === SandboxInstancePurposes.SNAPSHOT ||
    input.purpose === SandboxInstancePurposes.SKILLS_DISCOVERY
  ) {
    return "snapshot_maintenance";
  }
  if (
    input.purpose === SandboxInstancePurposes.SESSION &&
    (input.source === SandboxInstanceSources.WEBHOOK ||
      input.source === SandboxInstanceSources.SCHEDULE)
  ) {
    return "trigger_runs";
  }

  return "user_sessions";
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return timestamp;
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toUtcDay(value: string): string {
  return new Date(parseTimestamp(value)).toISOString().slice(0, 10);
}
