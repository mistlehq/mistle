import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptCredentialUtf8,
  decryptIntegrationTargetSecrets,
  encryptCredentialUtf8,
  encryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
  wrapOrganizationCredentialKey,
} from "./crypto.js";

describe("integration credential crypto", () => {
  it("wraps and unwraps organization credential keys", () => {
    const organizationCredentialKey = randomBytes(32);
    const masterEncryptionKeyMaterial = "master-key-version-1";

    const wrappedCiphertext = wrapOrganizationCredentialKey({
      organizationCredentialKey,
      masterEncryptionKeyMaterial,
    });
    const unwrappedKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext,
      masterEncryptionKeyMaterial,
    });

    expect(unwrappedKey.equals(organizationCredentialKey)).toBe(true);

    organizationCredentialKey.fill(0);
    unwrappedKey.fill(0);
  });

  it("encrypts and decrypts utf8 credentials with organization keys", () => {
    const organizationCredentialKey = randomBytes(32);
    const plaintext = "sk-test-secret-value";

    const encrypted = encryptCredentialUtf8({
      plaintext,
      organizationCredentialKey,
    });
    const decrypted = decryptCredentialUtf8({
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      organizationCredentialKey,
    });

    expect(decrypted).toBe(plaintext);

    organizationCredentialKey.fill(0);
  });

  it("resolves configured master key material", () => {
    const material = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: 2,
      masterEncryptionKeys: {
        "1": "master-key-1",
        "2": "master-key-2",
      },
    });

    expect(material).toBe("master-key-2");
  });

  it("throws for missing master key material", () => {
    expect(() =>
      resolveMasterEncryptionKeyMaterial({
        masterKeyVersion: 99,
        masterEncryptionKeys: {
          "1": "master-key-1",
        },
      }),
    ).toThrow("Master encryption key version '99' is missing.");
  });

  it("throws for invalid wrapped organization key format", () => {
    expect(() =>
      unwrapOrganizationCredentialKey({
        wrappedCiphertext: "invalid-format",
        masterEncryptionKeyMaterial: "master-key-1",
      }),
    ).toThrow("Wrapped organization credential key has an invalid format.");
  });

  it("encrypts and decrypts integration target secrets with master key material", () => {
    const encrypted = encryptIntegrationTargetSecrets({
      secrets: {
        client_secret: "github-client-secret",
        private_key_pem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      },
      masterKeyVersion: 3,
      masterEncryptionKeyMaterial: "master-key-version-3",
    });

    expect(encrypted.masterKeyVersion).toBe(3);

    const decrypted = decryptIntegrationTargetSecrets({
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      masterEncryptionKeyMaterial: "master-key-version-3",
    });

    expect(decrypted).toEqual({
      client_secret: "github-client-secret",
      private_key_pem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
  });

  it("throws for invalid integration target secrets ciphertext format", () => {
    expect(() =>
      decryptIntegrationTargetSecrets({
        nonce: "invalid",
        ciphertext: "invalid-format",
        masterEncryptionKeyMaterial: "master-key-version-1",
      }),
    ).toThrow("Encrypted integration target secrets ciphertext format is invalid.");
  });

  it("throws when decrypting integration target secrets with the wrong key", () => {
    const encrypted = encryptIntegrationTargetSecrets({
      secrets: {
        client_secret: "github-client-secret",
      },
      masterKeyVersion: 1,
      masterEncryptionKeyMaterial: "master-key-version-1",
    });

    expect(() =>
      decryptIntegrationTargetSecrets({
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        masterEncryptionKeyMaterial: "wrong-master-key",
      }),
    ).toThrow("Failed to decrypt integration target secrets.");
  });
});
