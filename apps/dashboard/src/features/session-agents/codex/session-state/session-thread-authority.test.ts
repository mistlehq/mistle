import { describe, expect, it } from "vitest";

import { resolveCodexCliLaunchTarget } from "./session-thread-authority.js";

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
      shouldClearActiveThreadId: true,
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
      shouldClearActiveThreadId: false,
    });
  });
});
