import { SpanStatusCode, type Attributes } from "@opentelemetry/api";

import type { RelayPeerSide } from "./types.js";

type TunnelTokenKind = "bootstrap" | "connection";

const NormalCloseCodes = new Set([1000, 1001]);
const NoStatusReceivedCloseCode = 1005;
const ReplacedCloseReason = "Replaced by newer sandbox tunnel connection.";
const PeerDisconnectedCloseReason = "Sandbox tunnel peer disconnected.";

export function getSandboxTunnelSessionSpanName(input: { peerSide: RelayPeerSide }): string {
  return input.peerSide === "bootstrap"
    ? "data_plane_gateway.sandbox_tunnel.bootstrap_session"
    : "data_plane_gateway.sandbox_tunnel.connection_session";
}

export function getSandboxTunnelSessionAttributes(input: {
  sandboxInstanceId: string;
  peerSide: RelayPeerSide;
  tokenKind: TunnelTokenKind;
}): Attributes {
  return {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.tunnel.peer_side": input.peerSide,
    "mistle.sandbox.tunnel.token_kind": input.tokenKind,
  };
}

export function classifySandboxTunnelClose(input: { closeCode: number; closeReason: string }): {
  outcome: "normal" | "replaced" | "peer_disconnected" | "error";
  logLevel: "debug" | "warn";
  spanStatusCode: SpanStatusCode;
  spanStatusMessage?: string;
} {
  if (NormalCloseCodes.has(input.closeCode)) {
    return {
      outcome: "normal",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeReason === ReplacedCloseReason) {
    return {
      outcome: "replaced",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeReason === PeerDisconnectedCloseReason) {
    return {
      outcome: "peer_disconnected",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeCode === NoStatusReceivedCloseCode && input.closeReason.length === 0) {
    return {
      outcome: "peer_disconnected",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  return {
    outcome: "error",
    logLevel: "warn",
    spanStatusCode: SpanStatusCode.ERROR,
    spanStatusMessage:
      input.closeReason.length > 0
        ? input.closeReason
        : `Sandbox tunnel websocket closed with code ${String(input.closeCode)}.`,
  };
}
