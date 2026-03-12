import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
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
  status: NonNullable<GetSandboxInstanceResponse>["status"];
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
