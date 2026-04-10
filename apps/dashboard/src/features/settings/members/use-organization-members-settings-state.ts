import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { MembersDirectoryFilter } from "./members-api.js";
import type { RoleChangeDialogState } from "./members-capability-policy.js";
import { buildRoleChangeDialogState, canManageInvitations } from "./members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";
import { resolveMembersDirectoryQueryState } from "./members-directory-query-state.js";
import { parseRoleSelectValue } from "./members-formatters.js";
import { clampMembersDirectoryOffset } from "./members-pagination.js";
import { buildMembersQueryKeys } from "./members-query-keys.js";
import { defaultMembersSettingsApi, type MembersSettingsApi } from "./members-settings-api.js";
import type { OrganizationMembersSettingsPageViewModel } from "./organization-members-settings-view-model.js";
import { useMembersMutations } from "./use-members-mutations.js";

type UseOrganizationMembersSettingsState = {
  activeOrganizationId: string;
  api?: MembersSettingsApi;
};

type UseOrganizationMembersSettingsStateResult = {
  viewModel: OrganizationMembersSettingsPageViewModel;
};

export function resolvePostInviteDirectoryState(): {
  activeFilter: MembersDirectoryFilter;
  searchValue: string;
  offset: number;
} {
  return {
    activeFilter: "invitations",
    searchValue: "",
    offset: 0,
  };
}

export function useOrganizationMembersSettingsState(
  input: UseOrganizationMembersSettingsState,
): UseOrganizationMembersSettingsStateResult {
  const membersDirectoryPageLimit = 25;
  const queryClient = useQueryClient();
  const api = input.api ?? defaultMembersSettingsApi;

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState | null>(null);
  const [pendingMemberOperation, setPendingMemberOperation] =
    useState<MembersDirectoryPendingMemberOperation>(null);
  const [invitationActionState, setInvitationActionState] =
    useState<MembersDirectoryInvitationActionState>(null);
  const [roleUpdateErrorMessage, setRoleUpdateErrorMessage] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<MembersDirectoryFilter>("members");
  const [searchValue, setSearchValue] = useState("");
  const [offset, setOffset] = useState(0);

  const queryKeys = buildMembersQueryKeys(input.activeOrganizationId);
  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.capabilities,
    queryFn: async () => api.getMembershipCapabilities(),
  });
  const membersQuery = useQuery({
    queryKey: [...queryKeys.members, membersDirectoryPageLimit, offset, searchValue],
    queryFn: async () =>
      api.listMembersPage({
        limit: membersDirectoryPageLimit,
        offset,
        search: searchValue,
      }),
    enabled: activeFilter === "members",
    retry: false,
  });
  const invitationsQuery = useQuery({
    queryKey: [...queryKeys.invitations, membersDirectoryPageLimit, offset, searchValue],
    queryFn: async () =>
      api.listInvitationsPage({
        limit: membersDirectoryPageLimit,
        offset,
        search: searchValue,
      }),
    enabled: activeFilter === "invitations",
    retry: false,
  });
  const directoryQueryState = resolveMembersDirectoryQueryState({
    activeFilter,
    capabilitiesQuery,
    invitationsQuery,
    membersQuery,
  });
  const mutations = useMembersMutations({
    activeOrganizationId: input.activeOrganizationId,
    api,
    queryClient,
    queryKeys,
    roleChangeDialog,
    setRoleChangeDialog,
    setRoleUpdateErrorMessage,
    setPendingMemberOperation,
    setInvitationActionState,
  });

  const inviteMembersDisabled =
    capabilitiesQuery.isError || !canManageInvitations(directoryQueryState.capabilities);

  useEffect(() => {
    const nextOffset = clampMembersDirectoryOffset({
      limit: membersDirectoryPageLimit,
      offset,
      total: directoryQueryState.total,
    });
    if (nextOffset !== offset) {
      setOffset(nextOffset);
    }
  }, [directoryQueryState.total, offset]);

  const viewModel: OrganizationMembersSettingsPageViewModel = {
    activeFilter,
    capabilities: directoryQueryState.capabilities,
    capabilitiesErrorMessage: capabilitiesQuery.isError
      ? "Membership permissions could not be loaded."
      : null,
    hasNextPage:
      offset + directoryQueryState.members.length + directoryQueryState.invitations.length <
      directoryQueryState.total,
    hasPreviousPage: offset > 0,
    invitationActionState,
    invitations: directoryQueryState.invitations,
    inviteDialogOpen,
    inviteMemberRequest: api.inviteMember,
    inviteMembersDisabled,
    isLoading: directoryQueryState.isPageLoading,
    isListFetching: directoryQueryState.isListFetching,
    isUpdatingRole: mutations.isUpdatingRole,
    limit: membersDirectoryPageLimit,
    listErrorNoticeMessage: directoryQueryState.listErrorNoticeMessage,
    loadErrorMessage: directoryQueryState.loadErrorMessage,
    memberAvatarsByUserId: directoryQueryState.memberAvatarsByUserId,
    members: directoryQueryState.members,
    onChangeRole: (member) => {
      const nextRoleChangeDialog = buildRoleChangeDialogState({
        capabilities: directoryQueryState.capabilities,
        member,
      });
      if (nextRoleChangeDialog === null) {
        return;
      }

      setRoleUpdateErrorMessage(null);
      setRoleChangeDialog(nextRoleChangeDialog);
    },
    onInviteCompleted: async () => {
      const nextState = resolvePostInviteDirectoryState();
      setActiveFilter(nextState.activeFilter);
      setSearchValue(nextState.searchValue);
      setOffset(nextState.offset);
      await mutations.onInviteCompleted();
    },
    onInviteDialogOpenChange: setInviteDialogOpen,
    onFilterChange: (nextValue) => {
      setActiveFilter(nextValue);
      setOffset(0);
    },
    onNextPage: () => {
      setOffset((currentValue) => currentValue + membersDirectoryPageLimit);
    },
    onPreviousPage: () => {
      setOffset((currentValue) => Math.max(currentValue - membersDirectoryPageLimit, 0));
    },
    onRemoveMember: mutations.onRemoveMember,
    onResendInvite: mutations.onResendInvite,
    onRevokeInvite: mutations.onRevokeInvite,
    onRoleDialogCancel: () => {
      if (!mutations.isUpdatingRole) {
        setRoleUpdateErrorMessage(null);
        setRoleChangeDialog(null);
      }
    },
    onRoleDialogOpenChange: (nextOpen) => {
      if (!nextOpen && !mutations.isUpdatingRole) {
        setRoleUpdateErrorMessage(null);
        setRoleChangeDialog(null);
      }
    },
    onRoleSelectValueChange: (nextRoleValue) => {
      const parsedRole = parseRoleSelectValue(nextRoleValue);
      if (parsedRole === null) {
        return;
      }

      setRoleUpdateErrorMessage(null);
      setRoleChangeDialog((currentValue) => {
        if (currentValue === null) {
          return null;
        }

        return {
          ...currentValue,
          selectedRole: parsedRole,
        };
      });
    },
    onSaveRole: mutations.onSaveRole,
    onSearchValueChange: (nextValue) => {
      setSearchValue(nextValue);
      setOffset(0);
    },
    activeOrganizationId: input.activeOrganizationId,
    offset,
    pendingMemberOperation,
    roleChangeDialog,
    roleUpdateErrorMessage,
    searchValue,
    total: directoryQueryState.total,
  };

  return { viewModel };
}
