export type MembersQueryKeys = {
  members: readonly ["settings", "members", string];
  invitations: readonly ["settings", "invitations", string];
  capabilities: readonly ["settings", "membership-capabilities", string];
};

export function buildMembersQueryKeys(organizationId: string): MembersQueryKeys {
  return {
    members: ["settings", "members", organizationId],
    invitations: ["settings", "invitations", organizationId],
    capabilities: ["settings", "membership-capabilities", organizationId],
  };
}
