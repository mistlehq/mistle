import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const WRAPPED_ORGANIZATION_KEY_FORMAT_VERSION = "v1";
const ENCRYPTED_CREDENTIAL_FORMAT_VERSION = "v1";
const AES_GCM_NONCE_BYTE_LENGTH = 12;

export function resolveMasterEncryptionKeyMaterial(input: {
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
}): string {
  const masterKeyMaterial = input.masterEncryptionKeys[String(input.masterKeyVersion)];
  if (masterKeyMaterial === undefined || masterKeyMaterial.length === 0) {
    throw new Error(
      `Master encryption key version '${String(input.masterKeyVersion)}' is missing.`,
    );
  }

  return masterKeyMaterial;
}

export function wrapOrganizationCredentialKey(input: {
  organizationCredentialKey: Buffer;
  masterEncryptionKeyMaterial: string;
}): string {
  const encryptionKey = createHash("sha256")
    .update(input.masterEncryptionKeyMaterial, "utf8")
    .digest();
  const nonce = randomBytes(AES_GCM_NONCE_BYTE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);

  try {
    const ciphertext = Buffer.concat([
      cipher.update(input.organizationCredentialKey),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    try {
      return [
        WRAPPED_ORGANIZATION_KEY_FORMAT_VERSION,
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

export function unwrapOrganizationCredentialKey(input: {
  wrappedCiphertext: string;
  masterEncryptionKeyMaterial: string;
}): Buffer {
  const [formatVersion, encodedNonce, encodedCiphertext, encodedAuthTag] =
    input.wrappedCiphertext.split(".");

  if (
    formatVersion !== WRAPPED_ORGANIZATION_KEY_FORMAT_VERSION ||
    encodedNonce === undefined ||
    encodedCiphertext === undefined ||
    encodedAuthTag === undefined
  ) {
    throw new Error("Wrapped organization credential key has an invalid format.");
  }

  const encryptionKey = createHash("sha256")
    .update(input.masterEncryptionKeyMaterial, "utf8")
    .digest();
  const nonce = Buffer.from(encodedNonce, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  const authTag = Buffer.from(encodedAuthTag, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new Error("Failed to unwrap organization credential key.", { cause: error });
  } finally {
    encryptionKey.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
    authTag.fill(0);
  }
}

export function encryptCredentialUtf8(input: {
  plaintext: string;
  organizationCredentialKey: Buffer;
}): { nonce: string; ciphertext: string } {
  const nonce = randomBytes(AES_GCM_NONCE_BYTE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", input.organizationCredentialKey, nonce);
  const plaintext = Buffer.from(input.plaintext, "utf8");

  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    try {
      return {
        nonce: nonce.toString("base64url"),
        ciphertext: [
          ENCRYPTED_CREDENTIAL_FORMAT_VERSION,
          ciphertext.toString("base64url"),
          authTag.toString("base64url"),
        ].join("."),
      };
    } finally {
      ciphertext.fill(0);
      authTag.fill(0);
    }
  } finally {
    nonce.fill(0);
    plaintext.fill(0);
  }
}

export function decryptCredentialUtf8(input: {
  nonce: string;
  ciphertext: string;
  organizationCredentialKey: Buffer;
}): string {
  const [formatVersion, encodedCiphertext, encodedAuthTag] = input.ciphertext.split(".");

  if (
    formatVersion !== ENCRYPTED_CREDENTIAL_FORMAT_VERSION ||
    encodedCiphertext === undefined ||
    encodedAuthTag === undefined
  ) {
    throw new Error("Encrypted credential ciphertext format is invalid.");
  }

  const nonce = Buffer.from(input.nonce, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  const authTag = Buffer.from(encodedAuthTag, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", input.organizationCredentialKey, nonce);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    try {
      return plaintext.toString("utf8");
    } finally {
      plaintext.fill(0);
    }
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    authTag.fill(0);
  }
}
