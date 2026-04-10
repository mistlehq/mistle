import {
  integrationConnectionDeviceAuthorizationAttempts,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import {
  encryptDeviceAuthorizationProviderStateUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../lib/crypto.js";
import { createPollAfterTimestamp } from "./device-authorization-timing.js";
import { resolveDeviceAuthorizationCapabilityTargetOrThrow } from "./resolve-device-authorization-capability-target.js";

export type StartDeviceAuthorizationConnectionInput = {
  organizationId: string;
  targetKey: string;
  methodId: string;
  displayName?: string;
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
  displayName?: string;
  providerStateEncrypted: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollAfterAt: string | null;
}): Promise<string> {
  const insertedRows = await input.db
    .insert(integrationConnectionDeviceAuthorizationAttempts)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      connectionMethodId: input.connectionMethodId,
      providerStateEncrypted: input.providerStateEncrypted,
      verificationUrl: input.verificationUrl,
      userCode: input.userCode,
      pollAfterAt: input.pollAfterAt,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    .returning({
      id: integrationConnectionDeviceAuthorizationAttempts.id,
    });

  if (insertedRows[0] === undefined) {
    throw new Error("Failed to persist device authorization attempt.");
  }

  return insertedRows[0].id;
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
