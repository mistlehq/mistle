import type {
  MemberAvatar,
  MembershipCapabilities,
  OrganizationRole,
  SettingsInvitation,
  SettingsMember,
} from "../settings/members/members-api.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "../settings/members/members-directory-model.js";
import type { OrganizationMembersSettingsPageViewModel } from "../settings/members/organization-members-settings-view-model.js";

export type OrganizationMembersFixtureViewerRole = "owner" | "admin" | "member";

function buildRoleTransitionMatrix(
  viewerRole: OrganizationMembersFixtureViewerRole,
): Record<OrganizationRole, OrganizationRole[]> {
  if (viewerRole === "owner") {
    return {
      owner: ["owner", "admin", "member"],
      admin: ["owner", "admin", "member"],
      member: ["owner", "admin", "member"],
    };
  }

  if (viewerRole === "admin") {
    return {
      owner: [],
      admin: ["admin", "member"],
      member: ["admin", "member"],
    };
  }

  return {
    owner: [],
    admin: [],
    member: [],
  };
}

function buildAssignableRoles(
  viewerRole: OrganizationMembersFixtureViewerRole,
): OrganizationRole[] {
  if (viewerRole === "owner") {
    return ["owner", "admin", "member"];
  }

  if (viewerRole === "admin") {
    return ["admin", "member"];
  }

  return [];
}

export function createOrganizationMembersFixtureCapabilities(
  viewerRole: OrganizationMembersFixtureViewerRole,
): MembershipCapabilities {
  const assignableRoles = buildAssignableRoles(viewerRole);

  return {
    organizationId: "org_storybook",
    actorRole: viewerRole,
    invite: {
      canExecute: assignableRoles.length > 0,
      assignableRoles,
    },
    memberRoleUpdate: {
      canExecute: viewerRole === "owner" || viewerRole === "admin",
      roleTransitionMatrix: buildRoleTransitionMatrix(viewerRole),
    },
  };
}

export const OrganizationMembersFixtureCapabilities: MembershipCapabilities =
  createOrganizationMembersFixtureCapabilities("admin");

export const OrganizationMembersFixtureMembers: SettingsMember[] = [
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

export const OrganizationMembersFixtureInvitations: SettingsInvitation[] = [
  {
    id: "inv_pending",
    organizationId: "org_storybook",
    email: "pending@mistle.so",
    role: "member",
    inviterId: "user_product",
    inviterName: "Product Lead",
    status: "pending",
    expiresAt: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "inv_revoked",
    organizationId: "org_storybook",
    email: "revoked@mistle.so",
    role: "admin",
    inviterId: "user_owner",
    inviterName: "Mistle Owner",
    status: "revoked",
    expiresAt: "2026-03-05T00:00:00.000Z",
    createdAt: "2026-02-20T00:00:00.000Z",
  },
];

export async function inviteOrganizationMemberFixtureRequest(): Promise<{
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

export function requireOrganizationMembersFixtureMember(memberId: string): SettingsMember {
  const member = OrganizationMembersFixtureMembers.find((entry) => entry.id === memberId);
  if (member === undefined) {
    throw new Error(`Missing demo member: ${memberId}`);
  }

  return member;
}

export function createOrganizationMembersFixtureRoleChangeDialog(
  memberId: string,
  selectedRole: "admin" | "member",
): RoleChangeDialogState {
  return {
    member: requireOrganizationMembersFixtureMember(memberId),
    selectedRole,
    allowedRoles: ["admin", "member"],
  };
}

export function createOrganizationMembersSettingsPageFixtureViewModel(
  input?: Partial<OrganizationMembersSettingsPageViewModel>,
): OrganizationMembersSettingsPageViewModel {
  const overrides = input ?? {};
  const viewerRole: OrganizationMembersFixtureViewerRole = "admin";
  const invitationActionState: MembersDirectoryInvitationActionState =
    overrides.invitationActionState ?? null;
  const pendingMemberOperation: MembersDirectoryPendingMemberOperation =
    overrides.pendingMemberOperation ?? null;
  const roleChangeDialog = overrides.roleChangeDialog ?? null;
  const activeFilter = overrides.activeFilter ?? "members";
  const emptyMembers: SettingsMember[] = [];
  const emptyInvitations: SettingsInvitation[] = [];
  const defaultMembers =
    activeFilter === "members" ? OrganizationMembersFixtureMembers : emptyMembers;
  const defaultInvitations =
    activeFilter === "invitations" ? OrganizationMembersFixtureInvitations : emptyInvitations;
  const members = overrides.members ?? defaultMembers;
  const invitations = overrides.invitations ?? defaultInvitations;

  return {
    activeFilter,
    capabilities:
      overrides.capabilities ?? createOrganizationMembersFixtureCapabilities(viewerRole),
    capabilitiesErrorMessage: overrides.capabilitiesErrorMessage ?? null,
    hasNextPage: overrides.hasNextPage ?? false,
    hasPreviousPage: overrides.hasPreviousPage ?? false,
    invitationActionState,
    invitations,
    inviteDialogOpen: overrides.inviteDialogOpen ?? false,
    inviteMemberRequest: overrides.inviteMemberRequest ?? inviteOrganizationMemberFixtureRequest,
    inviteMembersDisabled:
      overrides.inviteMembersDisabled ??
      !createOrganizationMembersFixtureCapabilities(viewerRole).invite.canExecute,
    isListFetching: overrides.isListFetching ?? false,
    isUpdatingRole: overrides.isUpdatingRole ?? false,
    limit: overrides.limit ?? 25,
    listErrorNoticeMessage: overrides.listErrorNoticeMessage ?? null,
    loadErrorMessage: overrides.loadErrorMessage ?? null,
    memberAvatarsByUserId: overrides.memberAvatarsByUserId ?? new Map<string, MemberAvatar>(),
    members,
    onChangeRole: overrides.onChangeRole ?? (() => {}),
    onInviteCompleted: overrides.onInviteCompleted ?? (async () => {}),
    onInviteDialogOpenChange: overrides.onInviteDialogOpenChange ?? (() => {}),
    onFilterChange: overrides.onFilterChange ?? (() => {}),
    onNextPage: overrides.onNextPage ?? (() => {}),
    onPreviousPage: overrides.onPreviousPage ?? (() => {}),
    onSearchValueChange: overrides.onSearchValueChange ?? (() => {}),
    onRemoveMember: overrides.onRemoveMember ?? (() => {}),
    onResendInvite: overrides.onResendInvite ?? (() => {}),
    onRevokeInvite: overrides.onRevokeInvite ?? (() => {}),
    onRoleDialogCancel: overrides.onRoleDialogCancel ?? (() => {}),
    onRoleDialogOpenChange: overrides.onRoleDialogOpenChange ?? (() => {}),
    onRoleSelectValueChange: overrides.onRoleSelectValueChange ?? (() => {}),
    onSaveRole: overrides.onSaveRole ?? (() => {}),
    activeOrganizationId: overrides.activeOrganizationId ?? "org_storybook",
    offset: overrides.offset ?? 0,
    pendingMemberOperation,
    roleChangeDialog,
    roleUpdateErrorMessage: overrides.roleUpdateErrorMessage ?? null,
    searchValue: overrides.searchValue ?? "",
    total: overrides.total ?? members.length + invitations.length,
  };
}

export function createOrganizationMembersSettingsPageFixtureRoleViewModel(
  input: {
    viewerRole?: OrganizationMembersFixtureViewerRole;
    overrides?: Partial<OrganizationMembersSettingsPageViewModel>;
  } = {},
): OrganizationMembersSettingsPageViewModel {
  return createOrganizationMembersSettingsPageFixtureViewModel({
    ...input.overrides,
    capabilities:
      input.overrides?.capabilities ??
      createOrganizationMembersFixtureCapabilities(input.viewerRole ?? "admin"),
    inviteMembersDisabled:
      input.overrides?.inviteMembersDisabled ??
      !createOrganizationMembersFixtureCapabilities(input.viewerRole ?? "admin").invite.canExecute,
  });
}
