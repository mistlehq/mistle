export type MainPanelTransitionState =
  | "stable_chat"
  | "switching_to_cli"
  | "stable_cli"
  | "restoring_chat";

export type MainPanelTransitionError = {
  kind: "cli_handoff_failed" | "chat_restore_failed";
  message: string | null;
} | null;

export type SessionMainPanelHandoffState = {
  transitionState: MainPanelTransitionState;
  error: MainPanelTransitionError;
};

export type SessionMainPanelHandoffAction =
  | {
      type: "handoff_to_cli_requested";
    }
  | {
      type: "cli_handoff_succeeded";
    }
  | {
      type: "cli_handoff_failed";
      errorMessage: string | null;
    }
  | {
      type: "chat_restore_requested";
    }
  | {
      type: "chat_restore_failed";
      errorMessage: string | null;
    }
  | {
      type: "reset_to_stable_chat";
    };

const CliToggleActiveStates = new Set<MainPanelTransitionState>(["switching_to_cli", "stable_cli"]);

function createHandoffState(
  transitionState: MainPanelTransitionState,
  error: MainPanelTransitionError = null,
): SessionMainPanelHandoffState {
  return {
    transitionState,
    error,
  };
}

export const InitialSessionMainPanelHandoffState = createHandoffState("stable_chat");

export function reduceSessionMainPanelHandoffState(
  _state: SessionMainPanelHandoffState,
  action: SessionMainPanelHandoffAction,
): SessionMainPanelHandoffState {
  switch (action.type) {
    case "handoff_to_cli_requested": {
      return createHandoffState("switching_to_cli");
    }

    case "cli_handoff_succeeded": {
      return createHandoffState("stable_cli");
    }

    case "cli_handoff_failed": {
      return createHandoffState("stable_chat", {
        kind: "cli_handoff_failed",
        message: action.errorMessage,
      });
    }

    case "chat_restore_requested": {
      return createHandoffState("restoring_chat");
    }

    case "reset_to_stable_chat": {
      return InitialSessionMainPanelHandoffState;
    }

    case "chat_restore_failed": {
      return createHandoffState("stable_chat", {
        kind: "chat_restore_failed",
        message: action.errorMessage,
      });
    }
  }
}

export function isCliToggleActive(transitionState: MainPanelTransitionState): boolean {
  return CliToggleActiveStates.has(transitionState);
}
