import { z } from "zod";

const HttpBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "Expected an http or https URL.");

export const DataPlaneApiServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const DataPlaneApiDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
    migrationUrl: z.string().min(1),
  })
  .strict();

export const DataPlaneApiWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
  })
  .strict();

export const DataPlaneApiRuntimeStateConfigSchema = z
  .object({
    gatewayBaseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const DataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema,
    database: DataPlaneApiDatabaseConfigSchema,
    workflow: DataPlaneApiWorkflowConfigSchema,
    runtimeState: DataPlaneApiRuntimeStateConfigSchema,
  })
  .strict();

export const PartialDataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema.partial().optional(),
    database: DataPlaneApiDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneApiWorkflowConfigSchema.partial().optional(),
    runtimeState: DataPlaneApiRuntimeStateConfigSchema.partial().optional(),
  })
  .strict();

export type DataPlaneApiConfig = z.infer<typeof DataPlaneApiConfigSchema>;
export type PartialDataPlaneApiConfigInput = z.input<typeof PartialDataPlaneApiConfigSchema>;
