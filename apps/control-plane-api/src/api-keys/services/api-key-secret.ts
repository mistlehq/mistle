import { createHash, randomBytes } from "node:crypto";

const ApiKeySecretPrefixByteLength = 16;
const ApiKeySecretByteLength = 32;

export const ApiKeySecretHashAlgorithms = {
  SHA256_V1: "sha256-v1",
} as const;

export type GeneratedApiKeySecret = {
  token: string;
  secretPrefix: string;
  secretHash: string;
  secretHashAlgorithm: string;
};

export function generateApiKeySecret(): GeneratedApiKeySecret {
  const secretPrefix = randomBytes(ApiKeySecretPrefixByteLength).toString("base64url");
  const secret = randomBytes(ApiKeySecretByteLength).toString("base64url");
  const token = `mstl_apk_${secretPrefix}_${secret}`;

  return {
    token,
    secretPrefix,
    secretHash: hashApiKeyToken(token),
    secretHashAlgorithm: ApiKeySecretHashAlgorithms.SHA256_V1,
  };
}

export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
