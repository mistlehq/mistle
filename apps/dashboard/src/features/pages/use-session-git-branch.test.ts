// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  GitBranchCommandTimeoutMs,
  buildGitBranchExecRequest,
  getSessionGitBranchQueryKey,
  useSessionGitBranch,
} from "./use-session-git-branch.js";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function createBranchQueryKey(): ReturnType<typeof getSessionGitBranchQueryKey> {
  return getSessionGitBranchQueryKey({
    connectedAtIso: "2026-04-22T00:00:00.000Z",
    sandboxInstanceId: "sbi_test",
    cwd: "/root/acme/repo-1",
  });
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

  it("clears the branch label when tracking is disabled", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(createBranchQueryKey(), {
      branchLabel: "main",
    });

    const { result } = renderHook(
      () =>
        useSessionGitBranch({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: false,
          ensureTransportConnected: async () => {
            throw new Error("ensureTransportConnected should not be called in this test.");
          },
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

    queryClient.setQueryData(createBranchQueryKey(), {
      branchLabel: "main",
    });

    const { result } = renderHook(
      () =>
        useSessionGitBranch({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: true,
          ensureTransportConnected: async () => {
            throw new Error("transport unavailable");
          },
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

  it("hides cached branch data until the current selection refetch completes", () => {
    const queryClient = createTestQueryClient({
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(createBranchQueryKey(), {
      branchLabel: "main",
    });

    const { result } = renderHook(
      () =>
        useSessionGitBranch({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: true,
          ensureTransportConnected: async () => await new Promise<never>(() => {}),
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.branchLabel).toBeNull();
  });
});
