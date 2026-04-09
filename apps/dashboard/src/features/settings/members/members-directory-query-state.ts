import type { UseQueryResult } from "@tanstack/react-query";

import type {
  InvitationsPage,
  MemberAvatar,
  MembershipCapabilities,
  MembersDirectoryFilter,
  MembersPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import { toMembersLoadErrorMessage } from "./members-load-error-message.js";

export type MembersDirectoryQueryState = {
  activeListQuery: UseQueryResult<MembersPage> | UseQueryResult<InvitationsPage>;
  capabilities: MembershipCapabilities | null;
  invitations: SettingsInvitation[];
  isListFetching: boolean;
  isPageLoading: boolean;
  listErrorNoticeMessage: string | null;
  loadErrorMessage: string | null;
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  members: SettingsMember[];
  total: number;
};

export function resolveMembersDirectoryQueryState(input: {
  activeFilter: MembersDirectoryFilter;
  capabilitiesQuery: UseQueryResult<MembershipCapabilities>;
  invitationsQuery: UseQueryResult<InvitationsPage>;
  membersQuery: UseQueryResult<MembersPage>;
}): MembersDirectoryQueryState {
  const activeListQuery =
    input.activeFilter === "members" ? input.membersQuery : input.invitationsQuery;
  const hasListData = activeListQuery.data !== undefined;

  return {
    activeListQuery,
    capabilities: input.capabilitiesQuery.isError ? null : (input.capabilitiesQuery.data ?? null),
    invitations:
      input.activeFilter === "invitations" ? (input.invitationsQuery.data?.invitations ?? []) : [],
    isListFetching: activeListQuery.isFetching,
    isPageLoading:
      (!hasListData && activeListQuery.isPending) ||
      (input.capabilitiesQuery.data === undefined && input.capabilitiesQuery.isPending),
    listErrorNoticeMessage:
      activeListQuery.isError && hasListData
        ? toMembersLoadErrorMessage({
            activeFilter: input.activeFilter,
            directoryError: activeListQuery.error,
          })
        : null,
    loadErrorMessage:
      activeListQuery.isError && !hasListData
        ? toMembersLoadErrorMessage({
            activeFilter: input.activeFilter,
            directoryError: activeListQuery.error,
          })
        : null,
    memberAvatarsByUserId:
      input.activeFilter === "members"
        ? (input.membersQuery.data?.memberAvatarsByUserId ?? new Map())
        : new Map(),
    members: input.activeFilter === "members" ? (input.membersQuery.data?.members ?? []) : [],
    total: activeListQuery.data?.total ?? 0,
  };
}
