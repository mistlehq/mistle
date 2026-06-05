import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import {
  encryptDeviceAuthorizationProviderStateUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../lib/crypto.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { assertIdentityLinkingAuthEditableOrThrow } from "./assert-identity-linking-auth-editable.js";
import { createPollAfterTimestamp } from "./device-authorization-timing.js";
import { resolveDeviceAuthorizationCapabilityTargetOrThrow } from "./resolve-device-authorization-capability-target.js";

export type StartDeviceAuthorizationConnectionInput = {
  organizationId: string;
  targetKey: string;
  methodId: string;
  displayName?: string;
};

export type StartDeviceAuthorizationConnectionReauthorizationInput = {
  organizationId: string;
  connectionId: string;
};

type StartedDeviceAuthorizationConnection = {
  attemptId: string;
  status: "pending";
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollAfterMs?: number;
};

async function persistDeviceAuthorizationAttempt(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  targetKey: string;
  connectionMethodId: string;
  connectionId?: string;
  displayName?: string;
  providerStateEncrypted: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollAfterAt: string | null;
}): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  const insertedRows = await input.db
    .insert(tables.integrationConnectionDeviceAuthorizationAttempts)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      connectionMethodId: input.connectionMethodId,
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      providerStateEncrypted: input.providerStateEncrypted,
      verificationUrl: input.verificationUrl,
      userCode: input.userCode,
      pollAfterAt: input.pollAfterAt,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    .returning({
      id: tables.integrationConnectionDeviceAuthorizationAttempts.id,
    });

  if (insertedRows[0] === undefined) {
    throw new Error("Failed to persist device authorization attempt.");
  }

  return insertedRows[0].id;
}

async function startDeviceAuthorizationAttempt(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: StartDeviceAuthorizationConnectionInput,
  reauthorizationInput?: {
    connectionId: string;
  },
): Promise<StartedDeviceAuthorizationConnection> {
  const resolved = await resolveDeviceAuthorizationCapabilityTargetOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      targetKey: input.targetKey,
      methodId: input.methodId,
      invalidInputCode: "INVALID_DEVICE_AUTH_START_INPUT",
    },
  );

  const startedAttempt = await resolved.deviceAuthorization.startDeviceAuthorization({
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    methodId: input.methodId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  });

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const providerStateEncrypted = encryptDeviceAuthorizationProviderStateUtf8({
    plaintext: JSON.stringify(startedAttempt.providerState),
    masterKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeyMaterial,
  });
  const pollAfterAt = createPollAfterTimestamp({
    pollAfterMs: startedAttempt.pollAfterMs,
  });

  const attemptId = await persistDeviceAuthorizationAttempt({
    db: ctx.db,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    connectionMethodId: resolved.connectionMethod.id,
    ...(reauthorizationInput === undefined
      ? {}
      : { connectionId: reauthorizationInput.connectionId }),
    providerStateEncrypted,
    verificationUrl: startedAttempt.verificationUrl,
    userCode: startedAttempt.userCode,
    pollAfterAt,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(startedAttempt.expiresAt === undefined ? {} : { expiresAt: startedAttempt.expiresAt }),
  });

  return {
    attemptId,
    status: "pending",
    verificationUrl: startedAttempt.verificationUrl,
    userCode: startedAttempt.userCode,
    ...(startedAttempt.expiresAt === undefined ? {} : { expiresAt: startedAttempt.expiresAt }),
    ...(startedAttempt.pollAfterMs === undefined
      ? {}
      : { pollAfterMs: startedAttempt.pollAfterMs }),
  };
}

export async function startDeviceAuthorizationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: StartDeviceAuthorizationConnectionInput,
): Promise<StartedDeviceAuthorizationConnection> {
  return startDeviceAuthorizationAttempt(ctx, input);
}

export async function startDeviceAuthorizationConnectionReauthorization(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: StartDeviceAuthorizationConnectionReauthorizationInput,
): Promise<StartedDeviceAuthorizationConnection> {
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

  const methodId = existingConnection.config?.["connection_method"];
  if (typeof methodId !== "string" || methodId.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_DEVICE_AUTH_START_INPUT,
      `Integration connection '${input.connectionId}' does not declare a device authorization connection method.`,
    );
  }

  const resolved = await resolveDeviceAuthorizationCapabilityTargetOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      targetKey: existingConnection.targetKey,
      methodId,
      invalidInputCode: "INVALID_DEVICE_AUTH_START_INPUT",
    },
  );

  if (resolved.connectionMethod.ui.reauthorize === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_NOT_SUPPORTED,
      `Integration target '${existingConnection.targetKey}' does not support device authorization reauthorization for connection method '${methodId}'.`,
    );
  }

  return startDeviceAuthorizationAttempt(
    ctx,
    {
      organizationId: input.organizationId,
      targetKey: existingConnection.targetKey,
      methodId,
    },
    {
      connectionId: existingConnection.id,
    },
  );
}
