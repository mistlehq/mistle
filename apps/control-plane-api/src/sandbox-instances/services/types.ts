import type {
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { PortAccessBootstrapTokenConfig } from "@mistle/port-access-auth";

import type { SandboxInstanceRuntimeContext } from "./runtime-context.js";

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

export type MintSandboxInstancePortAccessInput = {
  organizationId: string;
  instanceId: string;
  port: number;
  baseDomain: string;
  gatewayWsUrl: string;
  bootstrapPath: "/_mistle/access/bootstrap";
  tokenTtlSeconds: number;
  tokenConfig: PortAccessBootstrapTokenConfig;
};

export type SandboxInstancePortAccess = {
  host: string;
  bootstrapPath: "/_mistle/access/bootstrap";
  bootstrapUrl: string;
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
  title: string | null;
  status: NonNullable<GetSandboxInstanceResponse>["status"];
  connectable: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  runtimeContext: SandboxInstanceRuntimeContext | null;
  automationConversation: SandboxInstanceAutomationConversation | null;
};

export type ListSandboxInstancesResult = Omit<ListSandboxInstancesResponse, "items"> & {
  items: Array<
    Omit<ListSandboxInstancesResponse["items"][number], "source" | "startedBy"> & {
      source: "dashboard" | "webhook" | "schedule";
      title: string | null;
      sandboxProfileDisplayName: string | null;
      startedBy: ListSandboxInstancesResponse["items"][number]["startedBy"] & {
        name: string | null;
      };
    }
  >;
};
