import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveSandboxInstanceRuntimeContext } from "./runtime-context.js";

function createRuntimePlan(input: {
  launchCwd?: string;
  workspaceSources?: CompiledRuntimePlan["workspaceSources"];
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
    workspaceSources: input.workspaceSources ?? [],
    runtimeClients: [],
    agentRuntimes: [
      {
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
            ...(input.launchCwd === undefined ? {} : { cwd: input.launchCwd }),
            command: "codex",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "main",
            cols: 120,
            rows: 40,
            ...(input.launchCwd === undefined ? {} : { cwd: input.launchCwd }),
            command: "codex",
            args: [],
          },
        },
      },
    ],
  };
}

describe("runtime context", () => {
  it("returns null when runtime plan is absent", () => {
    expect(
      resolveSandboxInstanceRuntimeContext({
        runtimePlan: null,
      }),
    ).toBeNull();
  });

  it("derives both launch cwd and repository root for a nested repo cwd", () => {
    expect(
      resolveSandboxInstanceRuntimeContext({
        runtimePlan: createRuntimePlan({
          launchCwd: "/root/acme/repo-1/packages/app",
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: "/root/acme/repo-1",
              originUrl: "https://github.com/acme/repo-1.git",
            },
          ],
        }),
      }),
    ).toEqual({
      launchCwd: "/root/acme/repo-1/packages/app",
      primaryRepositoryRoot: "/root/acme/repo-1",
    });
  });

  it("returns null repository root when the launch cwd is not inside a repository workspace source", () => {
    expect(
      resolveSandboxInstanceRuntimeContext({
        runtimePlan: createRuntimePlan({
          launchCwd: "/root/workspace/tmp",
          workspaceSources: [
            {
              sourceKind: "git-clone",
              resourceKind: "repository",
              path: "/root/acme/repo-1",
              originUrl: "https://github.com/acme/repo-1.git",
            },
          ],
        }),
      }),
    ).toEqual({
      launchCwd: "/root/workspace/tmp",
      primaryRepositoryRoot: null,
    });
  });

  it("returns null fields when the runtime plan does not pin a launch cwd", () => {
    expect(
      resolveSandboxInstanceRuntimeContext({
        runtimePlan: createRuntimePlan({}),
      }),
    ).toEqual({
      launchCwd: null,
      primaryRepositoryRoot: null,
    });
  });
});
