import { z } from "zod";

import {
  GlobalSandboxStorageConfigSchema,
  GlobalSandboxTokenConfigSchema,
  GlobalTelemetryConfigSchema,
  SandboxStorageBackend,
} from "../../global/schema.js";

const SandboxProviders = ["docker", "e2b"] as const;
const DefaultE2BCloudDomain = "e2b.app";

const HttpBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "Expected an http or https URL.");

export const DataPlaneWorkerDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
  })
  .strict();

export const DataPlaneWorkerWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
    runMigrations: z.boolean(),
    concurrency: z.number().int().min(1),
  })
  .strict();

export const DataPlaneWorkerRuntimeStateConfigSchema = z
  .object({
    gatewayBaseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const PartialDataPlaneWorkerRuntimeStateConfigSchema = z
  .object({
    gatewayBaseUrl: HttpBaseUrlSchema.optional(),
  })
  .strict();

export const DataPlaneWorkerControlPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const PartialDataPlaneWorkerControlPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema.optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxDockerConfigSchema = z
  .object({
    socketPath: z.string().min(1),
    networkName: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxE2BConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    domain: z.string().min(1).default(DefaultE2BCloudDomain),
    cpuCount: z.number().int().min(1).default(2),
    memoryMb: z
      .number()
      .int()
      .min(1)
      .default(4 * 1024),
  })
  .strict();

export const DataPlaneWorkerSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders),
    storage: GlobalSandboxStorageConfigSchema.optional(),
    internalGatewayWsUrl: z.string().trim().min(1),
    bootstrap: GlobalSandboxTokenConfigSchema,
    sandboxdTestFaultsEnabled: z.boolean().optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.optional(),
    e2b: DataPlaneWorkerSandboxE2BConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders).optional(),
    storage: GlobalSandboxStorageConfigSchema.partial().optional(),
    internalGatewayWsUrl: z.string().trim().min(1).optional(),
    bootstrap: GlobalSandboxTokenConfigSchema.partial().optional(),
    sandboxdTestFaultsEnabled: z.boolean().optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.partial().optional(),
    e2b: DataPlaneWorkerSandboxE2BConfigSchema.partial().optional(),
  })
  .strict();

export const SandboxStorageArchilMountTypes = {
  S3_COMPATIBLE: "s3-compatible",
} as const;

export type SandboxStorageArchilMountType =
  (typeof SandboxStorageArchilMountTypes)[keyof typeof SandboxStorageArchilMountTypes];

export const DataPlaneWorkerSandboxStorageArchilMountConfigSchema = z
  .object({
    type: z.enum([SandboxStorageArchilMountTypes.S3_COMPATIBLE]),
    bucket: z.string().trim().min(1),
    endpoint: HttpBaseUrlSchema,
    accessKeyId: z.string().trim().min(1),
    secretAccessKey: z.string().trim().min(1),
  })
  .strict();

export const DataPlaneWorkerSandboxStorageArchilConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1),
    region: z.string().trim().min(1),
    namePrefix: z.string().trim().min(1).optional(),
    mounts: z.array(DataPlaneWorkerSandboxStorageArchilMountConfigSchema).max(1).optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxStorageArchilConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    region: z.string().trim().min(1).optional(),
    namePrefix: z.string().trim().min(1).optional(),
    mounts: z.array(DataPlaneWorkerSandboxStorageArchilMountConfigSchema).max(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema = z
  .object({
    namePrefix: z.string().trim().min(1).optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxStorageDockerVolumeConfigSchema = z
  .object({
    namePrefix: z.string().trim().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxStorageConfigSchema = z
  .object({
    archil: DataPlaneWorkerSandboxStorageArchilConfigSchema.optional(),
    dockerVolume: DataPlaneWorkerSandboxStorageDockerVolumeConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxStorageConfigSchema = z
  .object({
    archil: PartialDataPlaneWorkerSandboxStorageArchilConfigSchema.optional(),
    dockerVolume: PartialDataPlaneWorkerSandboxStorageDockerVolumeConfigSchema.optional(),
  })
  .strict();

export const DataPlaneWorkerInternalAuthConfigSchema = z
  .object({
    serviceToken: z.string().trim().min(1),
  })
  .strict();

export const DataPlaneWorkerConfigSchema = z
  .object({
    database: DataPlaneWorkerDatabaseConfigSchema,
    workflow: DataPlaneWorkerWorkflowConfigSchema,
    runtimeState: DataPlaneWorkerRuntimeStateConfigSchema,
    sandbox: DataPlaneWorkerSandboxConfigSchema,
    controlPlaneApi: DataPlaneWorkerControlPlaneApiConfigSchema,
    sandboxStorage: DataPlaneWorkerSandboxStorageConfigSchema.optional(),
    internalAuth: DataPlaneWorkerInternalAuthConfigSchema,
    telemetry: GlobalTelemetryConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerConfigSchema = z
  .object({
    database: DataPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneWorkerWorkflowConfigSchema.partial().optional(),
    runtimeState: PartialDataPlaneWorkerRuntimeStateConfigSchema.optional(),
    sandbox: PartialDataPlaneWorkerSandboxConfigSchema.optional(),
    controlPlaneApi: PartialDataPlaneWorkerControlPlaneApiConfigSchema.optional(),
    sandboxStorage: PartialDataPlaneWorkerSandboxStorageConfigSchema.optional(),
    internalAuth: DataPlaneWorkerInternalAuthConfigSchema.partial().optional(),
    telemetry: GlobalTelemetryConfigSchema.optional(),
  })
  .strict();

const DataPlaneWorkerProviderRequirementMessages = {
  DOCKER: "sandbox.docker is required when sandbox.provider is 'docker'.",
} as const;

const DataPlaneWorkerPersistentSandboxRequirementMessages = {
  ARCHIL: "sandboxStorage.archil is required when sandbox.storage.backend is 'archil'.",
  DOCKER_VOLUME:
    "sandboxStorage.dockerVolume is required when sandbox.storage.backend is 'docker_volume'.",
} as const;

export function getDataPlaneWorkerSandboxProviderValidationIssue(input: {
  appSandbox: DataPlaneWorkerConfig["sandbox"];
}): {
  path: readonly ["sandbox", "docker"];
  message: string;
} | null {
  if (input.appSandbox.provider === "docker" && input.appSandbox.docker === undefined) {
    return {
      path: ["sandbox", "docker"],
      message: DataPlaneWorkerProviderRequirementMessages.DOCKER,
    };
  }

  return null;
}

export function getDataPlaneWorkerPersistentSandboxValidationIssue(input: {
  appConfig: DataPlaneWorkerConfig;
}): {
  path: readonly ["sandboxStorage", "archil"] | readonly ["sandboxStorage", "dockerVolume"];
  message: string;
} | null {
  if (input.appConfig.sandbox.storage?.backend === SandboxStorageBackend.ARCHIL) {
    if (input.appConfig.sandboxStorage?.archil === undefined) {
      return {
        path: ["sandboxStorage", "archil"],
        message: DataPlaneWorkerPersistentSandboxRequirementMessages.ARCHIL,
      };
    }
  }

  if (input.appConfig.sandbox.storage?.backend === SandboxStorageBackend.DOCKER_VOLUME) {
    if (input.appConfig.sandboxStorage?.dockerVolume === undefined) {
      return {
        path: ["sandboxStorage", "dockerVolume"],
        message: DataPlaneWorkerPersistentSandboxRequirementMessages.DOCKER_VOLUME,
      };
    }
  }

  return null;
}

export type DataPlaneWorkerConfig = z.infer<typeof DataPlaneWorkerConfigSchema>;
export type DataPlaneWorkerSandboxStorageConfig = z.infer<
  typeof DataPlaneWorkerSandboxStorageConfigSchema
>;
export type PartialDataPlaneWorkerConfigInput = z.input<typeof PartialDataPlaneWorkerConfigSchema>;
