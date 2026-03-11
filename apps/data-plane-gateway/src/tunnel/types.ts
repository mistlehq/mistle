import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";

export type RelayPeerSide = "bootstrap" | "connection";

export type LocalPeerDescriptor = {
  sandboxInstanceId: string;
  side: RelayPeerSide;
};

export type RelayTarget = LocalPeerDescriptor & {
  nodeId: string;
  sessionId: string;
};

export type RelayPeerSocket = WSContext<WebSocket>;

export type RelayPayload = string | ArrayBuffer;
