import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  DataPlaneWorkerControlPlaneApiEnvDescriptors,
  DataPlaneWorkerDatabaseEnvDescriptors,
  DataPlaneWorkerRuntimeStateEnvDescriptors,
  DataPlaneWorkerSandboxDockerEnvDescriptors,
  DataPlaneWorkerSandboxE2BEnvDescriptors,
  DataPlaneWorkerSandboxEnvDescriptors,
  DataPlaneWorkerSandboxStorageArchilEnvDescriptors,
  DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors,
  DataPlaneWorkerWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  DataPlaneWorkerControlPlaneApiConfigSchema,
  PartialDataPlaneWorkerRuntimeStateConfigSchema,
  DataPlaneWorkerSandboxDockerConfigSchema,
  DataPlaneWorkerSandboxE2BConfigSchema,
  DataPlaneWorkerSandboxStorageArchilConfigSchema,
  DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema,
  DataPlaneWorkerWorkflowConfigSchema,
  PartialDataPlaneWorkerConfigSchema,
  PartialDataPlaneWorkerSandboxConfigSchema,
} from "./schema.js";

export {
  DataPlaneWorkerControlPlaneApiEnvDescriptors,
  DataPlaneWorkerDatabaseEnvDescriptors,
  DataPlaneWorkerRuntimeStateEnvDescriptors,
  DataPlaneWorkerSandboxDockerEnvDescriptors,
  DataPlaneWorkerSandboxE2BEnvDescriptors,
  DataPlaneWorkerSandboxEnvDescriptors,
  DataPlaneWorkerSandboxStorageArchilEnvDescriptors,
  DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors,
  DataPlaneWorkerWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";

const loadDatabaseEnv = createEnvLoader<typeof DataPlaneWorkerDatabaseConfigSchema>(
  DataPlaneWorkerDatabaseEnvDescriptors,
);
const loadWorkflowEnv = createEnvLoader<typeof DataPlaneWorkerWorkflowConfigSchema>(
  DataPlaneWorkerWorkflowEnvDescriptors,
);
const loadRuntimeStateEnv = createEnvLoader<typeof PartialDataPlaneWorkerRuntimeStateConfigSchema>(
  DataPlaneWorkerRuntimeStateEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof DataPlaneWorkerControlPlaneApiConfigSchema>(
  DataPlaneWorkerControlPlaneApiEnvDescriptors,
);
const loadSandboxDockerEnv = createEnvLoader<typeof DataPlaneWorkerSandboxDockerConfigSchema>(
  DataPlaneWorkerSandboxDockerEnvDescriptors,
);
const loadSandboxE2BEnv = createEnvLoader<typeof DataPlaneWorkerSandboxE2BConfigSchema>(
  DataPlaneWorkerSandboxE2BEnvDescriptors,
);
const loadSandboxEnv = createEnvLoader<typeof PartialDataPlaneWorkerSandboxConfigSchema>(
  DataPlaneWorkerSandboxEnvDescriptors,
);
const loadSandboxStorageArchilEnv = createEnvLoader<
  typeof DataPlaneWorkerSandboxStorageArchilConfigSchema
>(DataPlaneWorkerSandboxStorageArchilEnvDescriptors);
const loadSandboxStorageDockerVolumeEnv = createEnvLoader<
  typeof DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema
>(DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors);

export function loadDataPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialDataPlaneWorkerConfigInput {
  const partialConfig: PartialDataPlaneWorkerConfigInput = {};

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

  const sandbox = loadSandboxEnv(env);
  const sandboxDocker = loadSandboxDockerEnv(env);
  const sandboxE2B = loadSandboxE2BEnv(env);
  const sandboxStorageArchil = loadSandboxStorageArchilEnv(env);
  const sandboxStorageDockerVolume = loadSandboxStorageDockerVolumeEnv(env);

  if (hasEntries(sandbox) || hasEntries(sandboxDocker) || hasEntries(sandboxE2B)) {
    const sandboxConfig: Record<string, unknown> = {
      ...sandbox,
    };

    if (hasEntries(sandboxDocker)) {
      sandboxConfig.docker = sandboxDocker;
    }

    if (hasEntries(sandboxE2B)) {
      sandboxConfig.e2b = sandboxE2B;
    }

    partialConfig.sandbox = sandboxConfig;
  }

  if (hasEntries(sandboxStorageArchil) || hasEntries(sandboxStorageDockerVolume)) {
    partialConfig.sandboxStorage = {
      ...(hasEntries(sandboxStorageArchil) ? { archil: sandboxStorageArchil } : {}),
      ...(hasEntries(sandboxStorageDockerVolume)
        ? { dockerVolume: sandboxStorageDockerVolume }
        : {}),
    };
  }

  return PartialDataPlaneWorkerConfigSchema.parse(partialConfig);
}
