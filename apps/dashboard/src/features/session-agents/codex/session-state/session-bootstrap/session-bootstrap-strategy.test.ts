import { describe, expect, it } from "vitest";

import {
  resolveBootstrapConnectionContext,
  resolveSessionBootstrapPlan,
} from "./session-bootstrap-strategy.js";

describe("bootstrap connection context", () => {
  it("returns null when no connected session exists", () => {
    expect(
      resolveBootstrapConnectionContext({
        connectionCandidate: null,
      }),
    ).toBeNull();
  });

  it("returns null when no thread is bound yet", () => {
    expect(
      resolveBootstrapConnectionContext({
        connectionCandidate: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          threadId: null,
        },
      }),
    ).toBeNull();
  });

  it("derives a reduced bootstrap context once a thread is bound", () => {
    expect(
      resolveBootstrapConnectionContext({
        connectionCandidate: {
          sandboxInstanceId: "sandbox_123",
          connectedAtIso: "2026-03-27T00:00:00.000Z",
          threadId: "thread_123",
        },
      }),
    ).toEqual({
      connectionKey: "sandbox_123:2026-03-27T00:00:00.000Z",
      threadId: "thread_123",
    });
  });
});

describe("session bootstrap plan", () => {
  it("returns no active plan when no connected session exists", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: null,
        establishedConnectionKey: null,
      }),
    ).toEqual({
      connectionKey: null,
      shouldLoadBootstrapData: false,
      threadSyncKey: null,
    });
  });

  it("returns no active plan when the connected session has no thread yet", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: null,
        establishedConnectionKey: null,
      }),
    ).toEqual({
      connectionKey: null,
      shouldLoadBootstrapData: false,
      threadSyncKey: null,
    });
  });

  it("loads bootstrap data before a baseline has been established", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: {
          connectionKey: "sandbox_123:2026-03-27T00:00:00.000Z",
          threadId: "thread_123",
        },
        establishedConnectionKey: null,
      }),
    ).toEqual({
      connectionKey: "sandbox_123:2026-03-27T00:00:00.000Z",
      shouldLoadBootstrapData: true,
      threadSyncKey: "sandbox_123:2026-03-27T00:00:00.000Z:thread_123",
    });
  });

  it("reloads bootstrap data when reconnecting to the same sandbox instance", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: {
          connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
          threadId: "thread_123",
        },
        establishedConnectionKey: "sandbox_123:2026-03-27T00:00:00.000Z",
      }),
    ).toEqual({
      connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
      shouldLoadBootstrapData: true,
      threadSyncKey: "sandbox_123:2026-03-27T00:05:00.000Z:thread_123",
    });
  });

  it("runs thread sync without reloading bootstrap data for the same connection", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: {
          connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
          threadId: "thread_123",
        },
        establishedConnectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
      }),
    ).toEqual({
      connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
      shouldLoadBootstrapData: false,
      threadSyncKey: "sandbox_123:2026-03-27T00:05:00.000Z:thread_123",
    });
  });

  it("keeps bootstrap data cached when only the thread changes on the same connection", () => {
    expect(
      resolveSessionBootstrapPlan({
        bootstrapConnectionContext: {
          connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
          threadId: "thread_456",
        },
        establishedConnectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
      }),
    ).toEqual({
      connectionKey: "sandbox_123:2026-03-27T00:05:00.000Z",
      shouldLoadBootstrapData: false,
      threadSyncKey: "sandbox_123:2026-03-27T00:05:00.000Z:thread_456",
    });
  });
});
