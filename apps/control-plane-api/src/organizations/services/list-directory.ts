import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { members, users } from "@mistle/db/control-plane";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { and, asc, desc, eq, ilike } from "drizzle-orm";

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
  const memberEntries =
    input.filter === "invitations"
      ? []
      : await readMemberEntries({
          ctx,
          organizationId: input.organizationId,
          search: normalizedSearch,
        });
  const invitationEntries =
    input.filter === "members"
      ? []
      : await readInvitationEntries({
          db: ctx.db,
          organizationId: input.organizationId,
          search: normalizedSearch,
        });

  const entries = [...memberEntries, ...invitationEntries].sort(compareDirectoryEntries);
  return {
    entries: entries.slice(input.offset, input.offset + input.limit),
    limit: input.limit,
    offset: input.offset,
    total: entries.length,
  };
}

async function readMemberEntries(input: {
  ctx: ListDirectoryContext;
  organizationId: string;
  search: string;
}): Promise<DirectoryMemberEntry[]> {
  const rows = await input.ctx.db
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
          : ilike(users.name, `%${escapeLikePattern(input.search)}%`),
      ),
    )
    .orderBy(desc(members.createdAt), asc(users.name), asc(users.email));

  const emailRows =
    input.search.length === 0
      ? rows
      : rows.filter(
          (row) =>
            row.name.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()) ||
            row.email.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()),
        );

  return Promise.all(
    emailRows.map(async (row): Promise<DirectoryMemberEntry> => {
      const imageObjectKey = row.imageObjectKey;
      return {
        kind: "member",
        id: row.id,
        userId: row.userId,
        name: resolveDirectoryMemberName({
          name: row.name,
          email: row.email,
        }),
        email: row.email,
        role: row.role,
        joinedAt: row.joinedAt.toISOString(),
        avatar:
          imageObjectKey === null || imageObjectKey.length === 0
            ? {
                hasImage: false,
                imageUrl: null,
              }
            : {
                hasImage: true,
                imageUrl: await input.ctx.objectStore.createPresignedGetUrl({
                  objectKey: imageObjectKey,
                  expiresInSeconds: input.ctx.presignedUrlTtlSeconds,
                }),
              },
      };
    }),
  );
}

async function readInvitationEntries(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  search: string;
}): Promise<DirectoryInvitationEntry[]> {
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

  return rows.map((row): DirectoryInvitationEntry => {
    const { status, rawStatus } = normalizeInvitationStatus(row.status);
    return {
      kind: "invitation",
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      role: normalizeDirectoryRole(row.role),
      inviterId: row.inviterId,
      status,
      rawStatus,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  });
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

function compareDirectoryEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  const byDate = compareDateDesc(resolveDirectoryEntryDate(left), resolveDirectoryEntryDate(right));
  if (byDate !== 0) {
    return byDate;
  }

  const byName = resolveDirectoryEntryName(left).localeCompare(
    resolveDirectoryEntryName(right),
    undefined,
    {
      sensitivity: "base",
    },
  );
  if (byName !== 0) {
    return byName;
  }

  return resolveDirectoryEntryEmail(left).localeCompare(
    resolveDirectoryEntryEmail(right),
    undefined,
    {
      sensitivity: "base",
    },
  );
}

function resolveDirectoryEntryDate(entry: DirectoryEntry): string {
  return entry.kind === "member" ? entry.joinedAt : entry.createdAt;
}

function resolveDirectoryEntryName(entry: DirectoryEntry): string {
  return entry.kind === "member" ? entry.name : entry.email;
}

function resolveDirectoryEntryEmail(entry: DirectoryEntry): string {
  return entry.email;
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
