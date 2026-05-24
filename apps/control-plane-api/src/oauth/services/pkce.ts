import { createHash } from "node:crypto";

export function verifyS256Pkce(input: { codeVerifier: string; codeChallenge: string }): boolean {
  return computeS256CodeChallenge(input.codeVerifier) === input.codeChallenge;
}

function computeS256CodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}
