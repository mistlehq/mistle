import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import {
  classifySandboxTunnelClose,
  getSandboxTunnelSessionAttributes,
  getSandboxTunnelSessionSpanName,
} from "./telemetry.js";

describe("tunnel session telemetry", () => {
  it("builds tunnel session attributes for a bootstrap peer", () => {
    expect(
      getSandboxTunnelSessionAttributes({
        sandboxInstanceId: "sbi_test",
        peerSide: "bootstrap",
        tokenKind: "bootstrap",
        relaySessionId: "dts_test",
        tokenJti: "token_jti_test",
      }),
    ).toEqual({
      "mistle.delivery.correlation_scope": "transport_only",
      "mistle.sandbox.instance_id": "sbi_test",
      "mistle.sandbox.tunnel.peer_side": "bootstrap",
      "mistle.sandbox.tunnel.token_kind": "bootstrap",
      "mistle.tunnel.relay_session_id": "dts_test",
    });
  });

  it("includes connection token JTI for delivery-correlatable connection peers", () => {
    expect(
      getSandboxTunnelSessionAttributes({
        sandboxInstanceId: "sbi_test",
        peerSide: "connection",
        tokenKind: "connection",
        relaySessionId: "dts_test",
        tokenJti: "token_jti_test",
      }),
    ).toEqual({
      "mistle.connection.token_jti": "token_jti_test",
      "mistle.delivery.correlation_scope": "join_via_connection_token_jti",
      "mistle.sandbox.instance_id": "sbi_test",
      "mistle.sandbox.tunnel.peer_side": "connection",
      "mistle.sandbox.tunnel.token_kind": "connection",
      "mistle.tunnel.relay_session_id": "dts_test",
    });
  });

  it("uses a distinct span name for connection peers", () => {
    expect(
      getSandboxTunnelSessionSpanName({
        peerSide: "connection",
      }),
    ).toBe("data_plane_gateway.sandbox_tunnel.connection_session");
  });

  it("treats replacement closures as expected tunnel lifecycle events", () => {
    expect(
      classifySandboxTunnelClose({
        closeCode: 1012,
        closeReason: "Replaced by newer sandbox tunnel connection.",
      }),
    ).toEqual({
      eventName: "gateway.tunnel.closed",
      outcome: "replaced",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    });
  });

  it("downgrades closes without a status frame to low-signal peer disconnects", () => {
    expect(
      classifySandboxTunnelClose({
        closeCode: 1005,
        closeReason: "",
      }),
    ).toEqual({
      eventName: "gateway.tunnel.closed",
      outcome: "peer_disconnected",
      logLevel: "debug",
      spanStatusCode: SpanStatusCode.UNSET,
    });
  });

  it("marks unexpected internal-error closes as span errors", () => {
    expect(
      classifySandboxTunnelClose({
        closeCode: 1011,
        closeReason: "Sandbox ownership lease could not be renewed.",
      }),
    ).toEqual({
      eventName: "gateway.tunnel.reset",
      outcome: "error",
      logLevel: "warn",
      spanStatusCode: SpanStatusCode.ERROR,
      spanStatusMessage: "Sandbox ownership lease could not be renewed.",
    });
  });
});
