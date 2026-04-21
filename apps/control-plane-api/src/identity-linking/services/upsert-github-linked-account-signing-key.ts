import {
  userExternalPrincipalCredentialSecrets,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import { encryptOrganizationBackedValue } from "../../sandbox-storage/services/credential-crypto.js";
import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import {
  GitHubProviderFamily,
  GitSshSigningCredentialKind,
  parseGitSshSigningPrivateKeyOrThrow,
} from "../github-signing.js";
import { listLinkedAccounts } from "./list-linked-accounts.js";

function createInvalidSigningKeyInputError(message: string): BadRequestError {
  return new BadRequestError(
    IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT,
    message,
  );
}

export async function resolveActiveGitHubLinkedPrincipalOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<string> {
  const githubLinkedAccount = (
    await listLinkedAccounts(ctx, {
      organizationId: input.organizationId,
      userId: input.userId,
    })
  ).find((linkedAccount) => linkedAccount.providerFamily === GitHubProviderFamily);

  if (githubLinkedAccount?.principal === null || githubLinkedAccount?.principal === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND,
      "GitHub linked account was not found for the authenticated user.",
    );
  }

  if (githubLinkedAccount.configurationStatus !== "active") {
    throw createInvalidSigningKeyInputError(
      "GitHub linked account must be enabled before a signing key can be uploaded.",
    );
  }

  if (githubLinkedAccount.principal.status !== UserExternalPrincipalStatuses.ACTIVE) {
    throw createInvalidSigningKeyInputError(
      "GitHub linked account must be active before a signing key can be uploaded.",
    );
  }

  if (githubLinkedAccount.credential?.status !== UserExternalPrincipalCredentialStatuses.ACTIVE) {
    throw createInvalidSigningKeyInputError(
      "GitHub linked account must be active before a signing key can be uploaded.",
    );
  }

  return githubLinkedAccount.principal.id;
}

export async function upsertGitHubLinkedAccountSigningKey(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    userId: string;
    privateKey: string;
  },
): Promise<void> {
  const principalId = await resolveActiveGitHubLinkedPrincipalOrThrow(ctx, input);
  const parsedSigningKey = parseGitSshSigningPrivateKeyOrThrow(input.privateKey);
  const encryptedSigningKey = await encryptOrganizationBackedValue({
    db: ctx.db,
    organizationId: input.organizationId,
    plaintext: parsedSigningKey.privateKey,
    encryptionConfig: {
      masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
    },
  });

  await ctx.db.transaction(async (tx) => {
    const existingCredential = await tx.query.userExternalPrincipalCredentials.findFirst({
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

    if (existingCredential !== undefined) {
      await tx
        .update(userExternalPrincipalCredentials)
        .set({
          status: UserExternalPrincipalCredentialStatuses.REVOKED,
          updatedAt: sql`now()`,
        })
        .where(eq(userExternalPrincipalCredentials.id, existingCredential.id));

      await tx
        .update(userExternalPrincipalCredentialSecrets)
        .set({
          revokedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(userExternalPrincipalCredentialSecrets.credentialId, existingCredential.id),
            isNull(userExternalPrincipalCredentialSecrets.revokedAt),
          ),
        );
    }

    const [insertedCredential] = await tx
      .insert(userExternalPrincipalCredentials)
      .values({
        organizationId: input.organizationId,
        principalId,
        providerFamily: GitHubProviderFamily,
        credentialKind: GitSshSigningCredentialKind,
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        lastValidatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning({
        id: userExternalPrincipalCredentials.id,
      });

    if (insertedCredential === undefined) {
      throw new Error("Failed to insert GitHub signing credential.");
    }

    await tx.insert(userExternalPrincipalCredentialSecrets).values({
      organizationId: input.organizationId,
      credentialId: insertedCredential.id,
      secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
      nonce: encryptedSigningKey.nonce,
      ciphertext: encryptedSigningKey.ciphertext,
      organizationCredentialKeyVersion: encryptedSigningKey.organizationCredentialKeyVersion,
      metadata: {
        publicKey: parsedSigningKey.publicKey,
        publicKeyFingerprint: parsedSigningKey.publicKeyFingerprint,
      },
      updatedAt: sql`now()`,
    });
  });
}
