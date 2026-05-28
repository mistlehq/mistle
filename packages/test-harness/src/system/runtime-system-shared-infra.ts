import { ensureRunnerPoolSession } from "../environment/runner-pool-session.js";
import { formatIntegrationDuration, writeIntegrationTimingLine } from "../integration/timing.js";
import {
  acquireSharedInfraCoordinatorLease,
  createTestEnvironmentSharedInfraKey,
  stopSharedInfraForTestRun,
} from "../services/shared-infra-coordinator.js";

export async function prewarmRuntimeSystemSharedInfra(): Promise<void> {
  ensureRunnerPoolSession(process.env);
  const key = createTestEnvironmentSharedInfraKey(process.env);
  const startedAt = Date.now();

  writeIntegrationTimingLine(`[system] prewarming shared infra for ${key}.`, {
    force: true,
  });
  await acquireSharedInfraCoordinatorLease({
    key,
    postgres: {},
    mailpit: true,
    seaweedfs: true,
    valkey: true,
  });
  writeIntegrationTimingLine(
    `[system] shared infra prewarm completed in ${formatIntegrationDuration(Date.now() - startedAt)}.`,
    {
      force: true,
    },
  );
}

export async function stopRuntimeSystemSharedInfraForRun(input: { runId: string }): Promise<void> {
  const startedAt = Date.now();

  await stopSharedInfraForTestRun(input.runId);
  writeIntegrationTimingLine(
    `[system] shared infra cleanup completed in ${formatIntegrationDuration(Date.now() - startedAt)}.`,
    {
      force: true,
    },
  );
}
