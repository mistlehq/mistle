import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { OpenCodeServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/opencode/server";
import { describe, expect, it } from "vitest";

import { buildCliPtyOpenInput } from "./session-runtime-cli-launch.js";

describe("buildCliPtyOpenInput", () => {
  it("includes cwd when resuming a Codex thread in a selected repository", () => {
    expect(
      buildCliPtyOpenInput({
        launchTarget: {
          type: "resume",
          threadId: "thread_123",
        },
        runtimeId: "codex",
        sandboxInstanceId: "sandbox_123",
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      args: ["resume", "--remote", CodexAppServerListenUrl, "thread_123"],
      cols: 120,
      command: "codex",
      cwd: "/root/acme/repo-2",
      ptySessionId: "cli",
      rows: 32,
      sandboxInstanceId: "sandbox_123",
    });
  });

  it("omits cwd when no Codex repository is selected", () => {
    expect(
      buildCliPtyOpenInput({
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
        runtimeId: "codex",
        sandboxInstanceId: "sandbox_123",
        selectedRepositoryPath: null,
      }),
    ).toEqual({
      args: ["--remote", CodexAppServerListenUrl],
      cols: 120,
      command: "codex",
      ptySessionId: "cli",
      rows: 32,
      sandboxInstanceId: "sandbox_123",
    });
  });

  it("attaches OpenCode TUI to the active server session and selected repository", () => {
    expect(
      buildCliPtyOpenInput({
        launchTarget: {
          type: "resume",
          threadId: "ses_123",
        },
        runtimeId: "opencode",
        sandboxInstanceId: "sandbox_123",
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      args: [
        "run",
        "--interactive",
        "--attach",
        OpenCodeServerListenUrl,
        "--session",
        "ses_123",
        "--dir",
        "/root/acme/repo-2",
      ],
      cols: 120,
      command: "opencode",
      cwd: "/root/acme/repo-2",
      ptySessionId: "cli",
      rows: 32,
      sandboxInstanceId: "sandbox_123",
    });
  });

  it("starts OpenCode TUI without a session when no active session is selected", () => {
    expect(
      buildCliPtyOpenInput({
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
        runtimeId: "opencode",
        sandboxInstanceId: "sandbox_123",
        selectedRepositoryPath: null,
      }),
    ).toEqual({
      args: ["run", "--interactive", "--attach", OpenCodeServerListenUrl],
      cols: 120,
      command: "opencode",
      ptySessionId: "cli",
      rows: 32,
      sandboxInstanceId: "sandbox_123",
    });
  });
});
