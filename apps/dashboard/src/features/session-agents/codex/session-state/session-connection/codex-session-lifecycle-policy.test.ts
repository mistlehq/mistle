import { describe, expect, it } from "vitest";

import {
  resolveCodexConnectionStateTransition,
  selectCodexConnectionThreadStrategy,
} from "./codex-session-lifecycle-policy.js";

describe("codex session lifecycle policy", () => {
  it("disconnects the transport when the connection closes or errors", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        state: "closed",
        errorMessage: null,
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: "The Codex session connection closed.",
      recoverableDisconnectMessage: null,
    });

    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        state: "error",
        errorMessage: "Socket failed.",
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: "Socket failed.",
      recoverableDisconnectMessage: null,
    });
  });

  it("surfaces connected-session transport loss as a recoverable disconnect", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: true,
        state: "closed",
        errorMessage: "Stream dropped.",
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: null,
      recoverableDisconnectMessage: "Stream dropped.",
    });
  });

  it("does not disconnect the transport for non-terminal transport states", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        state: "ready",
        errorMessage: null,
      }),
    ).toEqual({
      shouldDisconnectSession: false,
      lifecycleErrorMessage: null,
      recoverableDisconnectMessage: null,
    });
  });

  it("resumes the oldest created available thread", () => {
    expect(
      selectCodexConnectionThreadStrategy({
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

  it("resumes the loaded thread even when it is missing from the available page", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        preferredThreadId: null,
        availableThreads: [],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_loaded_only",
    });
  });

  it("prefers the explicit persisted thread binding when available", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        preferredThreadId: "thread_persisted",
        availableThreads: [
          {
            id: "thread_persisted",
            name: null,
            preview: null,
            createdAt: 5,
            updatedAt: 5,
          },
          {
            id: "thread_old",
            name: null,
            preview: null,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_persisted",
    });
  });

  it("starts a new thread when none exist yet", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        preferredThreadId: null,
        availableThreads: [],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "start_new",
    });
  });
});
