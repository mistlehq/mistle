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
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABBUODbQh7
1Ee9N5XEJxQsmOAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIKg9i4qHFoxQs1Li
6thmHLc4GDvI1AK6c5WGWoqybDILAAAAoF7AedmHz+63DN5qQRhZPivpN/qd1jhenZ8qEz
JV7oDNijPT5ICJv3Z4S4hsi9ra0k4EhpPWsDw9aExlYKYipCVrppwg++y+CflCtrXhfqrX
1AZT9wdYbrBmc8lO6niH1rg1IXHOkfLlXIRg5PJBufmVlPveJLcFJU5svA5AgH1JttOY84
sqUQuVSJhFhTlxx/fq0e+eMMvBrG/Zc09NJBQ=
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
