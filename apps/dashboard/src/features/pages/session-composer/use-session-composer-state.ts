import type {
  AgentConversationCollaborationModeSettings,
  ComposerCommandDescriptor,
} from "@mistle/integrations-core";
import type { UploadedSandboxFile } from "@mistle/sandbox-session-client";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChatAttachment } from "../../chat/chat-types.js";
import type { ChatComposerViewModel } from "../../chat/components/chat-composer.js";
import {
  buildSessionComposerPrompt,
  buildPendingSessionDiffCommentSummaryLabel,
  buildPendingSessionDiffCommentSummaryTitle,
  type PendingSessionDiffComment,
} from "../session-diff-comment.js";
import type { SessionPullRequestSummary } from "../use-session-repository-status.js";
import { resolveComposerSubmitAction } from "./session-composer-capabilities.js";
import {
  buildModelSelectionRequiredMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerCollaborationModeSettings,
  SessionComposerSubmittedLocalImageAttachment,
} from "./session-composer-runtime-contracts.js";
import {
  resolveComposerStatusMessage,
  type ComposerStatusMessage,
} from "./session-composer-status.js";
import { listComposerCommands } from "./session-composer-trigger-detection.js";
import type { SessionComposerAttachmentControl } from "./use-session-composer-attachment-control.js";
import type { SessionComposerConfigControl } from "./use-session-composer-config-control.js";

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
};

type QueuedComposerPrompt = {
  id: string;
  prompt: string;
  attachments: readonly PendingComposerAttachment[];
  pendingDiffComments: readonly PendingSessionDiffComment[];
  status: "failed" | "queued" | "submitting";
};

export type QueuedComposerPromptViewModel = {
  id: string;
  text: string;
  attachments: readonly ChatAttachment[];
  isRemovable: boolean;
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
    submittedAttachments?: readonly SessionComposerSubmittedLocalImageAttachment[];
    uploadedAttachments?: readonly UploadedSandboxFile[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
    collaborationModeSettings?: SessionComposerCollaborationModeSettings | undefined;
  }) => Promise<void>;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly SessionComposerSubmittedLocalImageAttachment[];
    uploadedAttachments?: readonly UploadedSandboxFile[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
  }) => Promise<void>;
  interruptTurn: () => void;
};

export type SessionComposerModelSelectionInput = {
  required: boolean;
  showControls: boolean;
};

export type SessionComposerRuntimeInput = {
  bootstrap: SessionComposerBootstrapResult;
  clearSessionErrorMessage: () => void;
  configControl: SessionComposerConfigControl;
  contextUsage: ChatComposerViewModel["contextUsage"];
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  modelSelection: SessionComposerModelSelectionInput;
  executeRuntimeCommand?: (commandId: string) => boolean;
  sessionErrorMessage: string | null;
  turnControl: SessionTurnControl;
};

export type SessionComposerSharedInput = {
  attachmentControl: SessionComposerAttachmentControl;
  repositoryStatus: {
    branchLabel: string | null;
    pullRequest: SessionPullRequestSummary | null;
  };
};

export type SessionComposerStateInput = SessionComposerRuntimeInput & SessionComposerSharedInput;

export type SessionComposerDraftState = {
  composerText: string;
  pendingDiffComments: readonly PendingSessionDiffComment[];
  clearPendingDiffComments: () => void;
  setComposerText: (nextText: string) => void;
};

export type SessionComposerUiState = {
  composerViewModel: ChatComposerViewModel;
  queuedPrompts: readonly QueuedComposerPromptViewModel[];
  removeQueuedPrompt: (queuedPromptId: string) => void;
  statusMessage: ComposerStatusMessage | null;
};

export function useSessionComposerState(input: {
  composerStateInput: SessionComposerStateInput;
  draftState: SessionComposerDraftState;
}): SessionComposerUiState {
  const { composerStateInput, draftState } = input;
  const { clearSessionErrorMessage, sessionErrorMessage } = composerStateInput;
  const { required: requiresModelSelection, showControls: showConfigControls } =
    composerStateInput.modelSelection;
  const composerText = draftState.composerText;
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);
  const [queuedPrompts, setQueuedPrompts] = useState<readonly QueuedComposerPrompt[]>([]);
  const [isSubmittingQueuedPrompt, setIsSubmittingQueuedPrompt] = useState(false);

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

  const turnCollaborationModeSettings = useMemo(():
    | SessionComposerCollaborationModeSettings
    | undefined => {
    if (composerStateInput.collaborationModeSettings === undefined) {
      return undefined;
    }

    if (activeComposerModel === null) {
      return undefined;
    }

    return {
      model: activeComposerModel.model,
      reasoningEffort: composerStateInput.configControl.selectedReasoningEffort,
      developerInstructions: composerStateInput.collaborationModeSettings.developerInstructions,
    };
  }, [
    activeComposerModel,
    composerStateInput.collaborationModeSettings,
    composerStateInput.configControl.selectedReasoningEffort,
  ]);

  const composerStatusMessage = resolveComposerStatusMessage({
    activeComposerModel,
    bootstrapState: composerStateInput.bootstrap.phase,
    composerErrorMessage,
    completedTurnErrorMessage: composerStateInput.turnControl.completedTurnErrorMessage,
    hasPendingImageAttachments: pendingComposerAttachments.some((attachment) =>
      attachment.file.type.startsWith("image/"),
    ),
    isUploadingAttachments: composerStateInput.attachmentControl.isUploadingAttachments,
    requiresModelSelection,
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
      const nextAttachments = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
      }));

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

  const queuePrompt = useCallback((): void => {
    const trimmedComposerText = composerText.trim();
    const hasSubmissionContent =
      trimmedComposerText.length > 0 ||
      pendingComposerAttachments.length > 0 ||
      draftState.pendingDiffComments.length > 0;

    if (!hasSubmissionContent) {
      return;
    }

    clearSessionErrorMessage();
    setComposerErrorMessage(null);
    setQueuedPrompts((currentQueuedPrompts) => [
      ...currentQueuedPrompts,
      {
        id: `queued-prompt-${crypto.randomUUID()}`,
        prompt: trimmedComposerText,
        attachments: pendingComposerAttachments,
        pendingDiffComments: draftState.pendingDiffComments,
        status: "queued",
      },
    ]);
    draftState.setComposerText("");
    draftState.clearPendingDiffComments();
    setPendingComposerAttachments([]);
  }, [clearSessionErrorMessage, composerText, draftState, pendingComposerAttachments]);

  const removeQueuedPrompt = useCallback((queuedPromptId: string): void => {
    setQueuedPrompts((currentQueuedPrompts) =>
      currentQueuedPrompts.filter((queuedPrompt) => queuedPrompt.id !== queuedPromptId),
    );
  }, []);

  const submitQueuedPrompt = useCallback(
    async (queuedPrompt: QueuedComposerPrompt): Promise<void> => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      setQueuedPrompts((currentQueuedPrompts) =>
        currentQueuedPrompts.map((currentQueuedPrompt) =>
          currentQueuedPrompt.id !== queuedPrompt.id
            ? currentQueuedPrompt
            : {
                ...currentQueuedPrompt,
                status: "submitting",
              },
        ),
      );

      const submittedPrompt = buildSessionComposerPrompt({
        composerText: queuedPrompt.prompt,
        pendingDiffComments: queuedPrompt.pendingDiffComments,
      });

      if (composerStateInput.bootstrap.phase.status !== "ready") {
        if (composerStateInput.bootstrap.phase.status === "failed") {
          setComposerErrorMessage(composerStateInput.bootstrap.phase.message);
        }
        setQueuedPrompts((currentQueuedPrompts) =>
          currentQueuedPrompts.map((currentQueuedPrompt) =>
            currentQueuedPrompt.id !== queuedPrompt.id
              ? currentQueuedPrompt
              : {
                  ...currentQueuedPrompt,
                  status: "failed",
                },
          ),
        );
        return;
      }

      if (requiresModelSelection && activeComposerModel === null) {
        const missingModelMessage =
          composerStateInput.configControl.selectedModel === null
            ? buildModelSelectionRequiredMessage()
            : buildUnavailableModelErrorMessage(composerStateInput.configControl.selectedModel);
        setComposerErrorMessage(missingModelMessage);
        setQueuedPrompts((currentQueuedPrompts) =>
          currentQueuedPrompts.map((currentQueuedPrompt) =>
            currentQueuedPrompt.id !== queuedPrompt.id
              ? currentQueuedPrompt
              : {
                  ...currentQueuedPrompt,
                  status: "failed",
                },
          ),
        );
        return;
      }

      let preparedAttachments;
      try {
        preparedAttachments = await composerStateInput.attachmentControl.prepareAttachments({
          files: queuedPrompt.attachments.map((attachment) => attachment.file),
          prompt: submittedPrompt,
          supportsImageInspection:
            activeComposerModel !== null && supportsImageInspection(activeComposerModel),
        });
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not upload attachments.",
        );
        setQueuedPrompts((currentQueuedPrompts) =>
          currentQueuedPrompts.map((currentQueuedPrompt) =>
            currentQueuedPrompt.id !== queuedPrompt.id
              ? currentQueuedPrompt
              : {
                  ...currentQueuedPrompt,
                  status: "failed",
                },
          ),
        );
        return;
      }

      try {
        await composerStateInput.turnControl.startTurn({
          submittedPrompt: preparedAttachments.prompt,
          submittedAttachments: preparedAttachments.submittedAttachments,
          uploadedAttachments: preparedAttachments.uploadedAttachments,
          displayAttachments: preparedAttachments.displayAttachments,
          transcriptPrompt: submittedPrompt,
          ...(turnCollaborationModeSettings === undefined
            ? {}
            : { collaborationModeSettings: turnCollaborationModeSettings }),
        });
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        setQueuedPrompts((currentQueuedPrompts) =>
          currentQueuedPrompts.map((currentQueuedPrompt) =>
            currentQueuedPrompt.id !== queuedPrompt.id
              ? currentQueuedPrompt
              : {
                  ...currentQueuedPrompt,
                  status: "failed",
                },
          ),
        );
        return;
      }

      setQueuedPrompts((currentQueuedPrompts) =>
        currentQueuedPrompts.filter(
          (currentQueuedPrompt) => currentQueuedPrompt.id !== queuedPrompt.id,
        ),
      );
      setComposerErrorMessage(null);
    },
    [
      activeComposerModel,
      clearSessionErrorMessage,
      composerStateInput.attachmentControl,
      composerStateInput.bootstrap.phase,
      composerStateInput.configControl.selectedModel,
      composerStateInput.turnControl,
      requiresModelSelection,
      turnCollaborationModeSettings,
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

      if (requiresModelSelection && activeComposerModel === null) {
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
          supportsImageInspection:
            activeComposerModel !== null && supportsImageInspection(activeComposerModel),
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
            uploadedAttachments: preparedAttachments.uploadedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submittedPrompt,
          });
        } else {
          await composerStateInput.turnControl.startTurn({
            submittedPrompt: preparedAttachments.prompt,
            submittedAttachments: preparedAttachments.submittedAttachments,
            uploadedAttachments: preparedAttachments.uploadedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submittedPrompt,
            ...(turnCollaborationModeSettings === undefined
              ? {}
              : { collaborationModeSettings: turnCollaborationModeSettings }),
          });
        }
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      draftState.setComposerText("");
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
    requiresModelSelection,
    submitAction,
    turnCollaborationModeSettings,
  ]);

  const submitRuntimeCommand = useCallback(
    (commandId: string): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);

      const command = findRuntimeComposerCommand({
        commandId,
        commands: listComposerCommands(composerStateInput.bootstrap.composerCapabilities),
      });
      if (command === null) {
        setComposerErrorMessage(`Runtime command '${commandId}' is not available.`);
        return;
      }

      if (composerStateInput.bootstrap.phase.status !== "ready") {
        if (composerStateInput.bootstrap.phase.status === "failed") {
          setComposerErrorMessage(composerStateInput.bootstrap.phase.message);
        }
        return;
      }

      if (composerStateInput.executeRuntimeCommand === undefined) {
        setComposerErrorMessage(`Runtime command '${commandId}' is not supported.`);
        return;
      }

      const commandAccepted = composerStateInput.executeRuntimeCommand(command.id);
      if (!commandAccepted) {
        return;
      }

      draftState.setComposerText("");
    },
    [
      clearSessionErrorMessage,
      composerStateInput.bootstrap.composerCapabilities,
      composerStateInput.bootstrap.phase,
      composerStateInput.executeRuntimeCommand,
      draftState,
    ],
  );

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
        (requiresModelSelection && activeComposerModel === null)
      );
    }

    return (
      composerStateInput.bootstrap.phase.status !== "ready" ||
      composerStateInput.turnControl.isStarting ||
      (composerText.trim().length === 0 &&
        pendingComposerAttachments.length === 0 &&
        draftState.pendingDiffComments.length === 0) ||
      (requiresModelSelection && activeComposerModel === null)
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
    requiresModelSelection,
    submitAction.submitMode,
  ]);

  const queuePromptDisabled = useMemo(
    () =>
      composerStateInput.turnControl.activeTurnState !== "running" ||
      composerStateInput.attachmentControl.isUploadingAttachments ||
      composerStateInput.bootstrap.phase.status !== "ready" ||
      (requiresModelSelection && activeComposerModel === null) ||
      (composerText.trim().length === 0 &&
        pendingComposerAttachments.length === 0 &&
        draftState.pendingDiffComments.length === 0),
    [
      activeComposerModel,
      composerText,
      composerStateInput.attachmentControl.isUploadingAttachments,
      composerStateInput.bootstrap.phase.status,
      composerStateInput.turnControl.activeTurnState,
      draftState.pendingDiffComments.length,
      pendingComposerAttachments.length,
      requiresModelSelection,
    ],
  );

  const queuedPromptViewModels = useMemo(
    () =>
      queuedPrompts.map((queuedPrompt) => ({
        id: queuedPrompt.id,
        text:
          queuedPrompt.prompt.length > 0
            ? queuedPrompt.prompt
            : buildPendingSessionDiffCommentSummaryLabel(queuedPrompt.pendingDiffComments.length),
        attachments: queuedPrompt.attachments.map((attachment) => ({
          kind: "file" as const,
          name: attachment.name,
          path: attachment.id,
        })),
        isRemovable: queuedPrompt.status !== "submitting",
      })),
    [queuedPrompts],
  );

  useEffect(() => {
    if (
      composerStateInput.turnControl.activeTurnState === "running" ||
      composerStateInput.turnControl.isStarting ||
      isSubmittingQueuedPrompt
    ) {
      return;
    }

    const nextQueuedPrompt = queuedPrompts.find((queuedPrompt) => queuedPrompt.status === "queued");
    if (nextQueuedPrompt === undefined) {
      return;
    }

    setIsSubmittingQueuedPrompt(true);
    void (async () => {
      try {
        await submitQueuedPrompt(nextQueuedPrompt);
      } finally {
        setIsSubmittingQueuedPrompt(false);
      }
    })();
  }, [
    composerStateInput.turnControl.activeTurnState,
    composerStateInput.turnControl.isStarting,
    isSubmittingQueuedPrompt,
    queuedPrompts,
    submitQueuedPrompt,
  ]);

  return {
    composerViewModel: {
      composerCapabilities: composerStateInput.bootstrap.composerCapabilities,
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
      gitBranchLabel: composerStateInput.repositoryStatus.branchLabel,
      pullRequest: composerStateInput.repositoryStatus.pullRequest,
      contextUsage: composerStateInput.contextUsage,
      isUploadingAttachments: composerStateInput.attachmentControl.isUploadingAttachments,
      keyboardShortcuts:
        composerStateInput.turnControl.activeTurnState === "running" &&
        (composerText.trim().length > 0 ||
          pendingComposerAttachments.length > 0 ||
          draftState.pendingDiffComments.length > 0)
          ? [
              { action: "Steer", shortcut: "enter" },
              { action: "Queue", shortcut: "mod-enter" },
            ]
          : [],
      secondarySubmitDisabled: queuePromptDisabled,
      configControlsDisabled:
        composerStateInput.bootstrap.phase.status !== "ready" ||
        composerStateInput.configControl.isUpdating ||
        composerStateInput.attachmentControl.isUploadingAttachments,
      showConfigControls,
      showReasoningControl: composerStateInput.configControl.canChangeReasoningEffort,
      onComposerTextChange: handleComposerTextChange,
      onSubmit: submitComposer,
      onRuntimeCommandSubmit: submitRuntimeCommand,
      onSecondarySubmit: queuePrompt,
      onModelChange: handleModelChange,
      onReasoningEffortChange: handleReasoningEffortChange,
      onPendingFilesAdded: addPendingComposerFiles,
      onRemovePendingAttachment: removePendingComposerAttachment,
      onClearPendingDiffComments: draftState.clearPendingDiffComments,
    },
    queuedPrompts: queuedPromptViewModels,
    removeQueuedPrompt,
    statusMessage: composerStatusMessage,
  };
}

function findRuntimeComposerCommand(input: {
  commandId: string;
  commands: readonly ComposerCommandDescriptor[];
}): ComposerCommandDescriptor | null {
  const command = input.commands.find(
    (candidateCommand) =>
      candidateCommand.id === input.commandId && candidateCommand.submitAs === "runtimeCommand",
  );

  return command ?? null;
}
