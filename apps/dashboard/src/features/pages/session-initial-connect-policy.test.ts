import { describe, expect, it } from "vitest";

import {
  MissingConnectableRuntimeContextMessage,
  resolveInitialSessionConnectInput,
} from "./session-initial-connect-policy.js";

describe("session initial connect policy", () => {
  it("throws when a connectable session is missing runtime context", () => {
    expect(() =>
      resolveInitialSessionConnectInput({
        connectable: true,
        providerConversationId: null,
        sandboxInstanceId: "sbi_123",
        runtimeContext: null,
      }),
    ).toThrow(MissingConnectableRuntimeContextMessage);
  });

  it("prefers the provider conversation when trigger state exposes one", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerConversationId: "thread_123",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1/packages/app",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      providerConversationId: "thread_123",
      sandboxInstanceId: "sbi_123",
      targetRuntimeConversationId: "thread_123",
    });
  });

  it("starts a new runtime conversation in the runtime context launch cwd", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerConversationId: null,
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1/packages/app",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      initialCwd: "/root/acme/repo-1/packages/app",
      selectionPolicy: "most_recently_updated",
      sandboxInstanceId: "sbi_123",
      targetRuntimeConversationId: null,
    });
  });

  it("starts a new runtime conversation without a cwd when runtime context has no launch cwd", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: false,
        providerConversationId: null,
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: null,
          primaryRepositoryRoot: null,
        },
      }),
    ).toEqual({
      selectionPolicy: "most_recently_updated",
      sandboxInstanceId: "sbi_123",
      targetRuntimeConversationId: null,
    });
  });

  it("uses a requested runtime conversation when no provider conversation is present", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerConversationId: null,
        requestedRuntimeConversationId: "thread_requested",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      sandboxInstanceId: "sbi_123",
      targetRuntimeConversationId: "thread_requested",
    });
  });

  it("keeps provider conversation authority over a requested runtime conversation", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerConversationId: "thread_provider",
        requestedRuntimeConversationId: "thread_requested",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      providerConversationId: "thread_provider",
      sandboxInstanceId: "sbi_123",
      targetRuntimeConversationId: "thread_provider",
    });
  });
});
