import { z } from "zod";

const HttpBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "Expected an http or https URL.");

const ValkeyUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "redis:" || parsedUrl.protocol === "rediss:";
}, "Expected a redis or rediss URL.");

export const DataPlaneGatewayServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const DataPlaneGatewayDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
  })
  .strict();

export const DataPlaneGatewayRuntimeStateValkeyConfigSchema = z
  .object({
    url: ValkeyUrlSchema,
    keyPrefix: z.string().min(1),
  })
  .strict();

export const PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema =
  DataPlaneGatewayRuntimeStateValkeyConfigSchema.partial();

export const DataPlaneGatewayRuntimeStateConfigSchema = z
  .object({
    backend: z.enum(["memory", "valkey"]),
    valkey: DataPlaneGatewayRuntimeStateValkeyConfigSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.backend === "memory" && value.valkey !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["valkey"],
        message: "runtimeState.valkey must be omitted when runtimeState.backend is 'memory'.",
      });
    }

    if (value.backend === "valkey" && value.valkey === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["valkey"],
        message: "runtimeState.valkey is required when runtimeState.backend is 'valkey'.",
      });
    }
  });

export const PartialDataPlaneGatewayRuntimeStateConfigSchema = z
  .object({
    backend: z.enum(["memory", "valkey"]).optional(),
    valkey: PartialDataPlaneGatewayRuntimeStateValkeyConfigSchema.optional(),
  })
  .strict();

export const DataPlaneGatewayDataPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const DataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema,
    database: DataPlaneGatewayDatabaseConfigSchema,
    runtimeState: DataPlaneGatewayRuntimeStateConfigSchema,
    dataPlaneApi: DataPlaneGatewayDataPlaneApiConfigSchema,
  })
  .strict();

export const PartialDataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema.partial().optional(),
    database: DataPlaneGatewayDatabaseConfigSchema.partial().optional(),
    runtimeState: PartialDataPlaneGatewayRuntimeStateConfigSchema.optional(),
    dataPlaneApi: DataPlaneGatewayDataPlaneApiConfigSchema.partial().optional(),
  })
  .strict();

export type DataPlaneGatewayConfig = z.infer<typeof DataPlaneGatewayConfigSchema>;
export type PartialDataPlaneGatewayConfigInput = z.input<
  typeof PartialDataPlaneGatewayConfigSchema
>;
