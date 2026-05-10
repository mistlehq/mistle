import { z } from "@hono/zod-openapi";
import { SandboxProvider } from "@mistle/sandbox";

export const InternalSandboxRuntimeResolveCredentialsRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    provider: z.enum([SandboxProvider.DOCKER, SandboxProvider.E2B]),
    connectionId: z.string().min(1).optional(),
  })
  .strict();

export const InternalSandboxRuntimeResolveCredentialsResponseSchema = z.discriminatedUnion(
  "provider",
  [
    z
      .object({
        provider: z.literal(SandboxProvider.DOCKER),
        source: z.literal("managed"),
      })
      .strict(),
    z
      .object({
        provider: z.literal(SandboxProvider.E2B),
        source: z.enum(["managed", "connection"]),
        apiKey: z.string().min(1),
        domain: z.string().min(1).optional(),
      })
      .strict(),
  ],
);
