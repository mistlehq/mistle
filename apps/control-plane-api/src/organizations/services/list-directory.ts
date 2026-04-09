import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { members, users } from "@mistle/db/control-plane";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";

type DirectoryFilter = "all" | "members" | "invitations";
type DirectoryInvitationStatus = "pending" | "accepted" | "canceled" | "rejected" | "revoked";
type DirectoryRole = "owner" | "admin" | "member";
type DirectoryMemberEntry = {
  kind: "member";
  id: string;
  userId: string;
  name: string;
  email: string;
  role: DirectoryRole;
  joinedAt: string;
  avatar: {
    hasImage: boolean;
    imageUrl: string | null;
  };
};
type DirectoryInvitationEntry = {
  kind: "invitation";
  id: string;
  organizationId: string;
  email: string;
  role: DirectoryRole;
  inviterId: string;
  status: DirectoryInvitationStatus | "unknown";
  rawStatus: string | null;
  expiresAt: string;
  createdAt: string;
};

export type DirectoryEntry = DirectoryMemberEntry | DirectoryInvitationEntry;
type DirectoryMemberRow = {
  kind: "member";
  id: string;
  userId: string;
  name: string;
  email: string;
  role: DirectoryRole;
  joinedAt: Date;
  imageObjectKey: string | null;
};
type DirectoryInvitationRow = {
  kind: "invitation";
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  inviterId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};
type DirectoryRow = DirectoryMemberRow | DirectoryInvitationRow;

export type ListDirectoryContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
  presignedUrlTtlSeconds: number;
};

export type ListDirectoryInput = {
  organizationId: string;
  limit: number;
  offset: number;
  filter: DirectoryFilter;
  search: string;
};

export type ListDirectoryResult = {
  entries: DirectoryEntry[];
  limit: number;
  offset: number;
  total: number;
};

const PendingInvitationStatus = "pending";

export async function listDirectory(
  ctx: ListDirectoryContext,
  input: ListDirectoryInput,
): Promise<ListDirectoryResult> {
  const normalizedSearch = input.search.trim();
  const memberRows =
    input.filter === "invitations"
      ? []
      : await readMemberRows({
          db: ctx.db,
          organizationId: input.organizationId,
          search: normalizedSearch,
        });
  const invitationRows =
    input.filter === "members"
      ? []
      : await readInvitationRows({
          db: ctx.db,
          organizationId: input.organizationId,
          search: normalizedSearch,
        });

  const rows = [...memberRows, ...invitationRows].sort(compareDirectoryRows);
  const pageRows = rows.slice(input.offset, input.offset + input.limit);
  const entries = await Promise.all(
    pageRows.map((row) =>
      buildDirectoryEntry({
        row,
        objectStore: ctx.objectStore,
        presignedUrlTtlSeconds: ctx.presignedUrlTtlSeconds,
      }),
    ),
  );

  return {
    entries,
    limit: input.limit,
    offset: input.offset,
    total: rows.length,
  };
}

async function readMemberRows(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  search: string;
}): Promise<DirectoryMemberRow[]> {
  const rows = await input.db
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
    .where(
      and(
        eq(members.organizationId, input.organizationId),
        input.search.length === 0
          ? undefined
          : or(
              ilike(users.name, `%${escapeLikePattern(input.search)}%`),
              ilike(users.email, `%${escapeLikePattern(input.search)}%`),
            ),
      ),
    )
    .orderBy(desc(members.createdAt), asc(users.name), asc(users.email));

  return rows.map(
    (row): DirectoryMemberRow => ({
      kind: "member",
      id: row.id,
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.joinedAt,
      imageObjectKey: row.imageObjectKey,
    }),
  );
}

async function readInvitationRows(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  search: string;
}): Promise<DirectoryInvitationRow[]> {
  const rows = await input.db.query.invitations.findMany({
    columns: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      inviterId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
    where: (invitationsTable, operators) =>
      operators.and(
        operators.eq(invitationsTable.organizationId, input.organizationId),
        operators.eq(invitationsTable.status, PendingInvitationStatus),
        input.search.length === 0
          ? undefined
          : operators.ilike(invitationsTable.email, `%${escapeLikePattern(input.search)}%`),
      ),
    orderBy: (invitationsTable, operators) => [
      operators.desc(invitationsTable.createdAt),
      operators.asc(invitationsTable.email),
    ],
  });

  return rows.map(
    (row): DirectoryInvitationRow => ({
      kind: "invitation",
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      role: row.role,
      inviterId: row.inviterId,
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }),
  );
}

async function buildDirectoryEntry(input: {
  row: DirectoryRow;
  objectStore: S3CompatibleObjectStore;
  presignedUrlTtlSeconds: number;
}): Promise<DirectoryEntry> {
  if (input.row.kind === "member") {
    const imageObjectKey = input.row.imageObjectKey;
    return {
      kind: "member",
      id: input.row.id,
      userId: input.row.userId,
      name: resolveDirectoryMemberName({
        name: input.row.name,
        email: input.row.email,
      }),
      email: input.row.email,
      role: input.row.role,
      joinedAt: input.row.joinedAt.toISOString(),
      avatar:
        imageObjectKey === null || imageObjectKey.length === 0
          ? {
              hasImage: false,
              imageUrl: null,
            }
          : {
              hasImage: true,
              imageUrl: await input.objectStore.createPresignedGetUrl({
                objectKey: imageObjectKey,
                expiresInSeconds: input.presignedUrlTtlSeconds,
              }),
            },
    };
  }

  const { status, rawStatus } = normalizeInvitationStatus(input.row.status);
  return {
    kind: "invitation",
    id: input.row.id,
    organizationId: input.row.organizationId,
    email: input.row.email,
    role: normalizeDirectoryRole(input.row.role),
    inviterId: input.row.inviterId,
    status,
    rawStatus,
    expiresAt: input.row.expiresAt.toISOString(),
    createdAt: input.row.createdAt.toISOString(),
  };
}

function resolveDirectoryMemberName(input: { name: string; email: string }): string {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0 || trimmedName === input.email) {
    return input.email;
  }

  return trimmedName;
}

function normalizeInvitationStatus(status: string): {
  status: DirectoryInvitationEntry["status"];
  rawStatus: string | null;
} {
  if (
    status === "pending" ||
    status === "accepted" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "revoked"
  ) {
    return {
      status,
      rawStatus: null,
    };
  }

  return {
    status: "unknown",
    rawStatus: status,
  };
}

function normalizeDirectoryRole(role: string | null): DirectoryRole {
  if (role === "owner" || role === "admin" || role === "member") {
    return role;
  }

  return "member";
}

function compareDirectoryRows(left: DirectoryRow, right: DirectoryRow): number {
  const byDate = compareDateDesc(resolveDirectoryRowDate(left), resolveDirectoryRowDate(right));
  if (byDate !== 0) {
    return byDate;
  }

  const byName = resolveDirectoryRowName(left).localeCompare(
    resolveDirectoryRowName(right),
    undefined,
    {
      sensitivity: "base",
    },
  );
  if (byName !== 0) {
    return byName;
  }

  return resolveDirectoryRowEmail(left).localeCompare(resolveDirectoryRowEmail(right), undefined, {
    sensitivity: "base",
  });
}

function resolveDirectoryRowDate(row: DirectoryRow): string {
  return row.kind === "member" ? row.joinedAt.toISOString() : row.createdAt.toISOString();
}

function resolveDirectoryRowName(row: DirectoryRow): string {
  return row.kind === "member"
    ? resolveDirectoryMemberName({
        name: row.name,
        email: row.email,
      })
    : row.email;
}

function resolveDirectoryRowEmail(row: DirectoryRow): string {
  return row.email;
}

function compareDateDesc(leftIsoDate: string, rightIsoDate: string): number {
  const leftEpochMs = Date.parse(leftIsoDate);
  const rightEpochMs = Date.parse(rightIsoDate);
  const leftValue = Number.isFinite(leftEpochMs) ? leftEpochMs : Number.NEGATIVE_INFINITY;
  const rightValue = Number.isFinite(rightEpochMs) ? rightEpochMs : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
