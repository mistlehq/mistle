import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type ListSandboxProfilesResponse =
  paths["/v1/sandbox/profiles"]["get"]["responses"][200]["content"]["application/json"];
type ListLaunchableSandboxProfilesResponse =
  paths["/v1/sandbox/profiles/launchable"]["get"]["responses"][200]["content"]["application/json"];
type GetSandboxProfileResponse =
  paths["/v1/sandbox/profiles/{profileId}"]["get"]["responses"][200]["content"]["application/json"];
type ListSandboxProfileVersionsResponse =
  paths["/v1/sandbox/profiles/{profileId}/versions"]["get"]["responses"][200]["content"]["application/json"];
type CreateSandboxProfileRequest =
  paths["/v1/sandbox/profiles"]["post"]["requestBody"]["content"]["application/json"];
type UpdateSandboxProfileRequest =
  paths["/v1/sandbox/profiles/{profileId}"]["patch"]["requestBody"]["content"]["application/json"];
type DeleteSandboxProfileResponse =
  paths["/v1/sandbox/profiles/{profileId}"]["delete"]["responses"][202]["content"]["application/json"];
type SandboxProfileVersionIntegrationBindingsResponse =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/integration-bindings"]["get"]["responses"][200]["content"]["application/json"];

export type SandboxProfile = GetSandboxProfileResponse;
export type SandboxProfileStatus = SandboxProfile["status"];
export type SandboxProfilesListResult = ListSandboxProfilesResponse;
export type SandboxProfileRepositoryOption =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/automation-config"]["get"]["responses"][200]["content"]["application/json"]["repositoryOptions"][number];
export type LaunchableSandboxProfile = ListLaunchableSandboxProfilesResponse["items"][number];
export type LaunchableSandboxProfilesResult = ListLaunchableSandboxProfilesResponse;
export type KeysetPageCursor = NonNullable<SandboxProfilesListResult["nextPage"]>;
export type KeysetPreviousPageCursor = NonNullable<SandboxProfilesListResult["previousPage"]>;
export type CreateSandboxProfileInput = CreateSandboxProfileRequest;
export type DeleteSandboxProfileResult = DeleteSandboxProfileResponse;
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

export type SandboxProfileVersion = ListSandboxProfileVersionsResponse["versions"][number];

export type SandboxProfileVersionPublishability =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/publishability"]["get"]["responses"][200]["content"]["application/json"];

export type PublishSandboxProfileVersionResult =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/publish"]["post"]["responses"][200]["content"]["application/json"];

export type SandboxProfileVersionIntegrationBinding =
  SandboxProfileVersionIntegrationBindingsResponse["bindings"][number];
export type SandboxProfileVersionSetupScript =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/setup-script"]["get"]["responses"][200]["content"]["application/json"];
export type SandboxProfileVersionAutomationConfig =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/automation-config"]["get"]["responses"][200]["content"]["application/json"];
