import { describe, expect, it } from "vitest";

import { resolveSessionBootstrapStrategy } from "./session-bootstrap-strategy.js";

describe("session bootstrap strategy", () => {
  it("returns disconnected when no connected session exists", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: null,
        establishedConnectionAtIso: null,
        establishedSandboxInstanceId: null,
        hasEstablishedBaseline: false,
      }),
    ).toBe("disconnected");
  });

  it("returns disconnected when the connected session has no thread yet", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: null,
        },
        establishedConnectionAtIso: null,
        establishedSandboxInstanceId: null,
        hasEstablishedBaseline: false,
      }),
    ).toBe("disconnected");
  });

  it("runs a full bootstrap before a baseline has been established", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: "thread_123",
        },
        establishedConnectionAtIso: null,
        establishedSandboxInstanceId: null,
        hasEstablishedBaseline: false,
      }),
    ).toBe("full");
  });

  it("refreshes bootstrap data when reconnecting to the same sandbox instance", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:05:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: "thread_123",
        },
        establishedConnectionAtIso: "2026-03-27T00:00:00.000Z",
        establishedSandboxInstanceId: "sandbox_123",
        hasEstablishedBaseline: true,
      }),
    ).toBe("refresh");
  });

  it("runs a thread-only sync when the same connection changes thread state", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:05:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: "thread_123",
        },
        establishedConnectionAtIso: "2026-03-27T00:05:00.000Z",
        establishedSandboxInstanceId: "sandbox_123",
        hasEstablishedBaseline: true,
      }),
    ).toBe("thread_sync");
  });

  it("runs a full bootstrap when the sandbox instance changes", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_456",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: "thread_456",
        },
        establishedConnectionAtIso: "2026-03-27T00:00:00.000Z",
        establishedSandboxInstanceId: "sandbox_123",
        hasEstablishedBaseline: true,
      }),
    ).toBe("full");
  });
});
