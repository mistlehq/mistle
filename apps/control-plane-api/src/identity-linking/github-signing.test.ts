import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BadRequestError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import {
  GitSshSigningSecretMetadataSchema,
  parseGitSshSigningPrivateKeyOrThrow,
} from "./github-signing.js";

const ValidGitSigningPrivateKeyPath = fileURLToPath(
  new URL("../../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const ValidGitSigningPrivateKey = readFileSync(ValidGitSigningPrivateKeyPath, "utf8");

const EncryptedGitSigningPrivateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABCYEwZKgd
M0Qp++geikSrNyAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIIUjGtb6+T6jUnHq
KKqbpZt8gK66hs+SP2+Pa0+KKHW9AAAAoO4KKK/Ymrm5CL/BIWsxkbcl9Up9joOFmvWBIH
pP1oimR6zcZ1X4zhPZvydyKu6ZYN86gFc4Uf2f9NYemMk0ws/mm0pQAeniErZ/1XlPWqfB
+SYziwRdbbzDUHWaM63tvt4uZuqyXu56H/d0UkZvp5ftShqZxuDvMBhUatt71a5SxWll5A
an0+U8MdfPsFnvbu1+3OBtjQ82MuNy6T4vNWg=
-----END OPENSSH PRIVATE KEY-----`;

function captureThrownError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw.");
}

describe("parseGitSshSigningPrivateKeyOrThrow", () => {
  it("parses a valid ssh private key and derives public metadata", () => {
    const parsed = parseGitSshSigningPrivateKeyOrThrow(ValidGitSigningPrivateKey);

    expect(parsed.privateKey).toBe(ValidGitSigningPrivateKey.trim());
    expect(
      GitSshSigningSecretMetadataSchema.parse({
        publicKey: parsed.publicKey,
        publicKeyFingerprint: parsed.publicKeyFingerprint,
      }),
    ).toEqual({
      publicKey: parsed.publicKey,
      publicKeyFingerprint: parsed.publicKeyFingerprint,
    });
  });

  it("rejects passphrase-protected ssh private keys", () => {
    const error = captureThrownError(() =>
      parseGitSshSigningPrivateKeyOrThrow(EncryptedGitSigningPrivateKey),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      code: "INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT",
      message: "GitHub signing key must be uploaded without a passphrase.",
    });
  });

  it("rejects PEM private keys that are not in OpenSSH format", () => {
    const error = captureThrownError(() =>
      parseGitSshSigningPrivateKeyOrThrow(
        "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
      ),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      code: "INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT",
      message: "GitHub signing key must be an OpenSSH private key.",
    });
  });

  it("rejects invalid ssh private keys", () => {
    const error = captureThrownError(() =>
      parseGitSshSigningPrivateKeyOrThrow(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
      ),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      code: "INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT",
      message: "GitHub signing key must be a valid SSH private key.",
    });
  });
});
