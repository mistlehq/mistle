import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export type StartSandboxInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
} & StartSandboxInstanceInput;

export type StartSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export const StartSandboxInstanceWorkflowSpec: ReturnType<
  typeof defineWorkflowSpec<
    StartSandboxInstanceWorkflowInput,
    StartSandboxInstanceWorkflowOutput,
    StartSandboxInstanceWorkflowInput
  >
> = defineWorkflowSpec({
  name: "data-plane.sandbox-instances.start",
  version: "1",
});
