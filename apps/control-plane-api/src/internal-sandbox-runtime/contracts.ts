import { z } from "zod";

export const InternalSandboxRuntimeErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const InternalSandboxRuntimeStartProfileInstanceRequestSchema = z.object({
  organizationId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: z.number().int().min(1),
  startedBy: z.object({
    kind: z.union([z.literal("user"), z.literal("system")]),
    id: z.string().min(1),
  }),
  source: z.union([z.literal("dashboard"), z.literal("webhook")]),
});

export const InternalSandboxRuntimeStartProfileInstanceResponseSchema = z.object({
  status: z.literal("completed"),
  workflowRunId: z.string().min(1),
  sandboxInstanceId: z.string().min(1),
  providerSandboxId: z.string().min(1),
});

export const InternalSandboxRuntimeMintConnectionRequestSchema = z.object({
  organizationId: z.string().min(1),
  instanceId: z.string().min(1),
});

export const InternalSandboxRuntimeMintConnectionResponseSchema = z.object({
  instanceId: z.string().min(1),
  url: z.url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
});
