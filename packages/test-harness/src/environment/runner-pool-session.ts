import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TestRunIdLength = 12;

export const MISTLE_TEST_RUN_ID_ENV = "MISTLE_TEST_RUN_ID";
export const MISTLE_TEST_COORDINATOR_DIR_ENV = "MISTLE_TEST_COORDINATOR_DIR";
export const MISTLE_TEST_POOLING_ENV = "MISTLE_TEST_POOLING";
export const MISTLE_TEST_RUN_OWNER_PID_ENV = "MISTLE_TEST_RUN_OWNER_PID";

export type RunnerPoolSession = {
  runId: string;
  coordinatorDir: string;
};

export function ensureRunnerPoolSession(environment: NodeJS.ProcessEnv): RunnerPoolSession {
  const runId = ensureEnvValue({
    environment,
    key: MISTLE_TEST_RUN_ID_ENV,
    create: createTestRunId,
  });
  const coordinatorDir = ensureEnvValue({
    environment,
    key: MISTLE_TEST_COORDINATOR_DIR_ENV,
    create: () => join(tmpdir(), "mistle-test-harness", "runner-pools", runId),
  });
  ensureEnvValue({
    environment,
    key: MISTLE_TEST_RUN_OWNER_PID_ENV,
    create: () => String(process.pid),
  });
  environment[MISTLE_TEST_POOLING_ENV] = "1";

  return {
    runId,
    coordinatorDir,
  };
}

export function resolveRunnerPoolSession(environment: NodeJS.ProcessEnv): RunnerPoolSession {
  const runId = environment[MISTLE_TEST_RUN_ID_ENV];
  if (runId === undefined || runId.length === 0) {
    throw new Error(`Missing required environment variable ${MISTLE_TEST_RUN_ID_ENV}.`);
  }

  const coordinatorDir = environment[MISTLE_TEST_COORDINATOR_DIR_ENV];
  if (coordinatorDir === undefined || coordinatorDir.length === 0) {
    throw new Error(`Missing required environment variable ${MISTLE_TEST_COORDINATOR_DIR_ENV}.`);
  }

  return {
    runId,
    coordinatorDir,
  };
}

function ensureEnvValue(input: {
  environment: NodeJS.ProcessEnv;
  key: string;
  create: () => string;
}): string {
  const existingValue = input.environment[input.key];
  if (existingValue !== undefined && existingValue.length > 0) {
    return existingValue;
  }

  const value = input.create();
  input.environment[input.key] = value;
  return value;
}

function createTestRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, TestRunIdLength);
}
