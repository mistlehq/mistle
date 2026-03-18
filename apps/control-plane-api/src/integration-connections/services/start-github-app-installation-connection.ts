import { randomBytes } from "node:crypto";

import { integrationConnectionRedirectSessions } from "@mistle/db/control-plane";

import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "./errors.js";
import { resolveGitHubAppInstallationHandlerTargetOrThrow } from "./resolve-github-app-installation-handler.js";

const REDIRECT_STATE_BYTE_LENGTH = 32;
const REDIRECT_SESSION_TTL_MS = 10 * 60 * 1000;

export type StartGitHubAppInstallationConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName?: string;
};

type StartedGitHubAppInstallationConnection = {
  authorizationUrl: string;
};

function createRedirectState(): string {
  return randomBytes(REDIRECT_STATE_BYTE_LENGTH).toString("base64url");
}

function createRedirectSessionExpiryTimestamp(): string {
  return new Date(Date.now() + REDIRECT_SESSION_TTL_MS).toISOString();
}

async function persistRedirectSession(input: {
  db: AppContext["var"]["db"];
  organizationId: string;
  targetKey: string;
  state: string;
  expiresAt: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationConnectionRedirectSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: integrationConnectionRedirectSessions.state,
    })
    .returning({
      id: integrationConnectionRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist redirect session state.");
  }
}

function encodeRedirectStateMetadata(input: { state: string; displayName?: string }): string {
  if (input.displayName === undefined) {
    return input.state;
  }

  return `${input.state}.${Buffer.from(input.displayName, "utf8").toString("base64url")}`;
}

export async function startGitHubAppInstallationConnection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: StartGitHubAppInstallationConnectionInput,
): Promise<StartedGitHubAppInstallationConnection> {
  const resolved = await resolveGitHubAppInstallationHandlerTargetOrThrow(db, integrationsConfig, {
    targetKey: input.targetKey,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
  });

  const state = encodeRedirectStateMetadata({
    state: createRedirectState(),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  const startedGitHubAppInstallationConnection = await resolved.redirectHandler.start({
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    state,
  });

  await persistRedirectSession({
    db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    state,
    expiresAt: createRedirectSessionExpiryTimestamp(),
  });

  return startedGitHubAppInstallationConnection;
}
