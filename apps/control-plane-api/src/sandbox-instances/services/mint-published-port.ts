import { randomUUID } from "node:crypto";

import type { GetSandboxInstanceResponse } from "@mistle/data-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  derivePublishedPortHost,
  mintPublishedPortBootstrapToken,
} from "@mistle/published-port-auth";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../errors.js";
import type {
  MintSandboxInstancePublishedPortInput,
  SandboxInstancePublishedPort,
} from "./types.js";

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

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
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot be published.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot be published: ${sandboxInstance.failureMessage}`;

  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    failureMessage,
  );
}

function createInstanceNotPublishableError(
  sandboxInstance: Pick<ExistingSandboxInstance, "id" | "status">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' is '${sandboxInstance.status}' and is not publishable.`,
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

function createBootstrapUrl(input: {
  gatewayWebsocketUrl: string;
  host: string;
  token: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
  const bootstrapUrl = new URL("/_mistle/bootstrap", gatewayUrl);
  bootstrapUrl.protocol = gatewayUrl.protocol === "wss:" ? "https:" : "http:";
  bootstrapUrl.host = input.host;
  bootstrapUrl.searchParams.set("token", input.token);

  return bootstrapUrl.toString();
}

function createExpirationIso(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export async function mintPublishedPort(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: MintSandboxInstancePublishedPortInput,
): Promise<SandboxInstancePublishedPort> {
  const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance.status === "failed") {
    throw createInstanceFailedError(sandboxInstance);
  }

  if (!sandboxInstance.connectable) {
    throw createInstanceNotPublishableError(sandboxInstance);
  }

  const host = derivePublishedPortHost({
    config: {
      baseDomain: input.publishBaseDomain,
    },
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
  });
  const token = await mintPublishedPortBootstrapToken({
    config: input.tokenConfig,
    jti: `${sandboxInstance.id}-${String(input.port)}-${randomUUID()}`,
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
    host,
    ttlSeconds: input.tokenTtlSeconds,
  });

  return {
    host,
    bootstrapUrl: createBootstrapUrl({
      gatewayWebsocketUrl: input.gatewayWebsocketUrl,
      host,
      token,
    }),
    token,
    expiresAt: createExpirationIso(input.tokenTtlSeconds),
  };
}
