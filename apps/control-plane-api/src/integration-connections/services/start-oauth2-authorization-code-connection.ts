import { createHash } from "node:crypto";

import {
  IntegrationConnectionRedirectSessionIntents,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";

import {
  encryptRedirectSessionSecretUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../lib/crypto.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { IntegrationConnectionsNotFoundCodes } from "../constants.js";
import { assertIdentityLinkingAuthEditableOrThrow } from "./assert-identity-linking-auth-editable.js";
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

export type StartOAuth2AuthorizationCodeConnectionReauthorizationInput = {
  organizationId: string;
  connectionId: string;
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

function removeFrameworkConnectionConfigFields(
  config: Record<string, unknown> | null,
): Record<string, unknown> {
  if (config === null) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key !== "connection_method" && key !== "client_id") {
      result[key] = value;
    }
  }

  return result;
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

async function startOAuth2AuthorizationCodeRedirect(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    targetKey: string;
    connectionConfig: Record<string, unknown>;
    controlPlaneBaseUrl: string;
    state: string;
    intent?: "create" | "reauthorize";
    connectionId?: string;
  },
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
      state: input.state,
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
    intent:
      input.intent === "reauthorize"
        ? IntegrationConnectionRedirectSessionIntents.REAUTHORIZE
        : IntegrationConnectionRedirectSessionIntents.CREATE,
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    state: input.state,
    pkceVerifierEncrypted,
    ...(providerStateEncrypted === undefined ? {} : { providerStateEncrypted }),
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist OAuth 2.0 (Authorization Code) redirect session state.",
  });

  return {
    authorizationUrl: startedOAuth2AuthorizationCodeConnection.authorizationUrl,
  };
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
  const state = encodeRedirectStateMetadata({
    state: createRedirectState(),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });

  return startOAuth2AuthorizationCodeRedirect(ctx, {
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    connectionConfig: input.connectionConfig ?? {},
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    state,
  });
}

export async function startOAuth2AuthorizationCodeConnectionReauthorization(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: StartOAuth2AuthorizationCodeConnectionReauthorizationInput,
): Promise<StartedOAuth2AuthorizationCodeConnection> {
  const existingConnection = await ctx.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (existingConnection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  await assertIdentityLinkingAuthEditableOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: existingConnection.id,
  });

  if (
    existingConnection.config?.["connection_method"] !==
    IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
      `Integration connection '${input.connectionId}' is not an OAuth 2.0 (Authorization Code) connection.`,
    );
  }

  const resolved = await resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      targetKey: existingConnection.targetKey,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
    },
  );

  if (resolved.connectionMethod.ui.reauthorize === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
      `Integration target '${existingConnection.targetKey}' does not support OAuth 2.0 (Authorization Code) reauthorization.`,
    );
  }

  return startOAuth2AuthorizationCodeRedirect(ctx, {
    organizationId: input.organizationId,
    targetKey: existingConnection.targetKey,
    connectionConfig: removeFrameworkConnectionConfigFields(existingConnection.config),
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    state: createRedirectState(),
    intent: "reauthorize",
    connectionId: existingConnection.id,
  });
}
