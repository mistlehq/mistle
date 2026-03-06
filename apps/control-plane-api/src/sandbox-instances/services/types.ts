import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { DataPlaneSandboxInstanceStatuses } from "@mistle/data-plane-trpc/contracts";
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

export type SandboxInstanceStatus = {
  id: string;
  status: (typeof DataPlaneSandboxInstanceStatuses)[keyof typeof DataPlaneSandboxInstanceStatuses];
  failureCode: string | null;
  failureMessage: string | null;
};

export type SandboxInstancesService = {
  getInstance: (input: {
    organizationId: string;
    instanceId: string;
  }) => Promise<SandboxInstanceStatus>;
  mintConnectionToken: (
    input: MintSandboxInstanceConnectionTokenInput,
  ) => Promise<SandboxInstanceConnectionToken>;
  mintConnectionTokenForInstance: (input: {
    organizationId: string;
    instanceId: string;
  }) => Promise<SandboxInstanceConnectionToken>;
};
