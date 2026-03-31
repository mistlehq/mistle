import { describe, expect, it } from "vitest";

import {
  resolveCodexCliLaunchTarget,
  resolvePostCliPreferredThreadId,
} from "./session-thread-authority.js";

describe("session thread authority", () => {
  it("resumes a persisted thread only when it already has turns", () => {
    expect(
      resolveCodexCliLaunchTarget({
        persistedThreadId: "thread_resumable",
        turnCount: 2,
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_resumable",
    });
  });

  it("starts a new CLI thread and clears persisted authority for an empty thread", () => {
    expect(
      resolveCodexCliLaunchTarget({
        persistedThreadId: "thread_empty",
        turnCount: 0,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearPersistedThreadId: true,
    });
  });

  it("starts a new CLI thread without clearing authority when no persisted thread exists", () => {
    expect(
      resolveCodexCliLaunchTarget({
        persistedThreadId: null,
        turnCount: null,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearPersistedThreadId: false,
    });
  });

  it("prefers the persisted thread id on chat restore when one exists", () => {
    expect(
      resolvePostCliPreferredThreadId({
        persistedThreadId: "thread_persisted",
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

  it("falls back to thread selection heuristics when chat has no persisted thread id", () => {
    expect(
      resolvePostCliPreferredThreadId({
        persistedThreadId: null,
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
});
