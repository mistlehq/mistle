import { describe, expect, it } from "vitest";

import { determineExistingProviderResumeAction } from "./provider-resume-inspection-policy.js";

describe("determineExistingProviderResumeAction", () => {
  it("resumes provider compute only when the provider reports resumable stopped", () => {
    expect(
      determineExistingProviderResumeAction({
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "resume_provider",
    });
  });

  it("uses already-active provider compute without asking the provider to resume it", () => {
    expect(
      determineExistingProviderResumeAction({
        providerState: "active",
      }),
    ).toEqual({
      kind: "use_active_provider",
    });
  });

  it("fails sandboxes when provider compute is missing", () => {
    expect(
      determineExistingProviderResumeAction({
        providerState: "missing",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider before resume.",
    });
  });

  it("fails sandboxes when provider compute is terminal", () => {
    expect(
      determineExistingProviderResumeAction({
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_not_resumable",
      failureMessage: "Sandbox runtime was not resumable at the provider before resume.",
    });
  });
});
