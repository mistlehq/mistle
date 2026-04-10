import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { invitations, users } from "@mistle/db/control-plane";
import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";

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
  const search = input.search.trim();
  const normalizedSearch = search.toLowerCase();
  const searchPattern = `%${escapeLikePattern(search)}%`;
  const now = new Date();
  const searchMatchesPending = "pending".includes(normalizedSearch);
  const searchMatchesExpired = "expired".includes(normalizedSearch);
  const searchMatchesAccepted = "accepted".includes(normalizedSearch);
  const searchMatchesCanceled = "canceled".includes(normalizedSearch);
  const searchMatchesRejected = "rejected".includes(normalizedSearch);
  const searchMatchesRevoked = "revoked".includes(normalizedSearch);
  const whereClause = and(
    eq(invitations.organizationId, input.organizationId),
    search.length === 0
      ? undefined
      : or(
          ilike(invitations.email, searchPattern),
          ilike(invitations.role, searchPattern),
          searchMatchesPending
            ? and(eq(invitations.status, "pending"), gte(invitations.expiresAt, now))
            : undefined,
          searchMatchesExpired
            ? and(eq(invitations.status, "pending"), lt(invitations.expiresAt, now))
            : undefined,
          searchMatchesAccepted ? eq(invitations.status, "accepted") : undefined,
          searchMatchesCanceled ? eq(invitations.status, "canceled") : undefined,
          searchMatchesRejected ? eq(invitations.status, "rejected") : undefined,
          searchMatchesRevoked ? eq(invitations.status, "revoked") : undefined,
        ),
  );

  const totalRows = await ctx.db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(invitations)
    .where(whereClause);
  const rows = await ctx.db
    .select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      email: invitations.email,
      role: invitations.role,
      inviterId: invitations.inviterId,
      inviterName: users.name,
      inviterEmail: users.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.inviterId))
    .where(whereClause)
    .orderBy(desc(invitations.createdAt), asc(invitations.email))
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
