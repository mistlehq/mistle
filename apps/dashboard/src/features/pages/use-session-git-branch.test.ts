// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  GitBranchCommandError,
  GitBranchCommandTimeoutMs,
  buildGitBranchExecRequest,
  getSessionGitBranchQueryKey,
  isFsChangedNotification,
  isNotGitRepositoryResult,
  useSessionGitBranch,
} from "./use-session-git-branch.js";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

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
        connectedAtIso: "2026-04-22T00:00:00.000Z",
        sandboxInstanceId: "sbi_test",
        cwd: "/root/acme/repo-1",
      }),
    ).toEqual(["session-git-branch", "sbi_test", "/root/acme/repo-1", "2026-04-22T00:00:00.000Z"]);
  });

  it("changes the query key when the session reconnect timestamp changes", () => {
    expect(
      getSessionGitBranchQueryKey({
        connectedAtIso: "2026-04-22T00:00:00.000Z",
        sandboxInstanceId: "sbi_test",
        cwd: "/root/acme/repo-1",
      }),
    ).not.toEqual(
      getSessionGitBranchQueryKey({
        connectedAtIso: "2026-04-22T00:05:00.000Z",
        sandboxInstanceId: "sbi_test",
        cwd: "/root/acme/repo-1",
      }),
    );
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

  it("recognizes not-a-git-repository exec failures", () => {
    expect(
      isNotGitRepositoryResult({
        exitCode: 128,
        stderr: "fatal: not a git repository (or any of the parent directories): .git",
      }),
    ).toBe(true);
  });

  it("does not treat unrelated git failures as not-a-git-repository", () => {
    expect(
      isNotGitRepositoryResult({
        exitCode: 124,
        stderr: "command timed out after 5000ms",
      }),
    ).toBe(false);
  });

  it("records command failure details for transient git errors", () => {
    const error = new GitBranchCommandError({
      command: "git rev-parse --absolute-git-dir",
      exitCode: 124,
      stderr: "command timed out after 5000ms",
    });

    expect(error.message).toBe("Git command failed: git rev-parse --absolute-git-dir");
    expect(error.command).toBe("git rev-parse --absolute-git-dir");
    expect(error.exitCode).toBe(124);
    expect(error.stderr).toBe("command timed out after 5000ms");
  });

  it("clears the branch label when tracking is disabled", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(
      ["session-git-branch", "sbi_test", "/root/acme/repo-1", "2026-04-22T00:00:00.000Z"],
      {
        branchLabel: "main",
        headWatchPath: "/root/acme/repo-1/.git/HEAD",
      },
    );

    const { result } = renderHook(
      () =>
        useSessionGitBranch({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: false,
          ensureTransportConnected: async () => {
            throw new Error("ensureTransportConnected should not be called in this test.");
          },
          rpcClient: null,
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.branchLabel).toBeNull();
  });

  it("clears the branch label when a refetch fails after cached data exists", async () => {
    const queryClient = createTestQueryClient({
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(
      ["session-git-branch", "sbi_test", "/root/acme/repo-1", "2026-04-22T00:00:00.000Z"],
      {
        branchLabel: "main",
        headWatchPath: "/root/acme/repo-1/.git/HEAD",
      },
    );

    const { result } = renderHook(
      () =>
        useSessionGitBranch({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: true,
          ensureTransportConnected: async () => {
            throw new Error("transport unavailable");
          },
          rpcClient: null,
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => {
      expect(result.current.branchLabel).toBeNull();
    });
  });
});
