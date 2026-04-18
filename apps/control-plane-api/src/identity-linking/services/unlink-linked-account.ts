import {
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipalKeys,
  UserExternalPrincipalKeyStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, inArray, ne } from "drizzle-orm";

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
  const timestamp = new Date().toISOString();

  await ctx.db.transaction(async (tx) => {
    const updatedPrincipals = await tx
      .update(userExternalPrincipals)
      .set({
        status: UserExternalPrincipalStatuses.UNLINKED,
        unlinkedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(userExternalPrincipals.organizationId, input.organizationId),
          eq(userExternalPrincipals.userId, input.userId),
          eq(userExternalPrincipals.providerFamily, input.providerFamily),
          ne(userExternalPrincipals.status, UserExternalPrincipalStatuses.UNLINKED),
        ),
      )
      .returning({
        id: userExternalPrincipals.id,
      });

    if (updatedPrincipals.length === 0) {
      return;
    }

    const principalIds = updatedPrincipals.map((principal) => principal.id);

    await tx
      .update(userExternalPrincipalKeys)
      .set({
        status: UserExternalPrincipalKeyStatuses.RETIRED,
        retiredAt: timestamp,
      })
      .where(
        and(
          inArray(userExternalPrincipalKeys.principalId, principalIds),
          eq(userExternalPrincipalKeys.status, UserExternalPrincipalKeyStatuses.ACTIVE),
        ),
      );

    await tx
      .update(userExternalPrincipalCredentials)
      .set({
        status: UserExternalPrincipalCredentialStatuses.REVOKED,
        updatedAt: timestamp,
      })
      .where(
        and(
          inArray(userExternalPrincipalCredentials.principalId, principalIds),
          ne(
            userExternalPrincipalCredentials.status,
            UserExternalPrincipalCredentialStatuses.REVOKED,
          ),
        ),
      );
  });
}
