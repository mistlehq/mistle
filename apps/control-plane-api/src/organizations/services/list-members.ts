import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
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

function buildDirectoryMemberSortName(tables: ReturnType<typeof getControlPlaneDatabaseSchema>) {
  return sql<string>`case
    when trim(${tables.users.name}) = '' or trim(${tables.users.name}) = ${tables.users.email} then ${tables.users.email}
    else trim(${tables.users.name})
  end`;
}

export async function listMembers(
  ctx: ListMembersContext,
  input: ListMembersInput,
): Promise<ListMembersResult> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const search = input.search.trim();
  const whereClause = and(
    eq(tables.members.organizationId, input.organizationId),
    search.length === 0
      ? undefined
      : or(
          ilike(tables.users.name, `%${escapeLikePattern(search)}%`),
          ilike(tables.users.email, `%${escapeLikePattern(search)}%`),
          ilike(tables.members.role, `%${escapeLikePattern(search)}%`),
        ),
  );

  const totalRows = await ctx.db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(tables.members)
    .innerJoin(tables.users, eq(tables.users.id, tables.members.userId))
    .where(whereClause);
  const directoryMemberSortName = buildDirectoryMemberSortName(tables);
  const rows = await ctx.db
    .select({
      id: tables.members.id,
      userId: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      role: tables.members.role,
      joinedAt: tables.members.createdAt,
      imageObjectKey: tables.users.imageObjectKey,
    })
    .from(tables.members)
    .innerJoin(tables.users, eq(tables.users.id, tables.members.userId))
    .where(whereClause)
    .orderBy(asc(directoryMemberSortName), asc(tables.users.email), desc(tables.members.createdAt))
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
