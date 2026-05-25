import type {
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { PtyTransportTokenConfig } from "@mistle/gateway-tunnel-auth";
import type { PortAccessBootstrapTokenConfig } from "@mistle/port-access-auth";
import type { Clock } from "@mistle/time";

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
  db: ControlPlaneDatabase;
  organizationId: string;
  instanceId: string;
  port: number;
  baseDomain: string;
  publicBaseUrl: string;
  linkPathBase: "/p/ports";
  linkTtlSeconds: number;
  createdBy: {
    kind: "agent" | "user";
    id: string;
  };
  clock: Clock;
};

export type SandboxInstancePortAccess = {
  host: string;
  url: string;
  expiresAt: string;
};

export type ResolveSandboxInstancePortAccessLinkInput = {
  db: ControlPlaneDatabase;
  organizationId: string;
  slug: string;
  baseDomain: string;
  gatewayWsUrl: string;
  bootstrapPath: "/_mistle/access/bootstrap";
  tokenTtlSeconds: number;
  tokenConfig: PortAccessBootstrapTokenConfig;
  clock: Clock;
};

export type SandboxInstancePortAccessRedirect = {
  bootstrapUrl: string;
};

export type MintSandboxInstancePtySessionInput = {
  organizationId: string;
  instanceId: string;
  ptySessionId: string;
  actingUserId: string;
  gatewayWebsocketUrl: string;
  tokenTtlSeconds: number;
  tokenConfig: PtyTransportTokenConfig;
};

export type SandboxInstancePtySession = {
  instanceId: string;
  ptySessionId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type SandboxInstanceTriggerConversation = {
  conversationId: string;
  routeId: string | null;
  providerConversationId: string | null;
};

export type SandboxInstanceStatus = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  title: string | null;
  status: NonNullable<GetSandboxInstanceResponse>["status"];
  connectable: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  runtimeContext: SandboxInstanceRuntimeContext | null;
  triggerConversation: SandboxInstanceTriggerConversation | null;
  startupOperation: NonNullable<GetSandboxInstanceResponse>["startupOperation"];
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
