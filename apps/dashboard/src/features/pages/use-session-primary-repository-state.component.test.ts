// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { useSessionPrimaryRepositoryState } from "./use-session-primary-repository-state.js";

type HookProps = {
  initialSelectedRepositoryPath?: string | null;
  sandboxInstanceId: string;
};

async function ensureTransportConnectedShouldNotRun(): Promise<never> {
  throw new Error("ensureTransportConnected should not be called in this test.");
}

function renderSessionPrimaryRepositoryState(initialProps: HookProps) {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return renderHook(
    (props: HookProps) =>
      useSessionPrimaryRepositoryState({
        enabled: false,
        ensureTransportConnected: ensureTransportConnectedShouldNotRun,
        ...(props.initialSelectedRepositoryPath === undefined
          ? {}
          : { initialSelectedRepositoryPath: props.initialSelectedRepositoryPath }),
        runtimeDisplayName: "Codex",
        sandboxInstanceId: props.sandboxInstanceId,
      }),
    {
      initialProps,
      wrapper: function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
        return createElement(QueryClientProvider, { client: queryClient }, children);
      },
    },
  );
}

describe("useSessionPrimaryRepositoryState", () => {
  it("exposes the runtime-plan repository on the initial render", () => {
    const sandboxInstanceId = "sbi_initial_runtime_plan";
    const repositoryPath = "/root/acme/repo-1";

    const { result } = renderSessionPrimaryRepositoryState({
      initialSelectedRepositoryPath: repositoryPath,
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBe(repositoryPath);
  });

  it("adopts the runtime-plan repository once it becomes available", () => {
    const sandboxInstanceId = "sbi_runtime_plan_race";
    const repositoryPath = "/root/acme/repo-1";

    const { result, rerender } = renderSessionPrimaryRepositoryState({
      initialSelectedRepositoryPath: null,
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBeNull();

    rerender({
      initialSelectedRepositoryPath: repositoryPath,
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBe(repositoryPath);
  });

  it("keeps the applied runtime-plan repository when later status is unavailable", () => {
    const sandboxInstanceId = "sbi_runtime_plan_status_gap";
    const repositoryPath = "/root/acme/repo-1";

    const { result, rerender } = renderSessionPrimaryRepositoryState({
      sandboxInstanceId,
    });

    rerender({
      initialSelectedRepositoryPath: repositoryPath,
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBe(repositoryPath);

    rerender({
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBe(repositoryPath);
  });

  it("does not overwrite a user-selected repository when a later initial value arrives", () => {
    const sandboxInstanceId = "sbi_user_selection";

    const { result, rerender } = renderSessionPrimaryRepositoryState({
      initialSelectedRepositoryPath: null,
      sandboxInstanceId,
    });

    act(() => {
      result.current.setSelectedRepositoryPath("/root/acme/repo-2");
    });

    rerender({
      initialSelectedRepositoryPath: "/root/acme/repo-1",
      sandboxInstanceId,
    });

    expect(result.current.selectedRepositoryPath).toBe("/root/acme/repo-2");
  });

  it("resets to the new runtime-plan repository when the sandbox changes", () => {
    const { result, rerender } = renderSessionPrimaryRepositoryState({
      initialSelectedRepositoryPath: "/root/acme/repo-1",
      sandboxInstanceId: "sbi_first",
    });

    act(() => {
      result.current.setSelectedRepositoryPath("/root/acme/repo-2");
    });

    rerender({
      initialSelectedRepositoryPath: "/root/acme/repo-3",
      sandboxInstanceId: "sbi_second",
    });

    expect(result.current.selectedRepositoryPath).toBe("/root/acme/repo-3");
  });
});
