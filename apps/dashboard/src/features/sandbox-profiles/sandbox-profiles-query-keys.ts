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

export function automationApplicableSandboxProfilesQueryKey(): readonly [
  "sandbox-profiles",
  "automation-applicable",
] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "automation-applicable"];
}

export function sandboxProfileDetailQueryKey(
  profileId: string,
): readonly ["sandbox-profiles", "detail", string] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "detail", profileId];
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
