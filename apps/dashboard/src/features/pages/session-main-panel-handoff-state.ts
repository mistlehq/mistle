export type MainPanelTransitionState =
  | "stable_chat"
  | "switching_to_cli"
  | "cli_entry_failed"
  | "stable_cli"
  | "restoring_chat"
  | "restore_failed";

export type SessionMainPanelHandoffState = {
  transitionState: MainPanelTransitionState;
  errorMessage: string | null;
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

export const InitialSessionMainPanelHandoffState: SessionMainPanelHandoffState = {
  transitionState: "stable_chat",
  errorMessage: null,
};

export function reduceSessionMainPanelHandoffState(
  _state: SessionMainPanelHandoffState,
  action: SessionMainPanelHandoffAction,
): SessionMainPanelHandoffState {
  switch (action.type) {
    case "handoff_to_cli_requested": {
      return {
        transitionState: "switching_to_cli",
        errorMessage: null,
      };
    }

    case "cli_handoff_succeeded": {
      return {
        transitionState: "stable_cli",
        errorMessage: null,
      };
    }

    case "cli_handoff_failed": {
      return {
        transitionState: "cli_entry_failed",
        errorMessage: action.errorMessage,
      };
    }

    case "chat_restore_requested": {
      return {
        transitionState: "restoring_chat",
        errorMessage: null,
      };
    }

    case "reset_to_stable_chat": {
      return {
        transitionState: "stable_chat",
        errorMessage: null,
      };
    }

    case "chat_restore_failed": {
      return {
        transitionState: "restore_failed",
        errorMessage: action.errorMessage,
      };
    }
  }
}

export function isCliToggleActive(transitionState: MainPanelTransitionState): boolean {
  return (
    transitionState === "switching_to_cli" ||
    transitionState === "cli_entry_failed" ||
    transitionState === "stable_cli"
  );
}

export function canRenderChatComposer(transitionState: MainPanelTransitionState): boolean {
  return transitionState === "stable_chat";
}

export function shouldLifecycleAutoAttachChat(transitionState: MainPanelTransitionState): boolean {
  return transitionState === "stable_chat";
}
