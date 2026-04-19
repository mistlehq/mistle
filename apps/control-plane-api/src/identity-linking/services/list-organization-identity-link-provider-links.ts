import {
  members,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
  users,
  type ControlPlaneDatabase,
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

function buildDirectoryMemberSortName() {
  return sql<string>`case
    when trim(${users.name}) = '' or trim(${users.name}) = ${users.email} then ${users.email}
    else trim(${users.name})
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
  const directoryMemberSortName = buildDirectoryMemberSortName();
  const rows = await ctx.db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      providerSubjectId: userExternalPrincipals.providerSubjectId,
      profile: userExternalPrincipals.profile,
      principalUpdatedAt: userExternalPrincipals.updatedAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(
      userExternalPrincipals,
      and(
        eq(userExternalPrincipals.organizationId, members.organizationId),
        eq(userExternalPrincipals.userId, members.userId),
        eq(userExternalPrincipals.providerFamily, input.providerFamily),
        eq(userExternalPrincipals.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
    )
    .where(eq(members.organizationId, input.organizationId))
    .orderBy(asc(directoryMemberSortName), asc(users.email), asc(members.createdAt));

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
