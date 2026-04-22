import { describe, expect, it } from "vitest";

import {
  GitBranchCommandTimeoutMs,
  buildGitBranchExecRequest,
  getSessionGitBranchQueryKey,
  isFsChangedNotification,
} from "./use-session-git-branch.js";

describe("useSessionGitBranch helpers", () => {
  it("builds git exec requests with the selected repository cwd", () => {
    expect(
      buildGitBranchExecRequest({
        args: ["branch", "--show-current"],
        cwd: "/root/acme/repo-1",
      }),
    ).toEqual({
      args: ["branch", "--show-current"],
      command: "git",
      cwd: "/root/acme/repo-1",
      timeoutMs: GitBranchCommandTimeoutMs,
    });
  });

  it("keys branch state only by sandbox instance and repository cwd", () => {
    expect(
      getSessionGitBranchQueryKey({
        sandboxInstanceId: "sbi_test",
        cwd: "/root/acme/repo-1",
      }),
    ).toEqual(["session-git-branch", "sbi_test", "/root/acme/repo-1"]);
  });

  it("recognizes fs changed notifications", () => {
    expect(
      isFsChangedNotification({
        method: "fs/changed",
        params: {
          watchId: "watch_123",
          changedPaths: ["/root/acme/repo-1/.git/HEAD"],
        },
      }),
    ).toBe(true);
  });

  it("rejects unrelated notifications", () => {
    expect(
      isFsChangedNotification({
        method: "turn/completed",
        params: {
          turn: {
            id: "turn_123",
          },
        },
      }),
    ).toBe(false);
  });
});
