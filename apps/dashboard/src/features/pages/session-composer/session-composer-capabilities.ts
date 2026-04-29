export type ComposerSubmitAction =
  | {
      type: "interrupt_turn";
      submitMode: "interrupt";
    }
  | {
      type: "start_turn" | "steer_turn";
      prompt: string;
      submitMode: "start" | "steer";
    };

export function resolveComposerSubmitAction(input: {
  composerText: string;
  hasActiveTurn: boolean;
  hasPendingInput: boolean;
}): ComposerSubmitAction {
  const trimmedComposerText = input.composerText.trim();
  const hasSubmissionContent = trimmedComposerText.length > 0 || input.hasPendingInput;

  if (!input.hasActiveTurn) {
    return {
      type: "start_turn",
      submitMode: "start",
      prompt: trimmedComposerText,
    };
  }

  if (!hasSubmissionContent) {
    return {
      type: "interrupt_turn",
      submitMode: "interrupt",
    };
  }

  return {
    type: "steer_turn",
    submitMode: "steer",
    prompt: trimmedComposerText,
  };
}
