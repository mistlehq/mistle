import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { OpenCodeServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/opencode/server";
import { describe, expect, it } from "vitest";

import {
  buildCliPtyOpenInput,
  resolveChatRestoreConnectionInput,
  resolveCliRestoreConversationId,
  resolveCliRestoreInitialCwd,
} from "./use-session-main-panel-handoff.js";

describe("buildCliPtyOpenInput", () => {
  it("includes cwd when resuming a thread in a selected repository", () => {
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

  it("omits cwd when no repository is selected", () => {
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

describe("resolveCliRestoreConversationId", () => {
  it("preserves the launched conversation id for runtimes that restore exact CLI sessions", () => {
    expect(
      resolveCliRestoreConversationId({
        fallbackConversationId: null,
        launchTarget: {
          type: "resume",
          threadId: "ses_launched",
        },
        preserveLaunchTarget: true,
      }),
    ).toBe("ses_launched");
  });

  it("keeps Codex local handoffs on fallback restore authority", () => {
    expect(
      resolveCliRestoreConversationId({
        fallbackConversationId: null,
        launchTarget: {
          type: "resume",
          threadId: "local_thread",
        },
        preserveLaunchTarget: false,
      }),
    ).toBeNull();
  });

  it("uses the fallback conversation id for start-new handoffs", () => {
    expect(
      resolveCliRestoreConversationId({
        fallbackConversationId: "thread_fallback",
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
        preserveLaunchTarget: true,
      }),
    ).toBe("thread_fallback");
  });
});

describe("resolveCliRestoreInitialCwd", () => {
  it("preserves the launch directory for runtimes that restore exact CLI sessions", () => {
    expect(
      resolveCliRestoreInitialCwd({
        launchDirectory: "/root/acme/repo-2",
        preserveLaunchDirectory: true,
      }),
    ).toBe("/root/acme/repo-2");
  });

  it("does not preserve the launch directory for Codex handoffs", () => {
    expect(
      resolveCliRestoreInitialCwd({
        launchDirectory: "/root/acme/repo-2",
        preserveLaunchDirectory: false,
      }),
    ).toBeNull();
  });
});

describe("resolveChatRestoreConnectionInput", () => {
  it("preserves durable provider thread authority without a selection policy", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: "/root/acme/repo-2",
        sandboxInstanceId: "sandbox_123",
        durableThreadId: "thread_provider",
      }),
    ).toEqual({
      initialCwd: "/root/acme/repo-2",
      sandboxInstanceId: "sandbox_123",
      targetThreadId: "thread_provider",
      providerThreadId: "thread_provider",
    });
  });

  it("uses most recently updated selection for local sessions without durable authority", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: null,
        sandboxInstanceId: "sandbox_123",
        durableThreadId: null,
      }),
    ).toEqual({
      initialCwd: null,
      sandboxInstanceId: "sandbox_123",
      targetThreadId: null,
      selectionPolicy: "most_recently_updated",
    });
  });
});
