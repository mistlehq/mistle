import { useQuery } from "@tanstack/react-query";

import type { MemberAvatar } from "./members-api.js";
import { listMemberAvatars } from "./members-avatars-service.js";
import type { MembersDirectoryRow } from "./members-directory-model.js";
import { buildMembersQueryKeys } from "./members-query-keys.js";

const MEMBER_AVATARS_STALE_TIME_MS = 60_000;

export function useMemberAvatars(input: {
  organizationId: string;
  rows: readonly MembersDirectoryRow[];
}): ReadonlyMap<string, MemberAvatar> {
  const visibleMemberUserIds = dedupeMemberUserIds(input.rows);
  const queryKeys = buildMembersQueryKeys(input.organizationId);
  const memberAvatarsQuery = useQuery({
    queryKey: [...queryKeys.memberAvatars, ...visibleMemberUserIds],
    // This list query is intentionally separate from the singleton avatar
    // helpers used by profile and organization settings. List rows fetch
    // batched member avatar URLs for the current visible member set.
    queryFn: async () =>
      listMemberAvatars({
        organizationId: input.organizationId,
        userIds: visibleMemberUserIds,
      }),
    enabled: visibleMemberUserIds.length > 0,
    staleTime: MEMBER_AVATARS_STALE_TIME_MS,
  });

  return new Map((memberAvatarsQuery.data ?? []).map((avatar) => [avatar.userId, avatar] as const));
}

function dedupeMemberUserIds(rows: readonly MembersDirectoryRow[]): string[] {
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.kind === "member") {
      userIds.add(row.member.userId);
    }
  }

  return [...userIds];
}
