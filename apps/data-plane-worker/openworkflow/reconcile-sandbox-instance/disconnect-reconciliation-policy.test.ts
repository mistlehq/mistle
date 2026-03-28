import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import {
  classifyDockerDisconnectProviderState,
  classifyE2BDisconnectProviderState,
  determineDisconnectReconciliationAction,
} from "./disconnect-reconciliation-policy.js";

describe("disconnect reconciliation provider classification", () => {
  it("treats running and restarting Docker containers as active", () => {
    expect(classifyDockerDisconnectProviderState("running")).toBe("active");
    expect(classifyDockerDisconnectProviderState("restarting")).toBe("active");
  });

  it("treats paused and exited Docker containers as resumably stopped", () => {
    expect(classifyDockerDisconnectProviderState("paused")).toBe("resumable_stopped");
    expect(classifyDockerDisconnectProviderState("exited")).toBe("resumable_stopped");
  });

  it("treats dead Docker containers as terminal", () => {
    expect(classifyDockerDisconnectProviderState("dead")).toBe("terminal_stopped");
  });

  it("treats running E2B sandboxes as active and paused sandboxes as resumably stopped", () => {
    expect(classifyE2BDisconnectProviderState("running")).toBe("active");
    expect(classifyE2BDisconnectProviderState("paused")).toBe("resumable_stopped");
  });
});

describe("determineDisconnectReconciliationAction", () => {
  it("fails starting sandboxes whose provider runtime is missing", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: SandboxInstanceStatuses.STARTING,
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
        sandboxStatus: SandboxInstanceStatuses.STARTING,
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("fails starting sandboxes when the bootstrap tunnel never recovered during startup", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: SandboxInstanceStatuses.STARTING,
        providerState: "active",
      }),
    ).toEqual({
      kind: "fail",
      failureCode: "bootstrap_disconnected_during_startup",
      failureMessage:
        "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.",
    });
  });

  it("stops running sandboxes that still exist at the provider", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: SandboxInstanceStatuses.RUNNING,
        providerState: "active",
      }),
    ).toEqual({
      kind: "stop_then_mark_stopped",
    });
  });

  it("marks running sandboxes stopped when the provider runtime is resumably stopped", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: SandboxInstanceStatuses.RUNNING,
        providerState: "resumable_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("fails running sandboxes when the provider runtime is terminal", () => {
    expect(
      determineDisconnectReconciliationAction({
        sandboxStatus: SandboxInstanceStatuses.RUNNING,
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
