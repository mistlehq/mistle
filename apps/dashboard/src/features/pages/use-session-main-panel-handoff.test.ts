import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { describe, expect, it } from "vitest";

import {
  buildCliPtyOpenInput,
  resolveChatRestoreConnectionInput,
} from "./use-session-main-panel-handoff.js";

describe("buildCliPtyOpenInput", () => {
  it("includes cwd when resuming a thread in a selected repository", () => {
    expect(
      buildCliPtyOpenInput({
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

  it("omits cwd when no repository is selected", () => {
    expect(
      buildCliPtyOpenInput({
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

describe("resolveChatRestoreConnectionInput", () => {
  it("preserves durable provider thread authority without a selection policy", () => {
    expect(
      resolveChatRestoreConnectionInput({
        sandboxInstanceId: "sandbox_123",
        durableThreadId: "thread_provider",
      }),
    ).toEqual({
      sandboxInstanceId: "sandbox_123",
      targetThreadId: "thread_provider",
      providerThreadId: "thread_provider",
    });
  });

  it("uses most recently updated selection for local sessions without durable authority", () => {
    expect(
      resolveChatRestoreConnectionInput({
        sandboxInstanceId: "sandbox_123",
        durableThreadId: null,
      }),
    ).toEqual({
      sandboxInstanceId: "sandbox_123",
      targetThreadId: null,
      selectionPolicy: "most_recently_updated",
    });
  });
});
