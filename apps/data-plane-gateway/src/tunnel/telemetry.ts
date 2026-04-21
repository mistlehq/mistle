import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

import type { RelayPeerSide } from "./types.js";

type TunnelTokenKind = "bootstrap" | "connection";
export type TunnelDeliveryCorrelationScope = "join_via_connection_token_jti" | "transport_only";

const NormalCloseCodes = new Set([1000, 1001]);
const NoStatusReceivedCloseCode = 1005;
const ReplacedCloseReason = "Replaced by newer sandbox tunnel connection.";
const PeerDisconnectedCloseReason = "Sandbox tunnel peer disconnected.";
const TunnelLifecycleTracer = trace.getTracer("@mistle/data-plane-gateway");

export function getSandboxTunnelSessionSpanName(input: { peerSide: RelayPeerSide }): string {
  return input.peerSide === "bootstrap"
    ? "data_plane_gateway.sandbox_tunnel.bootstrap_session"
    : "data_plane_gateway.sandbox_tunnel.connection_session";
}

export function getSandboxTunnelDeliveryCorrelationScope(input: {
  tokenKind: TunnelTokenKind;
}): TunnelDeliveryCorrelationScope {
  return input.tokenKind === "connection" ? "join_via_connection_token_jti" : "transport_only";
}

export function getSandboxTunnelSessionAttributes(input: {
  sandboxInstanceId: string;
  peerSide: RelayPeerSide;
  tokenKind: TunnelTokenKind;
  relaySessionId: string;
  tokenJti?: string;
}): Attributes {
  const correlationScope = getSandboxTunnelDeliveryCorrelationScope({
    tokenKind: input.tokenKind,
  });
  return {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.tunnel.peer_side": input.peerSide,
    "mistle.sandbox.tunnel.token_kind": input.tokenKind,
    "mistle.tunnel.relay_session_id": input.relaySessionId,
    "mistle.delivery.correlation_scope": correlationScope,
    ...(correlationScope !== "join_via_connection_token_jti" || input.tokenJti === undefined
      ? {}
      : {
          "mistle.connection.token_jti": input.tokenJti,
        }),
  };
}

export function startSandboxTunnelSessionSpan(input: {
  sandboxInstanceId: string;
  peerSide: RelayPeerSide;
  tokenKind: TunnelTokenKind;
  relaySessionId: string;
  tokenJti?: string;
}): Span {
  return TunnelLifecycleTracer.startSpan(getSandboxTunnelSessionSpanName(input), {
    attributes: getSandboxTunnelSessionAttributes(input),
  });
}

export function classifySandboxTunnelClose(input: { closeCode: number; closeReason: string }): {
  eventName: "gateway.tunnel.closed" | "gateway.tunnel.reset";
  outcome: "normal" | "replaced" | "peer_disconnected" | "error";
  logLevel: "debug" | "warn";
  spanStatusCode: SpanStatusCode;
  spanStatusMessage?: string;
} {
  if (NormalCloseCodes.has(input.closeCode)) {
    return {
      eventName: "gateway.tunnel.closed",
      outcome: "normal",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeReason === ReplacedCloseReason) {
    return {
      eventName: "gateway.tunnel.closed",
      outcome: "replaced",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeReason === PeerDisconnectedCloseReason) {
    return {
      eventName: "gateway.tunnel.closed",
      outcome: "peer_disconnected",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  if (input.closeCode === NoStatusReceivedCloseCode && input.closeReason.length === 0) {
    return {
      eventName: "gateway.tunnel.closed",
      outcome: "peer_disconnected",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    };
  }

  return {
    eventName: "gateway.tunnel.reset",
    outcome: "error",
    logLevel: "warn",
    spanStatusCode: SpanStatusCode.ERROR,
    spanStatusMessage:
      input.closeReason.length > 0
        ? input.closeReason
        : `Sandbox tunnel websocket closed with code ${String(input.closeCode)}.`,
  };
}
