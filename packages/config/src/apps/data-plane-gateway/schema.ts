import { z } from "zod";

import {
  GlobalSandboxConfigSchema,
  GlobalTelemetryConfigSchema,
  PartialGlobalSandboxConfigSchema,
  PartialGlobalTelemetryConfigSchema,
} from "../../global/schema.js";

const HttpBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "Expected an http or https URL.");

const ValkeyUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "redis:" || parsedUrl.protocol === "rediss:";
}, "Expected a redis or rediss URL.");

const NatsUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "nats:" || parsedUrl.protocol === "tls:";
}, "Expected a nats or tls URL.");

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

export const DataPlaneGatewayRelayConfigSchema = z
  .discriminatedUnion("backend", [
    z
      .object({
        backend: z.literal("memory"),
      })
      .strict(),
    z
      .object({
        backend: z.literal("nats"),
        nats: z
          .object({
            url: NatsUrlSchema,
            namePrefix: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
  ])
  .default({ backend: "memory" });

export const PartialDataPlaneGatewayRelayConfigSchema = z
  .object({
    backend: z.enum(["memory", "nats"]).optional(),
    nats: z
      .object({
        url: NatsUrlSchema.optional(),
        namePrefix: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const DataPlaneGatewayDataPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const DataPlaneGatewayControlPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema,
    publicBaseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const DataPlaneGatewayInternalAuthConfigSchema = z
  .object({
    serviceToken: z.string().trim().min(1),
  })
  .strict();

export const DataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema,
    database: DataPlaneGatewayDatabaseConfigSchema,
    runtimeState: DataPlaneGatewayRuntimeStateConfigSchema,
    gatewayRelay: DataPlaneGatewayRelayConfigSchema,
    dataPlaneApi: DataPlaneGatewayDataPlaneApiConfigSchema,
    controlPlaneApi: DataPlaneGatewayControlPlaneApiConfigSchema,
    internalAuth: DataPlaneGatewayInternalAuthConfigSchema,
    sandbox: GlobalSandboxConfigSchema,
    telemetry: GlobalTelemetryConfigSchema,
  })
  .strict();

export const PartialDataPlaneGatewayConfigSchema = z
  .object({
    server: DataPlaneGatewayServerConfigSchema.partial().optional(),
    database: DataPlaneGatewayDatabaseConfigSchema.partial().optional(),
    runtimeState: PartialDataPlaneGatewayRuntimeStateConfigSchema.optional(),
    gatewayRelay: PartialDataPlaneGatewayRelayConfigSchema.optional(),
    dataPlaneApi: DataPlaneGatewayDataPlaneApiConfigSchema.partial().optional(),
    controlPlaneApi: DataPlaneGatewayControlPlaneApiConfigSchema.partial().optional(),
    internalAuth: DataPlaneGatewayInternalAuthConfigSchema.partial().optional(),
    sandbox: PartialGlobalSandboxConfigSchema.optional(),
    telemetry: PartialGlobalTelemetryConfigSchema.optional(),
  })
  .strict();

export type DataPlaneGatewayConfig = z.infer<typeof DataPlaneGatewayConfigSchema>;
export type PartialDataPlaneGatewayConfigInput = z.input<
  typeof PartialDataPlaneGatewayConfigSchema
>;
