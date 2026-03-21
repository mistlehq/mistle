import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";

export type CreateSandboxInstancesServiceInput = {
  db: ControlPlaneDatabase;
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

export type SandboxInstanceAutomationConversation = {
  conversationId: string;
  routeId: string | null;
  providerConversationId: string | null;
};

export type SandboxInstanceStatus = {
  id: string;
  status: NonNullable<GetSandboxInstanceResponse>["status"];
  failureCode: string | null;
  failureMessage: string | null;
  automationConversation: SandboxInstanceAutomationConversation | null;
};

export type ListSandboxInstancesResult = Omit<ListSandboxInstancesResponse, "items"> & {
  items: Array<
    ListSandboxInstancesResponse["items"][number] & {
      startedBy: ListSandboxInstancesResponse["items"][number]["startedBy"] & {
        name: string | null;
      };
    }
  >;
};

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
