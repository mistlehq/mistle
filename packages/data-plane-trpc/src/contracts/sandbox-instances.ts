import { z } from "zod";

export const DataPlaneSandboxProviders = {
  MODAL: "modal",
} as const;

export const DataPlaneSandboxImageKinds = {
  BASE: "base",
  SNAPSHOT: "snapshot",
} as const;

export const DataPlaneSandboxInstanceStarterKinds = {
  USER: "user",
} as const;

export const DataPlaneSandboxInstanceSources = {
  DASHBOARD: "dashboard",
} as const;

export const StartSandboxInstanceImageSchema = z
  .object({
    provider: z.literal(DataPlaneSandboxProviders.MODAL),
    imageId: z.string().min(1),
    kind: z.enum([DataPlaneSandboxImageKinds.BASE, DataPlaneSandboxImageKinds.SNAPSHOT]),
    createdAt: z.string().min(1),
  })
  .strict();

export const StartSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    manifest: z.record(z.string(), z.unknown()),
    startedBy: z
      .object({
        kind: z.literal(DataPlaneSandboxInstanceStarterKinds.USER),
        id: z.string().min(1),
      })
      .strict(),
    source: z.literal(DataPlaneSandboxInstanceSources.DASHBOARD),
    image: StartSandboxInstanceImageSchema,
  })
  .strict();

export const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type StartSandboxInstanceInput = z.infer<typeof StartSandboxInstanceInputSchema>;
export type StartSandboxInstanceAcceptedResponse = z.infer<
  typeof StartSandboxInstanceAcceptedResponseSchema
>;
