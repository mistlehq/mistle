import type { MembershipCapabilities, OrganizationRole, SettingsMember } from "./members-api.js";

export type RoleChangeDialogState = {
  member: SettingsMember;
  selectedRole: OrganizationRole;
  allowedRoles: OrganizationRole[];
};

export function canManageInvitations(capabilities: MembershipCapabilities | null): boolean {
  return capabilities?.invite.canExecute === true;
}

export function resolveAllowedRoleTransitions(input: {
  capabilities: MembershipCapabilities | null;
  memberRole: OrganizationRole;
}): OrganizationRole[] {
  return input.capabilities?.memberRoleUpdate.roleTransitionMatrix[input.memberRole] ?? [];
}

export function buildRoleChangeDialogState(input: {
  capabilities: MembershipCapabilities | null;
  member: SettingsMember;
}): RoleChangeDialogState | null {
  const allowedRoles = resolveAllowedRoleTransitions({
    capabilities: input.capabilities,
    memberRole: input.member.role,
  });
  if (allowedRoles.length === 0) {
    return null;
  }

  const defaultRole = allowedRoles[0];
  if (defaultRole === undefined) {
    return null;
  }

  return {
    member: input.member,
    selectedRole: defaultRole,
    allowedRoles,
  };
}
