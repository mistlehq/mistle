import {
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalCredentials,
  userExternalPrincipalCredentialSecrets,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipalKeys,
  UserExternalPrincipalKeyStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, inArray, ne } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";
import type { CompletedLinkedAccountAuthorization } from "./provider-adapters.js";
import { resolveIdentityLinkProviderAdapter } from "./provider-adapters.js";
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
  timestamp: string;
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipalKeys)
    .set({
      status: UserExternalPrincipalKeyStatuses.RETIRED,
      retiredAt: input.timestamp,
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
  timestamp: string;
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipalCredentials)
    .set({
      status: UserExternalPrincipalCredentialStatuses.REVOKED,
      updatedAt: input.timestamp,
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
  timestamp: string;
}): Promise<void> {
  if (input.principalIds.length === 0) {
    return;
  }

  await input.db
    .update(userExternalPrincipals)
    .set({
      status: UserExternalPrincipalStatuses.UNLINKED,
      unlinkedAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .where(inArray(userExternalPrincipals.id, input.principalIds));

  await retirePrincipalKeys(input);
  await revokePrincipalCredentials(input);
}

function normalizeCompletedLinkedAccountAuthorizationOrThrow(
  completedAuthorization: CompletedLinkedAccountAuthorization,
): CompletedLinkedAccountAuthorization {
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

  return {
    providerSubjectId,
    keys: normalizedKeys as CompletedLinkedAccountAuthorization["keys"],
    ...(completedAuthorization.profile === undefined
      ? {}
      : { profile: completedAuthorization.profile }),
    ...(credential === undefined ? {} : { credential }),
  };
}

async function persistLinkedAccountAuthorization(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  userId: string;
  providerFamily: string;
  organizationProviderConfigId: string;
  integrationConnectionId: string;
  completedAuthorization: CompletedLinkedAccountAuthorization;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
  timestamp: string;
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
    timestamp: input.timestamp,
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
        linkedAt: input.timestamp,
        updatedAt: input.timestamp,
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
        linkedAt: input.timestamp,
        unlinkedAt: null,
        updatedAt: input.timestamp,
      })
      .where(eq(userExternalPrincipals.id, principalId));
  }

  await retirePrincipalKeys({
    db: input.db,
    principalIds: [principalId],
    timestamp: input.timestamp,
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
    timestamp: input.timestamp,
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
      lastValidatedAt: input.timestamp,
      updatedAt: input.timestamp,
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
          secretKind: secret.secretKind,
          nonce: encryptedSecret.nonce,
          ciphertext: encryptedSecret.ciphertext,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          ...(secret.metadata === undefined ? {} : { metadata: secret.metadata }),
          ...(secret.expiresAt === undefined ? {} : { expiresAt: secret.expiresAt }),
          updatedAt: input.timestamp,
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

  const providerAdapter = resolveIdentityLinkProviderAdapter(input.providerFamily);
  if (providerAdapter === undefined) {
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
  const completedAuthorization = await providerAdapter.completeAuthorization({
    organizationId: redirectSession.organizationId,
    userId: redirectSession.userId,
    providerFamily: input.providerFamily,
    organizationProviderConfig: providerContext.organizationProviderConfig,
    integrationConnection: providerContext.integrationConnection,
    integrationTarget: providerContext.integrationTarget,
    query: queryParams,
    redirectUrl,
    ...(pkceVerifier === undefined ? {} : { pkceVerifier }),
    ...(providerState === undefined ? {} : { providerState }),
  });

  const timestamp = new Date().toISOString();
  await ctx.db.transaction(async (tx) => {
    await markIdentityLinkRedirectSessionUsedOrThrow({
      db: tx,
      redirectSessionId: redirectSession.id,
      usedAt: timestamp,
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
      timestamp,
    });
  });

  return buildIdentityLinkResultDashboardUrl({
    dashboardBaseUrl: ctx.dashboardBaseUrl,
    providerFamily: input.providerFamily,
    result: "success",
  });
}

export { normalizeCompletedLinkedAccountAuthorizationOrThrow };
