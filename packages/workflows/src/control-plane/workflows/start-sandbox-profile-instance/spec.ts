import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import { defineWorkflowSpec } from "openworkflow";

import type { StartSandboxInstanceWorkflowImageInput } from "../../../data-plane/workflows/start-sandbox-instance/spec.js";

export type StartSandboxProfileInstanceWorkflowInput = {
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

export type StartSandboxProfileInstanceWorkflowOutput = {
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export const StartSandboxProfileInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput
>({
  name: "control-plane.sandbox-instances.start-profile-instance",
  version: "1",
});
