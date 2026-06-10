import { z } from "@hono/zod-openapi";
import { SandboxProvider } from "@mistle/sandbox";

const ModalSandboxMaxTimeoutMs = 24 * 60 * 60 * 1000;

export const InternalSandboxRuntimeResolveCredentialsRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    provider: z.enum([
      SandboxProvider.DOCKER,
      SandboxProvider.E2B,
      SandboxProvider.FREESTYLE,
      SandboxProvider.MODAL,
      SandboxProvider.OPENCOMPUTER,
      SandboxProvider.TENSORLAKE,
    ]),
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
    z
      .object({
        provider: z.literal(SandboxProvider.TENSORLAKE),
        source: z.enum(["managed", "connection"]),
        apiKey: z.string().min(1),
      })
      .strict(),
    z
      .object({
        provider: z.literal(SandboxProvider.OPENCOMPUTER),
        source: z.enum(["managed", "connection"]),
        apiKey: z.string().min(1),
        apiBaseUrl: z.url().optional(),
      })
      .strict(),
    z
      .object({
        provider: z.literal(SandboxProvider.FREESTYLE),
        source: z.enum(["managed", "connection"]),
        apiKey: z.string().min(1),
        baseUrl: z.url().optional(),
      })
      .strict(),
    z
      .object({
        provider: z.literal(SandboxProvider.MODAL),
        source: z.enum(["managed", "connection"]),
        tokenId: z.string().min(1),
        tokenSecret: z.string().min(1),
        appName: z.string().min(1),
        environment: z.string().min(1).optional(),
        defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
      })
      .strict(),
  ],
);
