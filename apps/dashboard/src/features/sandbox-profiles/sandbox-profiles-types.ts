import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type ListSandboxProfilesResponse =
  paths["/v1/sandbox/profiles"]["get"]["responses"][200]["content"]["application/json"];
type ListLaunchableSandboxProfilesResponse =
  paths["/v1/sandbox/profiles/launchable"]["get"]["responses"][200]["content"]["application/json"];
type ListAutomationApplicableSandboxProfilesResponse =
  paths["/v1/sandbox/profiles/automation-applicable"]["get"]["responses"][200]["content"]["application/json"];
type GetSandboxProfileResponse =
  paths["/v1/sandbox/profiles/{profileId}"]["get"]["responses"][200]["content"]["application/json"];
type CreateSandboxProfileRequest =
  paths["/v1/sandbox/profiles"]["post"]["requestBody"]["content"]["application/json"];
type UpdateSandboxProfileRequest =
  paths["/v1/sandbox/profiles/{profileId}"]["patch"]["requestBody"]["content"]["application/json"];

export type SandboxProfile = GetSandboxProfileResponse;
export type SandboxProfileStatus = SandboxProfile["status"];
export type SandboxProfilesListResult = ListSandboxProfilesResponse;
export type LaunchableSandboxProfilesResult = ListLaunchableSandboxProfilesResponse;
export type LaunchableSandboxProfile = LaunchableSandboxProfilesResult["items"][number];
export type AutomationApplicableSandboxProfilesResult =
  ListAutomationApplicableSandboxProfilesResponse;
export type AutomationApplicableSandboxProfile =
  AutomationApplicableSandboxProfilesResult["items"][number];
export type KeysetPageCursor = NonNullable<SandboxProfilesListResult["nextPage"]>;
export type KeysetPreviousPageCursor = NonNullable<SandboxProfilesListResult["previousPage"]>;
export type CreateSandboxProfileInput = CreateSandboxProfileRequest;
export type UpdateSandboxProfileInput = UpdateSandboxProfileRequest & {
  profileId: string;
};

export const SandboxIntegrationBindingKinds = {
  AGENT: "agent",
  GIT: "git",
  CONNECTOR: "connector",
} as const;

export type SandboxIntegrationBindingKind =
  (typeof SandboxIntegrationBindingKinds)[keyof typeof SandboxIntegrationBindingKinds];

export type SandboxProfileVersion = {
  sandboxProfileId: string;
  version: number;
};

export type SandboxProfileVersionIntegrationBinding = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  connectionId: string;
  kind: SandboxIntegrationBindingKind;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
