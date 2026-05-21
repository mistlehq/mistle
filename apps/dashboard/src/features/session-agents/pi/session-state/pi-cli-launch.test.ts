import { describe, expect, it } from "vitest";

import { buildPiCliPtyOpenInput } from "./pi-cli-launch.js";

describe("buildPiCliPtyOpenInput", () => {
  it("attaches Pi TUI to the active session file and selected repository", () => {
    expect(
      buildPiCliPtyOpenInput({
        launchTarget: {
          type: "resume",
          threadId: "/root/.pi/sessions/session.jsonl",
        },
        ptySessionId: "cli_launch_1",
        sandboxInstanceId: "sandbox_123",
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      args: ["--session", "/root/.pi/sessions/session.jsonl"],
      cols: 120,
      command: "pi",
      cwd: "/root/acme/repo-2",
      ptySessionId: "cli_launch_1",
      rows: 32,
      sandboxInstanceId: "sandbox_123",
    });
  });
});
