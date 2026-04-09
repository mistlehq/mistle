import { useQuery } from "@tanstack/react-query";

import type {
  MemberAvatar,
  InvitationsPage,
  MembershipCapabilities,
  MembersDirectoryFilter,
  MembersPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import { resolveMembersDirectoryQueryState } from "./members-directory-query-state.js";
import type { MembersQueryKeys } from "./members-query-keys.js";
import type { MembersSettingsApi } from "./members-settings-api.js";

export function useMembersQueries(input: {
  organizationId: string;
  limit: number;
  offset: number;
  filter: MembersDirectoryFilter;
  search: string;
  api: MembersSettingsApi;
  queryKeys: MembersQueryKeys;
}): {
  capabilitiesQuery: ReturnType<typeof useQuery<MembershipCapabilities>>;
  membersQuery: ReturnType<typeof useQuery<MembersPage>>;
  invitationsQuery: ReturnType<typeof useQuery<InvitationsPage>>;
  activeListQuery:
    | ReturnType<typeof useQuery<MembersPage>>
    | ReturnType<typeof useQuery<InvitationsPage>>;
  capabilities: MembershipCapabilities | null;
  isListFetching: boolean;
  isPageLoading: boolean;
  listErrorNoticeMessage: string | null;
  loadErrorMessage: string | null;
  members: SettingsMember[];
  invitations: SettingsInvitation[];
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  limit: number;
  offset: number;
  total: number;
} {
  const capabilitiesQuery = useQuery({
    queryKey: input.queryKeys.capabilities,
    queryFn: async () =>
      input.api.getMembershipCapabilities({
        organizationId: input.organizationId,
      }),
  });

  const membersQuery = useQuery({
    queryKey: [...input.queryKeys.members, input.limit, input.offset, input.search],
    queryFn: async () =>
      input.api.listMembersPage({
        organizationId: input.organizationId,
        limit: input.limit,
        offset: input.offset,
        search: input.search,
      }),
    enabled: input.filter === "members",
    retry: false,
  });

  const invitationsQuery = useQuery({
    queryKey: [...input.queryKeys.invitations, input.limit, input.offset, input.search],
    queryFn: async () =>
      input.api.listInvitationsPage({
        organizationId: input.organizationId,
        limit: input.limit,
        offset: input.offset,
        search: input.search,
      }),
    enabled: input.filter === "invitations",
    retry: false,
  });

  const activeListQuery = input.filter === "members" ? membersQuery : invitationsQuery;
  const directoryQueryState = resolveMembersDirectoryQueryState({
    activeFilter: input.filter,
    capabilitiesQuery,
    invitationsQuery,
    membersQuery,
  });
  const limit = input.limit;
  const offset = input.offset;
  const total = directoryQueryState.total;

  return {
    capabilitiesQuery,
    membersQuery,
    invitationsQuery,
    activeListQuery,
    capabilities: directoryQueryState.capabilities,
    isListFetching: directoryQueryState.isListFetching,
    isPageLoading: directoryQueryState.isPageLoading,
    listErrorNoticeMessage: directoryQueryState.listErrorNoticeMessage,
    loadErrorMessage: directoryQueryState.loadErrorMessage,
    members: directoryQueryState.members,
    invitations: directoryQueryState.invitations,
    memberAvatarsByUserId: directoryQueryState.memberAvatarsByUserId,
    limit,
    offset,
    total,
  };
}
