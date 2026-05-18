import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import { PtyTransportTokenRoles, mintPtyTransportToken } from "@mistle/gateway-tunnel-auth";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../errors.js";
import type { MintSandboxInstancePtySessionInput, SandboxInstancePtySession } from "./types.js";

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

export async function mintPtySession(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: MintSandboxInstancePtySessionInput,
): Promise<SandboxInstancePtySession> {
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

  const minted = await mintPtyTransportToken({
    config: input.tokenConfig,
    claims: {
      sub: sandboxInstance.id,
      organizationId: input.organizationId,
      ptySessionId: input.ptySessionId,
      role: PtyTransportTokenRoles.CLIENT,
      actingUserId: input.actingUserId,
    },
    ttlSeconds: input.tokenTtlSeconds,
  });

  return {
    instanceId: sandboxInstance.id,
    ptySessionId: input.ptySessionId,
    token: minted.token,
    expiresAt: minted.expiresAt.toISOString(),
  };
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
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot open PTY sessions.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot open PTY sessions: ${sandboxInstance.failureMessage}`;

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
