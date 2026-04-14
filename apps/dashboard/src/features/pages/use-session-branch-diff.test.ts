import { describe, expect, it } from "vitest";

import {
  BranchDiffCommandTimeoutMs,
  buildBranchDiffGitExecRequest,
  getSessionBranchDiffQueryKey,
  normalizeBranchDiffError,
  resolveBranchDiffErrorNotice,
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

  it("maps not-a-repository errors to a non-alert notice", () => {
    expect(
      normalizeBranchDiffError({
        kind: "not_git_repository",
        message: "Current workspace is not a git repository.",
      }),
    ).toEqual({
      message: "Current workspace is not a git repository.",
      title: "Changes unavailable",
      variant: "default",
    });
  });

  it("maps missing-main errors to a non-alert notice", () => {
    expect(
      resolveBranchDiffErrorNotice({
        kind: "missing_main",
        message: "Local branch `main` does not exist.",
      }),
    ).toEqual({
      message: "Local branch `main` does not exist.",
      title: "Changes unavailable",
      variant: "default",
    });
  });

  it("maps generic git failures to an alert notice", () => {
    expect(normalizeBranchDiffError(new Error("fatal: bad revision 'main'"))).toEqual({
      message: "fatal: bad revision 'main'",
      title: "Could not load changes",
      variant: "alert",
    });
  });

  it("maps timeout failures to an alert notice", () => {
    expect(normalizeBranchDiffError(new Error("command timed out after 15000ms"))).toEqual({
      message: "Timed out loading changes compared with main.",
      title: "Could not load changes",
      variant: "alert",
    });
  });
});
