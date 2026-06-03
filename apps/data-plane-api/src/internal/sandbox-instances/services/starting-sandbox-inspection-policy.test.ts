import { SandboxInspectDispositions } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import {
  determineStartingSandboxInspectionOutcome,
  StartingSandboxInspectionOutcomes,
} from "./starting-sandbox-inspection-policy.js";

describe("determineStartingSandboxInspectionOutcome", () => {
  it("keeps starting sandboxes in starting when the provider runtime is active", () => {
    expect(
      determineStartingSandboxInspectionOutcome({
        providerDisposition: SandboxInspectDispositions.ACTIVE,
      }),
    ).toEqual({
      kind: StartingSandboxInspectionOutcomes.KEEP_STARTING,
    });
  });

  it("keeps starting sandboxes in starting when the provider runtime is stopping", () => {
    expect(
      determineStartingSandboxInspectionOutcome({
        providerDisposition: SandboxInspectDispositions.STOPPING,
      }),
    ).toEqual({
      kind: StartingSandboxInspectionOutcomes.KEEP_STARTING,
    });
  });

  it("keeps starting sandboxes in starting when the provider runtime is resumably stopped", () => {
    expect(
      determineStartingSandboxInspectionOutcome({
        providerDisposition: SandboxInspectDispositions.RESUMABLE_STOPPED,
      }),
    ).toEqual({
      kind: StartingSandboxInspectionOutcomes.KEEP_STARTING,
    });
  });

  it("fails starting sandboxes when the provider runtime is terminal", () => {
    expect(
      determineStartingSandboxInspectionOutcome({
        providerDisposition: SandboxInspectDispositions.TERMINAL_STOPPED,
      }),
    ).toEqual({
      kind: StartingSandboxInspectionOutcomes.FAIL,
      failureCode: "provider_runtime_stopped_during_startup",
      failureMessage: "Sandbox runtime was not running at the provider during startup inspection.",
    });
  });
});
