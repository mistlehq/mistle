export type StopProviderState =
  | "active"
  | "stopping"
  | "resumable_stopped"
  | "terminal_stopped"
  | "missing";

export type StopProviderAction =
  | {
      kind: "fail";
      failureCode: string;
      failureMessage: string;
    }
  | {
      kind: "mark_stopped";
    }
  | {
      kind: "retry_provider_stop_in_progress";
      reason: string;
    }
  | {
      kind: "shutdown_stop_then_inspect";
    };

export function determineStopProviderAction(input: {
  providerState: StopProviderState;
}): StopProviderAction {
  switch (input.providerState) {
    case "missing":
      return {
        kind: "fail",
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider during stop execution.",
      };
    case "terminal_stopped":
      return {
        kind: "fail",
        failureCode: "provider_runtime_terminal",
        failureMessage: "Sandbox runtime was terminal at the provider during stop execution.",
      };
    case "resumable_stopped":
      return {
        kind: "mark_stopped",
      };
    case "stopping":
      return {
        kind: "retry_provider_stop_in_progress",
        reason: "Sandbox runtime stop is still in progress at the provider.",
      };
    case "active":
      return {
        kind: "shutdown_stop_then_inspect",
      };
  }
}
