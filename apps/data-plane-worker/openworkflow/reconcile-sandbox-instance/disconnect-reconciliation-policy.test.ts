import { describe, expect, it } from "vitest";

import { determineDisconnectReconciliationAction } from "./disconnect-reconciliation-policy.js";

describe("determineDisconnectReconciliationAction", () => {
  it("fails starting sandboxes whose provider runtime is missing", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "starting",
        providerState: "missing",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_missing",
      failureMessage:
        "Sandbox runtime was not found at the provider during disconnect reconciliation.",
    });
  });

  it("marks starting sandboxes stopped when the provider runtime is resumably stopped", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "starting",
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("conditionally stops starting sandboxes when bootstrap disconnect is the only startup failure", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "starting",
        providerState: "active",
      }),
    ).toEqual({
      kind: "fail_if_startup_failure_evidence_else_stop",
      failureCode: "bootstrap_disconnected_during_startup",
      failureMessage:
        "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.",
    });
  });

  it("uses the startup policy for started and initializing sandboxes", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "started",
        providerState: "active",
      }),
    ).toEqual({
      kind: "fail_if_startup_failure_evidence_else_stop",
      failureCode: "bootstrap_disconnected_during_startup",
      failureMessage:
        "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.",
    });
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "initializing",
        providerState: "active",
      }),
    ).toEqual({
      kind: "fail_if_startup_failure_evidence_else_stop",
      failureCode: "bootstrap_disconnected_during_startup",
      failureMessage:
        "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.",
    });
  });

  it("stops running sandboxes that still exist at the provider", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "running",
        providerState: "active",
      }),
    ).toEqual({
      kind: "stop_then_mark_stopped",
    });
  });

  it("stops reconnecting and stopping sandboxes that still exist at the provider", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "reconnecting",
        providerState: "active",
      }),
    ).toEqual({
      kind: "stop_then_mark_stopped",
    });
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "stopping",
        providerState: "active",
      }),
    ).toEqual({
      kind: "stop_then_mark_stopped",
    });
  });

  it("handles provider stop-in-progress explicitly during runtime reconciliation", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "stopping",
        providerState: "stopping",
      }),
    ).toEqual({
      kind: "retry_provider_stop_in_progress",
      reason:
        "Sandbox runtime stop is still in progress at the provider during disconnect reconciliation.",
    });
  });

  it("handles provider stop-in-progress explicitly during startup reconciliation", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "starting",
        providerState: "stopping",
      }),
    ).toEqual({
      kind: "retry_provider_stop_in_progress",
      reason:
        "Sandbox runtime stop is still in progress at the provider during disconnect reconciliation.",
    });
  });

  it("marks running sandboxes stopped when the provider runtime is resumably stopped", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "running",
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("fails running sandboxes when the provider runtime is terminal", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "running",
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_terminal",
      failureMessage:
        "Sandbox runtime was terminal at the provider during disconnect reconciliation.",
    });
  });

  it("fails stopping sandboxes when provider runtime is terminal", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "stopping",
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_terminal",
      failureMessage:
        "Sandbox runtime was terminal at the provider during disconnect reconciliation.",
    });
  });

  it("fails running sandboxes when provider compute is missing", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "running",
        providerState: "missing",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_missing",
      failureMessage:
        "Sandbox runtime was not found at the provider during disconnect reconciliation.",
    });
  });

  it("fails starting sandboxes when provider compute is terminal", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: "starting",
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "provider_runtime_terminal",
      failureMessage:
        "Sandbox runtime was terminal at the provider during disconnect reconciliation.",
    });
  });
});
