import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  buildRepositoryDiscoveryFindArgs,
  DefaultSandboxWorkspaceDir,
  parseRepositoryPaths,
  resolveRuntimePlanPrimaryRepositoryPath,
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
});
