import { describe, expect, it } from "vitest";

import {
  resolveCodexCliLaunchTarget,
  resolvePostCliPreferredThreadId,
} from "./session-thread-authority.js";

describe("session thread authority", () => {
  it("resumes an active thread only when it already has turns", () => {
    expect(
      resolveCodexCliLaunchTarget({
        activeThreadId: "thread_resumable",
        turnCount: 2,
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_resumable",
    });
  });

  it("starts a new CLI thread and clears active authority for an empty thread", () => {
    expect(
      resolveCodexCliLaunchTarget({
        activeThreadId: "thread_empty",
        turnCount: 0,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearPersistedThreadId: true,
    });
  });

  it("starts a new CLI thread without clearing authority when no active thread exists", () => {
    expect(
      resolveCodexCliLaunchTarget({
        activeThreadId: null,
        turnCount: null,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearPersistedThreadId: false,
    });
  });

  it("prefers the provider thread id on chat restore when one exists", () => {
    expect(
      resolvePostCliPreferredThreadId({
        providerThreadId: "thread_persisted",
        availableThreads: [
          {
            id: "thread_other",
            name: null,
            preview: null,
            createdAt: 5,
            updatedAt: 5,
          },
        ],
        loadedThreadIds: ["thread_other"],
      }),
    ).toBe("thread_persisted");
  });

  it("falls back to thread selection heuristics when chat has no provider thread id", () => {
    expect(
      resolvePostCliPreferredThreadId({
        providerThreadId: null,
        availableThreads: [
          {
            id: "thread_old",
            name: null,
            preview: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "thread_cli_from_cli",
            name: null,
            preview: null,
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        loadedThreadIds: ["thread_cli_from_cli"],
      }),
    ).toBe("thread_cli_from_cli");
  });

  it("prefers the newest available thread when no loaded thread exists after CLI", () => {
    expect(
      resolvePostCliPreferredThreadId({
        providerThreadId: null,
        availableThreads: [
          {
            id: "thread_old",
            name: null,
            preview: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "thread_new",
            name: null,
            preview: null,
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        loadedThreadIds: [],
      }),
    ).toBe("thread_new");
  });
});
