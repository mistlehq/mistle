import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import { SandboxImageKind } from "@mistle/sandbox";
import { z } from "zod";

const DataPlaneSandboxImageKinds = SandboxImageKind;
const DataPlaneSandboxInstanceStarterKinds = {
  USER: "user",
  SYSTEM: "system",
} as const;
const DataPlaneSandboxInstanceSources = {
  DASHBOARD: "dashboard",
  WEBHOOK: "webhook",
} as const;
export const DataPlaneSandboxInstanceStatuses = {
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
} as const;

const StartSandboxInstanceImageSchema = z
  .object({
    imageId: z.string().min(1),
    kind: z.enum(DataPlaneSandboxImageKinds),
    createdAt: z.string().min(1),
  })
  .strict();

export const StartSandboxInstanceInputValidationSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    runtimePlan: CompiledRuntimePlanSchema,
    startedBy: z
      .object({
        kind: z.enum(DataPlaneSandboxInstanceStarterKinds),
        id: z.string().min(1),
      })
      .strict(),
    source: z.enum(DataPlaneSandboxInstanceSources),
    image: StartSandboxInstanceImageSchema,
  })
  .strict();

export const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(DataPlaneSandboxInstanceStatuses),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export type StartSandboxInstanceInput = z.infer<typeof StartSandboxInstanceInputValidationSchema>;
export type StartSandboxInstanceAcceptedResponse = z.infer<
  typeof StartSandboxInstanceAcceptedResponseSchema
>;
export type GetSandboxInstanceInput = z.infer<typeof GetSandboxInstanceInputSchema>;
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
