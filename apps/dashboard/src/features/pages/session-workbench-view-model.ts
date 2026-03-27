import type { CodexSessionConnectionState } from "@mistle/integrations-definitions/openai/agent/client";

import type { StartSessionStep } from "../session-agents/codex/session-state/index.js";

export type SessionHeaderStatusUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
};

export function resolveSessionHeaderStatusUi(input: {
  sandboxStatus: string;
  agentConnectionState: CodexSessionConnectionState;
  step: StartSessionStep;
  hasConnectionError: boolean;
}): SessionHeaderStatusUi {
  if (input.sandboxStatus === "failed") {
    return {
      label: "Sandbox failed",
      variant: "destructive",
    };
  }

  if (input.hasConnectionError || input.agentConnectionState === "error") {
    return {
      label: "Connection failed",
      variant: "destructive",
    };
  }

  if (input.agentConnectionState === "ready") {
    return {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (input.sandboxStatus === "stopped" && input.step === "idle") {
    return {
      label: "Sandbox stopped",
      variant: "outline",
    };
  }

  if (input.sandboxStatus === "resuming") {
    return {
      label: "Resuming sandbox",
      variant: "outline",
    };
  }

  if (input.sandboxStatus !== "running") {
    return {
      label: "Starting sandbox",
      variant: "outline",
    };
  }

  if (input.agentConnectionState === "opening_agent_stream") {
    return {
      label: "Connecting",
      variant: "outline",
    };
  }

  if (input.agentConnectionState === "initializing") {
    return {
      label: "Initializing",
      variant: "outline",
    };
  }

  if (
    input.agentConnectionState === "connecting_socket" ||
    input.agentConnectionState === "connected_socket" ||
    input.step === "securing" ||
    input.step === "connecting"
  ) {
    return {
      label: "Connecting",
      variant: "outline",
    };
  }

  return {
    label: "Session idle",
    variant: "outline",
  };
}

export function hasSessionTopAlert(input: {
  hasSandboxStatusError: boolean;
  lifecycleErrorMessage: string | null;
  sandboxFailureMessage: string | null;
  stoppedSessionMessage: string | null;
}): boolean {
  return (
    input.hasSandboxStatusError ||
    input.lifecycleErrorMessage !== null ||
    input.sandboxFailureMessage !== null ||
    input.stoppedSessionMessage !== null
  );
}

export function resolveStoppedSessionMessage(input: {
  connectionReadinessReason:
    | "failed"
    | "loading"
    | "missing-session"
    | "ready"
    | "resuming"
    | "starting"
    | "stopped"
    | "unknown";
}): string | null {
  if (input.connectionReadinessReason !== "stopped") {
    return null;
  }

  return "This sandbox is stopped. Resume it to reconnect chat and terminal.";
}

export function shouldShowResumeAction(input: {
  requiresManualResume: boolean;
  isResumingStoppedSandbox: boolean;
}): boolean {
  return input.requiresManualResume;
}

export type ChatComposerAction =
  | {
      type: "interrupt_turn";
      shouldClearComposer: false;
    }
  | {
      type: "start_turn" | "steer_turn";
      prompt: string;
      shouldClearComposer: true;
    };

export function resolveChatComposerAction(input: {
  composerText: string;
  hasActiveTurn: boolean;
  hasPendingAttachments: boolean;
}): ChatComposerAction {
  const trimmedComposerText = input.composerText.trim();
  const hasSubmissionContent = trimmedComposerText.length > 0 || input.hasPendingAttachments;

  if (!input.hasActiveTurn) {
    return {
      type: "start_turn",
      prompt: trimmedComposerText,
      shouldClearComposer: true,
    };
  }

  if (!hasSubmissionContent) {
    return {
      type: "interrupt_turn",
      shouldClearComposer: false,
    };
  }

  return {
    type: "steer_turn",
    prompt: trimmedComposerText,
    shouldClearComposer: true,
  };
}
