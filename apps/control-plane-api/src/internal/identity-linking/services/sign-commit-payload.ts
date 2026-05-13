import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { SigningGrantError, verifySigningGrant } from "@mistle/sandbox-signing-auth";
import { and, eq, isNull } from "drizzle-orm";

import {
  GitSshSigningCredentialKind,
  GitSshSigningSecretMetadataSchema,
} from "../../../identity-linking/github-signing.js";
import {
  DefaultCommitSignBinaryPath,
  runCommitSignBinary,
  SshSigningFormat,
  type CommitSignResult,
} from "../../../identity-linking/services/commit-sign-binary.js";
import { createCredentialSecretResolver } from "./credential-secret-resolution.js";
import { InternalIdentityLinkingError, InternalIdentityLinkingErrorCodes } from "./errors.js";

type SignCommitPayloadInput = {
  organizationId: string;
  sandboxInstanceId: string;
  actingUserId: string;
  providerFamily: string;
  format: string;
  keyRef: string;
  grant: string;
  payload: string;
  encoding: "base64";
};

function resolveRequestedKeyRefOrThrow(keyRef: string): string {
  const prefix = "key::";
  if (!keyRef.startsWith(prefix)) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.INVALID_SIGN_COMMIT_PAYLOAD_INPUT,
      400,
      `Linked-principal signing key '${keyRef}' is invalid.`,
    );
  }

  const publicKey = keyRef.slice(prefix.length).trim();
  if (publicKey.length === 0) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.INVALID_SIGN_COMMIT_PAYLOAD_INPUT,
      400,
      `Linked-principal signing key '${keyRef}' is invalid.`,
    );
  }

  return publicKey;
}

export async function signCommitPayload(
  ctx: {
    db: ControlPlaneDatabase;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
    commitSignConfig?: {
      binaryPath: string;
    };
    sandboxBootstrapConfig: {
      tokenSecret: string;
      tokenIssuer: string;
      tokenAudience: string;
    };
  },
  input: SignCommitPayloadInput,
): Promise<CommitSignResult> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  if (input.format !== SshSigningFormat) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.UNSUPPORTED_SIGNING_FORMAT,
      400,
      `Git commit signing format '${input.format}' is not supported yet.`,
    );
  }

  const commitSignBinaryPath = ctx.commitSignConfig?.binaryPath ?? DefaultCommitSignBinaryPath;

  let verifiedGrant;
  try {
    verifiedGrant = await verifySigningGrant({
      config: {
        tokenSecret: ctx.sandboxBootstrapConfig.tokenSecret,
        tokenIssuer: ctx.sandboxBootstrapConfig.tokenIssuer,
        tokenAudience: ctx.sandboxBootstrapConfig.tokenAudience,
      },
      token: input.grant,
    });
  } catch (error) {
    if (error instanceof SigningGrantError) {
      throw new InternalIdentityLinkingError(
        InternalIdentityLinkingErrorCodes.INVALID_SIGN_COMMIT_PAYLOAD_INPUT,
        400,
        `Signing grant verification failed: ${error.code}.`,
      );
    }

    throw error;
  }

  const claimMismatch =
    verifiedGrant.sub !== input.sandboxInstanceId
      ? "sandboxInstanceId"
      : verifiedGrant.organizationId !== input.organizationId
        ? "organizationId"
        : verifiedGrant.actingUserId !== input.actingUserId
          ? "actingUserId"
          : verifiedGrant.providerFamily !== input.providerFamily
            ? "providerFamily"
            : verifiedGrant.format !== input.format
              ? "format"
              : verifiedGrant.keyRef !== input.keyRef
                ? "keyRef"
                : undefined;

  if (claimMismatch !== undefined) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.INVALID_SIGN_COMMIT_PAYLOAD_INPUT,
      400,
      `Signing request ${claimMismatch} does not match the verified signing grant.`,
    );
  }

  const requestedPublicKey = resolveRequestedKeyRefOrThrow(input.keyRef);

  const providerConfig = await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
        eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
      ),
  });

  if (providerConfig === undefined) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.PROVIDER_CONFIG_NOT_FOUND,
      404,
      `Identity-linking provider '${input.providerFamily}' is not configured for organization '${input.organizationId}'.`,
    );
  }

  const principal = await ctx.db.query.userExternalPrincipals.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, input.actingUserId),
        eq(table.providerFamily, input.providerFamily),
        eq(table.organizationProviderConfigId, providerConfig.id),
        eq(table.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
  });

  if (principal === undefined) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.PRINCIPAL_NOT_FOUND,
      404,
      `No active linked principal was found for user '${input.actingUserId}' and provider '${input.providerFamily}'.`,
    );
  }

  const signingCredentialSecrets = await ctx.db
    .select({
      credentialId: tables.userExternalPrincipalCredentials.id,
      secretKind: tables.userExternalPrincipalCredentialSecrets.secretKind,
      ciphertext: tables.userExternalPrincipalCredentialSecrets.ciphertext,
      nonce: tables.userExternalPrincipalCredentialSecrets.nonce,
      organizationCredentialKeyVersion:
        tables.userExternalPrincipalCredentialSecrets.organizationCredentialKeyVersion,
      expiresAt: tables.userExternalPrincipalCredentialSecrets.expiresAt,
      revokedAt: tables.userExternalPrincipalCredentialSecrets.revokedAt,
      metadata: tables.userExternalPrincipalCredentialSecrets.metadata,
    })
    .from(tables.userExternalPrincipalCredentials)
    .innerJoin(
      tables.userExternalPrincipalCredentialSecrets,
      and(
        eq(tables.userExternalPrincipalCredentialSecrets.organizationId, input.organizationId),
        eq(
          tables.userExternalPrincipalCredentialSecrets.credentialId,
          tables.userExternalPrincipalCredentials.id,
        ),
        eq(
          tables.userExternalPrincipalCredentialSecrets.secretKind,
          UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
        ),
        isNull(tables.userExternalPrincipalCredentialSecrets.revokedAt),
      ),
    )
    .where(
      and(
        eq(tables.userExternalPrincipalCredentials.organizationId, input.organizationId),
        eq(tables.userExternalPrincipalCredentials.principalId, principal.id),
        eq(tables.userExternalPrincipalCredentials.providerFamily, input.providerFamily),
        eq(tables.userExternalPrincipalCredentials.credentialKind, GitSshSigningCredentialKind),
        eq(
          tables.userExternalPrincipalCredentials.status,
          UserExternalPrincipalCredentialStatuses.ACTIVE,
        ),
      ),
    );

  if (signingCredentialSecrets.length === 0) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      `No active Git SSH signing credential is available for principal '${principal.id}'.`,
    );
  }

  if (signingCredentialSecrets.length > 1) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.AMBIGUOUS_CREDENTIAL_KIND,
      400,
      `Multiple active Git SSH signing credentials are configured for principal '${principal.id}'.`,
    );
  }

  const signingCredentialSecret = signingCredentialSecrets[0];
  if (signingCredentialSecret === undefined) {
    throw new Error("Expected Git SSH signing credential secret candidate.");
  }

  const parsedSigningMetadata = GitSshSigningSecretMetadataSchema.safeParse(
    signingCredentialSecret.metadata ?? {},
  );
  if (!parsedSigningMetadata.success) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      `Git SSH signing credential '${signingCredentialSecret.credentialId}' is missing public key metadata.`,
    );
  }

  const storedPublicKey = parsedSigningMetadata.data.publicKey.trim();
  if (storedPublicKey.length === 0) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      `Git SSH signing credential '${signingCredentialSecret.credentialId}' has an empty public key.`,
    );
  }

  if (storedPublicKey !== requestedPublicKey) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      `No active Git SSH signing credential matches requested key '${input.keyRef}'.`,
    );
  }

  const credentialSecretResolver = await createCredentialSecretResolver({
    tx: ctx.db,
    organizationId: input.organizationId,
    integrationsConfig: ctx.integrationsConfig,
    secrets: [
      {
        secretKind: signingCredentialSecret.secretKind,
        ciphertext: signingCredentialSecret.ciphertext,
        nonce: signingCredentialSecret.nonce,
        organizationCredentialKeyVersion: signingCredentialSecret.organizationCredentialKeyVersion,
        expiresAt: signingCredentialSecret.expiresAt,
        revokedAt: signingCredentialSecret.revokedAt,
      },
    ],
  });

  try {
    const privateKey = await credentialSecretResolver.resolve(
      UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
    );
    return await runCommitSignBinary({
      binaryPath: commitSignBinaryPath,
      format: SshSigningFormat,
      privateKey,
      payloadBase64: input.payload,
    });
  } finally {
    credentialSecretResolver.cleanup();
  }
}
