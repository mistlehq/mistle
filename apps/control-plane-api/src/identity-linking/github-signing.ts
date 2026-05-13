import { BadRequestError } from "@mistle/http/errors.js";
import sshpk from "sshpk";
import { z } from "zod";

import { IdentityLinkingBadRequestCodes } from "./constants.js";

export const GitHubProviderFamily = "github";
export const GitSshSigningCredentialKind = "git_ssh_signing_key";
const GitSshPrivateKeyMaxBytes = 64 * 1024;
const OpenSshPrivateKeyHeader = "-----BEGIN OPENSSH PRIVATE KEY-----";
const OpenSshPrivateKeyFooter = "-----END OPENSSH PRIVATE KEY-----";

export const GitSshSigningSecretMetadataSchema = z
  .object({
    publicKey: z.string().min(1),
    publicKeyFingerprint: z.string().min(1),
  })
  .strict();

export type ParsedGitSshSigningPrivateKey = {
  privateKey: string;
  publicKey: string;
  publicKeyFingerprint: string;
};

function createInvalidSigningKeyError(message: string): BadRequestError {
  return new BadRequestError(
    IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT,
    message,
  );
}

function isNamedError(error: unknown, expectedName: string): boolean {
  return error instanceof Error && error.name === expectedName;
}

export function parseGitSshSigningPrivateKeyOrThrow(
  rawPrivateKey: string,
): ParsedGitSshSigningPrivateKey {
  const normalizedPrivateKey = rawPrivateKey.trim();
  if (normalizedPrivateKey.length === 0) {
    throw createInvalidSigningKeyError("GitHub signing key upload cannot be empty.");
  }

  if (Buffer.byteLength(normalizedPrivateKey, "utf8") > GitSshPrivateKeyMaxBytes) {
    throw createInvalidSigningKeyError("GitHub signing key upload is too large.");
  }

  if (
    !normalizedPrivateKey.startsWith(OpenSshPrivateKeyHeader) ||
    !normalizedPrivateKey.endsWith(OpenSshPrivateKeyFooter)
  ) {
    throw createInvalidSigningKeyError("GitHub signing key must be an OpenSSH private key.");
  }

  let privateKey: sshpk.PrivateKey;
  try {
    privateKey = sshpk.parsePrivateKey(normalizedPrivateKey, "auto");
  } catch (error) {
    if (isNamedError(error, "KeyEncryptedError")) {
      throw createInvalidSigningKeyError(
        "GitHub signing key must be uploaded without a passphrase.",
      );
    }

    if (isNamedError(error, "KeyParseError")) {
      throw createInvalidSigningKeyError("GitHub signing key must be a valid SSH private key.");
    }

    throw error;
  }

  const publicKey = privateKey.toPublic().toString("ssh").trim();
  const publicKeyFingerprint = privateKey.toPublic().fingerprint("sha256", "ssh").toString();

  const parsedMetadata = GitSshSigningSecretMetadataSchema.safeParse({
    publicKey,
    publicKeyFingerprint,
  });
  if (!parsedMetadata.success) {
    throw createInvalidSigningKeyError(
      "GitHub signing key could not be converted into public key metadata.",
    );
  }

  return {
    privateKey: normalizedPrivateKey,
    publicKey: parsedMetadata.data.publicKey,
    publicKeyFingerprint: parsedMetadata.data.publicKeyFingerprint,
  };
}
