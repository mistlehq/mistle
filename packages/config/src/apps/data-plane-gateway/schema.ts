import { z } from "zod";

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

export const DataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema,
    database: DataPlaneGatewayDatabaseConfigSchema,
  })
  .strict();

export const PartialDataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema.partial().optional(),
    database: DataPlaneGatewayDatabaseConfigSchema.partial().optional(),
  })
  .strict();

export type DataPlaneGatewayConfig = z.infer<typeof DataPlaneGatewayConfigSchema>;
export type PartialDataPlaneGatewayConfigInput = z.input<
  typeof PartialDataPlaneGatewayConfigSchema
>;
