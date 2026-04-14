// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { useSessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useSessionPrimaryRepositoryState", () => {
  it("adopts the runtime-plan repository once it becomes available after repository discovery", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const sandboxInstanceId = "sbi_runtime_plan_race";
    const repositoryPath = "/root/acme/repo-1";

    queryClient.setQueryData(["session-primary-repository-options", sandboxInstanceId], {
      repositoryOptions: [{ value: repositoryPath, label: "acme/repo-1" }],
    });

    const { result, rerender } = renderHook(
      (props: { initialSelectedRepositoryPath?: string | null }) =>
        useSessionPrimaryRepositoryState({
          enabled: true,
          ensureTransportConnected: async () => {
            throw new Error("ensureTransportConnected should not be called in this test.");
          },
          ...(props.initialSelectedRepositoryPath === undefined
            ? {}
            : { initialSelectedRepositoryPath: props.initialSelectedRepositoryPath }),
          sandboxInstanceId,
        }),
      {
        initialProps: {
          initialSelectedRepositoryPath: null,
        } as { initialSelectedRepositoryPath?: string | null },
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.selectedRepositoryPath).toBeNull();

    rerender({
      initialSelectedRepositoryPath: repositoryPath,
    });

    expect(result.current.selectedRepositoryPath).toBe(repositoryPath);
  });

  it("does not overwrite a user-selected repository when a later initial value arrives", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const sandboxInstanceId = "sbi_user_selection";

    queryClient.setQueryData(["session-primary-repository-options", sandboxInstanceId], {
      repositoryOptions: [
        { value: "/root/acme/repo-1", label: "acme/repo-1" },
        { value: "/root/acme/repo-2", label: "acme/repo-2" },
      ],
    });

    const { result, rerender } = renderHook(
      (props: { initialSelectedRepositoryPath?: string | null }) =>
        useSessionPrimaryRepositoryState({
          enabled: true,
          ensureTransportConnected: async () => {
            throw new Error("ensureTransportConnected should not be called in this test.");
          },
          ...(props.initialSelectedRepositoryPath === undefined
            ? {}
            : { initialSelectedRepositoryPath: props.initialSelectedRepositoryPath }),
          sandboxInstanceId,
        }),
      {
        initialProps: {
          initialSelectedRepositoryPath: null,
        } as { initialSelectedRepositoryPath?: string | null },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.setSelectedRepositoryPath("/root/acme/repo-2");
    });

    rerender({
      initialSelectedRepositoryPath: "/root/acme/repo-1",
    });

    expect(result.current.selectedRepositoryPath).toBe("/root/acme/repo-2");
  });
});
