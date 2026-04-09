export type MembersQueryKeys = {
  members: readonly ["settings", "members-directory", string];
  invitations: readonly ["settings", "invitations-directory", string];
  capabilities: readonly ["settings", "membership-capabilities", string];
};

export function buildMembersQueryKeys(organizationId: string): MembersQueryKeys {
  return {
    members: ["settings", "members-directory", organizationId],
    invitations: ["settings", "invitations-directory", organizationId],
    capabilities: ["settings", "membership-capabilities", organizationId],
  };
}
