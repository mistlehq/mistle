import { randomUUID } from "node:crypto";

import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { mintConnectionToken as mintGatewayConnectionToken } from "@mistle/gateway-connection-auth";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "./errors.js";
import type {
  MintSandboxInstanceConnectionTokenInput,
  SandboxInstanceConnectionToken,
} from "./types.js";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function createConnectionUrl(input: {
  gatewayWebsocketUrl: string;
  sandboxInstanceId: string;
  token: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
  gatewayUrl.pathname = `${trimTrailingSlash(gatewayUrl.pathname)}/${encodeURIComponent(input.sandboxInstanceId)}`;
  gatewayUrl.searchParams.set("connect_token", input.token);

  return gatewayUrl.toString();
}

function createExpirationIso(ttlSeconds: number): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Connection token ttlSeconds must be an integer greater than or equal to 1.");
  }

  const expiresAtEpochMilliseconds = Date.now() + ttlSeconds * 1000;
  return new Date(expiresAtEpochMilliseconds).toISOString();
}

function createTokenJti(instanceId: string): string {
  return `${instanceId}-${randomUUID()}`;
}

function createSandboxInstanceNotFoundError(instanceId: string): SandboxInstancesNotFoundError {
  return new SandboxInstancesNotFoundError(
    SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
    `Sandbox instance '${instanceId}' was not found.`,
  );
}

function createInstanceFailedError(input: {
  instanceId: string;
  message: string | null;
}): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    input.message ?? `Sandbox instance '${input.instanceId}' failed and cannot be connected.`,
  );
}

function createInstanceNotResumableError(input: {
  instanceId: string;
  message: string | null;
}): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    input.message ??
      `Sandbox instance '${input.instanceId}' is not connectable yet and cannot mint a connection token.`,
  );
}

export async function mintConnectionToken(
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: MintSandboxInstanceConnectionTokenInput,
): Promise<SandboxInstanceConnectionToken> {
  const connectStatus = await dataPlaneClient.getSandboxConnectStatus({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (connectStatus === null) {
    throw createSandboxInstanceNotFoundError(input.instanceId);
  }

  if (connectStatus.status === "failed") {
    throw createInstanceFailedError({
      instanceId: connectStatus.instanceId,
      message: connectStatus.message,
    });
  }

  if (connectStatus.status !== "ready") {
    throw createInstanceNotResumableError({
      instanceId: connectStatus.instanceId,
      message: connectStatus.message,
    });
  }

  const token = await mintGatewayConnectionToken({
    config: input.tokenConfig,
    jti: createTokenJti(connectStatus.instanceId),
    sandboxInstanceId: connectStatus.instanceId,
    ttlSeconds: input.tokenTtlSeconds,
  });

  return {
    instanceId: connectStatus.instanceId,
    url: createConnectionUrl({
      gatewayWebsocketUrl: input.gatewayWebsocketUrl,
      sandboxInstanceId: connectStatus.instanceId,
      token,
    }),
    token,
    expiresAt: createExpirationIso(input.tokenTtlSeconds),
  };
}
