import { describe, expect, it } from "vitest";

import { resolveSessionBootstrapStrategy } from "./session-bootstrap-strategy.js";

describe("session bootstrap strategy", () => {
  it("returns disconnected when no connected session exists", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: null,
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
        establishedSandboxInstanceId: null,
        hasEstablishedBaseline: false,
      }),
    ).toBe("full");
  });

  it("runs a thread-only sync when reconnecting to the same sandbox instance", () => {
    expect(
      resolveSessionBootstrapStrategy({
        connectedSession: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          expiresAtIso: "2026-03-27T01:00:00.000Z",
          connectionUrl: "wss://example.invalid",
          threadId: "thread_123",
        },
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
        establishedSandboxInstanceId: "sandbox_123",
        hasEstablishedBaseline: true,
      }),
    ).toBe("full");
  });
});
