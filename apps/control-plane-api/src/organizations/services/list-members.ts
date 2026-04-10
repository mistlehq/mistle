import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { members, users } from "@mistle/db/control-plane";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import {
  createMemberAvatar,
  escapeLikePattern,
  resolveDirectoryMemberName,
  type OrganizationRole,
} from "./directory-shared.js";

export type MembersPageEntry = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
  avatar: {
    hasImage: boolean;
    imageUrl: string | null;
  };
};

export type ListMembersContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
  presignedUrlTtlSeconds: number;
};

export type ListMembersInput = {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
};

export type ListMembersResult = {
  members: MembersPageEntry[];
  limit: number;
  offset: number;
  total: number;
};

type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: Date;
  imageObjectKey: string | null;
};

function buildDirectoryMemberSortName() {
  return sql<string>`case
    when trim(${users.name}) = '' or trim(${users.name}) = ${users.email} then ${users.email}
    else trim(${users.name})
  end`;
}

export async function listMembers(
  ctx: ListMembersContext,
  input: ListMembersInput,
): Promise<ListMembersResult> {
  const search = input.search.trim();
  const whereClause = and(
    eq(members.organizationId, input.organizationId),
    search.length === 0
      ? undefined
      : or(
          ilike(users.name, `%${escapeLikePattern(search)}%`),
          ilike(users.email, `%${escapeLikePattern(search)}%`),
          ilike(members.role, `%${escapeLikePattern(search)}%`),
        ),
  );

  const totalRows = await ctx.db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(whereClause);
  const directoryMemberSortName = buildDirectoryMemberSortName();
  const rows = await ctx.db
    .select({
      id: members.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: members.role,
      joinedAt: members.createdAt,
      imageObjectKey: users.imageObjectKey,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(whereClause)
    .orderBy(asc(directoryMemberSortName), asc(users.email), desc(members.createdAt))
    .limit(input.limit)
    .offset(input.offset);

  const memberRows: MemberRow[] = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.joinedAt,
    imageObjectKey: row.imageObjectKey,
  }));
  const membersPageEntries = await Promise.all(
    memberRows.map(async (row): Promise<MembersPageEntry> => {
      const avatar = await createMemberAvatar({
        imageObjectKey: row.imageObjectKey,
        objectStore: ctx.objectStore,
        presignedUrlTtlSeconds: ctx.presignedUrlTtlSeconds,
      }).catch(() => ({
        hasImage: row.imageObjectKey !== null && row.imageObjectKey.length > 0,
        imageUrl: null,
      }));

      return {
        id: row.id,
        userId: row.userId,
        name: resolveDirectoryMemberName({
          name: row.name,
          email: row.email,
        }),
        email: row.email,
        role: row.role,
        joinedAt: row.joinedAt.toISOString(),
        avatar,
      };
    }),
  );

  return {
    members: membersPageEntries,
    limit: input.limit,
    offset: input.offset,
    total: totalRows[0]?.totalResults ?? 0,
  };
}
