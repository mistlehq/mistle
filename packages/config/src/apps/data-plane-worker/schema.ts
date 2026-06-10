import { z } from "zod";

import {
  GlobalSandboxTokenConfigSchema,
  GlobalTelemetryConfigSchema,
} from "../../global/schema.js";

const DefaultE2BCloudDomain = "e2b.app";
const ModalSandboxMaxTimeoutMs = 24 * 60 * 60 * 1000;

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
    databasePoolMax: z.number().int().min(1),
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

export const DataPlaneWorkerSandboxDockerConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      socketPath: z.string().min(1),
      networkName: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      socketPath: z.string().min(1).optional(),
      networkName: z.string().min(1).optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxDockerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    socketPath: z.string().min(1).optional(),
    networkName: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxE2BConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      domain: z.string().min(1).default(DefaultE2BCloudDomain),
      cpuCount: z.number().int().min(1).default(2),
      memoryMb: z
        .number()
        .int()
        .min(1)
        .default(4 * 1024),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
      cpuCount: z.number().int().min(1).optional(),
      memoryMb: z.number().int().min(1).optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxE2BConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    cpuCount: z.number().int().min(1).optional(),
    memoryMb: z.number().int().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxTensorlakeConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxTensorlakeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxOpenComputerConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      apiBaseUrl: z.url().optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      apiBaseUrl: z.url().optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxOpenComputerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    apiBaseUrl: z.url().optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxFreestyleConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      baseUrl: z.url().optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      baseUrl: z.url().optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxFreestyleConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.url().optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxModalConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      tokenId: z.string().min(1),
      tokenSecret: z.string().min(1),
      appName: z.string().min(1),
      environment: z.string().min(1).optional(),
      defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      tokenId: z.string().min(1).optional(),
      tokenSecret: z.string().min(1).optional(),
      appName: z.string().min(1).optional(),
      environment: z.string().min(1).optional(),
      defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxModalConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tokenId: z.string().min(1).optional(),
    tokenSecret: z.string().min(1).optional(),
    appName: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxConfigSchema = z
  .object({
    internalGatewayWsUrl: z.string().trim().min(1),
    bootstrap: GlobalSandboxTokenConfigSchema,
    sandboxdTestFaultsEnabled: z.boolean().optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.optional(),
    e2b: DataPlaneWorkerSandboxE2BConfigSchema.optional(),
    freestyle: DataPlaneWorkerSandboxFreestyleConfigSchema.optional(),
    modal: DataPlaneWorkerSandboxModalConfigSchema.optional(),
    opencomputer: DataPlaneWorkerSandboxOpenComputerConfigSchema.optional(),
    tensorlake: DataPlaneWorkerSandboxTensorlakeConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    internalGatewayWsUrl: z.string().trim().min(1).optional(),
    bootstrap: GlobalSandboxTokenConfigSchema.partial().optional(),
    sandboxdTestFaultsEnabled: z.boolean().optional(),
    docker: PartialDataPlaneWorkerSandboxDockerConfigSchema.optional(),
    e2b: PartialDataPlaneWorkerSandboxE2BConfigSchema.optional(),
    freestyle: PartialDataPlaneWorkerSandboxFreestyleConfigSchema.optional(),
    modal: PartialDataPlaneWorkerSandboxModalConfigSchema.optional(),
    opencomputer: PartialDataPlaneWorkerSandboxOpenComputerConfigSchema.optional(),
    tensorlake: PartialDataPlaneWorkerSandboxTensorlakeConfigSchema.optional(),
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
    internalAuth: DataPlaneWorkerInternalAuthConfigSchema.partial().optional(),
    telemetry: GlobalTelemetryConfigSchema.optional(),
  })
  .strict();

export function getDataPlaneWorkerSandboxProviderValidationIssue(input: {
  appSandbox: DataPlaneWorkerConfig["sandbox"];
}): {
  path: readonly ["sandbox", "docker"];
  message: string;
} | null {
  void input;
  return null;
}

export type DataPlaneWorkerConfig = z.infer<typeof DataPlaneWorkerConfigSchema>;
export type PartialDataPlaneWorkerConfigInput = z.input<typeof PartialDataPlaneWorkerConfigSchema>;
