import type {
  MemberAvatar,
  MembersDirectoryFilter,
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import type { RoleChangeDialogState } from "./members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";

export type OrganizationMembersSettingsPageViewModel = {
  activeFilter: MembersDirectoryFilter;
  capabilities: MembershipCapabilities | null;
  capabilitiesErrorMessage: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  invitationActionState: MembersDirectoryInvitationActionState;
  invitations: SettingsInvitation[];
  inviteDialogOpen: boolean;
  inviteMemberRequest: (request: {
    organizationId: string;
    email: string;
    role: MembershipCapabilities["actorRole"];
  }) => Promise<{
    status: string | null;
    message: string | null;
    code: string | null;
    raw: unknown;
  }>;
  isLoading: boolean;
  isListFetching: boolean;
  isUpdatingRole: boolean;
  listErrorNoticeMessage: string | null;
  loadErrorMessage: string | null;
  limit: number;
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  members: SettingsMember[];
  inviteMembersDisabled: boolean;
  onChangeRole: (member: SettingsMember) => void;
  onInviteCompleted: () => Promise<void>;
  onInviteDialogOpenChange: (nextOpen: boolean) => void;
  onFilterChange: (nextValue: MembersDirectoryFilter) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onSearchValueChange: (nextValue: string) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onRoleDialogCancel: () => void;
  onRoleDialogOpenChange: (nextOpen: boolean) => void;
  onRoleSelectValueChange: (nextRoleValue: string | null) => void;
  onSaveRole: () => void;
  activeOrganizationId: string;
  offset: number;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  roleChangeDialog: RoleChangeDialogState | null;
  roleUpdateErrorMessage: string | null;
  searchValue: string;
  total: number;
};
