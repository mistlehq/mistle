import { describe, expect, it } from "vitest";

import {
  resolveCodexConnectionStateTransition,
  selectCodexConnectionThreadStrategy,
} from "./codex-session-lifecycle-policy.js";

describe("codex session lifecycle policy", () => {
  it("resets session state when the transport closes or errors", () => {
    expect(
      resolveCodexConnectionStateTransition({
        state: "closed",
        errorMessage: null,
      }),
    ).toEqual({
      shouldResetSession: true,
      startErrorMessage: "The Codex session connection closed.",
    });

    expect(
      resolveCodexConnectionStateTransition({
        state: "error",
        errorMessage: "Socket failed.",
      }),
    ).toEqual({
      shouldResetSession: true,
      startErrorMessage: "Socket failed.",
    });
  });

  it("does not reset session state for non-terminal transport states", () => {
    expect(
      resolveCodexConnectionStateTransition({
        state: "ready",
        errorMessage: null,
      }),
    ).toEqual({
      shouldResetSession: false,
      startErrorMessage: null,
    });
  });

  it("resumes the most recent loaded thread when one is already loaded", () => {
    expect(
      selectCodexConnectionThreadStrategy({
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
        loadedThreadIds: ["thread_old", "thread_new"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_new",
    });
  });

  it("resumes the most recent available thread when no thread is currently loaded", () => {
    expect(
      selectCodexConnectionThreadStrategy({
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
      threadId: "thread_new",
    });
  });

  it("starts a new thread when none exist yet", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        availableThreads: [],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "start_new",
    });
  });
});
