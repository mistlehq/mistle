// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  getSessionRepositoryStatusQueryKey,
  useSessionRepositoryStatus,
} from "./use-session-repository-status.js";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function createRepositoryStatusQueryKey() {
  return getSessionRepositoryStatusQueryKey({
    connectedAtIso: "2026-04-22T00:00:00.000Z",
    sandboxInstanceId: "sbi_test",
    cwd: "/root/acme/repo-1",
  });
}

describe("useSessionRepositoryStatus", () => {
  it("clears repository status when tracking is disabled", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(createRepositoryStatusQueryKey(), {
      branchLabel: "main",
      pullRequest: {
        isDraft: false,
        number: 42,
        state: "OPEN",
        title: "Demo pull request",
        url: "https://github.com/mistlehq/mistle/pull/42",
      },
    });

    const { result } = renderHook(
      () =>
        useSessionRepositoryStatus({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: false,
          ensureTransportConnected: async () => {
            throw new Error("ensureTransportConnected should not be called in this test.");
          },
          refreshEpoch: 0,
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.branchLabel).toBeNull();
    expect(result.current.pullRequest).toBeNull();
  });

  it("clears repository status when a refetch fails after cached data exists", async () => {
    const queryClient = createTestQueryClient({
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(createRepositoryStatusQueryKey(), {
      branchLabel: "main",
      pullRequest: {
        isDraft: false,
        number: 42,
        state: "OPEN",
        title: "Demo pull request",
        url: "https://github.com/mistlehq/mistle/pull/42",
      },
    });

    const { result } = renderHook(
      () =>
        useSessionRepositoryStatus({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: true,
          ensureTransportConnected: async () => {
            throw new Error("transport unavailable");
          },
          refreshEpoch: 0,
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => {
      expect(result.current.branchLabel).toBeNull();
      expect(result.current.pullRequest).toBeNull();
    });
  });

  it("hides cached repository status until the current selection refetch completes", () => {
    const queryClient = createTestQueryClient({
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(createRepositoryStatusQueryKey(), {
      branchLabel: "main",
      pullRequest: {
        isDraft: false,
        number: 42,
        state: "OPEN",
        title: "Demo pull request",
        url: "https://github.com/mistlehq/mistle/pull/42",
      },
    });

    const { result } = renderHook(
      () =>
        useSessionRepositoryStatus({
          connectedAtIso: "2026-04-22T00:00:00.000Z",
          cwd: "/root/acme/repo-1",
          enabled: true,
          ensureTransportConnected: async () => await new Promise<never>(() => {}),
          refreshEpoch: 0,
          sandboxInstanceId: "sbi_test",
        }),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.branchLabel).toBeNull();
    expect(result.current.pullRequest).toBeNull();
  });
});
