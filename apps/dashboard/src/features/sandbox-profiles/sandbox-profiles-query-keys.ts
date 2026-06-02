export const SANDBOX_PROFILES_QUERY_KEY_PREFIX: readonly ["sandbox-profiles"] = [
  "sandbox-profiles",
];

export function sandboxProfilesListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
}): readonly ["sandbox-profiles", "list", number, string | null, string | null] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "list", input.limit, input.after, input.before];
}

export function launchableSandboxProfilesQueryKey(): readonly ["sandbox-profiles", "launchable"] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "launchable"];
}

export function sandboxProvidersQueryKey(): readonly ["sandbox-profiles", "providers"] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "providers"];
}

export function sandboxProfileDetailQueryKey(
  profileId: string,
): readonly ["sandbox-profiles", "detail", string] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "detail", profileId];
}

export function sandboxProfileTriggerUsagesQueryKey(
  profileId: string,
): readonly ["sandbox-profiles", "trigger-usages", string] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "trigger-usages", profileId];
}

export function sandboxProfileDuplicateTriggerUsagesQueryKey(input: {
  profileId: string;
  activeVersion: number | null;
}): readonly ["sandbox-profiles", "duplicate-trigger-usages", string, number | null] {
  return [
    SANDBOX_PROFILES_QUERY_KEY_PREFIX[0],
    "duplicate-trigger-usages",
    input.profileId,
    input.activeVersion,
  ];
}

export function sandboxProfileIntegrationDirectoryQueryKey(): readonly [
  "sandbox-profiles",
  "integration-directory",
] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "integration-directory"];
}

export function sandboxProfileVersionsQueryKey(
  profileId: string,
): readonly ["sandbox-profiles", "versions", string] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "versions", profileId];
}

export function sandboxProfileVersionIntegrationBindingsQueryKey(input: {
  profileId: string;
  version: number;
}): readonly ["sandbox-profiles", "integration-bindings", string, number] {
  return [
    SANDBOX_PROFILES_QUERY_KEY_PREFIX[0],
    "integration-bindings",
    input.profileId,
    input.version,
  ];
}

export function sandboxProfileVersionSetupScriptQueryKey(input: {
  profileId: string;
  version: number;
}): readonly ["sandbox-profiles", "setup-script", string, number] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "setup-script", input.profileId, input.version];
}

export function sandboxProfileVersionSkillsSourceReposQueryKey(input: {
  profileId: string;
  version: number;
  originUrl: string | null;
}): readonly ["sandbox-profiles", "skills-source-repos", string, number, string | null] {
  return [
    SANDBOX_PROFILES_QUERY_KEY_PREFIX[0],
    "skills-source-repos",
    input.profileId,
    input.version,
    input.originUrl,
  ];
}

export function sandboxProfileVersionTriggerConfigQueryKey(input: {
  profileId: string;
  version: number;
}): readonly ["sandbox-profiles", "trigger-config", string, number] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "trigger-config", input.profileId, input.version];
}
