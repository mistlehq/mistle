import {
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, asc, eq, sql } from "drizzle-orm";

import { resolveDirectoryMemberName } from "../../organizations/services/directory-shared.js";

export type OrganizationIdentityLinkProviderPrincipalSummary = {
  providerSubjectId: string | null;
  login: string | null;
  displayName: string | null;
  email: string | null;
};

export type OrganizationIdentityLinkProviderLink = {
  userId: string;
  name: string;
  email: string;
  linked: boolean;
  principalSummary: OrganizationIdentityLinkProviderPrincipalSummary | null;
  updatedAt: string | null;
};

function buildDirectoryMemberSortName(tables: ReturnType<typeof getControlPlaneDatabaseSchema>) {
  return sql<string>`case
    when trim(${tables.users.name}) = '' or trim(${tables.users.name}) = ${tables.users.email} then ${tables.users.email}
    else trim(${tables.users.name})
  end`;
}

function readProfileString(input: {
  profile: Record<string, unknown> | null;
  key: "login" | "displayName" | "email";
}): string | null {
  const value = input.profile?.[input.key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? null : trimmedValue;
}

export async function listOrganizationIdentityLinkProviderLinks(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    providerFamily: string;
  },
): Promise<OrganizationIdentityLinkProviderLink[]> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const directoryMemberSortName = buildDirectoryMemberSortName(tables);
  const rows = await ctx.db
    .select({
      userId: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      providerSubjectId: tables.userExternalPrincipals.providerSubjectId,
      profile: tables.userExternalPrincipals.profile,
      principalUpdatedAt: tables.userExternalPrincipals.updatedAt,
    })
    .from(tables.members)
    .innerJoin(tables.users, eq(tables.users.id, tables.members.userId))
    .leftJoin(
      tables.userExternalPrincipals,
      and(
        eq(tables.userExternalPrincipals.organizationId, tables.members.organizationId),
        eq(tables.userExternalPrincipals.userId, tables.members.userId),
        eq(tables.userExternalPrincipals.providerFamily, input.providerFamily),
        eq(tables.userExternalPrincipals.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
    )
    .where(eq(tables.members.organizationId, input.organizationId))
    .orderBy(asc(directoryMemberSortName), asc(tables.users.email), asc(tables.members.createdAt));

  return rows.map((row) => {
    const principalSummary =
      row.providerSubjectId === null && row.profile === null
        ? null
        : {
            providerSubjectId: row.providerSubjectId,
            login: readProfileString({
              profile: row.profile,
              key: "login",
            }),
            displayName: readProfileString({
              profile: row.profile,
              key: "displayName",
            }),
            email: readProfileString({
              profile: row.profile,
              key: "email",
            }),
          };

    return {
      userId: row.userId,
      name: resolveDirectoryMemberName({
        name: row.name,
        email: row.email,
      }),
      email: row.email,
      linked: principalSummary !== null,
      principalSummary,
      updatedAt: row.principalUpdatedAt,
    };
  });
}
