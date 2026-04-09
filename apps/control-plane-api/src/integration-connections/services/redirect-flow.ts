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

export function encodeGitHubAppInstallationStateMetadata(input: {
  state: string;
  connectionId: string;
}): string {
  return `${input.state}.${Buffer.from(input.connectionId, "utf8").toString("base64url")}`;
}

export function resolveGitHubAppInstallationConnectionId(state: string): string {
  const separatorIndex = state.indexOf(".");
  if (separatorIndex < 0 || separatorIndex === state.length - 1) {
    throw new Error("GitHub App installation state is missing connection metadata.");
  }

  const encodedConnectionId = state.slice(separatorIndex + 1);
  const connectionId = Buffer.from(encodedConnectionId, "base64url").toString("utf8").trim();
  if (connectionId.length === 0) {
    throw new Error("GitHub App installation state contains an empty connection id.");
  }

  return connectionId;
}

export function createRedirectQueryParams(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }

  return params;
}
