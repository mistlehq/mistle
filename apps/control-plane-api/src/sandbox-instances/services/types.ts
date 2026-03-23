import type {
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";

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
