import type { WebSocket } from "ws";

export type RelayPeerSide = "bootstrap" | "connection" | "ptyClient" | "ptySandbox";

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

export type RelayPeerSocket = {
  readonly raw?: WebSocket;
  readonly readyState: number;
  close: (code?: number, reason?: string) => void;
  send: (payload: string | ArrayBuffer) => void;
};

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
