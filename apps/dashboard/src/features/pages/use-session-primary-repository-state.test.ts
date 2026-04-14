// @vitest-environment jsdom

import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  buildRepositoryDiscoveryFindArgs,
  DefaultSandboxWorkspaceDir,
  parseRepositoryPaths,
  resolveRuntimePlanPrimaryRepositoryPath,
  useSessionPrimaryRepositoryState,
  toRepositoryOptions,
} from "./use-session-primary-repository-state.js";

function createRuntimePlan(input: {
  newLaunchCwd?: string;
  resumeLaunchCwd?: string;
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_123",
    version: 1,
    image: {
      source: "base",
      imageRef: "img_123",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [
      {
        bindingId: "ibd_123",
        runtimeId: "codex",
        runtimeKey: "codex",
        clientId: "rtc_123",
        endpointKey: "endpoint_123",
        ptyLaunch: {
          runtimeId: "codex",
          displayName: "Codex",
          newLaunch: {
            ptySessionId: "main",
            cols: 120,
            rows: 40,
            ...(input.newLaunchCwd === undefined ? {} : { cwd: input.newLaunchCwd }),
            command: "codex",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "main",
            cols: 120,
            rows: 40,
            ...(input.resumeLaunchCwd === undefined ? {} : { cwd: input.resumeLaunchCwd }),
            command: "codex",
            args: [],
          },
        },
      },
    ],
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useSessionPrimaryRepositoryState helpers", () => {
  it("parses repository roots from find output", () => {
    expect(
      parseRepositoryPaths({
        findOutput: [
          "/root/platform/.git",
          "/root/acme/repo-1/.git",
          "",
          "/root/acme/repo-1/.git",
          "/root/acme/repo-2/.git",
        ].join("\n"),
      }),
    ).toEqual(["/root/acme/repo-1", "/root/acme/repo-2", "/root/platform"]);
  });

  it("builds a find command that supports repositories and worktree checkouts", () => {
    expect(
      buildRepositoryDiscoveryFindArgs({
        workspaceRoot: DefaultSandboxWorkspaceDir,
      }),
    ).toEqual([
      "/root",
      "-mindepth",
      "1",
      "-maxdepth",
      "3",
      "(",
      "-type",
      "d",
      "-o",
      "-type",
      "f",
      ")",
      "-name",
      ".git",
    ]);
  });

  it("builds repository labels relative to the workspace root", () => {
    expect(
      toRepositoryOptions({
        repositoryPaths: ["/root/acme/repo-1", "/tmp/external-repo"],
        workspaceRoot: DefaultSandboxWorkspaceDir,
      }),
    ).toEqual([
      { value: "/root/acme/repo-1", label: "acme/repo-1" },
      { value: "/tmp/external-repo", label: "/tmp/external-repo" },
    ]);
  });

  it("resolves the initial repository from the runtime plan cwd", () => {
    expect(
      resolveRuntimePlanPrimaryRepositoryPath({
        runtimePlan: createRuntimePlan({
          newLaunchCwd: "/root/acme/repo-1",
          resumeLaunchCwd: "/root/acme/repo-1",
        }),
      }),
    ).toBe("/root/acme/repo-1");
  });

  it("returns null when the runtime plan does not pin a repository cwd", () => {
    expect(
      resolveRuntimePlanPrimaryRepositoryPath({
        runtimePlan: createRuntimePlan({}),
      }),
    ).toBeNull();
  });

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
});
