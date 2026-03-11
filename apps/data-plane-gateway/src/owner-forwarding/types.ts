import type { WSEvents } from "hono/ws";
import type { WebSocket } from "ws";

export type GatewayForwardingIdentity = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type GatewayHttpForwardRequest = GatewayForwardingIdentity & {
  pathSuffix: string;
  request: Request;
};

export type GatewayWebSocketForwardRequest = GatewayForwardingIdentity & {
  requestUrl: URL;
  sandboxInstanceId: string;
};

export interface GatewayHttpForwarder {
  forwardRequest(input: GatewayHttpForwardRequest): Promise<Response>;
}

export interface GatewayWebSocketForwarder {
  createEvents(input: GatewayWebSocketForwardRequest): WSEvents<WebSocket>;
}
