import { randomUUID } from "node:crypto";

import { ensureRunnerPoolSession } from "../../packages/test-harness/src/environment/runner-pool-session.ts";

const IntegrationRunIdEnvVar = "MISTLE_INTEGRATION_RUN_ID";
const IntegrationRunIdLength = 12;

function createIntegrationRunId(): string {
  return randomUUID().replace(/-/gu, "").slice(0, IntegrationRunIdLength);
}

export function ensureIntegrationRunId(environment: NodeJS.ProcessEnv): string {
  const currentRunId = environment[IntegrationRunIdEnvVar];
  if (currentRunId !== undefined && currentRunId.length > 0) {
    return currentRunId;
  }

  const generatedRunId = createIntegrationRunId();
  environment[IntegrationRunIdEnvVar] = generatedRunId;
  environment["MISTLE_TEST_RUN_ID"] = generatedRunId;
  return generatedRunId;
}

export function ensureIntegrationRunnerPoolSession(environment: NodeJS.ProcessEnv): {
  runId: string;
  coordinatorDir: string;
} {
  const integrationRunId = ensureIntegrationRunId(environment);
  environment["MISTLE_TEST_RUN_ID"] = integrationRunId;
  return ensureRunnerPoolSession(environment);
}
