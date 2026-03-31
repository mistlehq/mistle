import { describe, expect, it } from "vitest";

import { resolveAgentPtyLaunchTemplate } from "./pty-launch.js";

const CodexPtyLaunch = {
  runtimeId: "codex",
  displayName: "Codex",
  newLaunch: {
    ptySessionId: "cli",
    cols: 120,
    rows: 32,
    command: "codex",
    args: [
      {
        kind: "literal" as const,
        value: "--remote",
      },
      {
        kind: "literal" as const,
        value: "ws://127.0.0.1:4500",
      },
    ],
  },
  resumeLaunch: {
    ptySessionId: "cli",
    cols: 120,
    rows: 32,
    command: "codex",
    args: [
      {
        kind: "literal" as const,
        value: "resume",
      },
      {
        kind: "literal" as const,
        value: "--remote",
      },
      {
        kind: "literal" as const,
        value: "ws://127.0.0.1:4500",
      },
      {
        kind: "threadId" as const,
      },
    ],
  },
};

describe("resolveAgentPtyLaunchTemplate", () => {
  it("resolves the new launch template when no thread id is present", () => {
    expect(
      resolveAgentPtyLaunchTemplate({
        launch: CodexPtyLaunch,
        threadId: null,
      }),
    ).toEqual({
      ptySessionId: "cli",
      cols: 120,
      rows: 32,
      command: "codex",
      args: ["--remote", "ws://127.0.0.1:4500"],
    });
  });

  it("resolves the resume launch template when a thread id is present", () => {
    expect(
      resolveAgentPtyLaunchTemplate({
        launch: CodexPtyLaunch,
        threadId: "thread_123",
      }),
    ).toEqual({
      ptySessionId: "cli",
      cols: 120,
      rows: 32,
      command: "codex",
      args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
    });
  });
});
