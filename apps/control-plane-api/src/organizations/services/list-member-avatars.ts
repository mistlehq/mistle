import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { members, users } from "@mistle/db/control-plane";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { and, eq, inArray } from "drizzle-orm";

export type ListMemberAvatarsContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
  presignedUrlTtlSeconds: number;
};

export type ListMemberAvatarsInput = {
  organizationId: string;
  userIds: readonly string[];
};

type MemberAvatarRecord = {
  userId: string;
  hasImage: boolean;
  imageUrl: string | null;
};

export async function listMemberAvatars(
  ctx: ListMemberAvatarsContext,
  input: ListMemberAvatarsInput,
): Promise<MemberAvatarRecord[]> {
  const dedupedUserIds = [...new Set(input.userIds)];
  if (dedupedUserIds.length === 0) {
    return [];
  }

  const rows = await ctx.db
    .select({
      userId: users.id,
      imageObjectKey: users.imageObjectKey,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.organizationId, input.organizationId),
        inArray(members.userId, dedupedUserIds),
      ),
    );

  const imageObjectKeyByUserId = new Map<string, string | null>();
  for (const row of rows) {
    imageObjectKeyByUserId.set(row.userId, row.imageObjectKey);
  }

  const results = await Promise.all(
    dedupedUserIds.map(async (userId): Promise<MemberAvatarRecord | null> => {
      const imageObjectKey = imageObjectKeyByUserId.get(userId);
      if (imageObjectKey === undefined) {
        return null;
      }

      if (imageObjectKey === null || imageObjectKey.length === 0) {
        return {
          userId,
          hasImage: false,
          imageUrl: null,
        };
      }

      return {
        userId,
        hasImage: true,
        imageUrl: await ctx.objectStore.createPresignedGetUrl({
          objectKey: imageObjectKey,
          expiresInSeconds: ctx.presignedUrlTtlSeconds,
        }),
      };
    }),
  );

  return results.filter((result) => result !== null);
}
