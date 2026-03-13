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
      }),
    ).toEqual({
      "mistle.sandbox.instance_id": "sbi_test",
      "mistle.sandbox.tunnel.peer_side": "bootstrap",
      "mistle.sandbox.tunnel.token_kind": "bootstrap",
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
      outcome: "replaced",
      logLevel: "info",
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
      outcome: "error",
      logLevel: "warn",
      spanStatusCode: SpanStatusCode.ERROR,
      spanStatusMessage: "Sandbox ownership lease could not be renewed.",
    });
  });
});
