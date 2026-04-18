import {
  IntegrationCredentialSecretKinds,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";

export async function resolveConnectionSecretOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
  slotKey: string;
  secretKind: (typeof IntegrationCredentialSecretKinds)[keyof typeof IntegrationCredentialSecretKinds];
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
}): Promise<string> {
  const linkedCredential = await input.db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, input.slotKey)),
  });

  if (linkedCredential === undefined) {
    throw new Error(
      `Integration connection '${input.connectionId}' is missing credential slot '${input.slotKey}'.`,
    );
  }

  const credential = await input.db.query.integrationCredentials.findFirst({
    columns: {
      ciphertext: true,
      nonce: true,
      organizationCredentialKeyVersion: true,
      revokedAt: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, linkedCredential.credentialId), eq(table.secretKind, input.secretKind)),
  });

  if (credential === undefined) {
    throw new Error(
      `Integration connection '${input.connectionId}' is missing credential '${input.secretKind}' for slot '${input.slotKey}'.`,
    );
  }

  if (credential.revokedAt !== null) {
    throw new Error(
      `Integration connection '${input.connectionId}' has a revoked credential for slot '${input.slotKey}'.`,
    );
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
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
