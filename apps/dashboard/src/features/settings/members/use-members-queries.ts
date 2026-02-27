import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MembershipCapabilities, SettingsInvitation, SettingsMember } from "./members-api.js";
import { canResendInvitation, resolveInvitationDisplayStatus } from "./members-directory-model.js";
import { formatMemberDisplayName } from "./members-formatters.js";
import type { MembersQueryKeys } from "./members-query-keys.js";
import type { MembersSettingsApi } from "./members-settings-api.js";

export function useMembersQueries(input: {
  organizationId: string;
  api: MembersSettingsApi;
  queryKeys: MembersQueryKeys;
}): {
  capabilitiesQuery: ReturnType<typeof useQuery<MembershipCapabilities>>;
  membersQuery: ReturnType<typeof useQuery<SettingsMember[]>>;
  invitationsQuery: ReturnType<typeof useQuery<SettingsInvitation[]>>;
  capabilities: MembershipCapabilities | null;
  members: SettingsMember[];
  invitations: SettingsInvitation[];
  inviterDisplayNames: Map<string, string>;
} {
  const capabilitiesQuery = useQuery({
    queryKey: input.queryKeys.capabilities,
    queryFn: async () =>
      input.api.getMembershipCapabilities({
        organizationId: input.organizationId,
      }),
  });

  const membersQuery = useQuery({
    queryKey: input.queryKeys.members,
    queryFn: async () =>
      input.api.listMembers({
        organizationId: input.organizationId,
      }),
  });

  const invitationsQuery = useQuery({
    queryKey: input.queryKeys.invitations,
    queryFn: async () =>
      input.api.listInvitations({
        organizationId: input.organizationId,
      }),
  });

  const capabilities = capabilitiesQuery.isError ? null : (capabilitiesQuery.data ?? null);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const invitations = useMemo(
    () =>
      (invitationsQuery.data ?? []).filter((invitation) =>
        canResendInvitation(resolveInvitationDisplayStatus(invitation)),
      ),
    [invitationsQuery.data],
  );

  const inviterDisplayNames = useMemo(() => {
    const displayNames = new Map<string, string>();
    for (const member of members) {
      displayNames.set(member.userId, formatMemberDisplayName(member));
    }
    return displayNames;
  }, [members]);

  return {
    capabilitiesQuery,
    membersQuery,
    invitationsQuery,
    capabilities,
    members,
    invitations,
    inviterDisplayNames,
  };
}
