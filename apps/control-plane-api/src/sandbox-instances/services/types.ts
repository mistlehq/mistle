import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
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

export type ListSandboxInstancesResult = ListSandboxInstancesResponse;

export type SandboxInstancesService = {
  listInstances: (input: {
    organizationId: string;
    limit?: number;
    after?: string;
    before?: string;
  }) => Promise<ListSandboxInstancesResult>;
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
