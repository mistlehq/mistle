import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { createOAuth2AuthorizationCodeCredentialSlotKeys } from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";

export type CreatedManagedTokenConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

async function createAndLinkManagedTokenCredential(input: {
  tx: ControlPlaneTransaction;
  organizationId: string;
  familyId: string;
  connectionId: string;
  slotKey: string;
  secretKind:
    | typeof IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN
    | typeof IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN;
  plaintext: string;
  organizationCredentialKeyVersion: number;
  organizationCredentialKey: Buffer;
  credentialMetadata?: Record<string, unknown>;
  expiresAt?: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);
  const existingLink = await input.tx.query.integrationConnectionCredentials.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.connectionId, input.connectionId),
        whereEq(table.slotKey, input.slotKey),
      ),
  });
  const encryptedCredential = encryptCredentialUtf8({
    plaintext: input.plaintext,
    organizationCredentialKey: input.organizationCredentialKey,
  });

  const [createdCredential] = await input.tx
    .insert(tables.integrationCredentials)
    .values({
      organizationId: input.organizationId,
      secretKind: input.secretKind,
      ciphertext: encryptedCredential.ciphertext,
      nonce: encryptedCredential.nonce,
      organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
      intendedFamilyId: input.familyId,
      ...(input.credentialMetadata === undefined ? {} : { metadata: input.credentialMetadata }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    .returning({
      id: tables.integrationCredentials.id,
    });

  if (createdCredential === undefined) {
    throw new Error("Failed to create managed token credential.");
  }

  await input.tx
    .insert(tables.integrationConnectionCredentials)
    .values({
      connectionId: input.connectionId,
      credentialId: createdCredential.id,
      slotKey: input.slotKey,
    })
    .onConflictDoUpdate({
      target: [
        tables.integrationConnectionCredentials.connectionId,
        tables.integrationConnectionCredentials.slotKey,
      ],
      set: {
        credentialId: createdCredential.id,
      },
    });

  if (existingLink !== undefined && existingLink.credentialId !== createdCredential.id) {
    await input.tx
      .update(tables.integrationCredentials)
      .set({
        revokedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.integrationCredentials.id, existingLink.credentialId),
          isNull(tables.integrationCredentials.revokedAt),
        ),
      );
  }
}

export async function createManagedTokenConnection(
  ctx: {
    tx: ControlPlaneTransaction;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    targetKey: string;
    familyId: string;
    variantId: string;
    displayName: string;
    connectionMethodId: string;
    connectionConfig: Record<string, unknown>;
    targetSnapshotConfig: Record<string, unknown>;
    accessToken: string;
    accessTokenExpiresAt?: string;
    refreshToken?: string;
    refreshTokenExpiresAt?: string;
    credentialMetadata?: Record<string, unknown>;
    externalSubjectId?: string;
  },
): Promise<CreatedManagedTokenConnection> {
  const tables = getControlPlaneDatabaseSchema(ctx.tx);

  const [createdConnection] = await ctx.tx
    .insert(tables.integrationConnections)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: input.displayName,
      status: IntegrationConnectionStatuses.ACTIVE,
      ...(input.externalSubjectId === undefined
        ? {}
        : {
            externalSubjectId: input.externalSubjectId,
          }),
      config: {
        ...input.connectionConfig,
        connection_method: input.connectionMethodId,
      },
      targetSnapshotConfig: input.targetSnapshotConfig,
    })
    .returning();

  if (createdConnection === undefined) {
    throw new Error("Failed to create managed token integration connection.");
  }

  const organizationCredentialKey = await ctx.tx.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const credentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
      familyId: input.familyId,
      variantId: input.variantId,
    });

    const encryptedAccessToken = encryptCredentialUtf8({
      plaintext: input.accessToken,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
    const [createdAccessTokenCredential] = await ctx.tx
      .insert(tables.integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        ciphertext: encryptedAccessToken.ciphertext,
        nonce: encryptedAccessToken.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.familyId,
        ...(input.credentialMetadata === undefined ? {} : { metadata: input.credentialMetadata }),
        ...(input.accessTokenExpiresAt === undefined
          ? {}
          : {
              expiresAt: input.accessTokenExpiresAt,
            }),
      })
      .returning({
        id: tables.integrationCredentials.id,
      });

    if (createdAccessTokenCredential === undefined) {
      throw new Error("Failed to create managed token access credential.");
    }

    const [createdAccessCredentialLink] = await ctx.tx
      .insert(tables.integrationConnectionCredentials)
      .values({
        connectionId: createdConnection.id,
        credentialId: createdAccessTokenCredential.id,
        slotKey: credentialSlotKeys.accessToken,
      })
      .returning({
        connectionId: tables.integrationConnectionCredentials.connectionId,
      });

    if (createdAccessCredentialLink === undefined) {
      throw new Error("Failed to link managed token access credential to the connection.");
    }

    if (input.refreshToken !== undefined) {
      const encryptedRefreshToken = encryptCredentialUtf8({
        plaintext: input.refreshToken,
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });
      const [createdRefreshTokenCredential] = await ctx.tx
        .insert(tables.integrationCredentials)
        .values({
          organizationId: input.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
          ciphertext: encryptedRefreshToken.ciphertext,
          nonce: encryptedRefreshToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: input.familyId,
          ...(input.credentialMetadata === undefined ? {} : { metadata: input.credentialMetadata }),
          ...(input.refreshTokenExpiresAt === undefined
            ? {}
            : {
                expiresAt: input.refreshTokenExpiresAt,
              }),
        })
        .returning({
          id: tables.integrationCredentials.id,
        });

      if (createdRefreshTokenCredential === undefined) {
        throw new Error("Failed to create managed token refresh credential.");
      }

      const [createdRefreshCredentialLink] = await ctx.tx
        .insert(tables.integrationConnectionCredentials)
        .values({
          connectionId: createdConnection.id,
          credentialId: createdRefreshTokenCredential.id,
          slotKey: credentialSlotKeys.refreshToken,
        })
        .returning({
          connectionId: tables.integrationConnectionCredentials.connectionId,
        });

      if (createdRefreshCredentialLink === undefined) {
        throw new Error("Failed to link managed token refresh credential to the connection.");
      }
    }
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }

  return {
    id: createdConnection.id,
    targetKey: createdConnection.targetKey,
    displayName: createdConnection.displayName,
    status: createdConnection.status,
    ...(createdConnection.externalSubjectId === null
      ? {}
      : { externalSubjectId: createdConnection.externalSubjectId }),
    ...(createdConnection.config === null ? {} : { config: createdConnection.config }),
    ...(createdConnection.targetSnapshotConfig === null
      ? {}
      : { targetSnapshotConfig: createdConnection.targetSnapshotConfig }),
    createdAt: createdConnection.createdAt,
    updatedAt: createdConnection.updatedAt,
  };
}

export async function reauthorizeManagedTokenConnection(
  ctx: {
    tx: ControlPlaneTransaction;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    connectionId: string;
    familyId: string;
    variantId: string;
    connectionConfig: Record<string, unknown>;
    targetSnapshotConfig: Record<string, unknown>;
    accessToken: string;
    accessTokenExpiresAt?: string;
    refreshToken: string;
    refreshTokenExpiresAt?: string;
    credentialMetadata?: Record<string, unknown>;
    externalSubjectId?: string;
  },
): Promise<CreatedManagedTokenConnection> {
  const tables = getControlPlaneDatabaseSchema(ctx.tx);
  const organizationCredentialKey = await ctx.tx.query.organizationCredentialKeys.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const credentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
      familyId: input.familyId,
      variantId: input.variantId,
    });

    await createAndLinkManagedTokenCredential({
      tx: ctx.tx,
      organizationId: input.organizationId,
      familyId: input.familyId,
      connectionId: input.connectionId,
      slotKey: credentialSlotKeys.accessToken,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      plaintext: input.accessToken,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
      ...(input.credentialMetadata === undefined
        ? {}
        : { credentialMetadata: input.credentialMetadata }),
      ...(input.accessTokenExpiresAt === undefined
        ? {}
        : { expiresAt: input.accessTokenExpiresAt }),
    });

    await createAndLinkManagedTokenCredential({
      tx: ctx.tx,
      organizationId: input.organizationId,
      familyId: input.familyId,
      connectionId: input.connectionId,
      slotKey: credentialSlotKeys.refreshToken,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      plaintext: input.refreshToken,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
      ...(input.credentialMetadata === undefined
        ? {}
        : { credentialMetadata: input.credentialMetadata }),
      ...(input.refreshTokenExpiresAt === undefined
        ? {}
        : { expiresAt: input.refreshTokenExpiresAt }),
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }

  const [updatedConnection] = await ctx.tx
    .update(tables.integrationConnections)
    .set({
      status: IntegrationConnectionStatuses.ACTIVE,
      ...(input.externalSubjectId === undefined
        ? {}
        : {
            externalSubjectId: input.externalSubjectId,
          }),
      config: input.connectionConfig,
      targetSnapshotConfig: input.targetSnapshotConfig,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.integrationConnections.id, input.connectionId),
        eq(tables.integrationConnections.organizationId, input.organizationId),
      ),
    )
    .returning();

  if (updatedConnection === undefined) {
    throw new Error("Failed to update managed token integration connection.");
  }

  return {
    id: updatedConnection.id,
    targetKey: updatedConnection.targetKey,
    displayName: updatedConnection.displayName,
    status: updatedConnection.status,
    ...(updatedConnection.externalSubjectId === null
      ? {}
      : { externalSubjectId: updatedConnection.externalSubjectId }),
    ...(updatedConnection.config === null ? {} : { config: updatedConnection.config }),
    ...(updatedConnection.targetSnapshotConfig === null
      ? {}
      : { targetSnapshotConfig: updatedConnection.targetSnapshotConfig }),
    createdAt: updatedConnection.createdAt,
    updatedAt: updatedConnection.updatedAt,
  };
}
