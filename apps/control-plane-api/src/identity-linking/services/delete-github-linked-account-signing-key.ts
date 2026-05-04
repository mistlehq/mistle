import {
  UserExternalPrincipalCredentialStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import { IdentityLinkingNotFoundCodes } from "../constants.js";
import { GitHubProviderFamily, GitSshSigningCredentialKind } from "../github-signing.js";
import { resolveActiveGitHubLinkedPrincipalOrThrow } from "./upsert-github-linked-account-signing-key.js";

export async function deleteGitHubLinkedAccountSigningKey(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<void> {
  const principalId = await resolveActiveGitHubLinkedPrincipalOrThrow(ctx, input);

  const existingCredential = await ctx.db.query.userExternalPrincipalCredentials.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.principalId, principalId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.credentialKind, GitSshSigningCredentialKind),
        eq(table.status, UserExternalPrincipalCredentialStatuses.ACTIVE),
      ),
  });

  if (existingCredential === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_SIGNING_KEY_NOT_FOUND,
      "GitHub signing key was not found for the authenticated user.",
    );
  }

  await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const [revokedCredential] = await tx
      .update(tables.userExternalPrincipalCredentials)
      .set({
        status: UserExternalPrincipalCredentialStatuses.REVOKED,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.userExternalPrincipalCredentials.id, existingCredential.id))
      .returning({
        id: tables.userExternalPrincipalCredentials.id,
      });

    if (revokedCredential === undefined) {
      throw new NotFoundError(
        IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_SIGNING_KEY_NOT_FOUND,
        "GitHub signing key was not found for the authenticated user.",
      );
    }

    await tx
      .update(tables.userExternalPrincipalCredentialSecrets)
      .set({
        revokedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.userExternalPrincipalCredentialSecrets.credentialId, existingCredential.id),
          isNull(tables.userExternalPrincipalCredentialSecrets.revokedAt),
        ),
      );
  });
}
