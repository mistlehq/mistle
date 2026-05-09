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
type PutSandboxProfileVersionRefreshScheduleRequest =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/refresh-schedule"]["put"]["requestBody"]["content"]["application/json"];
type PutSandboxProfileVersionRefreshScheduleResponse =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/refresh-schedule"]["put"]["responses"][200]["content"]["application/json"];
type DeleteSandboxProfileVersionRefreshScheduleResponse =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/refresh-schedule"]["delete"]["responses"][200]["content"]["application/json"];
type PutSandboxProfileVersionDraftRequest =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/draft"]["put"]["requestBody"]["content"]["application/json"];
type PutSandboxProfileVersionDraftResponse =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/draft"]["put"]["responses"][200]["content"]["application/json"];
type ListSandboxProvidersResponse =
  paths["/v1/sandbox/providers"]["get"]["responses"][200]["content"]["application/json"];

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
  SANDBOX: "sandbox",
} as const;

export type SandboxIntegrationBindingKind =
  (typeof SandboxIntegrationBindingKinds)[keyof typeof SandboxIntegrationBindingKinds];

export type SandboxProfileVersion = ListSandboxProfileVersionsResponse["versions"][number];
export type SandboxProfileVersionRefreshSchedule = PutSandboxProfileVersionRefreshScheduleResponse;
export type PutSandboxProfileVersionRefreshScheduleInput =
  PutSandboxProfileVersionRefreshScheduleRequest & {
    profileId: string;
    version: number;
  };
export type DeleteSandboxProfileVersionRefreshScheduleResult =
  DeleteSandboxProfileVersionRefreshScheduleResponse;
export type PutSandboxProfileVersionDraftInput = PutSandboxProfileVersionDraftRequest & {
  profileId: string;
  version: number;
};
export type PutSandboxProfileVersionDraftResult = PutSandboxProfileVersionDraftResponse;
export type SandboxProvidersResult = ListSandboxProvidersResponse;
export type SandboxProviderSummary = SandboxProvidersResult["items"][number];

export type SandboxProfileVersionPublishability =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/publishability"]["get"]["responses"][200]["content"]["application/json"];

export type SandboxProfileVersionDraftAutomationImpact =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/draft-automation-impact"]["get"]["responses"][200]["content"]["application/json"];
export type SandboxProfileVersionDraftAutomationImpactAutomation =
  SandboxProfileVersionDraftAutomationImpact["affectedAutomations"][number];
export type SandboxProfileVersionDraftAutomationImpactIssue =
  SandboxProfileVersionDraftAutomationImpactAutomation["issues"][number];

export type PublishSandboxProfileVersionResult = {
  activeVersion: number | null;
  snapshotJob: {
    id: string;
    trigger: "publish" | "manual_refresh" | "scheduled_refresh";
    state: "queued" | "running" | "succeeded" | "failed";
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  version: SandboxProfileVersion;
};

export type SandboxProfileVersionIntegrationBinding =
  SandboxProfileVersionIntegrationBindingsResponse["bindings"][number];
export type SandboxProfileVersionSetupScript =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/setup-script"]["get"]["responses"][200]["content"]["application/json"];
export type SandboxProfileSetupScriptTestRun =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/setup-script/test-runs"]["post"]["responses"][201]["content"]["application/json"];
export type SandboxProfileSetupAssistant =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/setup-script/assistant"]["post"]["responses"][201]["content"]["application/json"];
export type SandboxProfileVersionAutomationConfig =
  paths["/v1/sandbox/profiles/{profileId}/versions/{version}/automation-config"]["get"]["responses"][200]["content"]["application/json"];
