import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type ListSandboxProfilesResponse =
  paths["/v1/sandbox/profiles"]["get"]["responses"][200]["content"]["application/json"];
type GetSandboxProfileResponse =
  paths["/v1/sandbox/profiles/{profileId}"]["get"]["responses"][200]["content"]["application/json"];
type CreateSandboxProfileRequest =
  paths["/v1/sandbox/profiles"]["post"]["requestBody"]["content"]["application/json"];
type UpdateSandboxProfileRequest =
  paths["/v1/sandbox/profiles/{profileId}"]["patch"]["requestBody"]["content"]["application/json"];

export type SandboxProfile = GetSandboxProfileResponse;
export type SandboxProfileStatus = SandboxProfile["status"];
export type SandboxProfilesListResult = ListSandboxProfilesResponse;
export type KeysetPageCursor = NonNullable<SandboxProfilesListResult["nextPage"]>;
export type KeysetPreviousPageCursor = NonNullable<SandboxProfilesListResult["previousPage"]>;
export type CreateSandboxProfileInput = CreateSandboxProfileRequest;
export type UpdateSandboxProfileInput = UpdateSandboxProfileRequest & {
  profileId: string;
};
