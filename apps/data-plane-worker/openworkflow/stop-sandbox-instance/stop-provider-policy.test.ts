import { describe, expect, it } from "vitest";

import { determineStopProviderAction } from "./stop-provider-policy.js";

describe("determineStopProviderAction", () => {
  it("stops active provider runtimes before marking the sandbox stopped", () => {
    expect(
      determineStopProviderAction({
        providerState: "active",
      }),
    ).toEqual({
      kind: "shutdown_stop_then_inspect",
    });
  });

  it("waits when provider stop is already in progress", () => {
    expect(
      determineStopProviderAction({
        providerState: "stopping",
      }),
    ).toEqual({
      kind: "retry_provider_stop_in_progress",
      reason: "Sandbox runtime stop is still in progress at the provider.",
    });
  });

  it("marks the sandbox stopped only when the provider runtime is resumably stopped", () => {
    expect(
      determineStopProviderAction({
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("fails when the provider runtime is terminal", () => {
    expect(
      determineStopProviderAction({
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_terminal",
      failureMessage: "Sandbox runtime was terminal at the provider during stop execution.",
    });
  });

  it("fails when the provider runtime is missing", () => {
    expect(
      determineStopProviderAction({
        providerState: "missing",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during stop execution.",
    });
  });
});
