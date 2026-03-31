import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { mintPublishedTargetShareToken } from "@mistle/published-target-auth";

import type { ControlPlaneApiPublishedTargetConfig } from "../../types.js";
import {
  createExpirationIso,
  createPublishedTargetHost,
  createPublishedTargetTokenJti,
  getExistingSandboxInstanceOrThrow,
  resolvePublishedTargetOrigin,
} from "./published-target-helpers.js";

export async function createPortShareLinkForInstance(
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
  },
): Promise<{
  shareUrl: string;
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
  const token = await mintPublishedTargetShareToken({
    config: publishedTargetConfig.shareToken,
    host,
    jti: createPublishedTargetTokenJti(sandboxInstance.id),
    sandboxInstanceId: sandboxInstance.id,
    targetId: String(input.port),
    targetKind: "port",
    ttlSeconds: input.ttlSeconds,
  });
  const shareUrl = new URL(
    "/_mistle/share",
    resolvePublishedTargetOrigin(publishedTargetConfig, host),
  );
  shareUrl.searchParams.set("token", token);

  return {
    shareUrl: shareUrl.toString(),
    expiresAt: createExpirationIso(input.ttlSeconds),
  };
}
