import { describe, expect, it } from "vitest";

import {
  parseBootstrapTunnelDiagnostics,
  summarizeBootstrapTunnelDiagnostics,
} from "./bootstrap-tunnel-diagnostics.js";

describe("parseBootstrapTunnelDiagnostics", () => {
  it("parses sandboxd bootstrap tunnel JSONL records and skips blank lines", () => {
    const logText = [
      "",
      JSON.stringify({
        timestampMs: 1_779_958_800_001,
        event: "bootstrap_tunnel.connect_started",
        host: "gateway.internal",
        port: 443,
      }),
      "  ",
      JSON.stringify({
        timestampMs: 1_779_958_800_123,
        event: "bootstrap_tunnel.reader_closed",
        closeSource: "reader",
        closeKind: "close_frame",
        closeCode: "1011",
        closeReason: "Sandbox bootstrap websocket stopped responding to ping.",
      }),
    ].join("\n");

    const result = parseBootstrapTunnelDiagnostics(logText);

    expect(result.parseErrors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.event).toBe("bootstrap_tunnel.connect_started");
    expect(result.records[1]?.closeKind).toBe("close_frame");
  });

  it("reports invalid JSON and schema mismatches", () => {
    const result = parseBootstrapTunnelDiagnostics(
      [
        "{not-json}",
        JSON.stringify({
          timestampMs: "not-a-number",
          event: "bootstrap_tunnel.reader_closed",
        }),
      ].join("\n"),
    );

    expect(result.records).toEqual([]);
    expect(result.parseErrors).toHaveLength(2);
    expect(result.parseErrors[0]).toContain("not valid JSON");
    expect(result.parseErrors[1]).toContain("does not match bootstrap tunnel diagnostic schema");
  });
});

describe("summarizeBootstrapTunnelDiagnostics", () => {
  it("summarizes terminal close, reconnect, and shutdown evidence into queryable fields", () => {
    const summary = summarizeBootstrapTunnelDiagnostics(
      [
        JSON.stringify({
          timestampMs: 1_779_958_800_001,
          event: "bootstrap_tunnel.connect_started",
          host: "gateway.internal",
        }),
        JSON.stringify({
          timestampMs: 1_779_958_800_050,
          event: "bootstrap_tunnel.token_exchange_failed",
          error: "token exchange returned status 429 with an empty body",
          outcome: "retryable",
        }),
        JSON.stringify({
          timestampMs: 1_779_958_800_100,
          event: "bootstrap_tunnel.shutdown_requested",
          closeSource: "tunnel_session_handle",
        }),
        JSON.stringify({
          timestampMs: 1_779_958_800_123,
          event: "bootstrap_tunnel.writer_observed_closed",
          closeSource: "writer",
          reason: "failed to write bootstrap tunnel text frame: IO error",
        }),
      ].join("\n"),
    );

    expect(summary).toMatchObject({
      bootstrapTunnelEventCount: 4,
      bootstrapTunnelFirstEvent: "bootstrap_tunnel.connect_started",
      bootstrapTunnelLastEvent: "bootstrap_tunnel.writer_observed_closed",
      bootstrapTunnelLastCloseSource: "writer",
      bootstrapTunnelLastReason: "failed to write bootstrap tunnel text frame: IO error",
      bootstrapTunnelTokenExchangeFailureError:
        "token exchange returned status 429 with an empty body",
      bootstrapTunnelShutdownRequested: true,
    });
  });
});
