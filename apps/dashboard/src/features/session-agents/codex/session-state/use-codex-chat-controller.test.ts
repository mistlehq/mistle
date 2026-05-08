import { describe, expect, it } from "vitest";

import { resolveTurnCwdCommit } from "./use-codex-chat-controller.js";

describe("resolveTurnCwdCommit", () => {
  it("commits the turn cwd for the active thread when a cwd-scoped turn starts", () => {
    expect(
      resolveTurnCwdCommit({
        threadId: "thread_123",
        cwd: "/root/acme/repo-2",
      }),
    ).toEqual({
      threadId: "thread_123",
      cwd: "/root/acme/repo-2",
    });
  });

  it("does not commit a cwd update for turns without a cwd override", () => {
    expect(
      resolveTurnCwdCommit({
        threadId: "thread_123",
      }),
    ).toBeNull();
  });
});
