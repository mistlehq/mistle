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

export function sandboxProfileDetailQueryKey(
  profileId: string,
): readonly ["sandbox-profiles", "detail", string] {
  return [SANDBOX_PROFILES_QUERY_KEY_PREFIX[0], "detail", profileId];
}
