import { describe, expect, it } from "vitest";

import {
  BranchDiffCommandTimeoutMs,
  buildBranchDiffGitExecRequest,
  getSessionBranchDiffQueryKey,
} from "./use-session-branch-diff.js";

describe("useSessionBranchDiff helpers", () => {
  it("builds git exec requests with the selected repository cwd", () => {
    expect(
      buildBranchDiffGitExecRequest({
        args: ["diff", "--binary", "abc123"],
        cwd: "/root/acme/repo-1",
      }),
    ).toEqual({
      args: ["diff", "--binary", "abc123"],
      command: "git",
      cwd: "/root/acme/repo-1",
      timeoutMs: BranchDiffCommandTimeoutMs,
    });
  });

  it("omits cwd when no primary repository is selected", () => {
    expect(
      buildBranchDiffGitExecRequest({
        args: ["rev-parse", "--verify", "main"],
        cwd: null,
      }),
    ).toEqual({
      args: ["rev-parse", "--verify", "main"],
      command: "git",
      timeoutMs: BranchDiffCommandTimeoutMs,
    });
  });

  it("includes cwd in the branch diff query key", () => {
    expect(
      getSessionBranchDiffQueryKey({
        sandboxInstanceId: "sbi_test",
        cwd: "/root/acme/repo-2",
      }),
    ).toEqual(["session-branch-diff", "sbi_test", "/root/acme/repo-2"]);
  });
});
