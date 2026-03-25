import { z } from "zod";

const SandboxProviders = ["docker"] as const;

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

export const DataPlaneWorkerTunnelConfigSchema = z
  .object({
    bootstrapTokenTtlSeconds: z.number().int().min(1),
    exchangeTokenTtlSeconds: z.number().int().min(1),
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

export const DataPlaneWorkerSandboxDockerConfigSchema = z
  .object({
    socketPath: z.string().min(1),
    networkName: z.string().min(1).optional(),
    tracesEndpoint: z.url().optional(),
  })
  .strict();

const DataPlaneWorkerTokenizerProxyEgressBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "sandbox.tokenizerProxyEgressBaseUrl must use http or https.");

export const DataPlaneWorkerSandboxConfigSchema = z
  .object({
    tokenizerProxyEgressBaseUrl: DataPlaneWorkerTokenizerProxyEgressBaseUrlSchema,
    docker: DataPlaneWorkerSandboxDockerConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    tokenizerProxyEgressBaseUrl: DataPlaneWorkerTokenizerProxyEgressBaseUrlSchema.optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.partial().optional(),
  })
  .strict();

export const DataPlaneWorkerConfigSchema = z
  .object({
    database: DataPlaneWorkerDatabaseConfigSchema,
    workflow: DataPlaneWorkerWorkflowConfigSchema,
    tunnel: DataPlaneWorkerTunnelConfigSchema,
    runtimeState: DataPlaneWorkerRuntimeStateConfigSchema,
    sandbox: DataPlaneWorkerSandboxConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerConfigSchema = z
  .object({
    database: DataPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneWorkerWorkflowConfigSchema.partial().optional(),
    tunnel: DataPlaneWorkerTunnelConfigSchema.partial().optional(),
    runtimeState: PartialDataPlaneWorkerRuntimeStateConfigSchema.optional(),
    sandbox: PartialDataPlaneWorkerSandboxConfigSchema.optional(),
  })
  .strict();

const DataPlaneWorkerProviderRequirementMessages = {
  DOCKER:
    "apps.data_plane_worker.sandbox.docker is required when global.sandbox.provider is 'docker'.",
} as const;

export function getDataPlaneWorkerSandboxProviderValidationIssue(input: {
  globalSandboxProvider: (typeof SandboxProviders)[number];
  appSandbox: DataPlaneWorkerConfig["sandbox"];
}): {
  path: readonly ["sandbox", "docker"];
  message: string;
} | null {
  if (input.globalSandboxProvider === "docker" && input.appSandbox.docker === undefined) {
    return {
      path: ["sandbox", "docker"],
      message: DataPlaneWorkerProviderRequirementMessages.DOCKER,
    };
  }

  return null;
}

export type DataPlaneWorkerConfig = z.infer<typeof DataPlaneWorkerConfigSchema>;
export type PartialDataPlaneWorkerConfigInput = z.input<typeof PartialDataPlaneWorkerConfigSchema>;
