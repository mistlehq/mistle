import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { resolveResumeStartupMode } from "./resume-sandbox-runtime.js";

describe("resolveResumeStartupMode", () => {
  it("uses a fresh startup mode for Docker provider resumes", () => {
    expect(
      resolveResumeStartupMode({
        runtimeProvider: SandboxProvider.DOCKER,
      }),
    ).toBe("new");
  });

  it("uses existing startup mode for E2B provider resumes", () => {
    expect(
      resolveResumeStartupMode({
        runtimeProvider: SandboxProvider.E2B,
      }),
    ).toBe("existing");
  });
});
