import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { ControlPlaneDbSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";

const ORGANIZATION_CREDENTIAL_KEY_VERSION = 1;
const WRAPPED_CIPHERTEXT_FORMAT_VERSION = "v1";
const WRAPPED_CIPHERTEXT_IV_BYTE_LENGTH = 12;
const ORGANIZATION_CREDENTIAL_KEY_BYTE_LENGTH = 32;

type CreateInitialOrganizationCredentialKeyInput = {
  db: ControlPlaneDatabase;
  organizationId: string;
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
};

function resolveActiveMasterEncryptionKeyMaterial(input: {
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
}): string {
  const masterKeyVersion = String(input.activeMasterEncryptionKeyVersion);
  const masterKeyMaterial = input.masterEncryptionKeys[masterKeyVersion];

  if (masterKeyMaterial === undefined || masterKeyMaterial.length === 0) {
    throw new Error(
      `Active master encryption key version '${masterKeyVersion}' is not configured.`,
    );
  }

  return masterKeyMaterial;
}

function wrapOrganizationCredentialKey(input: {
  organizationCredentialKey: Buffer;
  masterEncryptionKeyMaterial: string;
}): string {
  const encryptionKey = createHash("sha256")
    .update(input.masterEncryptionKeyMaterial, "utf8")
    .digest();
  const iv = randomBytes(WRAPPED_CIPHERTEXT_IV_BYTE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);

  try {
    const ciphertext = Buffer.concat([
      cipher.update(input.organizationCredentialKey),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      WRAPPED_CIPHERTEXT_FORMAT_VERSION,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      authTag.toString("base64url"),
    ].join(".");
  } finally {
    encryptionKey.fill(0);
  }
}

export async function createInitialOrganizationCredentialKey(
  input: CreateInitialOrganizationCredentialKeyInput,
): Promise<void> {
  const organizationCredentialKey = randomBytes(ORGANIZATION_CREDENTIAL_KEY_BYTE_LENGTH);
  const masterEncryptionKeyMaterial = resolveActiveMasterEncryptionKeyMaterial({
    activeMasterEncryptionKeyVersion: input.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });

  try {
    const ciphertext = wrapOrganizationCredentialKey({
      organizationCredentialKey,
      masterEncryptionKeyMaterial,
    });

    await input.db.insert(ControlPlaneDbSchema.organizationCredentialKeys).values({
      organizationId: input.organizationId,
      version: ORGANIZATION_CREDENTIAL_KEY_VERSION,
      masterKeyVersion: input.activeMasterEncryptionKeyVersion,
      ciphertext,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
