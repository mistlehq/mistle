import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { mintPublishedTargetAccessToken } from "@mistle/published-target-auth";

import type { ControlPlaneApiPublishedTargetConfig } from "../../types.js";
import {
  createExpirationIso,
  createPublishedTargetHost,
  createPublishedTargetTokenJti,
  getExistingSandboxInstanceOrThrow,
} from "./published-target-helpers.js";

export async function mintPortPublishTokenForInstance(
  {
    dataPlaneClient,
    publishedTargetConfig,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    publishedTargetConfig: ControlPlaneApiPublishedTargetConfig;
  },
  input: {
    organizationId: string;
    instanceId: string;
    port: number;
    ttlSeconds: number;
    userId: string;
  },
): Promise<{
  host: string;
  token: string;
  expiresAt: string;
}> {
  const sandboxInstance = await getExistingSandboxInstanceOrThrow(dataPlaneClient, {
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });
  const host = createPublishedTargetHost({
    config: publishedTargetConfig,
    sandboxInstanceId: sandboxInstance.id,
    port: input.port,
  });
  const token = await mintPublishedTargetAccessToken({
    config: publishedTargetConfig.accessToken,
    host,
    jti: createPublishedTargetTokenJti(sandboxInstance.id),
    organizationId: input.organizationId,
    sandboxInstanceId: sandboxInstance.id,
    targetId: String(input.port),
    targetKind: "port",
    ttlSeconds: input.ttlSeconds,
    userId: input.userId,
  });

  return {
    host,
    token,
    expiresAt: createExpirationIso(input.ttlSeconds),
  };
}
