import { createHash } from "node:crypto";

import { integrationConnectionRedirectSessions } from "@mistle/db/control-plane";

import {
  encryptRedirectSessionSecretUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../integration-credentials/crypto.js";
import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "./errors.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeRedirectStateMetadata,
} from "./redirect-flow.js";
import { resolveOAuth2CapabilityTargetOrThrow } from "./resolve-oauth2-capability-target.js";

const PKCE_CHALLENGE_METHOD = "S256" as const;

export type StartOAuth2ConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName?: string;
  controlPlaneBaseUrl: string;
};

type StartedOAuth2Connection = {
  authorizationUrl: string;
};

function buildOAuth2CompleteUrl(input: { controlPlaneBaseUrl: string; targetKey: string }): string {
  return new URL(
    `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth2/complete`,
    input.controlPlaneBaseUrl,
  ).toString();
}

function createPkceVerifier(): string {
  return createRedirectState();
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

async function persistRedirectSession(input: {
  db: AppContext["var"]["db"];
  organizationId: string;
  targetKey: string;
  state: string;
  pkceVerifierEncrypted: string;
  expiresAt: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationConnectionRedirectSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      pkceVerifierEncrypted: input.pkceVerifierEncrypted,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: integrationConnectionRedirectSessions.state,
    })
    .returning({
      id: integrationConnectionRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist OAuth2 redirect session state.");
  }
}

export async function startOAuth2Connection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: StartOAuth2ConnectionInput,
): Promise<StartedOAuth2Connection> {
  const resolved = await resolveOAuth2CapabilityTargetOrThrow(db, integrationsConfig, {
    targetKey: input.targetKey,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
  });

  const state = encodeRedirectStateMetadata({
    state: createRedirectState(),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  const pkceVerifier = createPkceVerifier();
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });
  const pkceVerifierEncrypted = encryptRedirectSessionSecretUtf8({
    plaintext: pkceVerifier,
    masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeyMaterial,
  });
  const redirectUrl = buildOAuth2CompleteUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    targetKey: input.targetKey,
  });

  const startedOAuth2Connection = await resolved.oauth2.startAuthorization({
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    state,
    redirectUrl,
    pkce: {
      challenge: createPkceChallenge(pkceVerifier),
      challengeMethod: PKCE_CHALLENGE_METHOD,
    },
  });

  await persistRedirectSession({
    db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    state,
    pkceVerifierEncrypted,
    expiresAt: createRedirectSessionExpiryTimestamp(),
  });

  return startedOAuth2Connection;
}
