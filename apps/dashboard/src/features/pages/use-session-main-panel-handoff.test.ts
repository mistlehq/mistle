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
        fallbackProviderConversationId: "ses_original",
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "resume",
          threadId: "ses_launched",
        },
        preserveLaunchContext: true,
      }),
    ).toEqual({
      runtimeConversationId: "ses_launched",
      providerConversationId: "ses_original",
      initialCwd: "/root/acme/repo-2",
    });
  });

  it("keeps Codex local handoffs on fallback restore authority", () => {
    expect(
      resolveCliRestoreContext({
        fallbackConversationId: null,
        fallbackProviderConversationId: null,
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "resume",
          threadId: "local_thread",
        },
        preserveLaunchContext: false,
      }),
    ).toEqual({
      runtimeConversationId: null,
      providerConversationId: null,
      initialCwd: null,
    });
  });

  it("uses the fallback conversation id for start-new handoffs", () => {
    expect(
      resolveCliRestoreContext({
        fallbackConversationId: "thread_fallback",
        fallbackProviderConversationId: "thread_provider",
        launchDirectory: "/root/acme/repo-2",
        launchTarget: {
          type: "start_new",
          shouldClearActiveThreadId: false,
        },
        preserveLaunchContext: true,
      }),
    ).toEqual({
      runtimeConversationId: "thread_fallback",
      providerConversationId: "thread_provider",
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
        durableRuntimeConversationId: "thread_active",
        explicitProviderConversationId: "thread_provider",
      }),
    ).toEqual({
      initialCwd: "/root/acme/repo-2",
      sandboxInstanceId: "sandbox_123",
      targetRuntimeConversationId: "thread_active",
      providerConversationId: "thread_provider",
    });
  });

  it("restores local provider sessions without marking the target as provider authority", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: "/root/acme/repo-2",
        sandboxInstanceId: "sandbox_123",
        durableRuntimeConversationId: "ses_active",
        explicitProviderConversationId: null,
      }),
    ).toEqual({
      initialCwd: "/root/acme/repo-2",
      sandboxInstanceId: "sandbox_123",
      targetRuntimeConversationId: "ses_active",
    });
  });

  it("uses most recently updated selection for local sessions without durable authority", () => {
    expect(
      resolveChatRestoreConnectionInput({
        initialCwd: null,
        sandboxInstanceId: "sandbox_123",
        durableRuntimeConversationId: null,
        explicitProviderConversationId: null,
      }),
    ).toEqual({
      initialCwd: null,
      sandboxInstanceId: "sandbox_123",
      targetRuntimeConversationId: null,
      selectionPolicy: "most_recently_updated",
    });
  });
});
