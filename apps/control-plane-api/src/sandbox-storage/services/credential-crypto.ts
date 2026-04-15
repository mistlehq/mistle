import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import {
  decryptCredentialUtf8,
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";

type OrganizationCredentialEncryptionConfig = {
  masterEncryptionKeys: Record<string, string>;
};

async function getLatestOrganizationCredentialKey(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}) {
  return input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });
}

async function getOrganizationCredentialKeyByVersion(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  organizationCredentialKeyVersion: number;
}) {
  return input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.version, input.organizationCredentialKeyVersion),
      ),
  });
}

function unwrapOrganizationCredentialKeyMaterial(input: {
  ciphertext: string;
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
}): Buffer {
  return unwrapOrganizationCredentialKey({
    wrappedCiphertext: input.ciphertext,
    masterEncryptionKeyMaterial: resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: input.masterKeyVersion,
      masterEncryptionKeys: input.masterEncryptionKeys,
    }),
  });
}

export async function encryptOrganizationBackedValue(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  plaintext: string;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<{
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
}> {
  const organizationCredentialKey = await getLatestOrganizationCredentialKey({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Latest organization credential key for organization '${input.organizationId}' was not found.`,
    );
  }

  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKeyMaterial({
    ciphertext: organizationCredentialKey.ciphertext,
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.encryptionConfig.masterEncryptionKeys,
  });

  try {
    const encrypted = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return {
      ...encrypted,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export async function decryptOrganizationBackedValue(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<string> {
  const organizationCredentialKey = await getOrganizationCredentialKeyByVersion({
    db: input.db,
    organizationId: input.organizationId,
    organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
  });
  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key version '${String(input.organizationCredentialKeyVersion)}' for organization '${input.organizationId}' was not found.`,
    );
  }

  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKeyMaterial({
    ciphertext: organizationCredentialKey.ciphertext,
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.encryptionConfig.masterEncryptionKeys,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
