import { defineWorkflowSpec } from "openworkflow";

export type RequestDeleteSandboxProfileWorkflowInput = {
  organizationId: string;
  profileId: string;
};

export type RequestDeleteSandboxProfileWorkflowOutput = {
  profileId: string;
};

export const RequestDeleteSandboxProfileWorkflowSpec = defineWorkflowSpec<
  RequestDeleteSandboxProfileWorkflowInput,
  RequestDeleteSandboxProfileWorkflowOutput
>({
  name: "control-plane.sandbox-profiles.request-delete-profile",
  version: "1",
});
