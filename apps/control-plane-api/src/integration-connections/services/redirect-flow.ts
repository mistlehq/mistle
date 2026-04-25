import { randomBytes } from "node:crypto";

import {
  type ControlPlaneDatabase,
  type IntegrationConnectionRedirectSession,
  integrationConnectionRedirectSessions,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

const REDIRECT_STATE_BYTE_LENGTH = 32;
const REDIRECT_SESSION_TTL_MS = 10 * 60 * 1000;

type RedirectStateBadRequestCode =
  | typeof IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID
  | typeof IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED
  | typeof IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED;

type RequiredRedirectQueryParamBadRequestCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT;

export function createRedirectState(): string {
  return randomBytes(REDIRECT_STATE_BYTE_LENGTH).toString("base64url");
}

export function createRedirectSessionExpiryTimestamp(): string {
  return new Date(Date.now() + REDIRECT_SESSION_TTL_MS).toISOString();
}

export async function persistRedirectSessionOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  targetKey: string;
  state: string;
  expiresAt: string;
  failureMessage: string;
  pkceVerifierEncrypted?: string;
  providerStateEncrypted?: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationConnectionRedirectSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      expiresAt: input.expiresAt,
      ...(input.pkceVerifierEncrypted === undefined
        ? {}
        : { pkceVerifierEncrypted: input.pkceVerifierEncrypted }),
      ...(input.providerStateEncrypted === undefined
        ? {}
        : { providerStateEncrypted: input.providerStateEncrypted }),
    })
    .onConflictDoNothing({
      target: integrationConnectionRedirectSessions.state,
    })
    .returning({
      id: integrationConnectionRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error(input.failureMessage);
  }
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

export const encodeGitHubAppManifestStateMetadata = encodeGitHubAppInstallationStateMetadata;

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

export const resolveGitHubAppManifestConnectionId = resolveGitHubAppInstallationConnectionId;

export function createRedirectQueryParams(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }

  return params;
}

export function resolveRequiredRedirectQueryParamOrThrow(input: {
  params: URLSearchParams;
  name: string;
  invalidInputCode: RequiredRedirectQueryParamBadRequestCode;
  missingMessage: string;
}): string {
  const value = input.params.get(input.name);
  if (value === null || value.length === 0) {
    throw new BadRequestError(input.invalidInputCode, input.missingMessage);
  }

  return value;
}

export async function resolveActiveRedirectSessionOrThrow(input: {
  db: ControlPlaneDatabase;
  state: string;
  targetKey?: string;
  invalidStateCode: RedirectStateBadRequestCode;
  alreadyUsedCode: RedirectStateBadRequestCode;
  expiredCode: RedirectStateBadRequestCode;
}): Promise<IntegrationConnectionRedirectSession> {
  const redirectSession = await input.db.query.integrationConnectionRedirectSessions.findFirst({
    where: (table, { and, eq }) =>
      input.targetKey === undefined
        ? eq(table.state, input.state)
        : and(eq(table.targetKey, input.targetKey), eq(table.state, input.state)),
  });

  if (redirectSession === undefined) {
    throw new BadRequestError(input.invalidStateCode, "Redirect state is invalid.");
  }

  if (redirectSession.usedAt !== null) {
    throw new BadRequestError(input.alreadyUsedCode, "Redirect state has already been used.");
  }

  const now = Date.now();
  const expiresAt = Date.parse(redirectSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(`Redirect session '${redirectSession.id}' has an invalid expiry timestamp.`);
  }

  if (expiresAt <= now) {
    throw new BadRequestError(input.expiredCode, "Redirect state has expired.");
  }

  return redirectSession;
}
