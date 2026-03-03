import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";

export type TunnelPeerSide = "bootstrap" | "connection";

export type TunnelPeerDescriptor = {
  instanceId: string;
  side: TunnelPeerSide;
};

export type TunnelPeerLocation = TunnelPeerDescriptor & {
  nodeId: string;
  sessionId: string;
};

export type TunnelPeerSocket = WSContext<WebSocket>;

export type TunnelFramePayload = string | ArrayBuffer;
