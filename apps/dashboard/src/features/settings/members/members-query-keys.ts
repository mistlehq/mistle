export type MembersQueryKeys = {
  directory: readonly ["settings", "members-directory", string];
  capabilities: readonly ["settings", "membership-capabilities", string];
};

export function buildMembersQueryKeys(organizationId: string): MembersQueryKeys {
  return {
    directory: ["settings", "members-directory", organizationId],
    capabilities: ["settings", "membership-capabilities", organizationId],
  };
}
