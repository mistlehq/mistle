import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { describe, expect, it } from "vitest";

import { buildCodexCliPtyOpenInput } from "./codex-cli-launch.js";

describe("buildCodexCliPtyOpenInput", () => {
  it("includes cwd when resuming a Codex thread in a selected repository", () => {
    expect(
      buildCodexCliPtyOpenInput({
        launchTarget: {
          type: "resume",
          threadId: "thread_123",
        },
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
      buildCodexCliPtyOpenInput({
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
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
});
