import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import type { SandboxInspectDisposition } from "@mistle/sandbox";
import {
  getSandboxDisconnectReconciliationPhase,
  SandboxDisconnectReconciliationPhases,
  type SandboxInstanceStatus,
} from "@mistle/sandbox-lifecycle";

export type DisconnectReconciliationAction =
  | {
      kind: "fail";
      failureCode: string;
      failureMessage: string;
    }
  | {
      kind: "mark_stopped";
    }
  | {
      kind: "stop_then_mark_stopped";
    };

/**
 * Maps durable sandbox status plus provider-backed runtime disposition into the
 * exact action the disconnect reconciliation workflow should take.
 *
 * This is intentionally provider-agnostic. Provider-specific interpretation
 * belongs in `@mistle/sandbox`, which reduces raw provider payloads into the
 * shared `SandboxInspectDisposition`.
 *
 * This policy reports the reconciliation condition. When startup diagnostics
 * already recorded a more specific failure, the reconciliation workflow enriches
 * the persisted failure message from sandbox operation events before marking
 * the instance failed.
 */
export function determineDisconnectReconciliationAction(input: {
  persistenceMode: string;
  sandboxStatus: SandboxInstanceStatus;
  providerState: SandboxInspectDisposition | "missing";
}): DisconnectReconciliationAction {
  const lifecyclePhase = getSandboxDisconnectReconciliationPhase(input.sandboxStatus);
  if (lifecyclePhase === null) {
    throw new Error(
      `Disconnect reconciliation does not support sandbox status '${input.sandboxStatus}'.`,
    );
  }

  switch (lifecyclePhase) {
    case SandboxDisconnectReconciliationPhases.STARTUP: {
      switch (input.providerState) {
        case "missing":
          if (input.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
            return {
              kind: "mark_stopped",
            };
          }
          return {
            kind: "fail",
            failureCode: "provider_runtime_missing",
            failureMessage:
              "Sandbox runtime was not found at the provider during disconnect reconciliation.",
          };
        case "resumable_stopped":
          return {
            kind: "mark_stopped",
          };
        case "terminal_stopped":
          if (input.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
            return {
              kind: "mark_stopped",
            };
          }
          return {
            kind: "fail",
            failureCode: "provider_runtime_terminal",
            failureMessage:
              "Sandbox runtime was terminal at the provider during disconnect reconciliation.",
          };
        case "active":
          return {
            kind: "fail",
            failureCode: "bootstrap_disconnected_during_startup",
            failureMessage:
              "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.",
          };
      }
    }
    case SandboxDisconnectReconciliationPhases.RUNTIME:
    case SandboxDisconnectReconciliationPhases.STOPPING: {
      switch (input.providerState) {
        case "missing":
          if (input.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
            return {
              kind: "mark_stopped",
            };
          }
          return {
            kind: "fail",
            failureCode: "provider_runtime_missing",
            failureMessage:
              "Sandbox runtime was not found at the provider during disconnect reconciliation.",
          };
        case "resumable_stopped":
          return {
            kind: "mark_stopped",
          };
        case "terminal_stopped":
          if (input.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
            return {
              kind: "mark_stopped",
            };
          }
          return {
            kind: "fail",
            failureCode: "provider_runtime_terminal",
            failureMessage:
              "Sandbox runtime was terminal at the provider during disconnect reconciliation.",
          };
        case "active":
          return {
            kind: "stop_then_mark_stopped",
          };
      }
    }
  }
}
