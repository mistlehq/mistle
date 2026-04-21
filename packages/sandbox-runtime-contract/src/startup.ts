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

export const SandboxdGitIdentitySchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    signing: z
      .object({
        format: z.literal("ssh"),
        program: z.string().min(1),
        keyRef: z.string().min(1),
        organizationId: z.string().min(1),
        providerFamily: z.string().min(1),
        actingUserId: z.string().min(1),
        grant: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SandboxdGitIdentity = z.infer<typeof SandboxdGitIdentitySchema>;

export const SandboxdStartupInputSchema = z
  .object({
    startupMode: SandboxdStartupModeSchema,
    bootstrapToken: z.string().min(1),
    tunnelExchangeToken: z.string().min(1),
    tunnelGatewayWsUrl: z.string().min(1),
    runtimePlan: CompiledRuntimePlanSchema,
    egressGrantByRuleId: z.record(z.string(), z.string().min(1)),
    gitIdentity: SandboxdGitIdentitySchema.optional(),
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
