export type MembersQueryKeys = {
  members: readonly ["settings", "members-directory", string];
  invitations: readonly ["settings", "invitations-directory", string];
  capabilities: readonly ["settings", "membership-capabilities", string];
};

export function buildMembersQueryKeys(activeOrganizationId: string): MembersQueryKeys {
  return {
    members: ["settings", "members-directory", activeOrganizationId],
    invitations: ["settings", "invitations-directory", activeOrganizationId],
    capabilities: ["settings", "membership-capabilities", activeOrganizationId],
  };
}
