import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export type StartSandboxProfileInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxProfileInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxProfileInstanceWorkflowImageInput;
};

export type StartSandboxProfileInstanceWorkflowOutput = {
  workflowRunId: string;
  sandboxInstanceId: string;
};

export const StartSandboxProfileInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput
>({
  name: "control-plane.sandbox-instances.start-profile-instance",
  version: "1",
});
