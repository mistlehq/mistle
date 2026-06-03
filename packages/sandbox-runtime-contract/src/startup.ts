import { z } from "zod";

import { CompiledRuntimePlanSchema } from "./runtime-plan.js";

export const SandboxdStartupModes = {
  NEW: "new",
  EXISTING: "existing",
} as const;

export const SandboxdStartupModeSchema = z.enum([
  SandboxdStartupModes.NEW,
  SandboxdStartupModes.EXISTING,
]);

export type SandboxdStartupMode = z.infer<typeof SandboxdStartupModeSchema>;

export const SandboxdExecutionModes = {
  SESSION: "session",
  SNAPSHOT: "snapshot",
} as const;

export const SandboxdExecutionModeSchema = z.enum([
  SandboxdExecutionModes.SESSION,
  SandboxdExecutionModes.SNAPSHOT,
]);

export type SandboxdExecutionMode = z.infer<typeof SandboxdExecutionModeSchema>;

export const SandboxdOperationKinds = {
  START: "start",
  RESUME: "resume",
  SETUP_CHECK: "setup_check",
  SNAPSHOT: "snapshot",
} as const;

export const SandboxdOperationKindSchema = z.enum([
  SandboxdOperationKinds.START,
  SandboxdOperationKinds.RESUME,
  SandboxdOperationKinds.SETUP_CHECK,
  SandboxdOperationKinds.SNAPSHOT,
]);

export type SandboxdOperationKind = z.infer<typeof SandboxdOperationKindSchema>;

export const SandboxdGitIdentitySchema = z
  .object({
    name: z.string().min(1),
    email: z.string().min(1),
    signing: z
      .object({
        format: z.literal("ssh"),
        program: z.string().min(1),
        keyRef: z.string().min(1),
        organizationId: z.string().min(1),
        providerFamily: z.string().min(1),
        integrationConnectionId: z.string().min(1),
        actingUserId: z.string().min(1),
        grant: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SandboxdGitIdentity = z.infer<typeof SandboxdGitIdentitySchema>;

export const SandboxdTransparentProxyBypassKinds = {
  SOCKET_MARK: "socket_mark",
} as const;

export const SandboxdTransparentProxyBypassSchema = z
  .object({
    kind: z.literal(SandboxdTransparentProxyBypassKinds.SOCKET_MARK),
    mark: z.number().int().min(1),
  })
  .strict();

export const SandboxdTransparentProxyExclusionKinds = {
  CIDR: "cidr",
  HOST: "host",
} as const;

export const SandboxdTransparentProxyExclusionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(SandboxdTransparentProxyExclusionKinds.CIDR),
      value: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal(SandboxdTransparentProxyExclusionKinds.HOST),
      value: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const SandboxdTransparentProxyConfigurationSchema = z
  .object({
    passthroughBypass: SandboxdTransparentProxyBypassSchema,
    exclusions: z.array(SandboxdTransparentProxyExclusionSchema),
  })
  .strict();

export type SandboxdTransparentProxyConfiguration = z.infer<
  typeof SandboxdTransparentProxyConfigurationSchema
>;

export const SandboxdStartupInputSchema = z
  .object({
    startupMode: SandboxdStartupModeSchema,
    executionMode: SandboxdExecutionModeSchema.optional(),
    operationKind: SandboxdOperationKindSchema,
    bootstrapToken: z.string().min(1),
    tunnelExchangeToken: z.string().min(1),
    tunnelGatewayWsUrl: z.string().min(1),
    runtimePlan: CompiledRuntimePlanSchema,
    actingUserId: z.string().min(1).optional(),
    gitIdentity: SandboxdGitIdentitySchema.optional(),
    transparentProxy: SandboxdTransparentProxyConfigurationSchema.optional(),
  })
  .strict();

export type SandboxdStartupInput = z.infer<typeof SandboxdStartupInputSchema>;

export const SandboxdInitResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

export type SandboxdInitResponse = z.infer<typeof SandboxdInitResponseSchema>;
