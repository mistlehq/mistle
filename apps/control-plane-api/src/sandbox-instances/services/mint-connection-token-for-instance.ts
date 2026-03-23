import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";

import { mintConnectionToken } from "./mint-connection-token.js";

type Ctx = {
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "resumeSandboxInstance"
  >;
  defaultConnectionToken: {
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: ConnectionTokenConfig;
  };
};

export async function mintConnectionTokenForInstance(
  { dataPlaneClient, defaultConnectionToken }: Ctx,
  input: {
    organizationId: string;
    instanceId: string;
  },
) {
  return mintConnectionToken(
    {
      dataPlaneClient,
    },
    {
      ...input,
      gatewayWebsocketUrl: defaultConnectionToken.gatewayWebsocketUrl,
      tokenTtlSeconds: defaultConnectionToken.tokenTtlSeconds,
      tokenConfig: defaultConnectionToken.tokenConfig,
    },
  );
}
