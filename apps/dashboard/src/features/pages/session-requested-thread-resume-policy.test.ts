import { describe, expect, it } from "vitest";

import { shouldAttemptRequestedThreadResume } from "./session-requested-thread-resume-policy.js";

describe("shouldAttemptRequestedThreadResume", () => {
  it("does not resume when there is no requested thread", () => {
    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_active",
        previousAttempt: null,
        providerThreadId: null,
        requestedThreadId: null,
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(false);
  });

  it("does not resume when the requested thread is already active", () => {
    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_requested",
        previousAttempt: null,
        providerThreadId: null,
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(false);
  });

  it("does not resume a requested thread when a provider thread owns the session", () => {
    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_provider",
        previousAttempt: null,
        providerThreadId: "thread_provider",
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(false);
  });

  it("resumes a requested thread once for the same sandbox", () => {
    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_active",
        previousAttempt: null,
        providerThreadId: null,
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(true);

    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_active",
        previousAttempt: {
          sandboxInstanceId: "sbi_test",
          threadId: "thread_requested",
        },
        providerThreadId: null,
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(false);
  });

  it("allows a new attempt when the requested thread or sandbox changes", () => {
    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_active",
        previousAttempt: {
          sandboxInstanceId: "sbi_test",
          threadId: "thread_requested",
        },
        providerThreadId: null,
        requestedThreadId: "thread_next",
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(true);

    expect(
      shouldAttemptRequestedThreadResume({
        activeThreadId: "thread_active",
        previousAttempt: {
          sandboxInstanceId: "sbi_test",
          threadId: "thread_requested",
        },
        providerThreadId: null,
        requestedThreadId: "thread_requested",
        sandboxInstanceId: "sbi_other",
      }),
    ).toBe(true);
  });
});
