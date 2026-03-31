export type MainPanelTransitionState =
  | "stable_chat"
  | "switching_to_cli"
  | "cli_entry_failed"
  | "stable_cli"
  | "restoring_chat"
  | "restore_failed";

export type ChatRestoreStep = "connecting_transport" | "resolving_thread" | "hydrating_chat";

export type SessionMainPanelHandoffState = {
  transitionState: MainPanelTransitionState;
  errorMessage: string | null;
  restoreStep: ChatRestoreStep | null;
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
      type: "chat_restore_step_changed";
      restoreStep: ChatRestoreStep;
    }
  | {
      type: "chat_restore_succeeded";
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
  restoreStep: null,
};

export function reduceSessionMainPanelHandoffState(
  state: SessionMainPanelHandoffState,
  action: SessionMainPanelHandoffAction,
): SessionMainPanelHandoffState {
  switch (action.type) {
    case "handoff_to_cli_requested": {
      return {
        transitionState: "switching_to_cli",
        errorMessage: null,
        restoreStep: null,
      };
    }

    case "cli_handoff_succeeded": {
      return {
        transitionState: "stable_cli",
        errorMessage: null,
        restoreStep: null,
      };
    }

    case "cli_handoff_failed": {
      return {
        transitionState: "cli_entry_failed",
        errorMessage: action.errorMessage,
        restoreStep: null,
      };
    }

    case "chat_restore_requested": {
      return {
        transitionState: "restoring_chat",
        errorMessage: null,
        restoreStep: "connecting_transport",
      };
    }

    case "chat_restore_step_changed": {
      return {
        ...state,
        restoreStep: action.restoreStep,
      };
    }

    case "chat_restore_succeeded":
    case "reset_to_stable_chat": {
      return {
        transitionState: "stable_chat",
        errorMessage: null,
        restoreStep: null,
      };
    }

    case "chat_restore_failed": {
      return {
        transitionState: "restore_failed",
        errorMessage: action.errorMessage,
        restoreStep: state.restoreStep,
      };
    }
  }
}

export function getChatRestoreStepLabel(step: ChatRestoreStep): string {
  switch (step) {
    case "connecting_transport":
      return "Reconnecting session transport";
    case "resolving_thread":
      return "Resolving chat thread";
    case "hydrating_chat":
      return "Hydrating chat transcript";
  }
}

export function getChatRestorePendingDetail(input: {
  restoreStep: ChatRestoreStep;
  lifecycleStep: "idle" | "securing" | "connecting" | "connected";
}): string | null {
  if (input.restoreStep !== "connecting_transport") {
    return null;
  }

  switch (input.lifecycleStep) {
    case "securing":
      return "Minting sandbox connection token.";
    case "connecting":
      return "Opening the sandbox agent channel and initializing JSON-RPC.";
    case "connected":
      return "Waiting for the restored transport to become usable.";
    case "idle":
      return "Preparing a fresh chat transport after leaving CLI.";
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
