import { randomBytes } from "node:crypto";

import { integrationOauthSessions } from "@mistle/db/control-plane";

import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "./errors.js";
import { resolveOauthHandlerTargetOrThrow } from "./resolve-oauth-handler.js";

const OAUTH_STATE_BYTE_LENGTH = 32;
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

export type StartOauthConnectionInput = {
  organizationId: string;
  targetKey: string;
};

type StartedOauthConnection = {
  authorizationUrl: string;
};

function createOAuthState(): string {
  return randomBytes(OAUTH_STATE_BYTE_LENGTH).toString("base64url");
}

function createExpiryTimestamp(): string {
  return new Date(Date.now() + OAUTH_SESSION_TTL_MS).toISOString();
}

async function persistOAuthSession(input: {
  db: AppContext["var"]["db"];
  organizationId: string;
  targetKey: string;
  state: string;
  expiresAt: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationOauthSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: integrationOauthSessions.state,
    })
    .returning({
      id: integrationOauthSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist OAuth session state.");
  }
}

export async function startOAuthConnection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: StartOauthConnectionInput,
): Promise<StartedOauthConnection> {
  const resolved = await resolveOauthHandlerTargetOrThrow(db, integrationsConfig, {
    targetKey: input.targetKey,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_START_INPUT,
  });

  const state = createOAuthState();
  const startedOauthConnection = await resolved.oauthHandler.start({
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    state,
  });

  await persistOAuthSession({
    db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    state,
    expiresAt: createExpiryTimestamp(),
  });

  return startedOauthConnection;
}
