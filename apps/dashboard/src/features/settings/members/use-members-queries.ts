import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  MemberAvatar,
  InvitationsPage,
  MembershipCapabilities,
  MembersDirectoryFilter,
  MembersPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
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
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
    retry: false,
  });

  const activeListQuery = input.filter === "members" ? membersQuery : invitationsQuery;
  const capabilities = capabilitiesQuery.isError ? null : (capabilitiesQuery.data ?? null);
  const members = input.filter === "members" ? (membersQuery.data?.members ?? []) : [];
  const invitations =
    input.filter === "invitations" ? (invitationsQuery.data?.invitations ?? []) : [];
  const memberAvatarsByUserId =
    input.filter === "members"
      ? (membersQuery.data?.memberAvatarsByUserId ?? new Map())
      : new Map();
  const limit = activeListQuery.data?.limit ?? input.limit;
  const offset = activeListQuery.data?.offset ?? input.offset;
  const total = activeListQuery.data?.total ?? 0;

  return {
    capabilitiesQuery,
    membersQuery,
    invitationsQuery,
    activeListQuery,
    capabilities,
    members,
    invitations,
    memberAvatarsByUserId,
    limit,
    offset,
    total,
  };
}
