import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import { asObjectRecord } from "../../core/record.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  DataPlaneWorkerControlPlaneApiConfigSchema,
  PartialDataPlaneWorkerRuntimeStateConfigSchema,
  DataPlaneWorkerSandboxDockerConfigSchema,
  DataPlaneWorkerSandboxE2BConfigSchema,
  DataPlaneWorkerSandboxStorageArchilMountConfigSchema,
  DataPlaneWorkerSandboxStorageArchilConfigSchema,
  DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema,
  DataPlaneWorkerWorkflowConfigSchema,
  PartialDataPlaneWorkerConfigSchema,
  PartialDataPlaneWorkerSandboxConfigSchema,
} from "./schema.js";

export const DataPlaneWorkerDatabaseEnvDescriptors = [
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneWorkerDatabaseConfigSchema>>[0];

export const DataPlaneWorkerWorkflowEnvDescriptors = [
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    key: "runMigrations",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
    parse: (value) =>
      parseBooleanEnv(value, "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS"),
  },
  {
    key: "concurrency",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneWorkerWorkflowConfigSchema>>[0];

export const DataPlaneWorkerRuntimeStateEnvDescriptors = [
  {
    key: "gatewayBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof PartialDataPlaneWorkerRuntimeStateConfigSchema>
>[0];

export const DataPlaneWorkerControlPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof DataPlaneWorkerControlPlaneApiConfigSchema>
>[0];

export const DataPlaneWorkerSandboxDockerEnvDescriptors = [
  {
    key: "socketPath",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH",
  },
  {
    key: "networkName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME",
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneWorkerSandboxDockerConfigSchema>>[0];

export const DataPlaneWorkerSandboxE2BEnvDescriptors = [
  {
    key: "apiKey",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY",
  },
  {
    key: "domain",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_DOMAIN",
  },
  {
    key: "cpuCount",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_CPU_COUNT",
    parse: Number,
  },
  {
    key: "memoryMb",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_MEMORY_MB",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof DataPlaneWorkerSandboxE2BConfigSchema>>[0];

export const DataPlaneWorkerSandboxEnvDescriptors = [
  {
    key: "tokenizerProxyEgressBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL",
  },
  {
    key: "sandboxdTestFaultsEnabled",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_SANDBOXD_TEST_FAULTS_ENABLED",
    parse: (value) =>
      parseBooleanEnv(value, "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_SANDBOXD_TEST_FAULTS_ENABLED"),
  },
] satisfies Parameters<typeof createEnvLoader<typeof PartialDataPlaneWorkerSandboxConfigSchema>>[0];

export const DataPlaneWorkerSandboxStorageArchilEnvDescriptors = [
  {
    key: "apiKey",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
  },
  {
    key: "region",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION",
  },
  {
    key: "namePrefix",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX",
  },
  {
    key: "mounts",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
    valueFormat: "json",
    parse: (value) => {
      try {
        const parsedValue = JSON.parse(value);
        if (!Array.isArray(parsedValue)) {
          throw new Error("Expected a JSON array.");
        }

        return parsedValue.map((item) => {
          const mount = asObjectRecord(item);

          return DataPlaneWorkerSandboxStorageArchilMountConfigSchema.parse({
            type: mount.type,
            bucket: mount.bucket,
            endpoint: mount.endpoint,
            accessKeyId: mount.accessKeyId,
            secretAccessKey: mount.secretAccessKey,
          });
        });
      } catch (error) {
        throw new Error(
          `Invalid MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof DataPlaneWorkerSandboxStorageArchilConfigSchema>
>[0];

export const DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors = [
  {
    key: "namePrefix",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema>
>[0];

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
