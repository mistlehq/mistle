import { createHash } from "node:crypto";

import {
  integrationConnectionRedirectSessions,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import {
  encryptRedirectSessionSecretUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../lib/crypto.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeRedirectStateMetadata,
} from "./redirect-flow.js";
import { resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow } from "./resolve-oauth2-authorization-code-capability-target.js";

const PKCE_CHALLENGE_METHOD = "S256" as const;

export type StartOAuth2AuthorizationCodeConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName?: string;
  controlPlaneBaseUrl: string;
};

type StartedOAuth2AuthorizationCodeConnection = {
  authorizationUrl: string;
};

function buildOAuth2AuthorizationCodeCompleteUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
}): string {
  return new URL(
    `/p/integration/callbacks/${encodeURIComponent(input.targetKey)}/oauth2-authorization-code`,
    input.controlPlaneBaseUrl,
  ).toString();
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

async function persistRedirectSession(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  targetKey: string;
  state: string;
  pkceVerifierEncrypted: string;
  providerStateEncrypted?: string;
  expiresAt: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationConnectionRedirectSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      pkceVerifierEncrypted: input.pkceVerifierEncrypted,
      ...(input.providerStateEncrypted === undefined
        ? {}
        : { providerStateEncrypted: input.providerStateEncrypted }),
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: integrationConnectionRedirectSessions.state,
    })
    .returning({
      id: integrationConnectionRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist OAuth 2.0 (Authorization Code) redirect session state.");
  }
}

export async function startOAuth2AuthorizationCodeConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: StartOAuth2AuthorizationCodeConnectionInput,
): Promise<StartedOAuth2AuthorizationCodeConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const resolved = await resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      targetKey: input.targetKey,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
    },
  );

  const state = encodeRedirectStateMetadata({
    state: createRedirectState(),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });
  const pkceVerifier = createRedirectState();
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });
  const pkceVerifierEncrypted = encryptRedirectSessionSecretUtf8({
    plaintext: pkceVerifier,
    masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeyMaterial,
  });
  const redirectUrl = buildOAuth2AuthorizationCodeCompleteUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    targetKey: input.targetKey,
  });

  const startedOAuth2AuthorizationCodeConnection =
    await resolved.oauth2AuthorizationCode.startAuthorization({
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
  const providerStateEncrypted =
    startedOAuth2AuthorizationCodeConnection.providerState === undefined
      ? undefined
      : encryptRedirectSessionSecretUtf8({
          plaintext: JSON.stringify(startedOAuth2AuthorizationCodeConnection.providerState),
          masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
          masterEncryptionKeyMaterial,
        });

  await persistRedirectSession({
    db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    state,
    pkceVerifierEncrypted,
    ...(providerStateEncrypted === undefined ? {} : { providerStateEncrypted }),
    expiresAt: createRedirectSessionExpiryTimestamp(),
  });

  return startedOAuth2AuthorizationCodeConnection;
}
