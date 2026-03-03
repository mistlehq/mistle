import { randomUUID } from "node:crypto";

import {
  DataPlaneSandboxInstanceStatuses,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-trpc";
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

function createConnectionUrl(input: { gatewayWebsocketUrl: string; token: string }): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
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

export async function mintConnectionToken(
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: MintSandboxInstanceConnectionTokenInput,
): Promise<SandboxInstanceConnectionToken> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  if (sandboxInstance.status !== DataPlaneSandboxInstanceStatuses.RUNNING) {
    throw new SandboxInstancesConflictError(
      SandboxInstancesConflictCodes.INSTANCE_NOT_RUNNING,
      `Sandbox instance '${sandboxInstance.id}' is not running.`,
    );
  }

  const token = await mintGatewayConnectionToken({
    config: input.tokenConfig,
    jti: createTokenJti(sandboxInstance.id),
    sandboxInstanceId: sandboxInstance.id,
    ttlSeconds: input.tokenTtlSeconds,
  });

  return {
    instanceId: sandboxInstance.id,
    url: createConnectionUrl({
      gatewayWebsocketUrl: input.gatewayWebsocketUrl,
      token,
    }),
    token,
    expiresAt: createExpirationIso(input.tokenTtlSeconds),
  };
}
