import { describe, expect, it } from "vitest";

import { resolveTriggerTargetSandboxProfileVersion } from "./trigger-target-profile-version.js";

describe("resolveTriggerTargetSandboxProfileVersion", () => {
  it("preserves an explicitly requested sandbox profile version", () => {
    expect(
      resolveTriggerTargetSandboxProfileVersion({
        requestedVersion: 3,
        activeVersion: 2,
      }),
    ).toBe(3);
  });

  it("uses the active sandbox profile version when no version is requested", () => {
    expect(
      resolveTriggerTargetSandboxProfileVersion({
        activeVersion: 2,
      }),
    ).toBe(2);
  });

  it("targets the initial sandbox profile version when no active version exists", () => {
    expect(
      resolveTriggerTargetSandboxProfileVersion({
        activeVersion: null,
      }),
    ).toBe(1);
  });
});
