import { randomUUID } from "node:crypto";

import type { GetSandboxInstanceResponse } from "@mistle/data-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { mintConnectionToken as mintGatewayConnectionToken } from "@mistle/gateway-connection-auth";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../errors.js";
import { refreshEgressGrantsForConnectableSandbox } from "./refresh-egress-grants-for-connectable-sandbox.js";
import type {
  MintSandboxInstanceConnectionTokenInput,
  SandboxInstanceConnectionToken,
} from "./types.js";

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

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

function createInstanceFailedError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "failureMessage">,
): SandboxInstancesConflictError {
  const failureMessage =
    sandboxInstance.failureMessage === null
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot be connected: ${sandboxInstance.failureMessage}`;

  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    failureMessage,
  );
}

function createInstanceNotConnectableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "status">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' is '${sandboxInstance.status}' and is not connectable.`,
  );
}

async function getExistingSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<ExistingSandboxInstance> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw createSandboxInstanceNotFoundError(input.instanceId);
  }

  return sandboxInstance;
}

export async function mintConnectionToken(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "refreshSandboxEgressGrants"
    >;
  },
  input: MintSandboxInstanceConnectionTokenInput,
): Promise<SandboxInstanceConnectionToken> {
  const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance.status === "failed") {
    throw createInstanceFailedError(sandboxInstance);
  }

  if (!sandboxInstance.connectable) {
    throw createInstanceNotConnectableError(sandboxInstance);
  }

  await refreshEgressGrantsForConnectableSandbox(dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstance,
  });

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
      sandboxInstanceId: sandboxInstance.id,
      token,
    }),
    token,
    expiresAt: createExpirationIso(input.tokenTtlSeconds),
  };
}
