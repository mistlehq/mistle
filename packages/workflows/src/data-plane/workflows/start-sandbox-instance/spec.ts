import { defineWorkflowSpec } from "openworkflow";

export type StartSandboxInstanceWorkflowImageInput = {
  provider: "modal";
  imageId: string;
  kind: "base" | "snapshot";
  createdAt: string;
};

export type StartSandboxInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  manifest: Record<string, unknown>;
  startedBy: {
    kind: "user";
    id: string;
  };
  source: "dashboard";
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
