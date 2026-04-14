import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useCallback, useMemo, useState } from "react";

import type { ChatComposerViewModel } from "../../chat/components/chat-composer.js";
import type { SessionBootstrapResult } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import { resolveComposerSubmitAction } from "./session-composer-capabilities.js";
import {
  buildModelSelectionRequiredMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";
import {
  resolveComposerStatusMessage,
  type ComposerStatusMessage,
} from "./session-composer-status.js";
import type { SessionComposerAttachmentControl } from "./use-session-composer-attachment-control.js";
import type { SessionComposerConfigControl } from "./use-session-composer-config-control.js";

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
};

export type SessionTurnControl = {
  activeTurnState: "idle" | "running";
  canSteer: boolean;
  canInterrupt: boolean;
  isStarting: boolean;
  isSteering: boolean;
  isInterrupting: boolean;
  completedTurnErrorMessage: string | null;
  startTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
  interruptTurn: () => void;
};

export type SessionComposerStateInput = {
  bootstrap: SessionBootstrapResult;
  clearSessionErrorMessage: () => void;
  configControl: SessionComposerConfigControl;
  attachmentControl: SessionComposerAttachmentControl;
  sessionErrorMessage: string | null;
  turnControl: SessionTurnControl;
};

export type SessionComposerUiState = {
  composerViewModel: ChatComposerViewModel;
  statusMessage: ComposerStatusMessage | null;
};

export function useSessionComposerState(input: SessionComposerStateInput): SessionComposerUiState {
  const { clearSessionErrorMessage, sessionErrorMessage } = input;
  const [composerText, setComposerText] = useState("");
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);

  const activeComposerModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels: input.bootstrap.establishedSnapshot.availableModels,
        selectedModel: input.configControl.selectedModel,
      }),
    [input.bootstrap.establishedSnapshot.availableModels, input.configControl.selectedModel],
  );

  const composerStatusMessage = resolveComposerStatusMessage({
    activeComposerModel,
    bootstrapState: input.bootstrap.phase,
    composerErrorMessage,
    completedTurnErrorMessage: input.turnControl.completedTurnErrorMessage,
    hasPendingAttachments: pendingComposerAttachments.length > 0,
    isUploadingAttachments: input.attachmentControl.isUploadingAttachments,
    sessionErrorMessage,
    selectedModel: input.configControl.selectedModel,
  });

  const handleComposerTextChange = useCallback(
    (nextText: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      setComposerText(nextText);
    },
    [clearSessionErrorMessage],
  );

  const handleModelChange = useCallback(
    (nextModel: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      input.configControl.setModel(nextModel);
    },
    [clearSessionErrorMessage, input.configControl],
  );

  const handleReasoningEffortChange = useCallback(
    (nextReasoningEffort: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      input.configControl.setReasoningEffort(nextReasoningEffort);
    },
    [clearSessionErrorMessage, input.configControl],
  );

  const addPendingComposerFiles = useCallback(
    (files: readonly File[]): void => {
      const nextAttachments = files.flatMap((file) => {
        if (!file.type.startsWith("image/")) {
          return [];
        }

        return [
          {
            id: crypto.randomUUID(),
            file,
            name: file.name,
          },
        ];
      });

      if (nextAttachments.length === 0) {
        return;
      }

      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      setPendingComposerAttachments((currentAttachments) => [
        ...currentAttachments,
        ...nextAttachments,
      ]);
    },
    [clearSessionErrorMessage],
  );

  const removePendingComposerAttachment = useCallback(
    (attachmentId: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      setPendingComposerAttachments((currentAttachments) =>
        currentAttachments.filter((attachment) => attachment.id !== attachmentId),
      );
    },
    [clearSessionErrorMessage],
  );

  const submitAction = useMemo(
    () =>
      resolveComposerSubmitAction({
        composerText,
        hasActiveTurn: input.turnControl.activeTurnState === "running",
        hasPendingAttachments: pendingComposerAttachments.length > 0,
      }),
    [composerText, input.turnControl.activeTurnState, pendingComposerAttachments.length],
  );

  const submitComposer = useCallback((): void => {
    void (async () => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);

      if (submitAction.type === "interrupt_turn") {
        input.turnControl.interruptTurn();
        return;
      }

      if (input.bootstrap.phase.status !== "ready") {
        if (input.bootstrap.phase.status === "failed") {
          setComposerErrorMessage(input.bootstrap.phase.message);
        }
        return;
      }

      if (activeComposerModel === null) {
        const missingModelMessage =
          input.configControl.selectedModel === null
            ? buildModelSelectionRequiredMessage()
            : buildUnavailableModelErrorMessage(input.configControl.selectedModel);
        setComposerErrorMessage(missingModelMessage);
        return;
      }

      let preparedAttachments;
      try {
        preparedAttachments = await input.attachmentControl.prepareAttachments({
          files: pendingComposerAttachments.map((attachment) => attachment.file),
          prompt: submitAction.prompt,
          supportsImageInspection: supportsImageInspection(activeComposerModel),
        });
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not upload attachments.",
        );
        return;
      }

      try {
        if (submitAction.type === "steer_turn") {
          await input.turnControl.steerTurn({
            submittedPrompt: preparedAttachments.prompt,
            submittedAttachments: preparedAttachments.submittedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submitAction.prompt,
          });
        } else {
          await input.turnControl.startTurn({
            submittedPrompt: preparedAttachments.prompt,
            submittedAttachments: preparedAttachments.submittedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submitAction.prompt,
          });
        }
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      if (submitAction.shouldClearComposer) {
        setComposerText("");
      }
      setComposerErrorMessage(null);
      setPendingComposerAttachments([]);
    })();
  }, [
    activeComposerModel,
    clearSessionErrorMessage,
    input.attachmentControl,
    input.bootstrap.phase,
    input.configControl.selectedModel,
    input.turnControl,
    pendingComposerAttachments,
    submitAction,
  ]);

  const submitLabel = useMemo(() => {
    if (submitAction.submitMode === "interrupt") {
      return input.turnControl.isInterrupting ? "Stopping..." : "Stop";
    }

    if (submitAction.submitMode === "steer") {
      return input.turnControl.isSteering ? "Steering..." : "Steer";
    }

    if (input.attachmentControl.isUploadingAttachments) {
      return "Uploading...";
    }

    return input.turnControl.isStarting ? "Sending..." : "Send";
  }, [
    input.attachmentControl.isUploadingAttachments,
    input.turnControl.isInterrupting,
    input.turnControl.isStarting,
    input.turnControl.isSteering,
    submitAction.submitMode,
  ]);

  const submitDisabled = useMemo(() => {
    if (submitAction.submitMode === "interrupt") {
      return !input.turnControl.canInterrupt;
    }

    if (input.attachmentControl.isUploadingAttachments) {
      return true;
    }

    if (submitAction.submitMode === "steer") {
      return (
        !input.turnControl.canSteer ||
        input.bootstrap.phase.status !== "ready" ||
        activeComposerModel === null
      );
    }

    return (
      input.bootstrap.phase.status !== "ready" ||
      input.turnControl.isStarting ||
      (composerText.trim().length === 0 && pendingComposerAttachments.length === 0) ||
      activeComposerModel === null
    );
  }, [
    activeComposerModel,
    composerText,
    input.attachmentControl.isUploadingAttachments,
    input.bootstrap.phase.status,
    input.turnControl.canInterrupt,
    input.turnControl.canSteer,
    input.turnControl.isStarting,
    pendingComposerAttachments.length,
    submitAction.submitMode,
  ]);

  return {
    composerViewModel: {
      composerText,
      pendingAttachments: pendingComposerAttachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
      })),
      modelOptions: input.configControl.modelOptions,
      selectedModel: input.configControl.selectedModel,
      selectedReasoningEffort: input.configControl.selectedReasoningEffort,
      isSubmitPending: input.turnControl.isStarting,
      submitMode: submitAction.submitMode,
      submitLabel,
      submitDisabled,
      submitDisabledReason: null,
      canUploadAttachments: input.attachmentControl.canUploadAttachments,
      isUploadingAttachments: input.attachmentControl.isUploadingAttachments,
      configControlsDisabled:
        input.bootstrap.phase.status !== "ready" ||
        input.configControl.isUpdating ||
        input.attachmentControl.isUploadingAttachments,
      onComposerTextChange: handleComposerTextChange,
      onSubmit: submitComposer,
      onModelChange: handleModelChange,
      onReasoningEffortChange: handleReasoningEffortChange,
      onPendingImageFilesAdded: addPendingComposerFiles,
      onRemovePendingAttachment: removePendingComposerAttachment,
    },
    statusMessage: composerStatusMessage,
  };
}
