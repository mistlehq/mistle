import type { GetSandboxInstanceResponse } from "@mistle/data-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { derivePortAccessHost, mintPortAccessBootstrapToken } from "@mistle/port-access-auth";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";
import type { MintSandboxInstancePortAccessInput, SandboxInstancePortAccess } from "./types.js";

type ExistingSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

function createExpirationIsoFromToken(token: string): string {
  const [, payloadSegment] = token.split(".");
  if (payloadSegment === undefined) {
    throw new Error("Port Access bootstrap token is malformed.");
  }

  const payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf8");
  const payload: unknown = JSON.parse(payloadJson);
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Port Access bootstrap token payload must be an object.");
  }

  const expiresAtSeconds = Object.getOwnPropertyDescriptor(payload, "exp")?.value;
  if (!Number.isInteger(expiresAtSeconds) || expiresAtSeconds < 1) {
    throw new Error("Port Access bootstrap token payload is missing a valid exp claim.");
  }

  return new Date(expiresAtSeconds * 1000).toISOString();
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
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return sandboxInstance;
}

export async function mintPortAccess(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: MintSandboxInstancePortAccessInput,
): Promise<SandboxInstancePortAccess> {
  const sandboxInstance = await getExistingSandboxInstance(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  const host = derivePortAccessHost({
    config: {
      baseDomain: input.baseDomain,
    },
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
  });
  const token = await mintPortAccessBootstrapToken({
    config: input.tokenConfig,
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
    host,
    ttlSeconds: input.tokenTtlSeconds,
  });

  return {
    host,
    bootstrapPath: input.bootstrapPath,
    token,
    expiresAt: createExpirationIsoFromToken(token),
  };
}
