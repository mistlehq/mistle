import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { afterAll, aroundEach } from "vitest";

type PhaseTimingAttributeValue = string | number | boolean | null;

type PhaseTimingRecord = {
  attributes: Record<string, PhaseTimingAttributeValue>;
  durationMs: number;
  event: string;
  phase: string;
};

type TestTimingContext = {
  records: PhaseTimingRecord[];
  startedAtMs: number;
  testName: string;
};

type CompletedTestTiming = {
  durationMs: number;
  records: readonly PhaseTimingRecord[];
  testName: string;
};

type PhaseTimingSummary = {
  count: number;
  maxDurationMs: number;
  phase: string;
  totalDurationMs: number;
};

type EventTimingSummary = {
  event: string;
  phases: PhaseTimingSummary[];
  recordedDurationMs: number;
};

type TestTimingSummaryArtifact = {
  event: "system_runtime.test_timing_summary";
  testName: string;
  durationMs: number;
  recordedDurationMs: number;
  timingEvents: EventTimingSummary[];
};

type TopPhaseTimingSummaryArtifact = {
  event: "system_runtime.top_phase_timing_summary";
  phases: {
    durationMs: number;
    event: string;
    phase: string;
    sandboxProvider: PhaseTimingAttributeValue | undefined;
    testName: string;
  }[];
};

type FileScopeTimingSummaryArtifact = {
  event: "system_runtime.file_scope_phase_timing_summary";
  recordedDurationMs: number;
  timingEvents: EventTimingSummary[];
};

type TimingArtifact = {
  event: "system_runtime.timing_artifact";
  fileScopeTimingSummary: FileScopeTimingSummaryArtifact | null;
  testTimingSummaries: TestTimingSummaryArtifact[];
  topPhaseTimingSummary: TopPhaseTimingSummaryArtifact | null;
  workerPid: number;
};

const timingStorage = new AsyncLocalStorage<TestTimingContext>();
const completedTestTimings: CompletedTestTiming[] = [];
const fileScopeRecords: PhaseTimingRecord[] = [];
let artifactWriteCount = 0;

aroundEach(async (runTest, { task }) => {
  const testTimingContext: TestTimingContext = {
    records: [],
    startedAtMs: Date.now(),
    testName: task.fullTestName,
  };

  try {
    await timingStorage.run(testTimingContext, runTest);
  } finally {
    completedTestTimings.push({
      durationMs: Date.now() - testTimingContext.startedAtMs,
      records: testTimingContext.records,
      testName: testTimingContext.testName,
    });
  }
});

afterAll(() => {
  const testTimingSummaries = buildCompletedTestTimingSummaries();
  const topPhaseTimingSummary = buildTopPhaseTimingSummary();
  const fileScopeTimingSummary = buildFileScopeTimingSummary();

  writeCompletedTestTimingSummaries(testTimingSummaries);
  writeTopPhaseTimingSummary(topPhaseTimingSummary);
  writeFileScopeTimingSummary(fileScopeTimingSummary);
  writeTimingArtifact({
    event: "system_runtime.timing_artifact",
    fileScopeTimingSummary,
    testTimingSummaries,
    topPhaseTimingSummary,
    workerPid: process.pid,
  });
});

export async function timeSystemRuntimePhase<Result>(input: {
  event: string;
  phase: string;
  operation: () => Promise<Result>;
  attributes?: Record<string, PhaseTimingAttributeValue>;
}): Promise<Result> {
  const startedAt = Date.now();

  try {
    return await input.operation();
  } finally {
    const durationMs = Date.now() - startedAt;
    const attributes = input.attributes ?? {};
    const record: PhaseTimingRecord = {
      attributes,
      durationMs,
      event: input.event,
      phase: input.phase,
    };
    recordPhaseTiming(record);

    const basePayload = {
      event: input.event,
      phase: input.phase,
      durationMs,
    };
    const payload =
      input.attributes === undefined ? basePayload : { ...input.attributes, ...basePayload };

    console.log(JSON.stringify(payload));
  }
}

function recordPhaseTiming(record: PhaseTimingRecord): void {
  const context = timingStorage.getStore();
  if (context === undefined) {
    fileScopeRecords.push(record);
    return;
  }

  context.records.push(record);
}

function buildCompletedTestTimingSummaries(): TestTimingSummaryArtifact[] {
  return completedTestTimings.map((completedTestTiming) => ({
    event: "system_runtime.test_timing_summary",
    testName: completedTestTiming.testName,
    durationMs: completedTestTiming.durationMs,
    recordedDurationMs: sumDurations(completedTestTiming.records),
    timingEvents: summarizeEvents(completedTestTiming.records),
  }));
}

function writeCompletedTestTimingSummaries(summaries: readonly TestTimingSummaryArtifact[]): void {
  for (const summary of summaries) {
    console.log(JSON.stringify(summary));
  }
}

function buildTopPhaseTimingSummary(): TopPhaseTimingSummaryArtifact | null {
  const phaseRecords = completedTestTimings.flatMap((completedTestTiming) =>
    completedTestTiming.records.map((record) => ({
      durationMs: record.durationMs,
      event: record.event,
      phase: record.phase,
      sandboxProvider: readSandboxProvider(record.attributes),
      testName: completedTestTiming.testName,
    })),
  );
  const topPhases = phaseRecords.sort(compareDurationDescending).slice(0, 20);

  if (topPhases.length === 0) {
    return null;
  }

  return {
    event: "system_runtime.top_phase_timing_summary",
    phases: topPhases,
  };
}

function writeTopPhaseTimingSummary(summary: TopPhaseTimingSummaryArtifact | null): void {
  if (summary === null) {
    return;
  }

  console.log(JSON.stringify(summary));
}

function buildFileScopeTimingSummary(): FileScopeTimingSummaryArtifact | null {
  if (fileScopeRecords.length === 0) {
    return null;
  }

  return {
    event: "system_runtime.file_scope_phase_timing_summary",
    recordedDurationMs: sumDurations(fileScopeRecords),
    timingEvents: summarizeEvents(fileScopeRecords),
  };
}

function writeFileScopeTimingSummary(summary: FileScopeTimingSummaryArtifact | null): void {
  if (summary === null) {
    return;
  }

  console.log(JSON.stringify(summary));
}

function writeTimingArtifact(artifact: TimingArtifact): void {
  const artifactDirectory = process.env["MISTLE_SYSTEM_RUNTIME_TIMING_ARTIFACT_DIR"];
  if (artifactDirectory === undefined || artifactDirectory.length === 0) {
    return;
  }

  mkdirSync(artifactDirectory, { recursive: true });
  const sequence = artifactWriteCount;
  artifactWriteCount += 1;

  writeFileSync(
    join(artifactDirectory, `system-runtime-timings-${process.pid}-${sequence}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

function summarizeEvents(records: readonly PhaseTimingRecord[]): EventTimingSummary[] {
  const recordsByEvent = new Map<string, PhaseTimingRecord[]>();

  for (const record of records) {
    const existingRecords = recordsByEvent.get(record.event);
    if (existingRecords === undefined) {
      recordsByEvent.set(record.event, [record]);
      continue;
    }

    existingRecords.push(record);
  }

  return [...recordsByEvent.entries()]
    .map(([event, eventRecords]) => ({
      event,
      phases: summarizePhases(eventRecords),
      recordedDurationMs: sumDurations(eventRecords),
    }))
    .sort(compareEventTimingSummary);
}

function summarizePhases(records: readonly PhaseTimingRecord[]): PhaseTimingSummary[] {
  const summariesByPhase = new Map<string, PhaseTimingSummary>();

  for (const record of records) {
    const existingSummary = summariesByPhase.get(record.phase);
    if (existingSummary === undefined) {
      summariesByPhase.set(record.phase, {
        count: 1,
        maxDurationMs: record.durationMs,
        phase: record.phase,
        totalDurationMs: record.durationMs,
      });
      continue;
    }

    existingSummary.count += 1;
    existingSummary.totalDurationMs += record.durationMs;
    existingSummary.maxDurationMs = Math.max(existingSummary.maxDurationMs, record.durationMs);
  }

  return [...summariesByPhase.values()].sort(comparePhaseTimingSummary);
}

function sumDurations(records: readonly PhaseTimingRecord[]): number {
  return records.reduce((total, record) => total + record.durationMs, 0);
}

function readSandboxProvider(
  attributes: Record<string, PhaseTimingAttributeValue>,
): PhaseTimingAttributeValue | undefined {
  return attributes["sandboxProvider"];
}

function compareDurationDescending(
  left: { durationMs: number },
  right: { durationMs: number },
): number {
  return right.durationMs - left.durationMs;
}

function compareEventTimingSummary(left: EventTimingSummary, right: EventTimingSummary): number {
  return (
    right.recordedDurationMs - left.recordedDurationMs || left.event.localeCompare(right.event)
  );
}

function comparePhaseTimingSummary(left: PhaseTimingSummary, right: PhaseTimingSummary): number {
  return (
    right.totalDurationMs - left.totalDurationMs ||
    right.maxDurationMs - left.maxDurationMs ||
    left.phase.localeCompare(right.phase)
  );
}
