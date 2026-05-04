import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { and, asc, desc, eq, gte, ilike, lt, ne, or, sql } from "drizzle-orm";

import {
  escapeLikePattern,
  normalizeInvitationStatus,
  normalizeOrganizationRole,
  resolveDirectoryMemberName,
  type OrganizationRole,
} from "./directory-shared.js";

export type InvitationPageEntry = {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  inviterId: string;
  inviterName: string;
  status: "pending" | "accepted" | "canceled" | "rejected" | "revoked";
  expiresAt: string;
  createdAt: string;
};

export type ListInvitationsContext = {
  db: ControlPlaneDatabase;
};

export type ListInvitationsInput = {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
};

export type ListInvitationsResult = {
  invitations: InvitationPageEntry[];
  limit: number;
  offset: number;
  total: number;
};

type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  inviterId: string;
  inviterName: string;
  inviterEmail: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

export async function listInvitations(
  ctx: ListInvitationsContext,
  input: ListInvitationsInput,
): Promise<ListInvitationsResult> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const search = input.search.trim();
  const normalizedSearch = search.toLowerCase();
  const searchPattern = `%${escapeLikePattern(search)}%`;
  const now = new Date();
  const searchMatchesPending = "pending".includes(normalizedSearch);
  const searchMatchesExpired = "expired".includes(normalizedSearch);
  const searchMatchesCanceled = "canceled".includes(normalizedSearch);
  const searchMatchesRejected = "rejected".includes(normalizedSearch);
  const searchMatchesRevoked = "revoked".includes(normalizedSearch);
  const whereClause = and(
    eq(tables.invitations.organizationId, input.organizationId),
    ne(tables.invitations.status, "accepted"),
    search.length === 0
      ? undefined
      : or(
          ilike(tables.invitations.email, searchPattern),
          ilike(tables.invitations.role, searchPattern),
          searchMatchesPending
            ? and(eq(tables.invitations.status, "pending"), gte(tables.invitations.expiresAt, now))
            : undefined,
          searchMatchesExpired
            ? and(eq(tables.invitations.status, "pending"), lt(tables.invitations.expiresAt, now))
            : undefined,
          searchMatchesCanceled ? eq(tables.invitations.status, "canceled") : undefined,
          searchMatchesRejected ? eq(tables.invitations.status, "rejected") : undefined,
          searchMatchesRevoked ? eq(tables.invitations.status, "revoked") : undefined,
        ),
  );

  const totalRows = await ctx.db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(tables.invitations)
    .where(whereClause);
  const rows = await ctx.db
    .select({
      id: tables.invitations.id,
      organizationId: tables.invitations.organizationId,
      email: tables.invitations.email,
      role: tables.invitations.role,
      inviterId: tables.invitations.inviterId,
      inviterName: tables.users.name,
      inviterEmail: tables.users.email,
      status: tables.invitations.status,
      expiresAt: tables.invitations.expiresAt,
      createdAt: tables.invitations.createdAt,
    })
    .from(tables.invitations)
    .innerJoin(tables.users, eq(tables.users.id, tables.invitations.inviterId))
    .where(whereClause)
    .orderBy(desc(tables.invitations.createdAt), asc(tables.invitations.email))
    .limit(input.limit)
    .offset(input.offset);

  const invitationRows: InvitationRow[] = rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    inviterId: row.inviterId,
    inviterName: row.inviterName,
    inviterEmail: row.inviterEmail,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));

  return {
    invitations: invitationRows.map((row) => {
      return {
        id: row.id,
        organizationId: row.organizationId,
        email: row.email,
        role: normalizeOrganizationRole(row.role),
        inviterId: row.inviterId,
        inviterName: resolveDirectoryMemberName({
          name: row.inviterName,
          email: row.inviterEmail,
        }),
        status: normalizeInvitationStatus(row.status),
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    limit: input.limit,
    offset: input.offset,
    total: totalRows[0]?.totalResults ?? 0,
  };
}
