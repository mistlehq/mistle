import { z } from "zod";

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

export const ControlPlaneWorkerConfigSchema = z
  .object({
    workflow: ControlPlaneWorkerWorkflowConfigSchema,
    email: ControlPlaneWorkerEmailConfigSchema,
    dataPlaneApi: ControlPlaneWorkerDataPlaneApiConfigSchema,
    controlPlaneApi: ControlPlaneWorkerControlPlaneApiConfigSchema,
  })
  .strict();

export const PartialControlPlaneWorkerConfigSchema = z
  .object({
    workflow: ControlPlaneWorkerWorkflowConfigSchema.partial().optional(),
    email: ControlPlaneWorkerEmailConfigSchema.partial().optional(),
    dataPlaneApi: ControlPlaneWorkerDataPlaneApiConfigSchema.partial().optional(),
    controlPlaneApi: ControlPlaneWorkerControlPlaneApiConfigSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneWorkerConfig = z.infer<typeof ControlPlaneWorkerConfigSchema>;
export type PartialControlPlaneWorkerConfigInput = z.input<
  typeof PartialControlPlaneWorkerConfigSchema
>;
