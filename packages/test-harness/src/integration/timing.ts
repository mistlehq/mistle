import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TimingEnabledValue = "1";
const TimingStartedAtEnv = "MISTLE_TEST_TIMING_STARTED_AT_MS";
const TimingEventsFileEnv = "MISTLE_TEST_TIMING_EVENTS_FILE";
const TimingProcessStartedAtMs = Date.now();

type TimingWriteOptions = {
  force?: boolean;
};

export type IntegrationTimingFileRecord = {
  type: "integration-file";
  label: string;
  file: string;
  services: string;
  envId: string;
  setupMs: number;
  bodyMs: number;
  teardownMs: number;
  totalMs: number;
  status: "passed" | "failed";
};

export function markIntegrationTimingStart(environment: NodeJS.ProcessEnv): void {
  if (environment["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  if (environment[TimingStartedAtEnv] === undefined) {
    environment[TimingStartedAtEnv] = String(Date.now());
  }
}

export function formatIntegrationDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

export function writeIntegrationTimingLine(
  message: string,
  options: TimingWriteOptions = {},
): void {
  if (options.force !== true && process.env["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  process.stderr.write(`${message}\n`);
}

export function writeIntegrationTimingEvent(
  event: string,
  details: string,
  options: TimingWriteOptions = {},
): void {
  if (options.force !== true && process.env["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  writeIntegrationTimingLine(
    `[integration] ${formatTimingOffset()} pid=${String(process.pid)} ${formatWorkerLabel()} ${event}: ${details}.`,
    options,
  );
}

export function writeIntegrationTimingRecord(
  record: IntegrationTimingFileRecord,
  options: TimingWriteOptions = {},
): void {
  if (options.force !== true && process.env["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  const eventsFile = process.env[TimingEventsFileEnv];
  if (eventsFile === undefined || eventsFile.length === 0) {
    return;
  }

  mkdirSync(dirname(eventsFile), { recursive: true });
  appendFileSync(eventsFile, `${JSON.stringify(record)}\n`, "utf8");
}

function formatTimingOffset(): string {
  const startedAtValue = process.env[TimingStartedAtEnv];
  if (startedAtValue === undefined || startedAtValue.length === 0) {
    return `t=+${formatIntegrationDuration(Date.now() - TimingProcessStartedAtMs)}`;
  }

  const startedAt = Number(startedAtValue);
  if (!Number.isFinite(startedAt)) {
    return "t=unknown";
  }

  return `t=+${formatIntegrationDuration(Date.now() - startedAt)}`;
}

function formatWorkerLabel(): string {
  const workerId = process.env["VITEST_WORKER_ID"];
  const poolId = process.env["VITEST_POOL_ID"];
  const labels: string[] = [];

  if (workerId !== undefined && workerId.length > 0) {
    labels.push(`worker=${workerId}`);
  }
  if (poolId !== undefined && poolId.length > 0) {
    labels.push(`pool=${poolId}`);
  }

  if (labels.length === 0) {
    return "worker=unknown";
  }

  return labels.join(" ");
}
