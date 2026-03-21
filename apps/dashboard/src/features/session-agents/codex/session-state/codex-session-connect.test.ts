import { describe, expect, it } from "vitest";

import {
  createConnectedCodexSession,
  resolveInitialCodexThreadAction,
} from "./codex-session-connect.js";

describe("codex session connect", () => {
  it("resumes the oldest created existing thread on reconnect", () => {
    expect(
      resolveInitialCodexThreadAction({
        preferredThreadId: null,
        availableThreads: [
          {
            id: "thread_old",
            name: null,
            preview: null,
            createdAt: 10,
            updatedAt: 10,
          },
          {
            id: "thread_new",
            name: null,
            preview: null,
            createdAt: 20,
            updatedAt: 20,
          },
        ],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_old",
    });
  });

  it("resumes a loaded thread that is missing from the available page", () => {
    expect(
      resolveInitialCodexThreadAction({
        preferredThreadId: null,
        availableThreads: [],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_loaded_only",
    });
  });

  it("prefers the persisted provider conversation id on reconnect", () => {
    expect(
      resolveInitialCodexThreadAction({
        preferredThreadId: "thread_persisted",
        availableThreads: [],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_persisted",
    });
  });

  it("starts a new thread when no existing thread is available", () => {
    expect(
      resolveInitialCodexThreadAction({
        preferredThreadId: null,
        availableThreads: [],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "start_new",
    });
  });

  it("builds the connected session snapshot from the minted connection", () => {
    expect(
      createConnectedCodexSession({
        sandboxInstanceId: "sandbox_123",
        connectedAtIso: "2026-03-20T00:00:00.000Z",
        mintedConnection: {
          instanceId: "sandbox_123",
          connectionUrl: "wss://example.test/codex",
          connectionToken: "token_123",
          connectionExpiresAt: "2026-03-20T01:00:00.000Z",
        },
        threadId: "thread_123",
      }),
    ).toEqual({
      sandboxInstanceId: "sandbox_123",
      connectedAtIso: "2026-03-20T00:00:00.000Z",
      expiresAtIso: "2026-03-20T01:00:00.000Z",
      threadId: "thread_123",
    });
  });
});
