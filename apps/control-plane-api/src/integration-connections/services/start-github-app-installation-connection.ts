import { integrationConnectionRedirectSessions } from "@mistle/db/control-plane";

import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "./errors.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeRedirectStateMetadata,
} from "./redirect-flow.js";
import { resolveGitHubAppInstallationHandlerTargetOrThrow } from "./resolve-github-app-installation-handler.js";

export type StartGitHubAppInstallationConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName?: string;
};

type StartedGitHubAppInstallationConnection = {
  authorizationUrl: string;
};

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
