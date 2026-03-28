import { SandboxInstanceStatuses } from "@mistle/db/data-plane";

export type DisconnectProviderState = "active" | "resumable_stopped" | "terminal_stopped";

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

export function classifyDockerDisconnectProviderState(state: string): DisconnectProviderState {
  switch (state) {
    case "running":
    case "restarting":
      return "active";
    case "paused":
    case "exited":
      return "resumable_stopped";
    case "dead":
    case "removing":
      return "terminal_stopped";
    case "created":
      throw new Error("Docker disconnect reconciliation does not support created containers.");
    default:
      throw new Error(
        `Docker disconnect reconciliation does not support provider state '${state}'.`,
      );
  }
}

export function classifyE2BDisconnectProviderState(state: string): DisconnectProviderState {
  switch (state) {
    case "running":
      return "active";
    case "paused":
      return "resumable_stopped";
    default:
      throw new Error(`E2B disconnect reconciliation does not support provider state '${state}'.`);
  }
}

export function determineDisconnectReconciliationAction(input: {
  sandboxStatus: string;
  providerState: DisconnectProviderState | "missing";
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
