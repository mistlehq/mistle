import { SandboxInspectDispositions } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { isStoppedSandboxProviderDispositionRecoverable } from "./stopped-sandbox-inspection-policy.js";

describe("isStoppedSandboxProviderDispositionRecoverable", () => {
  it("treats active, stopping, and resumably stopped provider runtimes as recoverable", () => {
    expect(isStoppedSandboxProviderDispositionRecoverable(SandboxInspectDispositions.ACTIVE)).toBe(
      true,
    );
    expect(
      isStoppedSandboxProviderDispositionRecoverable(SandboxInspectDispositions.STOPPING),
    ).toBe(true);
    expect(
      isStoppedSandboxProviderDispositionRecoverable(SandboxInspectDispositions.RESUMABLE_STOPPED),
    ).toBe(true);
  });

  it("treats terminal provider runtimes as not recoverable", () => {
    expect(
      isStoppedSandboxProviderDispositionRecoverable(SandboxInspectDispositions.TERMINAL_STOPPED),
    ).toBe(false);
  });
});
