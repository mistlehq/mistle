import { describe, expect, it } from "vitest";

import {
  MissingConnectableRuntimeContextMessage,
  resolveInitialSessionConnectTarget,
} from "./session-initial-connect-policy.js";

describe("session initial connect policy", () => {
  it("throws when a connectable session is missing runtime context", () => {
    expect(() =>
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: null,
        runtimeContext: null,
      }),
    ).toThrow(MissingConnectableRuntimeContextMessage);
  });

  it("prefers the provider thread when automation state exposes one", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: "thread_123",
        runtimeContext: {
          launchCwd: "/root/acme/repo-1/packages/app",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      type: "provider_thread",
      threadId: "thread_123",
    });
  });

  it("starts a new thread in the runtime context launch cwd", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: true,
        providerThreadId: null,
        runtimeContext: {
          launchCwd: "/root/acme/repo-1/packages/app",
          primaryRepositoryRoot: "/root/acme/repo-1",
        },
      }),
    ).toEqual({
      type: "new_thread",
      cwd: "/root/acme/repo-1/packages/app",
    });
  });

  it("starts a new thread without a cwd when runtime context has no launch cwd", () => {
    expect(
      resolveInitialSessionConnectTarget({
        connectable: false,
        providerThreadId: null,
        runtimeContext: {
          launchCwd: null,
          primaryRepositoryRoot: null,
        },
      }),
    ).toEqual({
      type: "new_thread",
    });
  });
});
