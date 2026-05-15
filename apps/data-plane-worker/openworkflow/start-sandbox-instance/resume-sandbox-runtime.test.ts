import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import {
  isSandboxdAlreadyInitializedForResume,
  isSandboxdInitializationAlreadyInProgressForResume,
  resolveResumeStartupMode,
} from "./resume-sandbox-runtime.js";

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

  it("uses existing startup mode for Tensorlake provider resumes", () => {
    expect(
      resolveResumeStartupMode({
        runtimeProvider: SandboxProvider.TENSORLAKE,
      }),
    ).toBe("existing");
  });
});

describe("sandboxd resume initialization errors", () => {
  it("identifies already-initialized sandboxd as requiring resume", () => {
    expect(
      isSandboxdAlreadyInitializedForResume(
        new Error(
          "control socket returned an error: sandboxd has already completed initialization",
        ),
      ),
    ).toBe(true);
  });

  it("identifies in-progress sandboxd initialization as requiring wait", () => {
    expect(
      isSandboxdInitializationAlreadyInProgressForResume(
        new Error("control socket returned an error: sandboxd is already initializing"),
      ),
    ).toBe(true);
    expect(
      isSandboxdInitializationAlreadyInProgressForResume(
        new Error("control socket returned an error: sandboxd init worker is already running"),
      ),
    ).toBe(true);
  });

  it("does not classify failed initialization as resumable", () => {
    const failedInitialization = new Error(
      "control socket returned an error: sandboxd initialization already failed: setup failed",
    );

    expect(isSandboxdAlreadyInitializedForResume(failedInitialization)).toBe(false);
    expect(isSandboxdInitializationAlreadyInProgressForResume(failedInitialization)).toBe(false);
  });
});
