import { OpenCodeServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/opencode/server";
import { describe, expect, it } from "vitest";

import { buildOpenCodeCliPtyOpenInput } from "./opencode-cli-launch.js";

describe("buildOpenCodeCliPtyOpenInput", () => {
  it("attaches OpenCode TUI to the active server session and selected repository", () => {
    expect(
      buildOpenCodeCliPtyOpenInput({
        launchTarget: {
          type: "resume",
          threadId: "ses_123",
        },
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
      buildOpenCodeCliPtyOpenInput({
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
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
