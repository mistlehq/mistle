import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  MemberAvatar,
  MembershipCapabilities,
  MembersDirectoryFilter,
  MembersDirectoryPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import { formatMemberDisplayName } from "./members-formatters.js";
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
  directoryQuery: ReturnType<typeof useQuery<MembersDirectoryPage>>;
  capabilities: MembershipCapabilities | null;
  members: SettingsMember[];
  invitations: SettingsInvitation[];
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  limit: number;
  offset: number;
  total: number;
  inviterDisplayNames: Map<string, string>;
} {
  const capabilitiesQuery = useQuery({
    queryKey: input.queryKeys.capabilities,
    queryFn: async () =>
      input.api.getMembershipCapabilities({
        organizationId: input.organizationId,
      }),
  });

  const directoryQuery = useQuery({
    queryKey: [...input.queryKeys.directory, input.limit, input.offset, input.filter, input.search],
    queryFn: async () =>
      input.api.listMembersDirectoryPage({
        organizationId: input.organizationId,
        limit: input.limit,
        offset: input.offset,
        filter: input.filter,
        search: input.search,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const capabilities = capabilitiesQuery.isError ? null : (capabilitiesQuery.data ?? null);
  const members = directoryQuery.data?.members ?? [];
  const invitations = directoryQuery.data?.invitations ?? [];
  const memberAvatarsByUserId = directoryQuery.data?.memberAvatarsByUserId ?? new Map();
  const limit = directoryQuery.data?.limit ?? input.limit;
  const offset = directoryQuery.data?.offset ?? input.offset;
  const total = directoryQuery.data?.total ?? 0;

  const inviterDisplayNames = new Map<string, string>();
  for (const member of members) {
    inviterDisplayNames.set(member.userId, formatMemberDisplayName(member));
  }

  return {
    capabilitiesQuery,
    directoryQuery,
    capabilities,
    members,
    invitations,
    memberAvatarsByUserId,
    limit,
    offset,
    total,
    inviterDisplayNames,
  };
}
