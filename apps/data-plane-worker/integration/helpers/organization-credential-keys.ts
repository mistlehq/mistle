import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { createControlPlaneDatabase, organizationCredentialKeys } from "@mistle/db/control-plane";

const AesGcmNonceByteLength = 12;
const OrganizationCredentialKeyByteLength = 32;
const WrappedOrganizationKeyFormatVersion = "v1";

function wrapOrganizationCredentialKey(input: {
  organizationCredentialKey: Buffer;
  masterEncryptionKeyMaterial: string;
}): string {
  const encryptionKey = createHash("sha256")
    .update(input.masterEncryptionKeyMaterial, "utf8")
    .digest();
  const nonce = randomBytes(AesGcmNonceByteLength);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);

  try {
    const ciphertext = Buffer.concat([
      cipher.update(input.organizationCredentialKey),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    try {
      return [
        WrappedOrganizationKeyFormatVersion,
        nonce.toString("base64url"),
        ciphertext.toString("base64url"),
        authTag.toString("base64url"),
      ].join(".");
    } finally {
      ciphertext.fill(0);
      authTag.fill(0);
    }
  } finally {
    encryptionKey.fill(0);
    nonce.fill(0);
  }
}

export async function insertInitialOrganizationCredentialKey(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  organizationCredentialKeyVersion: number;
  masterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
}): Promise<void> {
  const organizationCredentialKey = randomBytes(OrganizationCredentialKeyByteLength);
  const masterEncryptionKeyMaterial =
    input.masterEncryptionKeys[String(input.masterEncryptionKeyVersion)];

  if (masterEncryptionKeyMaterial === undefined) {
    throw new Error(
      `Master encryption key version '${String(input.masterEncryptionKeyVersion)}' is missing.`,
    );
  }

  try {
    const ciphertext = wrapOrganizationCredentialKey({
      organizationCredentialKey,
      masterEncryptionKeyMaterial,
    });

    await input.db.insert(organizationCredentialKeys).values({
      organizationId: input.organizationId,
      version: input.organizationCredentialKeyVersion,
      masterKeyVersion: input.masterEncryptionKeyVersion,
      ciphertext,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
