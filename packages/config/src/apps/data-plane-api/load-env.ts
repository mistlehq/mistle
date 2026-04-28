import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneApiControlPlaneApiEnvDescriptors,
  DataPlaneApiDatabaseEnvDescriptors,
  DataPlaneApiRuntimeStateEnvDescriptors,
  DataPlaneApiSandboxDockerEnvDescriptors,
  DataPlaneApiSandboxE2BEnvDescriptors,
  DataPlaneApiServerEnvDescriptors,
  DataPlaneApiWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";
import {
  type PartialDataPlaneApiConfigInput,
  DataPlaneApiControlPlaneApiConfigSchema,
  DataPlaneApiDatabaseConfigSchema,
  DataPlaneApiRuntimeStateConfigSchema,
  DataPlaneApiSandboxDockerConfigSchema,
  DataPlaneApiSandboxE2BConfigSchema,
  DataPlaneApiServerConfigSchema,
  DataPlaneApiWorkflowConfigSchema,
  PartialDataPlaneApiConfigSchema,
} from "./schema.js";

export {
  DataPlaneApiControlPlaneApiEnvDescriptors,
  DataPlaneApiDatabaseEnvDescriptors,
  DataPlaneApiRuntimeStateEnvDescriptors,
  DataPlaneApiSandboxDockerEnvDescriptors,
  DataPlaneApiSandboxE2BEnvDescriptors,
  DataPlaneApiServerEnvDescriptors,
  DataPlaneApiWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";

const loadServerEnv = createEnvLoader<typeof DataPlaneApiServerConfigSchema>(
  DataPlaneApiServerEnvDescriptors,
);
const loadDatabaseEnv = createEnvLoader<typeof DataPlaneApiDatabaseConfigSchema>(
  DataPlaneApiDatabaseEnvDescriptors,
);
const loadWorkflowEnv = createEnvLoader<typeof DataPlaneApiWorkflowConfigSchema>(
  DataPlaneApiWorkflowEnvDescriptors,
);
const loadRuntimeStateEnv = createEnvLoader<typeof DataPlaneApiRuntimeStateConfigSchema>(
  DataPlaneApiRuntimeStateEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof DataPlaneApiControlPlaneApiConfigSchema>(
  DataPlaneApiControlPlaneApiEnvDescriptors,
);
const loadSandboxDockerEnv = createEnvLoader<typeof DataPlaneApiSandboxDockerConfigSchema>(
  DataPlaneApiSandboxDockerEnvDescriptors,
);
const loadSandboxE2BEnv = createEnvLoader<typeof DataPlaneApiSandboxE2BConfigSchema>(
  DataPlaneApiSandboxE2BEnvDescriptors,
);

export function loadDataPlaneApiFromEnv(env: NodeJS.ProcessEnv): PartialDataPlaneApiConfigInput {
  const partialConfig: PartialDataPlaneApiConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const runtimeState = loadRuntimeStateEnv(env);
  if (hasEntries(runtimeState)) {
    partialConfig.runtimeState = runtimeState;
  }

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  const sandboxDocker = loadSandboxDockerEnv(env);
  const sandboxE2B = loadSandboxE2BEnv(env);
  if (hasEntries(sandboxDocker) || hasEntries(sandboxE2B)) {
    partialConfig.sandbox = {
      ...(hasEntries(sandboxDocker) ? { docker: sandboxDocker } : {}),
      ...(hasEntries(sandboxE2B) ? { e2b: sandboxE2B } : {}),
    };
  }

  return PartialDataPlaneApiConfigSchema.parse(partialConfig);
}
