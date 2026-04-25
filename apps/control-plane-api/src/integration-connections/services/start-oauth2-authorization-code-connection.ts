import { createHash } from "node:crypto";

import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
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
  persistRedirectSessionOrThrow,
} from "./redirect-flow.js";
import { resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow } from "./resolve-oauth2-authorization-code-capability-target.js";

const PKCE_CHALLENGE_METHOD = "S256" as const;

export type StartOAuth2AuthorizationCodeConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName?: string;
  connectionConfig?: Record<string, unknown>;
  controlPlaneBaseUrl: string;
};

type StartedOAuth2AuthorizationCodeConnection = {
  authorizationUrl: string;
};

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function resolveConnectionConfigOrThrow(input: {
  targetKey: string;
  rawConnectionConfig: Record<string, unknown> | undefined;
  configSchema:
    | {
        safeParse(input: unknown): { success: true; data: unknown } | { success: false };
      }
    | undefined;
}): Record<string, unknown> {
  const rawConnectionConfig = input.rawConnectionConfig ?? {};

  if (input.configSchema === undefined) {
    if (Object.keys(rawConnectionConfig).length > 0) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
        `Integration target '${input.targetKey}' does not accept OAuth 2.0 (Authorization Code) connection config.`,
      );
    }

    return {};
  }

  const parsedConnectionConfig = input.configSchema.safeParse(rawConnectionConfig);
  if (!parsedConnectionConfig.success) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
      `Integration target '${input.targetKey}' received invalid OAuth 2.0 (Authorization Code) connection config.`,
    );
  }

  const connectionConfigRecord = toUnknownRecord(parsedConnectionConfig.data);
  if (connectionConfigRecord === null) {
    throw new Error("OAuth 2.0 (Authorization Code) connection config must parse to an object.");
  }

  return connectionConfigRecord;
}

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
  const connectionConfig = resolveConnectionConfigOrThrow({
    targetKey: input.targetKey,
    rawConnectionConfig: input.connectionConfig,
    configSchema: resolved.connectionMethodStartConfigSchema,
  });

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
      connectionConfig,
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

  await persistRedirectSessionOrThrow({
    db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    state,
    pkceVerifierEncrypted,
    ...(providerStateEncrypted === undefined ? {} : { providerStateEncrypted }),
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist OAuth 2.0 (Authorization Code) redirect session state.",
  });

  return {
    authorizationUrl: startedOAuth2AuthorizationCodeConnection.authorizationUrl,
  };
}
