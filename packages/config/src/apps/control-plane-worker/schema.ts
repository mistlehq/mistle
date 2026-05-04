import { z } from "zod";

export const ControlPlaneWorkerDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
  })
  .strict();

export const ControlPlaneWorkerWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
    runMigrations: z.boolean(),
    concurrency: z.number().int().min(1),
  })
  .strict();

export const ControlPlaneWorkerEmailConfigSchema = z
  .object({
    fromAddress: z.string().min(1),
    fromName: z.string().min(1),
    smtpHost: z.string().min(1),
    smtpPort: z.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    smtpUsername: z.string().min(1),
    smtpPassword: z.string().min(1),
  })
  .strict();

export const ControlPlaneWorkerDataPlaneApiConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

export const ControlPlaneWorkerControlPlaneApiConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

export const ControlPlaneWorkerInternalAuthConfigSchema = z
  .object({
    serviceToken: z.string().trim().min(1),
  })
  .strict();

export const ControlPlaneWorkerSandboxConfigSchema = z
  .object({
    defaultBaseImage: z.string().min(1),
  })
  .strict();

export const ControlPlaneWorkerConfigSchema = z
  .object({
    database: ControlPlaneWorkerDatabaseConfigSchema,
    workflow: ControlPlaneWorkerWorkflowConfigSchema,
    email: ControlPlaneWorkerEmailConfigSchema,
    dataPlaneApi: ControlPlaneWorkerDataPlaneApiConfigSchema,
    controlPlaneApi: ControlPlaneWorkerControlPlaneApiConfigSchema,
    internalAuth: ControlPlaneWorkerInternalAuthConfigSchema,
    sandbox: ControlPlaneWorkerSandboxConfigSchema,
  })
  .strict();

export const PartialControlPlaneWorkerConfigSchema = z
  .object({
    database: ControlPlaneWorkerDatabaseConfigSchema.partial().optional(),
    workflow: ControlPlaneWorkerWorkflowConfigSchema.partial().optional(),
    email: ControlPlaneWorkerEmailConfigSchema.partial().optional(),
    dataPlaneApi: ControlPlaneWorkerDataPlaneApiConfigSchema.partial().optional(),
    controlPlaneApi: ControlPlaneWorkerControlPlaneApiConfigSchema.partial().optional(),
    internalAuth: ControlPlaneWorkerInternalAuthConfigSchema.partial().optional(),
    sandbox: ControlPlaneWorkerSandboxConfigSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneWorkerConfig = z.infer<typeof ControlPlaneWorkerConfigSchema>;
export type PartialControlPlaneWorkerConfigInput = z.input<
  typeof PartialControlPlaneWorkerConfigSchema
>;
