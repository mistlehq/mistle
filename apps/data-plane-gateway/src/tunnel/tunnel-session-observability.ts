import { SpanStatusCode, type Span } from "@opentelemetry/api";

import { logger } from "../logger.js";
import {
  classifySandboxTunnelClose,
  getSandboxTunnelDeliveryCorrelationScope,
} from "./telemetry.js";
import type { RelayPeerSide } from "./types.js";

type TokenKind = "bootstrap" | "connection";

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(`Unexpected non-Error throwable: ${String(error)}`);
}

/**
 * Records a tunnel-session failure against the active session span.
 */
export function recordTunnelSessionError(input: {
  tunnelSessionSpan: Span | undefined;
  error: unknown;
  statusMessage: string;
}): void {
  if (input.tunnelSessionSpan === undefined) {
    return;
  }

  input.tunnelSessionSpan.recordException(normalizeError(input.error));
  input.tunnelSessionSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: input.statusMessage,
  });
}

/**
 * Logs and finalizes span attributes for a websocket tunnel session close event.
 */
export function finalizeTunnelSession(input: {
  closeCode: number;
  closeReason: string;
  openedAtMs: number | undefined;
  peerSide: RelayPeerSide;
  relaySessionId: string;
  sandboxInstanceId: string;
  tokenKind: TokenKind;
  tokenJti?: string;
  tunnelSessionSpan: Span | undefined;
}): void {
  const closeClassification = classifySandboxTunnelClose({
    closeCode: input.closeCode,
    closeReason: input.closeReason,
  });
  const deliveryCorrelationScope = getSandboxTunnelDeliveryCorrelationScope({
    tokenKind: input.tokenKind,
  });
  const durationMs = input.openedAtMs === undefined ? undefined : Date.now() - input.openedAtMs;
  const logData = {
    eventName: closeClassification.eventName,
    closeCode: input.closeCode,
    closeOutcome: closeClassification.outcome,
    closeReason: input.closeReason,
    durationMs,
    "mistle.delivery.correlation_scope": deliveryCorrelationScope,
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.tunnel.peer_side": input.peerSide,
    "mistle.sandbox.tunnel.token_kind": input.tokenKind,
    "mistle.tunnel.relay_session_id": input.relaySessionId,
    ...(deliveryCorrelationScope !== "join_via_connection_token_jti" || input.tokenJti === undefined
      ? {}
      : {
          "mistle.connection.token_jti": input.tokenJti,
        }),
  };
  const expectedClose = closeClassification.logLevel !== "warn";
  const logMessage =
    input.tokenKind === "bootstrap"
      ? expectedClose
        ? "Sandbox bootstrap tunnel disconnected"
        : "Sandbox bootstrap tunnel disconnected unexpectedly"
      : expectedClose
        ? "Sandbox connection peer detached"
        : "Sandbox connection peer detached unexpectedly";

  if (closeClassification.logLevel === "debug") {
    logger.debug(logData, logMessage);
  } else {
    logger.warn(logData, logMessage);
  }

  if (input.tunnelSessionSpan === undefined) {
    return;
  }

  input.tunnelSessionSpan.setAttributes({
    "mistle.sandbox.tunnel.close_code": input.closeCode,
    "mistle.sandbox.tunnel.close_outcome": closeClassification.outcome,
    "mistle.sandbox.tunnel.close_reason": input.closeReason,
    "mistle.delivery.correlation_scope": deliveryCorrelationScope,
    "mistle.tunnel.relay_session_id": input.relaySessionId,
    ...(deliveryCorrelationScope !== "join_via_connection_token_jti" || input.tokenJti === undefined
      ? {}
      : {
          "mistle.connection.token_jti": input.tokenJti,
        }),
    ...(durationMs === undefined
      ? {}
      : {
          "mistle.sandbox.tunnel.duration_ms": durationMs,
        }),
  });
  if (closeClassification.spanStatusCode === SpanStatusCode.ERROR) {
    const statusMessage =
      closeClassification.spanStatusMessage ??
      `Sandbox tunnel websocket closed with code ${String(input.closeCode)}.`;
    input.tunnelSessionSpan.setStatus({
      code: closeClassification.spanStatusCode,
      message: statusMessage,
    });
  }
  input.tunnelSessionSpan.end();
}
