import {
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import {
  resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow,
  resolveOrganizationIdentityLinkProviderConfigByIdOrThrow,
} from "./resolve-organization-identity-link-provider-config.js";

export async function unlinkLinkedAccount(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    userId: string;
    providerFamily: string;
  },
): Promise<void> {
  const config = await resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow(ctx, {
    organizationId: input.organizationId,
    providerFamily: input.providerFamily,
  });

  return unlinkLinkedAccountForProviderConfig(ctx, {
    organizationId: input.organizationId,
    userId: input.userId,
    organizationProviderConfigId: config.id,
  });
}

export async function unlinkLinkedAccountForProviderConfig(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    userId: string;
    organizationProviderConfigId: string;
  },
): Promise<void> {
  await resolveOrganizationIdentityLinkProviderConfigByIdOrThrow(ctx, {
    organizationId: input.organizationId,
    organizationProviderConfigId: input.organizationProviderConfigId,
  });

  await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const updatedPrincipals = await tx
      .update(tables.userExternalPrincipals)
      .set({
        status: UserExternalPrincipalStatuses.UNLINKED,
        unlinkedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.userExternalPrincipals.organizationId, input.organizationId),
          eq(tables.userExternalPrincipals.userId, input.userId),
          eq(
            tables.userExternalPrincipals.organizationProviderConfigId,
            input.organizationProviderConfigId,
          ),
          ne(tables.userExternalPrincipals.status, UserExternalPrincipalStatuses.UNLINKED),
        ),
      )
      .returning({
        id: tables.userExternalPrincipals.id,
      });

    if (updatedPrincipals.length === 0) {
      return;
    }

    const principalIds = updatedPrincipals.map((principal) => principal.id);

    await tx
      .update(tables.userExternalPrincipalKeys)
      .set({
        status: UserExternalPrincipalKeyStatuses.RETIRED,
        retiredAt: sql`now()`,
      })
      .where(
        and(
          inArray(tables.userExternalPrincipalKeys.principalId, principalIds),
          eq(tables.userExternalPrincipalKeys.status, UserExternalPrincipalKeyStatuses.ACTIVE),
        ),
      );

    await tx
      .update(tables.userExternalPrincipalCredentials)
      .set({
        status: UserExternalPrincipalCredentialStatuses.REVOKED,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(tables.userExternalPrincipalCredentials.principalId, principalIds),
          ne(
            tables.userExternalPrincipalCredentials.status,
            UserExternalPrincipalCredentialStatuses.REVOKED,
          ),
        ),
      );
  });
}
