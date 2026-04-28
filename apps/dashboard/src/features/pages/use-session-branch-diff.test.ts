import { describe, expect, it } from "vitest";

import {
  BranchDiffCommandTimeoutMs,
  buildBranchDiffGitExecRequest,
  formatBranchDiffCompareLabel,
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
        args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        cwd: null,
      }),
    ).toEqual({
      args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
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

  it("formats the default compare label before the compare ref is known", () => {
    expect(formatBranchDiffCompareLabel(null)).toBe("Compared with default branch");
  });

  it("formats the resolved compare ref label", () => {
    expect(formatBranchDiffCompareLabel("origin/trunk")).toBe("Compared with origin/trunk");
  });

  it("maps missing default branch errors to a non-alert notice", () => {
    expect(
      resolveBranchDiffErrorNotice({
        kind: "missing_default_branch",
        message: "Could not resolve the default branch from `origin/HEAD`.",
      }),
    ).toEqual({
      message: "Could not resolve the default branch from `origin/HEAD`.",
      title: "Changes unavailable",
      variant: "default",
    });
  });

  it("maps unknown error kinds through the generic error path", () => {
    expect(
      normalizeBranchDiffError({
        kind: "unknown_branch_diff_error",
        message: "Unexpected branch diff error.",
      }),
    ).toEqual({
      message: "Could not load changes compared with the default branch.",
      title: "Could not load changes",
      variant: "alert",
    });
  });

  it("maps generic git failures to an alert notice", () => {
    expect(normalizeBranchDiffError(new Error("fatal: bad revision 'origin/trunk'"))).toEqual({
      message: "fatal: bad revision 'origin/trunk'",
      title: "Could not load changes",
      variant: "alert",
    });
  });

  it("maps timeout failures to an alert notice", () => {
    expect(normalizeBranchDiffError(new Error("command timed out after 15000ms"))).toEqual({
      message: "Timed out loading changes compared with the default branch.",
      title: "Could not load changes",
      variant: "alert",
    });
  });
});
