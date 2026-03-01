import { SandboxInstanceSources, SandboxInstanceStarterKinds } from "@mistle/db/data-plane";
import { SandboxImageKind, SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";
import { z } from "zod";

export const DataPlaneSandboxProviders = SandboxProvider;
export const DataPlaneSandboxImageKinds = SandboxImageKind;
export const DataPlaneSandboxInstanceStarterKinds = SandboxInstanceStarterKinds;
export const DataPlaneSandboxInstanceSources = SandboxInstanceSources;

export const StartSandboxInstanceImageSchema = z
  .object({
    provider: z.enum(DataPlaneSandboxProviders),
    imageId: z.string().min(1),
    kind: z.enum(DataPlaneSandboxImageKinds),
    createdAt: z.string().min(1),
  })
  .strict();

export const StartSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
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

export const StartSandboxInstanceCompletedResponseSchema = z
  .object({
    status: z.literal("completed"),
    sandboxInstanceId: z.string().min(1),
    providerSandboxId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type StartSandboxInstanceInput = z.infer<typeof StartSandboxInstanceInputSchema>;
export type StartSandboxInstanceCompletedResponse = z.infer<
  typeof StartSandboxInstanceCompletedResponseSchema
>;

type ContractMatchesWorkflowInput =
  StartSandboxInstanceInput extends StartSandboxInstanceWorkflowInput
    ? StartSandboxInstanceWorkflowInput extends StartSandboxInstanceInput
      ? true
      : never
    : never;

const contractMatchesWorkflowInput: ContractMatchesWorkflowInput = true;
void contractMatchesWorkflowInput;
