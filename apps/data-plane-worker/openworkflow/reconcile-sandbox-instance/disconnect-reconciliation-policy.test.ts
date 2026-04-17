import { SandboxInstancePersistenceModes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { determineDisconnectReconciliationAction } from "./disconnect-reconciliation-policy.js";

describe("determineDisconnectReconciliationAction", () => {
  it("fails starting sandboxes whose provider runtime is missing", () => {
    expect(
      determineDisconnectReconciliationAction({
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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

  it("marks persistent running sandboxes stopped when provider compute is missing", () => {
    expect(
      determineDisconnectReconciliationAction({
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxStatus: SandboxInstanceStatuses.RUNNING,
        providerState: "missing",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });

  it("marks persistent starting sandboxes stopped when provider compute is terminal", () => {
    expect(
      determineDisconnectReconciliationAction({
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxStatus: SandboxInstanceStatuses.STARTING,
        providerState: "terminal_stopped",
      }),
    ).toEqual({
      kind: "mark_stopped",
    });
  });
});
