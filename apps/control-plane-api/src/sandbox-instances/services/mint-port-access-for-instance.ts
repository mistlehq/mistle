import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { PortAccessBootstrapTokenConfig } from "@mistle/port-access-auth";

import { mintPortAccess } from "./mint-port-access.js";

type Ctx = {
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  defaultPortAccess: {
    baseDomain: string;
    bootstrapPath: "/_mistle/access/bootstrap";
    tokenTtlSeconds: number;
    tokenConfig: PortAccessBootstrapTokenConfig;
  };
};

export async function mintPortAccessForInstance(
  { dataPlaneClient, defaultPortAccess }: Ctx,
  input: {
    organizationId: string;
    instanceId: string;
    port: number;
  },
) {
  return mintPortAccess(
    {
      dataPlaneClient,
    },
    {
      ...input,
      baseDomain: defaultPortAccess.baseDomain,
      bootstrapPath: defaultPortAccess.bootstrapPath,
      tokenTtlSeconds: defaultPortAccess.tokenTtlSeconds,
      tokenConfig: defaultPortAccess.tokenConfig,
    },
  );
}
