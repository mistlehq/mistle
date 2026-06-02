import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { usesLegacyResumeForProviderPreservedDaemonEgressRefresh } from "./resume-sandbox-runtime.js";

describe("sandboxd resume activation routing", () => {
  it("keeps only E2B on the legacy resume path while initialized activation cannot refresh preserved egress state", () => {
    expect(usesLegacyResumeForProviderPreservedDaemonEgressRefresh(SandboxProvider.E2B)).toBe(true);
    expect(usesLegacyResumeForProviderPreservedDaemonEgressRefresh(SandboxProvider.DOCKER)).toBe(
      false,
    );
    expect(
      usesLegacyResumeForProviderPreservedDaemonEgressRefresh(SandboxProvider.TENSORLAKE),
    ).toBe(false);
  });
});
