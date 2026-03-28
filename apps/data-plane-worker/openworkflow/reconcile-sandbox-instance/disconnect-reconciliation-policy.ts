import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import type { SandboxInspectDisposition } from "@mistle/sandbox";

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
 */
export function determineDisconnectReconciliationAction(input: {
  sandboxStatus: string;
  providerState: SandboxInspectDisposition | "missing";
}): DisconnectReconciliationAction {
  switch (input.sandboxStatus) {
    case SandboxInstanceStatuses.STARTING: {
      switch (input.providerState) {
        case "missing":
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
    case SandboxInstanceStatuses.RUNNING: {
      switch (input.providerState) {
        case "missing":
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
    default:
      throw new Error(
        `Disconnect reconciliation does not support sandbox status '${input.sandboxStatus}'.`,
      );
  }
}
