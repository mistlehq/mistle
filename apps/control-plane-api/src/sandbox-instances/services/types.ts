import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";

export type CreateSandboxInstancesServiceInput = {
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  defaultConnectionToken: {
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: ConnectionTokenConfig;
  };
};

export type MintSandboxInstanceConnectionTokenInput = {
  organizationId: string;
  instanceId: string;
  gatewayWebsocketUrl: string;
  tokenTtlSeconds: number;
  tokenConfig: ConnectionTokenConfig;
};

export type SandboxInstanceConnectionToken = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type SandboxInstancesService = {
  mintConnectionToken: (
    input: MintSandboxInstanceConnectionTokenInput,
  ) => Promise<SandboxInstanceConnectionToken>;
  mintConnectionTokenForInstance: (input: {
    organizationId: string;
    instanceId: string;
  }) => Promise<SandboxInstanceConnectionToken>;
};
