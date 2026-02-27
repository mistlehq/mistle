import { z } from "zod";

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
    gatewayWsUrl: z.string().min(1),
    bootstrapTokenTtlSeconds: z.number().int().min(1),
  })
  .strict();

export const DataPlaneWorkerSandboxProviders = {
  MODAL: "modal",
  DOCKER: "docker",
} as const;

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
  })
  .strict();

export const DataPlaneWorkerSandboxConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal(DataPlaneWorkerSandboxProviders.MODAL),
      modal: DataPlaneWorkerSandboxModalConfigSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal(DataPlaneWorkerSandboxProviders.DOCKER),
      docker: DataPlaneWorkerSandboxDockerConfigSchema,
    })
    .strict(),
]);

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    provider: z
      .enum([DataPlaneWorkerSandboxProviders.MODAL, DataPlaneWorkerSandboxProviders.DOCKER])
      .optional(),
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
    sandbox: DataPlaneWorkerSandboxConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerConfigSchema = z
  .object({
    server: DataPlaneWorkerServerConfigSchema.partial().optional(),
    database: DataPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneWorkerWorkflowConfigSchema.partial().optional(),
    tunnel: DataPlaneWorkerTunnelConfigSchema.partial().optional(),
    sandbox: PartialDataPlaneWorkerSandboxConfigSchema.optional(),
  })
  .strict();

export type DataPlaneWorkerConfig = z.infer<typeof DataPlaneWorkerConfigSchema>;
export type PartialDataPlaneWorkerConfigInput = z.input<typeof PartialDataPlaneWorkerConfigSchema>;
