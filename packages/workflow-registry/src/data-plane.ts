import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export const StartSandboxInstanceWorkflowName = "data-plane.sandbox-instances.start";
export const StartSandboxInstanceWorkflowVersion = "1";
export const ResumeSandboxInstanceWorkflowName = "data-plane.sandbox-instances.resume";
export const ResumeSandboxInstanceWorkflowVersion = "1";
export const StopSandboxInstanceWorkflowName = "data-plane.sandbox-instances.stop";
export const StopSandboxInstanceWorkflowVersion = "1";

export type SandboxStopReason = "idle" | "disconnected";

export type StartSandboxInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "createdAt"
>;

export type StartSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxInstanceWorkflowImageInput;
};

export type StartSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  providerRuntimeId: string;
};

export const StartSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowOutput
>({
  name: StartSandboxInstanceWorkflowName,
  version: StartSandboxInstanceWorkflowVersion,
});

export type ResumeSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
};

export type ResumeSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
};

export const ResumeSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  ResumeSandboxInstanceWorkflowInput,
  ResumeSandboxInstanceWorkflowOutput
>({
  name: ResumeSandboxInstanceWorkflowName,
  version: ResumeSandboxInstanceWorkflowVersion,
});

export type StopSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId: string;
};

export type StopSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
};

export const StopSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  StopSandboxInstanceWorkflowInput,
  StopSandboxInstanceWorkflowOutput
>({
  name: StopSandboxInstanceWorkflowName,
  version: StopSandboxInstanceWorkflowVersion,
});
