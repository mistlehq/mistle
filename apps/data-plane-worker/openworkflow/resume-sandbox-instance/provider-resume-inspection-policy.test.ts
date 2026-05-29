import { describe, expect, it } from "vitest";

import {
  determineExistingProviderResumeAction,
  type ProviderResumeInspectionState,
} from "./provider-resume-inspection-policy.js";

describe("determineExistingProviderResumeAction", () => {
  it("resumes provider compute only when the provider reports resumable stopped", () => {
    expect(
      determineExistingProviderResumeAction({
        persistenceMode: "ephemeral",
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "resume_provider",
    });
  });

  it("uses already-active provider compute without asking the provider to resume it", () => {
    expect(
      determineExistingProviderResumeAction({
        persistenceMode: "ephemeral",
        providerState: "active",
      }),
    ).toEqual({
      kind: "use_active_provider",
    });
  });

  it("preserves persistent sandbox recovery when provider compute is missing or terminal", () => {
    const providerStates: ProviderResumeInspectionState[] = ["missing", "terminal_stopped"];

    for (const providerState of providerStates) {
      expect(
        determineExistingProviderResumeAction({
          persistenceMode: "persistent",
          providerState,
        }),
      ).toEqual({
        kind: "replace_provider_compute",
      });
    }
  });

  it("fails ephemeral sandboxes when provider compute is missing", () => {
    expect(
      determineExistingProviderResumeAction({
        persistenceMode: "ephemeral",
        providerState: "missing",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider before resume.",
    });
  });

  it("fails ephemeral sandboxes when provider compute is terminal", () => {
    expect(
      determineExistingProviderResumeAction({
        persistenceMode: "ephemeral",
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_not_resumable",
      failureMessage: "Sandbox runtime was not resumable at the provider before resume.",
    });
  });
});
