import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
} from "@mistle/db/control-plane";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";

import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import type { AppContext } from "../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./errors.js";

const integrationRegistry = createIntegrationRegistry();

export type ResolveIntegrationCredentialInput = {
  connectionId: string;
  secretType: string;
  purpose?: string | undefined;
  resolverKey?: string | undefined;
};

export type ResolvedIntegrationCredential = {
  value: string;
  expiresAt?: string;
};

type ResolvePersistedCredentialInput = {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
  secretType: string;
  purpose?: string | undefined;
};

function parsePersistedSecretType(secretType: string): IntegrationCredentialSecretKind | undefined {
  if (secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return IntegrationCredentialSecretKinds.API_KEY;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN;
  }

  return undefined;
}

async function resolvePersistedCredential(
  input: ResolvePersistedCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const credentialPurpose = input.purpose;
  const linkedCredentials =
    credentialPurpose === undefined
      ? await input.db.query.integrationConnectionCredentials.findMany({
          columns: {
            credentialId: true,
            purpose: true,
          },
          where: (table, { eq }) => eq(table.connectionId, input.connectionId),
        })
      : await input.db.query.integrationConnectionCredentials.findMany({
          columns: {
            credentialId: true,
            purpose: true,
          },
          where: (table, { and, eq }) =>
            and(eq(table.connectionId, input.connectionId), eq(table.purpose, credentialPurpose)),
        });

  if (linkedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this connection.",
    );
  }

  const matchedCredentials: Array<{
    id: string;
    ciphertext: string;
    nonce: string;
    organizationCredentialKeyVersion: number;
  }> = [];
  const persistedSecretType = parsePersistedSecretType(input.secretType);
  if (persistedSecretType === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  for (const linkedCredential of linkedCredentials) {
    const credential = await input.db.query.integrationCredentials.findFirst({
      columns: {
        id: true,
        ciphertext: true,
        nonce: true,
        organizationCredentialKeyVersion: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(
          eq(table.id, linkedCredential.credentialId),
          eq(table.secretKind, persistedSecretType),
          isNull(table.revokedAt),
        ),
    });

    if (credential !== undefined) {
      matchedCredentials.push(credential);
    }
  }

  if (matchedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  if (matchedCredentials.length > 1) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.AMBIGUOUS_CREDENTIAL_MATCH,
      400,
      "Multiple credentials matched. Provide a specific purpose for credential resolution.",
    );
  }

  const credential = matchedCredentials[0];
  if (credential === undefined) {
    throw new Error("Expected matched credential to exist.");
  }

  const organizationCredentialKey = await input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.version, credential.organizationCredentialKeyVersion),
      ),
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key version '${String(credential.organizationCredentialKeyVersion)}' for organization '${input.organizationId}' was not found.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const value = decryptCredentialUtf8({
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return {
      value,
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export async function resolveIntegrationCredential(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: ResolveIntegrationCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.connectionId),
  });

  if (connection === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_FOUND,
      404,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_ACTIVE,
      400,
      `Integration connection '${connection.id}' is not active.`,
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  if (input.resolverKey !== undefined) {
    const customResolver = definition.credentialResolvers?.custom?.[input.resolverKey];
    if (customResolver === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.RESOLVER_NOT_FOUND,
        404,
        `Credential resolver '${input.resolverKey}' was not found for target '${connection.targetKey}'.`,
      );
    }

    return customResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  const defaultResolver = definition.credentialResolvers?.default;
  if (defaultResolver !== undefined) {
    return defaultResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  return resolvePersistedCredential({
    db,
    integrationsConfig,
    organizationId: connection.organizationId,
    connectionId: connection.id,
    secretType: input.secretType,
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
  });
}
