import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { shouldTransitionDeletedProviderCleanupToStopped } from "./delete-sandbox-instance.js";

describe("shouldTransitionDeletedProviderCleanupToStopped", () => {
  it("transitions startup rows after provider cleanup so delete retries can complete idempotently", () => {
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.PENDING)).toBe(
      true,
    );
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.STARTING)).toBe(
      true,
    );
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.STARTED)).toBe(
      true,
    );
    expect(
      shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.INITIALIZING),
    ).toBe(true);
  });

  it("does not rewrite already-terminal or ordinary runtime states", () => {
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.RUNNING)).toBe(
      false,
    );
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.STOPPING)).toBe(
      false,
    );
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.STOPPED)).toBe(
      false,
    );
    expect(shouldTransitionDeletedProviderCleanupToStopped(SandboxInstanceStatuses.FAILED)).toBe(
      false,
    );
  });
});
