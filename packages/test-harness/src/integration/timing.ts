const TimingEnabledValue = "1";
const TimingStartedAtEnv = "MISTLE_TEST_TIMING_STARTED_AT_MS";

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

export function writeIntegrationTimingLine(message: string): void {
  if (process.env["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  process.stderr.write(`${message}\n`);
}

export function writeIntegrationTimingEvent(event: string, details: string): void {
  if (process.env["MISTLE_TEST_TIMING"] !== TimingEnabledValue) {
    return;
  }

  writeIntegrationTimingLine(
    `[integration-new] ${formatTimingOffset()} pid=${String(process.pid)} ${formatWorkerLabel()} ${event}: ${details}.`,
  );
}

function formatTimingOffset(): string {
  const startedAtValue = process.env[TimingStartedAtEnv];
  if (startedAtValue === undefined || startedAtValue.length === 0) {
    return "t=unknown";
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
