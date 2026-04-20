import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  isPageLoading: boolean;
  viewModel: OrganizationMembersSettingsPageViewModel;
};

const SearchDebounceMs = 300;

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
  const [searchInputValue, setSearchInputValue] = useState("");
  const searchInputValueRef = useRef(searchInputValue);
  const [directoryQueryInput, setDirectoryQueryInput] = useState<{
    activeFilter: MembersDirectoryFilter;
    offset: number;
    searchValue: string;
  }>({
    activeFilter: "members",
    offset: 0,
    searchValue: "",
  });
  const { activeFilter, offset, searchValue: querySearchValue } = directoryQueryInput;

  useEffect(() => {
    searchInputValueRef.current = searchInputValue;
  }, [searchInputValue]);

  const searchDebouncer = useDebouncer(
    (nextValue: string) => {
      setDirectoryQueryInput((currentValue) => {
        if (currentValue.searchValue === nextValue && currentValue.offset === 0) {
          return currentValue;
        }

        return {
          ...currentValue,
          offset: 0,
          searchValue: nextValue,
        };
      });
    },
    {
      wait: SearchDebounceMs,
    },
  );

  const queryKeys = buildMembersQueryKeys(input.activeOrganizationId);
  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.capabilities,
    queryFn: async () => api.getMembershipCapabilities(),
  });
  const membersQuery = useQuery({
    queryKey: [...queryKeys.members, membersDirectoryPageLimit, offset, querySearchValue],
    queryFn: async () =>
      api.listMembersPage({
        limit: membersDirectoryPageLimit,
        offset,
        search: querySearchValue,
      }),
    enabled: activeFilter === "members",
    retry: false,
  });
  const invitationsQuery = useQuery({
    queryKey: [...queryKeys.invitations, membersDirectoryPageLimit, offset, querySearchValue],
    queryFn: async () =>
      api.listInvitationsPage({
        limit: membersDirectoryPageLimit,
        offset,
        search: querySearchValue,
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
    if (directoryQueryState.activeListQuery.data === undefined) {
      return;
    }

    const nextOffset = clampMembersDirectoryOffset({
      limit: membersDirectoryPageLimit,
      offset,
      total: directoryQueryState.total,
    });
    if (nextOffset !== offset) {
      setDirectoryQueryInput((currentValue) => {
        return {
          ...currentValue,
          offset: nextOffset,
        };
      });
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
      searchDebouncer.cancel();
      setSearchInputValue(nextState.searchValue);
      searchInputValueRef.current = nextState.searchValue;
      setDirectoryQueryInput(nextState);
      await mutations.onInviteCompleted();
    },
    onInviteDialogOpenChange: setInviteDialogOpen,
    onFilterChange: (nextValue) => {
      searchDebouncer.cancel();
      setDirectoryQueryInput((currentValue) => {
        return {
          ...currentValue,
          activeFilter: nextValue,
          offset: 0,
          searchValue: searchInputValueRef.current,
        };
      });
    },
    onNextPage: () => {
      setDirectoryQueryInput((currentValue) => {
        return {
          ...currentValue,
          offset: currentValue.offset + membersDirectoryPageLimit,
        };
      });
    },
    onPreviousPage: () => {
      setDirectoryQueryInput((currentValue) => {
        return {
          ...currentValue,
          offset: Math.max(currentValue.offset - membersDirectoryPageLimit, 0),
        };
      });
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
      searchInputValueRef.current = nextValue;
      setSearchInputValue(nextValue);
      searchDebouncer.maybeExecute(nextValue);
    },
    activeOrganizationId: input.activeOrganizationId,
    offset,
    pendingMemberOperation,
    roleChangeDialog,
    roleUpdateErrorMessage,
    searchValue: searchInputValue,
    total: directoryQueryState.total,
  };

  return {
    isPageLoading: directoryQueryState.isPageLoading,
    viewModel,
  };
}
