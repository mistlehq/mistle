import { describe, expect, it } from "vitest";

import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { resolveInitialSessionConnectTarget } from "./session-initial-connect-policy.js";

function createRuntimePlan(): NonNullable<SandboxInstanceStatusResult["runtimePlan"]> {
  return {
    sandboxProfileId: "sbp_123",
    version: 1,
    image: {
      source: "base",
      imageRef: "img_123",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo-1",
        originUrl: "https://github.com/acme/repo-1.git",
      },
    ],
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
            cwd: "/root/acme/repo-1/packages/app",
            command: "codex",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "main",
            cols: 120,
            rows: 40,
            cwd: "/root/acme/repo-1/packages/app",
            command: "codex",
            args: [],
          },
        },
      },
    ],
  };
}

describe("session initial connect policy", () => {
  it("waits for the runtime plan before auto-connecting a new session", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: null,
        runtimePlan: null,
      }),
    ).toEqual({
      type: "wait_for_runtime_plan",
    });
  });

  it("prefers the provider thread when automation state exposes one", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: "thread_123",
        runtimePlan: null,
      }),
    ).toEqual({
      type: "provider_thread",
      threadId: "thread_123",
    });
  });

  it("starts a new thread in the raw runtime-plan cwd once the plan is available", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: null,
        runtimePlan: createRuntimePlan(),
      }),
    ).toEqual({
      type: "new_thread",
      cwd: "/root/acme/repo-1/packages/app",
    });
  });
});
