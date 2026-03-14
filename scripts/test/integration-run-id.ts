import { randomUUID } from "node:crypto";

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
  return generatedRunId;
}
