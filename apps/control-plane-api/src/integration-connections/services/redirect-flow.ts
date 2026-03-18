import { randomBytes } from "node:crypto";

const REDIRECT_STATE_BYTE_LENGTH = 32;
const REDIRECT_SESSION_TTL_MS = 10 * 60 * 1000;

export function createRedirectState(): string {
  return randomBytes(REDIRECT_STATE_BYTE_LENGTH).toString("base64url");
}

export function createRedirectSessionExpiryTimestamp(): string {
  return new Date(Date.now() + REDIRECT_SESSION_TTL_MS).toISOString();
}

export function encodeRedirectStateMetadata(input: {
  state: string;
  displayName?: string;
}): string {
  if (input.displayName === undefined) {
    return input.state;
  }

  return `${input.state}.${Buffer.from(input.displayName, "utf8").toString("base64url")}`;
}

export function resolveRedirectDisplayName(state: string): string | undefined {
  const separatorIndex = state.indexOf(".");
  if (separatorIndex < 0 || separatorIndex === state.length - 1) {
    return undefined;
  }

  const encodedDisplayName = state.slice(separatorIndex + 1);
  const displayName = Buffer.from(encodedDisplayName, "base64url").toString("utf8").trim();
  if (displayName.length === 0) {
    return undefined;
  }

  return displayName;
}

export function createRedirectQueryParams(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }

  return params;
}
