import { z } from "zod";

const SandboxProviders = ["modal", "docker"] as const;

export const DataPlaneWorkerServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

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

export const DataPlaneWorkerReaperConfigSchema = z
  .object({
    pollIntervalSeconds: z.number().int().min(1),
    webhookIdleTimeoutSeconds: z.number().int().min(1),
    executionLeaseFreshnessSeconds: z.number().int().min(1),
    tunnelDisconnectGraceSeconds: z.number().int().min(1),
  })
  .strict();

export const DataPlaneWorkerSandboxModalConfigSchema = z
  .object({
    tokenId: z.string().min(1),
    tokenSecret: z.string().min(1),
    appName: z.string().min(1),
    environmentName: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxDockerConfigSchema = z
  .object({
    socketPath: z.string().min(1),
    snapshotRepository: z.string().min(1),
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
    modal: DataPlaneWorkerSandboxModalConfigSchema.optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    tokenizerProxyEgressBaseUrl: DataPlaneWorkerTokenizerProxyEgressBaseUrlSchema.optional(),
    modal: DataPlaneWorkerSandboxModalConfigSchema.partial().optional(),
    docker: DataPlaneWorkerSandboxDockerConfigSchema.partial().optional(),
  })
  .strict();

export const DataPlaneWorkerConfigSchema = z
  .object({
    server: DataPlaneWorkerServerConfigSchema,
    database: DataPlaneWorkerDatabaseConfigSchema,
    workflow: DataPlaneWorkerWorkflowConfigSchema,
    tunnel: DataPlaneWorkerTunnelConfigSchema,
    reaper: DataPlaneWorkerReaperConfigSchema,
    sandbox: DataPlaneWorkerSandboxConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerConfigSchema = z
  .object({
    server: DataPlaneWorkerServerConfigSchema.partial().optional(),
    database: DataPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneWorkerWorkflowConfigSchema.partial().optional(),
    tunnel: DataPlaneWorkerTunnelConfigSchema.partial().optional(),
    reaper: DataPlaneWorkerReaperConfigSchema.partial().optional(),
    sandbox: PartialDataPlaneWorkerSandboxConfigSchema.optional(),
  })
  .strict();

const DataPlaneWorkerProviderRequirementMessages = {
  MODAL:
    "apps.data_plane_worker.sandbox.modal is required when global.sandbox.provider is 'modal'.",
  DOCKER:
    "apps.data_plane_worker.sandbox.docker is required when global.sandbox.provider is 'docker'.",
} as const;

export function getDataPlaneWorkerSandboxProviderValidationIssue(input: {
  globalSandboxProvider: (typeof SandboxProviders)[number];
  appSandbox: DataPlaneWorkerConfig["sandbox"];
}): {
  path: readonly ["sandbox", "modal"] | readonly ["sandbox", "docker"];
  message: string;
} | null {
  if (input.globalSandboxProvider === "modal" && input.appSandbox.modal === undefined) {
    return {
      path: ["sandbox", "modal"],
      message: DataPlaneWorkerProviderRequirementMessages.MODAL,
    };
  }

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
