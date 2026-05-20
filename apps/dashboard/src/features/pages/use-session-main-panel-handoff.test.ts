import { describe, expect, it } from "vitest";

import {
  resolveChatRestoreConnectionInput,
  resolveCliRestoreContext,
} from "./use-session-main-panel-handoff.js";

describe("resolveCliRestoreContext", () => {
  it("preserves the launched conversation and directory for runtimes that restore exact CLI sessions", () => {
    expect(
      resolveCliRestoreContext({
        fallbackConversationId: null,
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "resume",
          threadId: "ses_launched",
        },
        preserveLaunchContext: true,
      }),
    ).toEqual({
      runtimeConversationId: "ses_launched",
      initialCwd: "/root/acme/repo-2",
    });
  });

  it("keeps Codex local handoffs on fallback restore authority", () => {
    expect(
      resolveCliRestoreContext({
        fallbackConversationId: null,
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "resume",
          threadId: "local_thread",
        },
        preserveLaunchContext: false,
      }),
    ).toEqual({
      runtimeConversationId: null,
      initialCwd: null,
    });
  });

  it("uses the fallback conversation id for start-new handoffs", () => {
    expect(
      resolveCliRestoreContext({
        fallbackConversationId: "thread_fallback",
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
        preserveLaunchContext: true,
      }),
    ).toEqual({
      runtimeConversationId: "thread_fallback",
      initialCwd: "/root/acme/repo-2",
    });
  });
});

describe("resolveChatRestoreConnectionInput", () => {
  it("preserves durable provider conversation authority without a selection policy", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: "/root/acme/repo-2",
        sandboxInstanceId: "sandbox_123",
        durableRuntimeConversationId: "thread_provider",
      }),
    ).toEqual({
      initialCwd: "/root/acme/repo-2",
      sandboxInstanceId: "sandbox_123",
      targetRuntimeConversationId: "thread_provider",
      providerConversationId: "thread_provider",
    });
  });

  it("uses most recently updated selection for local sessions without durable authority", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: null,
        sandboxInstanceId: "sandbox_123",
        durableRuntimeConversationId: null,
      }),
    ).toEqual({
      initialCwd: null,
      sandboxInstanceId: "sandbox_123",
      targetRuntimeConversationId: null,
      selectionPolicy: "most_recently_updated",
    });
  });
});
