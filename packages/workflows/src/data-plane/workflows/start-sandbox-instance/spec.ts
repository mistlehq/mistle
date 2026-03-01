import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export type StartSandboxInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxInstanceWorkflowImageInput;
};

export type StartSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export const StartSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowOutput
>({
  name: "data-plane.sandbox-instances.start",
  version: "1",
});
