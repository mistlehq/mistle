import { randomUUID } from "node:crypto";

import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { derivePublishedTargetHost } from "@mistle/published-target-auth";

import type { ControlPlaneApiPublishedTargetConfig } from "../../types.js";
import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

function createSandboxInstanceNotFoundError(instanceId: string): SandboxInstancesNotFoundError {
  return new SandboxInstancesNotFoundError(
    SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
    `Sandbox instance '${instanceId}' was not found.`,
  );
}

export async function getExistingSandboxInstanceOrThrow(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<{ id: string }> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw createSandboxInstanceNotFoundError(input.instanceId);
  }

  return {
    id: sandboxInstance.id,
  };
}

export function resolvePublishedTargetOrigin(
  config: ControlPlaneApiPublishedTargetConfig,
  host: string,
): string {
  const protocol = config.environment === "development" ? "http" : "https";
  return `${protocol}://${host}`;
}

export function createPublishedTargetHost(input: {
  config: ControlPlaneApiPublishedTargetConfig;
  sandboxInstanceId: string;
  port: number;
}): string {
  return derivePublishedTargetHost({
    baseDomain: input.config.baseDomain,
    sandboxInstanceId: input.sandboxInstanceId,
    target: {
      kind: "port",
      port: input.port,
    },
  });
}

export function createExpirationIso(ttlSeconds: number): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("ttlSeconds must be an integer greater than or equal to 1.");
  }

  const expiresAtEpochMilliseconds = Date.now() + ttlSeconds * 1000;
  return new Date(expiresAtEpochMilliseconds).toISOString();
}

export function createPublishedTargetTokenJti(instanceId: string): string {
  return `${instanceId}-${randomUUID()}`;
}
