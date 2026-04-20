import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useCallback, useMemo, useState } from "react";

import type { ChatComposerViewModel } from "../../chat/components/chat-composer.js";
import type { SessionBootstrapResult } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import {
  buildSessionComposerPrompt,
  buildPendingSessionDiffCommentSummaryLabel,
  buildPendingSessionDiffCommentSummaryTitle,
  type PendingSessionDiffComment,
} from "../session-diff-comment.js";
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

export type SessionComposerDraftState = {
  composerText: string;
  pendingDiffComments: readonly PendingSessionDiffComment[];
  clearPendingDiffComments: () => void;
  setComposerText: (nextText: string) => void;
};

export type SessionComposerUiState = {
  composerViewModel: ChatComposerViewModel;
  statusMessage: ComposerStatusMessage | null;
};

export function useSessionComposerState(input: {
  composerStateInput: SessionComposerStateInput;
  draftState: SessionComposerDraftState;
}): SessionComposerUiState {
  const { composerStateInput, draftState } = input;
  const { clearSessionErrorMessage, sessionErrorMessage } = composerStateInput;
  const composerText = draftState.composerText;
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);

  const activeComposerModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels: composerStateInput.bootstrap.establishedSnapshot.availableModels,
        selectedModel: composerStateInput.configControl.selectedModel,
      }),
    [
      composerStateInput.bootstrap.establishedSnapshot.availableModels,
      composerStateInput.configControl.selectedModel,
    ],
  );

  const composerStatusMessage = resolveComposerStatusMessage({
    activeComposerModel,
    bootstrapState: composerStateInput.bootstrap.phase,
    composerErrorMessage,
    completedTurnErrorMessage: composerStateInput.turnControl.completedTurnErrorMessage,
    hasPendingAttachments: pendingComposerAttachments.length > 0,
    isUploadingAttachments: composerStateInput.attachmentControl.isUploadingAttachments,
    sessionErrorMessage,
    selectedModel: composerStateInput.configControl.selectedModel,
  });

  const handleComposerTextChange = useCallback(
    (nextText: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      draftState.setComposerText(nextText);
    },
    [clearSessionErrorMessage, draftState],
  );

  const handleModelChange = useCallback(
    (nextModel: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      composerStateInput.configControl.setModel(nextModel);
    },
    [clearSessionErrorMessage, composerStateInput.configControl],
  );

  const handleReasoningEffortChange = useCallback(
    (nextReasoningEffort: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      composerStateInput.configControl.setReasoningEffort(nextReasoningEffort);
    },
    [clearSessionErrorMessage, composerStateInput.configControl],
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
        hasActiveTurn: composerStateInput.turnControl.activeTurnState === "running",
        hasPendingInput:
          pendingComposerAttachments.length > 0 || draftState.pendingDiffComments.length > 0,
      }),
    [
      composerText,
      composerStateInput.turnControl.activeTurnState,
      draftState.pendingDiffComments.length,
      pendingComposerAttachments.length,
    ],
  );

  const submitComposer = useCallback((): void => {
    void (async () => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);

      if (submitAction.type === "interrupt_turn") {
        composerStateInput.turnControl.interruptTurn();
        return;
      }

      if (composerStateInput.bootstrap.phase.status !== "ready") {
        if (composerStateInput.bootstrap.phase.status === "failed") {
          setComposerErrorMessage(composerStateInput.bootstrap.phase.message);
        }
        return;
      }

      if (activeComposerModel === null) {
        const missingModelMessage =
          composerStateInput.configControl.selectedModel === null
            ? buildModelSelectionRequiredMessage()
            : buildUnavailableModelErrorMessage(composerStateInput.configControl.selectedModel);
        setComposerErrorMessage(missingModelMessage);
        return;
      }

      const submittedPrompt = buildSessionComposerPrompt({
        composerText: submitAction.prompt,
        pendingDiffComments: draftState.pendingDiffComments,
      });

      let preparedAttachments;
      try {
        preparedAttachments = await composerStateInput.attachmentControl.prepareAttachments({
          files: pendingComposerAttachments.map((attachment) => attachment.file),
          prompt: submittedPrompt,
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
          await composerStateInput.turnControl.steerTurn({
            submittedPrompt: preparedAttachments.prompt,
            submittedAttachments: preparedAttachments.submittedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submittedPrompt,
          });
        } else {
          await composerStateInput.turnControl.startTurn({
            submittedPrompt: preparedAttachments.prompt,
            submittedAttachments: preparedAttachments.submittedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submittedPrompt,
          });
        }
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      if (submitAction.shouldClearComposer) {
        draftState.setComposerText("");
      }
      draftState.clearPendingDiffComments();
      setComposerErrorMessage(null);
      setPendingComposerAttachments([]);
    })();
  }, [
    activeComposerModel,
    clearSessionErrorMessage,
    composerStateInput.attachmentControl,
    composerStateInput.bootstrap.phase,
    composerStateInput.configControl.selectedModel,
    composerStateInput.turnControl,
    draftState,
    pendingComposerAttachments,
    submitAction,
  ]);

  const submitLabel = useMemo(() => {
    if (submitAction.submitMode === "interrupt") {
      return composerStateInput.turnControl.isInterrupting ? "Stopping..." : "Stop";
    }

    if (submitAction.submitMode === "steer") {
      return composerStateInput.turnControl.isSteering ? "Steering..." : "Steer";
    }

    if (composerStateInput.attachmentControl.isUploadingAttachments) {
      return "Uploading...";
    }

    return composerStateInput.turnControl.isStarting ? "Sending..." : "Send";
  }, [
    composerStateInput.attachmentControl.isUploadingAttachments,
    composerStateInput.turnControl.isInterrupting,
    composerStateInput.turnControl.isStarting,
    composerStateInput.turnControl.isSteering,
    submitAction.submitMode,
  ]);

  const submitDisabled = useMemo(() => {
    if (submitAction.submitMode === "interrupt") {
      return !composerStateInput.turnControl.canInterrupt;
    }

    if (composerStateInput.attachmentControl.isUploadingAttachments) {
      return true;
    }

    if (submitAction.submitMode === "steer") {
      return (
        !composerStateInput.turnControl.canSteer ||
        composerStateInput.bootstrap.phase.status !== "ready" ||
        activeComposerModel === null
      );
    }

    return (
      composerStateInput.bootstrap.phase.status !== "ready" ||
      composerStateInput.turnControl.isStarting ||
      (composerText.trim().length === 0 &&
        pendingComposerAttachments.length === 0 &&
        draftState.pendingDiffComments.length === 0) ||
      activeComposerModel === null
    );
  }, [
    activeComposerModel,
    composerText,
    composerStateInput.attachmentControl.isUploadingAttachments,
    composerStateInput.bootstrap.phase.status,
    composerStateInput.turnControl.canInterrupt,
    composerStateInput.turnControl.canSteer,
    composerStateInput.turnControl.isStarting,
    draftState.pendingDiffComments.length,
    pendingComposerAttachments.length,
    submitAction.submitMode,
  ]);

  return {
    composerViewModel: {
      composerText,
      pendingDiffCommentSummary:
        draftState.pendingDiffComments.length === 0
          ? null
          : {
              count: draftState.pendingDiffComments.length,
              label: buildPendingSessionDiffCommentSummaryLabel(
                draftState.pendingDiffComments.length,
              ),
              title: buildPendingSessionDiffCommentSummaryTitle(draftState.pendingDiffComments),
            },
      pendingAttachments: pendingComposerAttachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
      })),
      modelOptions: composerStateInput.configControl.modelOptions,
      selectedModel: composerStateInput.configControl.selectedModel,
      selectedReasoningEffort: composerStateInput.configControl.selectedReasoningEffort,
      isSubmitPending: composerStateInput.turnControl.isStarting,
      submitMode: submitAction.submitMode,
      submitLabel,
      submitDisabled,
      submitDisabledReason: null,
      canUploadAttachments: composerStateInput.attachmentControl.canUploadAttachments,
      isUploadingAttachments: composerStateInput.attachmentControl.isUploadingAttachments,
      configControlsDisabled:
        composerStateInput.bootstrap.phase.status !== "ready" ||
        composerStateInput.configControl.isUpdating ||
        composerStateInput.attachmentControl.isUploadingAttachments,
      onComposerTextChange: handleComposerTextChange,
      onSubmit: submitComposer,
      onModelChange: handleModelChange,
      onReasoningEffortChange: handleReasoningEffortChange,
      onPendingImageFilesAdded: addPendingComposerFiles,
      onRemovePendingAttachment: removePendingComposerAttachment,
      onClearPendingDiffComments: draftState.clearPendingDiffComments,
    },
    statusMessage: composerStatusMessage,
  };
}
