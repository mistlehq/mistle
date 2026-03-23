import { randomUUID } from "node:crypto";

import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import { mintConnectionToken as mintGatewayConnectionToken } from "@mistle/gateway-connection-auth";
import { systemClock, systemSleeper } from "@mistle/time";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../../../sandbox-instances/errors.js";

const ConnectionWaitTimeoutMs = 30_000;
const ConnectionWaitPollIntervalMs = 250;

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

function createInstanceNotResumableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' did not become running before the connect wait timed out.`,
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

async function waitForRunningSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<ExistingSandboxInstance> {
  const deadlineMs = systemClock.nowMs() + ConnectionWaitTimeoutMs;

  while (true) {
    const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, input);

    if (sandboxInstance.status === "running") {
      return sandboxInstance;
    }

    if (sandboxInstance.status === "failed") {
      throw createInstanceFailedError(sandboxInstance);
    }

    const remainingMs = deadlineMs - systemClock.nowMs();
    if (remainingMs <= 0) {
      throw createInstanceNotResumableError(sandboxInstance);
    }

    await systemSleeper.sleep(Math.min(remainingMs, ConnectionWaitPollIntervalMs));
  }
}

export async function mintConnectionToken(
  {
    dataPlaneClient,
    gatewayWebsocketUrl,
    tokenTtlSeconds,
    tokenConfig,
  }: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "resumeSandboxInstance"
    >;
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: ConnectionTokenConfig;
  },
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<{
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
}> {
  let sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance.status === "failed") {
    throw createInstanceFailedError(sandboxInstance);
  }

  if (sandboxInstance.status === "starting") {
    sandboxInstance = await waitForRunningSandboxInstance(dataPlaneClient, {
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    });
  } else if (sandboxInstance.status === "stopped") {
    await dataPlaneClient.resumeSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    });
    sandboxInstance = await waitForRunningSandboxInstance(dataPlaneClient, {
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    });
  }

  const token = await mintGatewayConnectionToken({
    config: tokenConfig,
    jti: createTokenJti(sandboxInstance.id),
    sandboxInstanceId: sandboxInstance.id,
    ttlSeconds: tokenTtlSeconds,
  });

  return {
    instanceId: sandboxInstance.id,
    url: createConnectionUrl({
      gatewayWebsocketUrl,
      sandboxInstanceId: sandboxInstance.id,
      token,
    }),
    token,
    expiresAt: createExpirationIso(tokenTtlSeconds),
  };
}
