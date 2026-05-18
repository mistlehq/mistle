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
        providerThreadId: null,
        sandboxInstanceId: "sbi_123",
        runtimeContext: null,
      }),
    ).toThrow(MissingConnectableRuntimeContextMessage);
  });

  it("prefers the provider thread when trigger state exposes one", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerThreadId: "thread_123",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1/packages/app",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      providerThreadId: "thread_123",
      sandboxInstanceId: "sbi_123",
      targetThreadId: "thread_123",
    });
  });

  it("starts a new thread in the runtime context launch cwd", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerThreadId: null,
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
      targetThreadId: null,
    });
  });

  it("starts a new thread without a cwd when runtime context has no launch cwd", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: false,
        providerThreadId: null,
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
      targetThreadId: null,
    });
  });

  it("uses a requested thread when no provider thread is present", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerThreadId: null,
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      sandboxInstanceId: "sbi_123",
      targetThreadId: "thread_requested",
    });
  });

  it("keeps provider thread authority over a requested thread", () => {
    expect(
      resolveInitialSessionConnectInput({
        connectable: true,
        providerThreadId: "thread_provider",
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_123",
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: "/root/acme/repo-1",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      providerThreadId: "thread_provider",
      sandboxInstanceId: "sbi_123",
      targetThreadId: "thread_provider",
    });
  });
});
