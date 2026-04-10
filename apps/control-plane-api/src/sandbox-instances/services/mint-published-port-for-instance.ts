import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { PublishedPortBootstrapTokenConfig } from "@mistle/published-port-auth";

import { mintPublishedPort } from "./mint-published-port.js";

type Ctx = {
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  defaultPublishedPort: {
    gatewayWebsocketUrl: string;
    publishBaseDomain: string;
    tokenTtlSeconds: number;
    tokenConfig: PublishedPortBootstrapTokenConfig;
  };
};

export async function mintPublishedPortForInstance(
  { dataPlaneClient, defaultPublishedPort }: Ctx,
  input: {
    organizationId: string;
    instanceId: string;
    port: number;
  },
) {
  return mintPublishedPort(
    {
      dataPlaneClient,
    },
    {
      ...input,
      gatewayWebsocketUrl: defaultPublishedPort.gatewayWebsocketUrl,
      publishBaseDomain: defaultPublishedPort.publishBaseDomain,
      tokenTtlSeconds: defaultPublishedPort.tokenTtlSeconds,
      tokenConfig: defaultPublishedPort.tokenConfig,
    },
  );
}
