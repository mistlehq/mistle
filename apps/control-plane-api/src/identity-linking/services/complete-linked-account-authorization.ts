import {
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalCredentials,
  userExternalPrincipalCredentialSecrets,
  type UserExternalPrincipalCredentialSecretKind,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipalKeys,
  UserExternalPrincipalKeyStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  type CompletedIdentityLinkingAuthorization,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { resolveIdentityLinkingRuntimeContextOrThrow } from "./identity-linking-definition.js";
import {
  buildIdentityLinkCallbackUrl,
  buildIdentityLinkResultDashboardUrl,
  createRedirectQueryParams,
  markIdentityLinkRedirectSessionUsedOrThrow,
  resolveIdentityLinkProviderState,
  resolveIdentityLinkRedirectSecret,
  resolveRedirectStateOrThrow,
} from "./redirect-flow.js";
import { resolveIdentityLinkProviderContextOrThrow } from "./resolve-identity-link-provider-context.js";

function resolveIdentityLinkingErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

function assertRedirectSessionNotUsedOrExpired(input: {
  redirectSession: {
    id: string;
    expiresAt: string;
    usedAt: string | null;
  };
}): void {
  if (input.redirectSession.usedAt !== null) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
      "Redirect state has already been used.",
    );
  }

  const expiresAt = Date.parse(input.redirectSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(
      `Identity-link redirect session '${input.redirectSession.id}' has an invalid expiry timestamp.`,
    );
  }

  if (expiresAt <= Date.now()) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.REDIRECT_STATE_EXPIRED,
      "Redirect state has expired.",
    );
  }
}

async function retirePrincipalKeys(input: {
  db: ControlPlaneDatabase;
  principalIds: string[];
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipalKeys)
    .set({
      status: UserExternalPrincipalKeyStatuses.RETIRED,
      retiredAt: sql`now()`,
    })
    .where(
      and(
        inArray(userExternalPrincipalKeys.principalId, input.principalIds),
        eq(userExternalPrincipalKeys.status, UserExternalPrincipalKeyStatuses.ACTIVE),
      ),
    );
}

async function revokePrincipalCredentials(input: {
  db: ControlPlaneDatabase;
  principalIds: string[];
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipalCredentials)
    .set({
      status: UserExternalPrincipalCredentialStatuses.REVOKED,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(userExternalPrincipalCredentials.principalId, input.principalIds),
        ne(
          userExternalPrincipalCredentials.status,
          UserExternalPrincipalCredentialStatuses.REVOKED,
        ),
      ),
    );
}

async function unlinkPrincipals(input: {
  db: ControlPlaneDatabase;
  principalIds: string[];
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipals)
    .set({
      status: UserExternalPrincipalStatuses.UNLINKED,
      unlinkedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(inArray(userExternalPrincipals.id, input.principalIds));

  await retirePrincipalKeys(input);
  await revokePrincipalCredentials(input);
}

function resolvePrincipalCredentialSecretKindOrThrow(
  secretKind: string,
): UserExternalPrincipalCredentialSecretKind {
  for (const candidate of Object.values(UserExternalPrincipalCredentialSecretKinds)) {
    if (candidate === secretKind) {
      return candidate;
    }
  }

  throw new BadRequestError(
    IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
    `Identity-link callback returned unsupported credential secret kind '${secretKind}'.`,
  );
}

function normalizeCompletedLinkedAccountAuthorizationOrThrow(
  completedAuthorization: CompletedIdentityLinkingAuthorization,
): CompletedIdentityLinkingAuthorization {
  const providerSubjectId = completedAuthorization.providerSubjectId.trim();
  if (providerSubjectId.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
      "Identity-link callback must return a non-empty provider subject id.",
    );
  }

  const normalizedKeys = completedAuthorization.keys.map((key) => {
    const keyType = key.keyType.trim();
    const keyValue = key.keyValue.trim();
    if (keyType.length === 0 || keyValue.length === 0) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
        "Identity-link callback must return non-empty provider identity keys.",
      );
    }

    return {
      keyType,
      keyValue,
    };
  });
  if (normalizedKeys.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
      "Identity-link callback must return at least one provider identity key.",
    );
  }

  const seenKeys = new Set<string>();
  for (const key of normalizedKeys) {
    const dedupeKey = `${key.keyType}\0${key.keyValue}`;
    if (seenKeys.has(dedupeKey)) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
        "Identity-link callback returned duplicate provider identity keys.",
      );
    }

    seenKeys.add(dedupeKey);
  }

  const credential =
    completedAuthorization.credential === undefined
      ? undefined
      : {
          ...completedAuthorization.credential,
          credentialKind: completedAuthorization.credential.credentialKind.trim(),
        };
  if (credential !== undefined && credential.credentialKind.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
      "Identity-link callback returned an empty credential kind.",
    );
  }

  let normalizedCredentialSecrets;
  if (credential !== undefined) {
    normalizedCredentialSecrets = credential.secrets.map((secret) => {
      const secretKind = secret.secretKind.trim();
      if (secretKind.length === 0 || secret.plaintext.length === 0) {
        throw new BadRequestError(
          IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
          "Identity-link callback returned an invalid credential secret.",
        );
      }

      return {
        ...secret,
        secretKind,
      };
    });
  }

  return {
    providerSubjectId,
    keys: [normalizedKeys[0]!, ...normalizedKeys.slice(1)],
    ...(completedAuthorization.profile === undefined
      ? {}
      : { profile: completedAuthorization.profile }),
    ...(credential === undefined
      ? {}
      : {
          credential: {
            ...credential,
            secrets:
              normalizedCredentialSecrets === undefined
                ? credential.secrets
                : [normalizedCredentialSecrets[0]!, ...normalizedCredentialSecrets.slice(1)],
          },
        }),
  };
}

async function persistLinkedAccountAuthorization(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  userId: string;
  providerFamily: string;
  organizationProviderConfigId: string;
  integrationConnectionId: string;
  completedAuthorization: CompletedIdentityLinkingAuthorization;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
}): Promise<void> {
  const completedAuthorization = normalizeCompletedLinkedAccountAuthorizationOrThrow(
    input.completedAuthorization,
  );
  const providerSubjectId = completedAuthorization.providerSubjectId;
  const existingUserPrincipals = await input.db.query.userExternalPrincipals.findMany({
    columns: {
      id: true,
      userId: true,
      providerSubjectId: true,
      status: true,
      linkedAt: true,
    },
    where: (table, { and, eq, ne }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, input.userId),
        eq(table.providerFamily, input.providerFamily),
        ne(table.status, UserExternalPrincipalStatuses.UNLINKED),
      ),
    orderBy: (table, { desc }) => [desc(table.linkedAt)],
  });

  const conflictingSubjectPrincipal = await input.db.query.userExternalPrincipals.findFirst({
    columns: {
      id: true,
      userId: true,
    },
    where: (table, { and, eq, ne }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
        eq(table.providerSubjectId, providerSubjectId),
        ne(table.status, UserExternalPrincipalStatuses.UNLINKED),
        ne(table.userId, input.userId),
      ),
  });

  if (conflictingSubjectPrincipal !== undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_SUBJECT_ALREADY_LINKED,
      `Provider identity '${providerSubjectId}' is already linked to another user.`,
    );
  }

  const reusablePrincipal =
    existingUserPrincipals.find((principal) => principal.providerSubjectId === providerSubjectId) ??
    existingUserPrincipals[0];

  const supersededPrincipalIds = existingUserPrincipals
    .filter((principal) => principal.id !== reusablePrincipal?.id)
    .map((principal) => principal.id);
  await unlinkPrincipals({
    db: input.db,
    principalIds: supersededPrincipalIds,
  });

  let principalId = reusablePrincipal?.id;
  if (principalId === undefined) {
    const [insertedPrincipal] = await input.db
      .insert(userExternalPrincipals)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        providerFamily: input.providerFamily,
        providerSubjectId,
        organizationProviderConfigId: input.organizationProviderConfigId,
        integrationConnectionId: input.integrationConnectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        ...(completedAuthorization.profile === undefined
          ? {}
          : { profile: completedAuthorization.profile }),
        linkedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning({
        id: userExternalPrincipals.id,
      });

    if (insertedPrincipal === undefined) {
      throw new Error("Failed to insert linked-account principal.");
    }

    principalId = insertedPrincipal.id;
  } else {
    await input.db
      .update(userExternalPrincipals)
      .set({
        providerSubjectId,
        organizationProviderConfigId: input.organizationProviderConfigId,
        integrationConnectionId: input.integrationConnectionId,
        status: UserExternalPrincipalStatuses.ACTIVE,
        profile: completedAuthorization.profile ?? null,
        linkedAt: sql`now()`,
        unlinkedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(userExternalPrincipals.id, principalId));
  }

  await retirePrincipalKeys({
    db: input.db,
    principalIds: [principalId],
  });

  await input.db.insert(userExternalPrincipalKeys).values(
    completedAuthorization.keys.map((key) => ({
      organizationId: input.organizationId,
      principalId,
      providerFamily: input.providerFamily,
      keyType: key.keyType,
      keyValue: key.keyValue,
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    })),
  );

  await revokePrincipalCredentials({
    db: input.db,
    principalIds: [principalId],
  });

  if (completedAuthorization.credential === undefined) {
    return;
  }

  const [insertedCredential] = await input.db
    .insert(userExternalPrincipalCredentials)
    .values({
      organizationId: input.organizationId,
      principalId,
      providerFamily: input.providerFamily,
      credentialKind: completedAuthorization.credential.credentialKind,
      status: UserExternalPrincipalCredentialStatuses.ACTIVE,
      ...(completedAuthorization.credential.scopes === undefined
        ? {}
        : { scopes: completedAuthorization.credential.scopes }),
      ...(completedAuthorization.credential.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: completedAuthorization.credential.accessTokenExpiresAt }),
      ...(completedAuthorization.credential.refreshTokenExpiresAt === undefined
        ? {}
        : {
            refreshTokenExpiresAt: completedAuthorization.credential.refreshTokenExpiresAt,
          }),
      lastValidatedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: userExternalPrincipalCredentials.id,
    });

  if (insertedCredential === undefined) {
    throw new Error("Failed to insert linked-account credential.");
  }

  if (completedAuthorization.credential.secrets.length === 0) {
    return;
  }

  const organizationCredentialKey = await input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    await input.db.insert(userExternalPrincipalCredentialSecrets).values(
      completedAuthorization.credential.secrets.map((secret) => {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: secret.plaintext,
          organizationCredentialKey: organizationCredentialKeyMaterial,
        });

        return {
          organizationId: input.organizationId,
          credentialId: insertedCredential.id,
          secretKind: resolvePrincipalCredentialSecretKindOrThrow(secret.secretKind),
          nonce: encryptedSecret.nonce,
          ciphertext: encryptedSecret.ciphertext,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          ...(secret.metadata === undefined ? {} : { metadata: secret.metadata }),
          ...(secret.expiresAt === undefined ? {} : { expiresAt: secret.expiresAt }),
          updatedAt: sql`now()`,
        };
      }),
    );
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}

export async function completeLinkedAccountAuthorization(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
    controlPlaneBaseUrl: string;
    dashboardBaseUrl: string;
  },
  input: {
    providerFamily: string;
    query: Record<string, string>;
  },
): Promise<string> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);

  const redirectSession = await ctx.db.query.identityLinkRedirectSessions.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.providerFamily, input.providerFamily), eq(table.state, state)),
  });

  if (redirectSession === undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }

  assertRedirectSessionNotUsedOrExpired({
    redirectSession,
  });

  const providerContext = await resolveIdentityLinkProviderContextOrThrow(ctx, {
    organizationId: redirectSession.organizationId,
    providerFamily: input.providerFamily,
    requiredConfigStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    organizationProviderConfigId: redirectSession.organizationProviderConfigId,
    integrationConnectionId: redirectSession.integrationConnectionId,
  });

  const identityLinkingRuntime = await resolveIdentityLinkingRuntimeContextOrThrow({
    db: ctx.db,
    integrationRegistry: ctx.integrationRegistry,
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
    },
    organizationId: redirectSession.organizationId,
    integrationTarget: providerContext.integrationTarget,
    integrationConnection: providerContext.integrationConnection,
  });

  if (identityLinkingRuntime.identityLinking.completeAuthorization === undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_ADAPTER_NOT_IMPLEMENTED,
      `Identity-linking provider '${input.providerFamily}' does not yet support linked-account authorization.`,
    );
  }

  const redirectUrl = buildIdentityLinkCallbackUrl({
    controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
    providerFamily: input.providerFamily,
  });
  const pkceVerifier =
    redirectSession.pkceVerifierEncrypted === null
      ? undefined
      : resolveIdentityLinkRedirectSecret(
          redirectSession.pkceVerifierEncrypted,
          ctx.integrationsConfig.masterEncryptionKeys,
        );
  const providerState =
    redirectSession.providerStateEncrypted === null
      ? undefined
      : resolveIdentityLinkProviderState(
          redirectSession.providerStateEncrypted,
          ctx.integrationsConfig.masterEncryptionKeys,
        );
  let completedAuthorization;
  try {
    completedAuthorization = await identityLinkingRuntime.identityLinking.completeAuthorization({
      organizationId: redirectSession.organizationId,
      userId: redirectSession.userId,
      providerFamily: input.providerFamily,
      target: identityLinkingRuntime.target,
      connection: identityLinkingRuntime.connection,
      query: queryParams,
      redirectUrl,
      now: new Date().toISOString(),
      ...(pkceVerifier === undefined ? {} : { pkceVerifier }),
      ...(providerState === undefined ? {} : { providerState }),
      resolveConnectionSecret: identityLinkingRuntime.resolveConnectionSecret,
    });
  } catch (error) {
    if (resolveIdentityLinkingErrorCode(error) === "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG") {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        error instanceof Error ? error.message : "Identity-linking provider config is invalid.",
      );
    }

    if (resolveIdentityLinkingErrorCode(error) === "IDENTITY_LINKING_AUTHORIZATION_FAILED") {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
        error instanceof Error
          ? error.message
          : "Identity-linking authorization did not complete successfully.",
      );
    }

    throw error;
  }

  await ctx.db.transaction(async (tx) => {
    await markIdentityLinkRedirectSessionUsedOrThrow({
      db: tx,
      redirectSessionId: redirectSession.id,
    });

    await persistLinkedAccountAuthorization({
      db: tx,
      organizationId: redirectSession.organizationId,
      userId: redirectSession.userId,
      providerFamily: input.providerFamily,
      organizationProviderConfigId: providerContext.organizationProviderConfig.id,
      integrationConnectionId: providerContext.integrationConnection.id,
      completedAuthorization,
      integrationsConfig: ctx.integrationsConfig,
    });
  });

  return buildIdentityLinkResultDashboardUrl({
    dashboardBaseUrl: ctx.dashboardBaseUrl,
    providerFamily: input.providerFamily,
    result: "success",
  });
}

export { normalizeCompletedLinkedAccountAuthorizationOrThrow };
