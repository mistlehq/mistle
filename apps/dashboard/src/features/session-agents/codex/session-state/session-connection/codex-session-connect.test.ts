import { CodexJsonRpcRequestError } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  createConnectedCodexSession,
  resolveInitialCodexThreadAction,
  resolveReconnectResumeFailureAction,
} from "./codex-session-connect.js";

describe("codex session connect", () => {
  it("resumes the oldest created existing thread on reconnect", () => {
    expect(
      resolveInitialCodexThreadAction({
        targetThreadId: null,
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
        targetThreadId: null,
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
        targetThreadId: "thread_persisted",
        availableThreads: [
          {
            id: "thread_persisted",
            name: null,
            preview: null,
            createdAt: 5,
            updatedAt: 5,
          },
        ],
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
        targetThreadId: null,
        availableThreads: [],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "start_new",
    });
  });

  it("resumes the most recently updated available thread for post-cli restore selection", () => {
    expect(
      resolveInitialCodexThreadAction({
        targetThreadId: null,
        availableThreads: [
          {
            id: "thread_old_but_active",
            name: null,
            preview: null,
            createdAt: 10,
            updatedAt: 30,
          },
          {
            id: "thread_newer_but_stale",
            name: null,
            preview: null,
            createdAt: 20,
            updatedAt: 20,
          },
        ],
        loadedThreadIds: [],
        selectionPolicy: "most_recently_updated",
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_old_but_active",
    });
  });

  it("starts a new thread when a reconnect-selected thread has no rollout", () => {
    expect(
      resolveReconnectResumeFailureAction({
        error: new CodexJsonRpcRequestError({
          method: "thread/resume",
          id: 5,
          code: -32600,
          message: "no rollout found for thread id thread_empty",
        }),
        targetThreadId: null,
        selectedThreadId: "thread_empty",
      }),
    ).toBe("start_new");
  });

  it("starts a new thread when a non-persisted reconnect-selected thread is missing", () => {
    expect(
      resolveReconnectResumeFailureAction({
        error: new CodexJsonRpcRequestError({
          method: "thread/resume",
          id: 6,
          code: -32600,
          message: "thread not found: thread_missing",
        }),
        targetThreadId: null,
        selectedThreadId: "thread_missing",
      }),
    ).toBe("start_new");
  });

  it("keeps the explicit error when the persisted linked thread is missing", () => {
    expect(
      resolveReconnectResumeFailureAction({
        error: new CodexJsonRpcRequestError({
          method: "thread/resume",
          id: 7,
          code: -32600,
          message: "invalid thread id: thread_persisted",
        }),
        targetThreadId: "thread_persisted",
        selectedThreadId: "thread_persisted",
      }),
    ).toBe("error_broken_persisted");
  });

  it("keeps the explicit error when the persisted linked thread has no rollout", () => {
    expect(
      resolveReconnectResumeFailureAction({
        error: new CodexJsonRpcRequestError({
          method: "thread/resume",
          id: 8,
          code: -32600,
          message: "no rollout found for thread id thread_persisted",
        }),
        targetThreadId: "thread_persisted",
        selectedThreadId: "thread_persisted",
      }),
    ).toBe("error_broken_persisted");
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
        providerThreadId: null,
        activeThreadId: "thread_123",
      }),
    ).toEqual({
      sandboxInstanceId: "sandbox_123",
      connectedAtIso: "2026-03-20T00:00:00.000Z",
      expiresAtIso: "2026-03-20T01:00:00.000Z",
      connectionUrl: "wss://example.test/codex",
      providerThreadId: null,
      activeThreadId: "thread_123",
    });
  });
});
