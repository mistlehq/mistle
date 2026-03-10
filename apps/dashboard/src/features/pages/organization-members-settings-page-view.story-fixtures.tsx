import type {
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "../settings/members/members-api.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "../settings/members/members-directory-model.js";
import type { OrganizationMembersSettingsPageViewProps } from "./organization-members-settings-page-view.js";

export const OrganizationMembersStoryCapabilities: MembershipCapabilities = {
  organizationId: "org_storybook",
  actorRole: "admin",
  invite: {
    canExecute: true,
    assignableRoles: ["admin", "member"],
  },
  memberRoleUpdate: {
    canExecute: true,
    roleTransitionMatrix: {
      owner: [],
      admin: ["admin", "member"],
      member: ["admin", "member"],
    },
  },
};

export const OrganizationMembersStoryMembers: SettingsMember[] = [
  {
    id: "mem_owner",
    userId: "user_owner",
    name: "Mistle Owner",
    email: "owner@mistle.so",
    role: "owner",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_product",
    userId: "user_product",
    name: "Product Lead",
    email: "product@mistle.so",
    role: "admin",
    joinedAt: "2026-02-04T00:00:00.000Z",
  },
  {
    id: "mem_storybook",
    userId: "user_storybook",
    name: "Storybook Tester",
    email: "storybook@mistle.so",
    role: "member",
    joinedAt: "2026-02-14T00:00:00.000Z",
  },
];

export const OrganizationMembersStoryInvitations: SettingsInvitation[] = [
  {
    id: "inv_pending",
    organizationId: "org_storybook",
    email: "pending@mistle.so",
    role: "member",
    inviterId: "user_product",
    status: "pending",
    rawStatus: null,
    expiresAt: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "inv_revoked",
    organizationId: "org_storybook",
    email: "revoked@mistle.so",
    role: "admin",
    inviterId: "user_owner",
    status: "revoked",
    rawStatus: null,
    expiresAt: "2026-03-05T00:00:00.000Z",
    createdAt: "2026-02-20T00:00:00.000Z",
  },
];

export async function inviteOrganizationMemberStoryRequest(): Promise<{
  status: string | null;
  message: string | null;
  code: string | null;
  raw: unknown;
}> {
  return {
    status: "queued",
    message: null,
    code: null,
    raw: null,
  };
}

export function requireOrganizationMembersStoryMember(memberId: string): SettingsMember {
  const member = OrganizationMembersStoryMembers.find((entry) => entry.id === memberId);
  if (member === undefined) {
    throw new Error(`Missing demo member: ${memberId}`);
  }

  return member;
}

export function resolveOrganizationMembersStoryInviterDisplayName(inviterId: string): string {
  const inviter = OrganizationMembersStoryMembers.find((member) => member.userId === inviterId);
  return inviter?.name ?? inviterId;
}

export function createOrganizationMembersStoryRoleChangeDialog(
  memberId: string,
  selectedRole: "admin" | "member",
): RoleChangeDialogState {
  return {
    member: requireOrganizationMembersStoryMember(memberId),
    selectedRole,
    allowedRoles: ["admin", "member"],
  };
}

export function createOrganizationMembersSettingsPageStoryArgs(
  overrides: Partial<OrganizationMembersSettingsPageViewProps> = {},
): OrganizationMembersSettingsPageViewProps {
  const invitationActionState: MembersDirectoryInvitationActionState =
    overrides.invitationActionState ?? null;
  const pendingMemberOperation: MembersDirectoryPendingMemberOperation =
    overrides.pendingMemberOperation ?? null;
  const roleChangeDialog = overrides.roleChangeDialog ?? null;

  return {
    capabilities: overrides.capabilities ?? OrganizationMembersStoryCapabilities,
    capabilitiesErrorMessage: overrides.capabilitiesErrorMessage ?? null,
    invitationActionState,
    invitations: overrides.invitations ?? OrganizationMembersStoryInvitations,
    inviteDialogOpen: overrides.inviteDialogOpen ?? false,
    inviteMemberRequest: overrides.inviteMemberRequest ?? inviteOrganizationMemberStoryRequest,
    isLoading: overrides.isLoading ?? false,
    isUpdatingRole: overrides.isUpdatingRole ?? false,
    loadErrorMessage: overrides.loadErrorMessage ?? null,
    members: overrides.members ?? OrganizationMembersStoryMembers,
    onChangeRole: overrides.onChangeRole ?? (() => {}),
    onInviteCompleted: overrides.onInviteCompleted ?? (async () => {}),
    onInviteDialogOpenChange: overrides.onInviteDialogOpenChange ?? (() => {}),
    onRemoveMember: overrides.onRemoveMember ?? (() => {}),
    onResendInvite: overrides.onResendInvite ?? (() => {}),
    onRetryCapabilities: overrides.onRetryCapabilities ?? (() => {}),
    onRetryLoad: overrides.onRetryLoad ?? (() => {}),
    onRevokeInvite: overrides.onRevokeInvite ?? (() => {}),
    onRoleDialogCancel: overrides.onRoleDialogCancel ?? (() => {}),
    onRoleDialogOpenChange: overrides.onRoleDialogOpenChange ?? (() => {}),
    onRoleSelectValueChange: overrides.onRoleSelectValueChange ?? (() => {}),
    onSaveRole: overrides.onSaveRole ?? (() => {}),
    organizationId: overrides.organizationId ?? "org_storybook",
    pendingMemberOperation,
    resolveInviterDisplayName:
      overrides.resolveInviterDisplayName ?? resolveOrganizationMembersStoryInviterDisplayName,
    roleChangeDialog,
    roleUpdateErrorMessage: overrides.roleUpdateErrorMessage ?? null,
  };
}
