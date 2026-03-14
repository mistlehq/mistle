import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";

export type RelayPeerSide = "bootstrap" | "connection";

export type LocalPeerDescriptor = {
  sandboxInstanceId: string;
  side: RelayPeerSide;
};

export type SessionPeerDescriptor = LocalPeerDescriptor & {
  sessionId: string;
};

export type RelayTarget = LocalPeerDescriptor & {
  nodeId: string;
  sessionId: string;
};

export type RelayPeerSocket = WSContext<WebSocket>;

export type RelayPayload = string | ArrayBuffer;

export type RelayFrameEnvelope = {
  kind: "frame";
  target: RelayTarget;
  payload: RelayPayload;
};

export type RelayCloseEnvelope = {
  kind: "close";
  target: RelayTarget;
  closeCode: number;
  closeReason: string;
};

export type RelayEnvelope = RelayFrameEnvelope | RelayCloseEnvelope;
