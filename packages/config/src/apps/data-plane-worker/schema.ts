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

export const DataPlaneWorkerSandboxProviders = {
  MODAL: "modal",
} as const;

export const DataPlaneWorkerSandboxModalConfigSchema = z
  .object({
    tokenId: z.string().min(1),
    tokenSecret: z.string().min(1),
    appName: z.string().min(1),
    environmentName: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneWorkerSandboxConfigSchema = z
  .object({
    provider: z.literal(DataPlaneWorkerSandboxProviders.MODAL),
    modal: DataPlaneWorkerSandboxModalConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerSandboxConfigSchema = z
  .object({
    provider: z.literal(DataPlaneWorkerSandboxProviders.MODAL).optional(),
    modal: DataPlaneWorkerSandboxModalConfigSchema.partial().optional(),
  })
  .strict();

export const DataPlaneWorkerConfigSchema = z
  .object({
    server: DataPlaneWorkerServerConfigSchema,
    database: DataPlaneWorkerDatabaseConfigSchema,
    workflow: DataPlaneWorkerWorkflowConfigSchema,
    sandbox: DataPlaneWorkerSandboxConfigSchema,
  })
  .strict();

export const PartialDataPlaneWorkerConfigSchema = z
  .object({
    server: DataPlaneWorkerServerConfigSchema.partial().optional(),
    database: DataPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneWorkerWorkflowConfigSchema.partial().optional(),
    sandbox: PartialDataPlaneWorkerSandboxConfigSchema.optional(),
  })
  .strict();

export type DataPlaneWorkerConfig = z.infer<typeof DataPlaneWorkerConfigSchema>;
export type PartialDataPlaneWorkerConfigInput = z.input<typeof PartialDataPlaneWorkerConfigSchema>;
