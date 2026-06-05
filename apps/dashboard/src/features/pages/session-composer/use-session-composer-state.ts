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
  createComposerDraft,
  trimComposerDraft,
  type ComposerDraft,
  type SelectedSkillMention,
} from "./session-composer-draft.js";
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
import {
  listComposerCommands,
  readLeadingSlashCommandName,
} from "./session-composer-trigger-detection.js";
import type {
  PreparedComposerAttachments,
  SessionComposerAttachmentControl,
} from "./use-session-composer-attachment-control.js";
import type { SessionComposerConfigControl } from "./use-session-composer-config-control.js";
import type { SessionComposerContextMentionControl } from "./use-session-composer-context-mention-control.js";

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
};

type QueuedComposerPrompt = {
  id: string;
  text: string;
  attachments: readonly PendingComposerAttachment[];
  pendingDiffComments: readonly PendingSessionDiffComment[];
  status: "failed" | "queued" | "submitting";
};

type PreparedComposerTurnSubmission = {
  preparedAttachments: PreparedComposerAttachments;
  selectedSkillMentions: readonly SelectedSkillMention[];
  submittedPrompt: string;
};

type ComposerTurnSubmissionPreparationResult =
  | {
      status: "blocked";
      message: string | null;
    }
  | {
      status: "ready";
      submission: PreparedComposerTurnSubmission;
    };

function mapSelectedSkillMentionsToSubmittedPrompt(input: {
  composerText: string;
  selectedSkillMentions: readonly SelectedSkillMention[];
  submittedPrompt: string;
}): readonly SelectedSkillMention[] {
  if (input.selectedSkillMentions.length === 0) {
    return [];
  }

  const promptComposerTextOffset = input.submittedPrompt.endsWith(input.composerText)
    ? input.submittedPrompt.length - input.composerText.length
    : 0;

  return input.selectedSkillMentions.map((mention) => ({
    ...mention,
    range: {
      start: mention.range.start + promptComposerTextOffset,
      end: mention.range.end + promptComposerTextOffset,
    },
  }));
}

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
    selectedSkillMentions?: readonly SelectedSkillMention[];
    submittedAttachments?: readonly SessionComposerSubmittedLocalImageAttachment[];
    uploadedAttachments?: readonly UploadedSandboxFile[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
    collaborationMode?: SessionComposerCollaborationModeSettings["mode"] | undefined;
    collaborationModeSettings?: SessionComposerCollaborationModeSettings | undefined;
    resolveSkillMentions?: boolean;
  }) => Promise<void>;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly SessionComposerSubmittedLocalImageAttachment[];
    uploadedAttachments?: readonly UploadedSandboxFile[];
    transcriptPrompt?: string;
    displayAttachments?: readonly ChatAttachment[];
  }) => Promise<void>;
  queueTurn?: (input: {
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
  goalStatus?: ChatComposerViewModel["goalStatus"];
  commandPanel?: ChatComposerViewModel["commandPanel"];
  contextMentionControl?: SessionComposerContextMentionControl | null;
  collaborationMode?: {
    mode: SessionComposerCollaborationModeSettings["mode"];
    onSwitchToPlan?: () => void;
    onSwitchToDefault: () => void;
  };
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  modelSelection: SessionComposerModelSelectionInput;
  executeRuntimeCommand?: (commandId: string) => boolean;
  executeTypedRuntimeCommand?: (input: { commandId: string; text: string }) => boolean;
  unavailableTypedRuntimeCommands?: readonly {
    name: string;
    message: string;
  }[];
  sessionErrorMessage: string | null;
  turnControl: SessionTurnControl;
};

export type SessionComposerSharedInput = {
  attachmentControl: SessionComposerAttachmentControl;
  placeholderText?: string | undefined;
  repositoryStatus: {
    branchLabel: string | null;
    pullRequest: SessionPullRequestSummary | null;
  };
};

export type SessionComposerStateInput = SessionComposerRuntimeInput & SessionComposerSharedInput;

export type SessionComposerDraftState = {
  composerDraft: ComposerDraft;
  pendingDiffComments: readonly PendingSessionDiffComment[];
  clearPendingDiffComments: () => void;
  setComposerDraft: (nextDraft: ComposerDraft) => void;
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
  const composerDraft = draftState.composerDraft;
  const composerText = composerDraft.text;
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);
  const [queuedPrompts, setQueuedPrompts] = useState<readonly QueuedComposerPrompt[]>([]);
  const [isSubmittingNativeQueuedPrompt, setIsSubmittingNativeQueuedPrompt] = useState(false);
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
      mode: composerStateInput.collaborationMode?.mode ?? "default",
      model: activeComposerModel.model,
      reasoningEffort: composerStateInput.configControl.selectedReasoningEffort,
      developerInstructions: composerStateInput.collaborationModeSettings.developerInstructions,
    };
  }, [
    activeComposerModel,
    composerStateInput.collaborationMode?.mode,
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

  const handleComposerDraftChange = useCallback(
    (nextDraft: ComposerDraft): void => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);
      draftState.setComposerDraft(nextDraft);
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

  const prepareComposerTurnSubmission = useCallback(
    async (prepareInput: {
      attachments: readonly PendingComposerAttachment[];
      composerDraft: ComposerDraft;
      pendingDiffComments: readonly PendingSessionDiffComment[];
    }): Promise<ComposerTurnSubmissionPreparationResult> => {
      if (composerStateInput.bootstrap.phase.status !== "ready") {
        return {
          status: "blocked",
          message:
            composerStateInput.bootstrap.phase.status === "failed"
              ? composerStateInput.bootstrap.phase.message
              : null,
        };
      }

      if (requiresModelSelection && activeComposerModel === null) {
        return {
          status: "blocked",
          message:
            composerStateInput.configControl.selectedModel === null
              ? buildModelSelectionRequiredMessage()
              : buildUnavailableModelErrorMessage(composerStateInput.configControl.selectedModel),
        };
      }

      const trimmedDraft = trimComposerDraft(prepareInput.composerDraft);
      const submittedPrompt = buildSessionComposerPrompt({
        composerText: trimmedDraft.text,
        pendingDiffComments: prepareInput.pendingDiffComments,
      });

      try {
        const preparedAttachments = await composerStateInput.attachmentControl.prepareAttachments({
          files: prepareInput.attachments.map((attachment) => attachment.file),
          prompt: submittedPrompt,
          supportsImageInspection:
            activeComposerModel !== null && supportsImageInspection(activeComposerModel),
        });

        return {
          status: "ready",
          submission: {
            preparedAttachments,
            selectedSkillMentions: mapSelectedSkillMentionsToSubmittedPrompt({
              composerText: trimmedDraft.text,
              selectedSkillMentions: trimmedDraft.selectedSkillMentions,
              submittedPrompt,
            }),
            submittedPrompt,
          },
        };
      } catch (error) {
        return {
          status: "blocked",
          message: error instanceof Error ? error.message : "Could not upload attachments.",
        };
      }
    },
    [
      activeComposerModel,
      composerStateInput.attachmentControl,
      composerStateInput.bootstrap.phase,
      composerStateInput.configControl.selectedModel,
      requiresModelSelection,
    ],
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

  const typedRuntimeCommand = useMemo(
    () =>
      findTypedRuntimeComposerCommand({
        composerText,
        commands: listComposerCommands(composerStateInput.bootstrap.composerCapabilities),
      }),
    [composerStateInput.bootstrap.composerCapabilities, composerText],
  );

  const unavailableTypedRuntimeCommand = useMemo(
    () =>
      findUnavailableTypedRuntimeCommand({
        composerText,
        commands: composerStateInput.unavailableTypedRuntimeCommands ?? [],
      }),
    [composerStateInput.unavailableTypedRuntimeCommands, composerText],
  );

  const queuePrompt = useCallback((): void => {
    if (typedRuntimeCommand !== null || unavailableTypedRuntimeCommand !== null) {
      return;
    }

    if (composerStateInput.configControl.isUpdating) {
      return;
    }

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
    const queueTurn = composerStateInput.turnControl.queueTurn;
    if (composerStateInput.turnControl.activeTurnState === "running" && queueTurn !== undefined) {
      if (isSubmittingNativeQueuedPrompt) {
        return;
      }
      setIsSubmittingNativeQueuedPrompt(true);
      void (async (): Promise<void> => {
        try {
          if (composerDraft.selectedSkillMentions.length > 0) {
            setComposerErrorMessage(
              "Selected skills cannot be queued while a task is in progress. Submit them after the current task finishes.",
            );
            return;
          }

          const preparationResult = await prepareComposerTurnSubmission({
            attachments: pendingComposerAttachments,
            composerDraft: createComposerDraft(trimmedComposerText),
            pendingDiffComments: draftState.pendingDiffComments,
          });

          if (preparationResult.status === "blocked") {
            if (preparationResult.message !== null) {
              setComposerErrorMessage(preparationResult.message);
            }
            return;
          }

          const { preparedAttachments, submittedPrompt } = preparationResult.submission;
          try {
            await queueTurn({
              submittedPrompt: preparedAttachments.prompt,
              submittedAttachments: preparedAttachments.submittedAttachments,
              uploadedAttachments: preparedAttachments.uploadedAttachments,
              displayAttachments: preparedAttachments.displayAttachments,
              transcriptPrompt: submittedPrompt,
            });
          } catch (error) {
            setComposerErrorMessage(
              error instanceof Error ? error.message : "Could not queue chat message.",
            );
            return;
          }

          draftState.setComposerDraft(createComposerDraft(""));
          draftState.clearPendingDiffComments();
          setPendingComposerAttachments([]);
        } finally {
          setIsSubmittingNativeQueuedPrompt(false);
        }
      })();
      return;
    }

    if (composerDraft.selectedSkillMentions.length > 0) {
      setComposerErrorMessage(
        "Selected skills cannot be queued while a task is in progress. Submit them after the current task finishes.",
      );
      return;
    }

    setQueuedPrompts((currentQueuedPrompts) => [
      ...currentQueuedPrompts,
      {
        id: `queued-prompt-${crypto.randomUUID()}`,
        text: trimmedComposerText,
        attachments: pendingComposerAttachments,
        pendingDiffComments: draftState.pendingDiffComments,
        status: "queued",
      },
    ]);
    draftState.setComposerDraft(createComposerDraft(""));
    draftState.clearPendingDiffComments();
    setPendingComposerAttachments([]);
  }, [
    clearSessionErrorMessage,
    composerStateInput.configControl.isUpdating,
    composerStateInput.turnControl,
    composerDraft.selectedSkillMentions.length,
    composerText,
    draftState,
    isSubmittingNativeQueuedPrompt,
    pendingComposerAttachments,
    prepareComposerTurnSubmission,
    typedRuntimeCommand,
    unavailableTypedRuntimeCommand,
  ]);

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

      const preparationResult = await prepareComposerTurnSubmission({
        attachments: queuedPrompt.attachments,
        composerDraft: createComposerDraft(queuedPrompt.text),
        pendingDiffComments: queuedPrompt.pendingDiffComments,
      });

      if (preparationResult.status === "blocked") {
        if (preparationResult.message !== null) {
          setComposerErrorMessage(preparationResult.message);
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

      const { preparedAttachments, submittedPrompt } = preparationResult.submission;
      try {
        await composerStateInput.turnControl.startTurn({
          submittedPrompt: preparedAttachments.prompt,
          submittedAttachments: preparedAttachments.submittedAttachments,
          uploadedAttachments: preparedAttachments.uploadedAttachments,
          displayAttachments: preparedAttachments.displayAttachments,
          transcriptPrompt: submittedPrompt,
          resolveSkillMentions: false,
          ...(turnCollaborationModeSettings === undefined
            ? {}
            : { collaborationMode: turnCollaborationModeSettings.mode }),
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
      clearSessionErrorMessage,
      composerStateInput.turnControl,
      prepareComposerTurnSubmission,
      turnCollaborationModeSettings,
    ],
  );

  const submitPlanTypedRuntimeCommand = useCallback(
    async (command: ComposerCommandDescriptor): Promise<void> => {
      const trimmedDraft = trimComposerDraft(composerDraft);
      const commandTokenLength = `/${command.name}`.length;
      const planPrompt = trimmedDraft.text.slice(commandTokenLength).trim();
      if (planPrompt.length === 0) {
        if (composerStateInput.collaborationMode?.onSwitchToPlan === undefined) {
          setComposerErrorMessage(`/${command.name} is not supported.`);
          return;
        }

        composerStateInput.collaborationMode.onSwitchToPlan();
        draftState.setComposerDraft(createComposerDraft(""));
        return;
      }

      const planPromptStart = trimmedDraft.text.indexOf(planPrompt, commandTokenLength);
      const planPromptDraft: ComposerDraft = {
        text: planPrompt,
        selectedSkillMentions: trimmedDraft.selectedSkillMentions
          .filter(
            (mention) =>
              mention.range.start >= planPromptStart &&
              mention.range.end <= planPromptStart + planPrompt.length,
          )
          .map((mention) => ({
            ...mention,
            range: {
              start: mention.range.start - planPromptStart,
              end: mention.range.end - planPromptStart,
            },
          })),
      };

      const preparationResult = await prepareComposerTurnSubmission({
        attachments: [],
        composerDraft: planPromptDraft,
        pendingDiffComments: [],
      });

      if (preparationResult.status === "blocked") {
        if (preparationResult.message !== null) {
          setComposerErrorMessage(preparationResult.message);
        }
        return;
      }

      if (activeComposerModel === null) {
        setComposerErrorMessage(buildModelSelectionRequiredMessage());
        return;
      }

      const { selectedSkillMentions, submittedPrompt } = preparationResult.submission;
      try {
        await composerStateInput.turnControl.startTurn({
          submittedPrompt,
          selectedSkillMentions,
          transcriptPrompt: submittedPrompt,
          collaborationMode: "plan",
          collaborationModeSettings: {
            mode: "plan",
            model: activeComposerModel.model,
            reasoningEffort: composerStateInput.configControl.selectedReasoningEffort,
            developerInstructions:
              composerStateInput.collaborationModeSettings?.developerInstructions ?? null,
          },
        });
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      composerStateInput.collaborationMode?.onSwitchToPlan?.();
      draftState.setComposerDraft(createComposerDraft(""));
    },
    [
      activeComposerModel,
      composerStateInput.collaborationMode,
      composerStateInput.collaborationModeSettings?.developerInstructions,
      composerStateInput.configControl.selectedReasoningEffort,
      composerStateInput.turnControl,
      composerDraft,
      draftState,
      prepareComposerTurnSubmission,
    ],
  );

  const submitComposer = useCallback((): void => {
    void (async () => {
      clearSessionErrorMessage();
      setComposerErrorMessage(null);

      if (submitAction.type !== "interrupt_turn" && composerStateInput.configControl.isUpdating) {
        return;
      }

      if (typedRuntimeCommand !== null) {
        if (
          composerStateInput.turnControl.activeTurnState === "running" &&
          typedRuntimeCommand.availability?.duringActiveTurn === "disabled"
        ) {
          setComposerErrorMessage(
            `/${typedRuntimeCommand.name} is disabled while a task is in progress.`,
          );
          return;
        }

        if (pendingComposerAttachments.length > 0 || draftState.pendingDiffComments.length > 0) {
          setComposerErrorMessage(`/${typedRuntimeCommand.name} does not support attachments.`);
          return;
        }

        if (composerStateInput.bootstrap.phase.status !== "ready") {
          if (composerStateInput.bootstrap.phase.status === "failed") {
            setComposerErrorMessage(composerStateInput.bootstrap.phase.message);
          }
          return;
        }

        if (typedRuntimeCommand.name === "plan") {
          await submitPlanTypedRuntimeCommand(typedRuntimeCommand);
          return;
        }

        if (composerStateInput.executeTypedRuntimeCommand === undefined) {
          setComposerErrorMessage(`/${typedRuntimeCommand.name} is not supported.`);
          return;
        }

        const commandAccepted = composerStateInput.executeTypedRuntimeCommand({
          commandId: typedRuntimeCommand.id,
          text: composerText,
        });
        if (commandAccepted) {
          draftState.setComposerDraft(createComposerDraft(""));
        }
        return;
      }

      if (unavailableTypedRuntimeCommand !== null) {
        setComposerErrorMessage(unavailableTypedRuntimeCommand.message);
        return;
      }

      if (submitAction.type === "interrupt_turn") {
        composerStateInput.turnControl.interruptTurn();
        return;
      }

      if (submitAction.type === "steer_turn" && composerDraft.selectedSkillMentions.length > 0) {
        setComposerErrorMessage(
          "Selected skills cannot be used while steering a task in progress. Submit them after the current task finishes.",
        );
        return;
      }

      const preparationResult = await prepareComposerTurnSubmission({
        attachments: pendingComposerAttachments,
        composerDraft:
          submitAction.prompt === composerText.trim()
            ? composerDraft
            : createComposerDraft(submitAction.prompt),
        pendingDiffComments: draftState.pendingDiffComments,
      });

      if (preparationResult.status === "blocked") {
        if (preparationResult.message !== null) {
          setComposerErrorMessage(preparationResult.message);
        }
        return;
      }

      const { preparedAttachments, submittedPrompt } = preparationResult.submission;
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
            selectedSkillMentions: preparationResult.submission.selectedSkillMentions,
            submittedAttachments: preparedAttachments.submittedAttachments,
            uploadedAttachments: preparedAttachments.uploadedAttachments,
            displayAttachments: preparedAttachments.displayAttachments,
            transcriptPrompt: submittedPrompt,
            ...(turnCollaborationModeSettings === undefined
              ? {}
              : { collaborationMode: turnCollaborationModeSettings.mode }),
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

      draftState.setComposerDraft(createComposerDraft(""));
      draftState.clearPendingDiffComments();
      setComposerErrorMessage(null);
      setPendingComposerAttachments([]);
    })();
  }, [
    clearSessionErrorMessage,
    composerStateInput.bootstrap.phase,
    composerStateInput.configControl.isUpdating,
    composerStateInput.executeTypedRuntimeCommand,
    composerStateInput.turnControl,
    composerDraft,
    composerText,
    draftState,
    pendingComposerAttachments,
    prepareComposerTurnSubmission,
    submitAction,
    submitPlanTypedRuntimeCommand,
    turnCollaborationModeSettings,
    typedRuntimeCommand,
    unavailableTypedRuntimeCommand,
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

      draftState.setComposerDraft(createComposerDraft(""));
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
    if (typedRuntimeCommand !== null || unavailableTypedRuntimeCommand !== null) {
      return (
        composerStateInput.attachmentControl.isUploadingAttachments ||
        composerStateInput.configControl.isUpdating ||
        composerStateInput.bootstrap.phase.status !== "ready"
      );
    }

    if (submitAction.submitMode === "interrupt") {
      return !composerStateInput.turnControl.canInterrupt;
    }

    if (composerStateInput.attachmentControl.isUploadingAttachments) {
      return true;
    }

    if (composerStateInput.configControl.isUpdating) {
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
    composerStateInput.configControl.isUpdating,
    composerStateInput.turnControl.canInterrupt,
    composerStateInput.turnControl.canSteer,
    composerStateInput.turnControl.isStarting,
    draftState.pendingDiffComments.length,
    pendingComposerAttachments.length,
    requiresModelSelection,
    submitAction.submitMode,
    typedRuntimeCommand,
    unavailableTypedRuntimeCommand,
  ]);

  const queuePromptDisabled = useMemo(
    () =>
      composerStateInput.turnControl.activeTurnState !== "running" ||
      composerStateInput.attachmentControl.isUploadingAttachments ||
      composerStateInput.configControl.isUpdating ||
      isSubmittingNativeQueuedPrompt ||
      composerStateInput.bootstrap.phase.status !== "ready" ||
      typedRuntimeCommand !== null ||
      unavailableTypedRuntimeCommand !== null ||
      (requiresModelSelection && activeComposerModel === null) ||
      (composerText.trim().length === 0 &&
        pendingComposerAttachments.length === 0 &&
        draftState.pendingDiffComments.length === 0),
    [
      activeComposerModel,
      composerText,
      composerStateInput.attachmentControl.isUploadingAttachments,
      composerStateInput.bootstrap.phase.status,
      composerStateInput.configControl.isUpdating,
      composerStateInput.turnControl.activeTurnState,
      draftState.pendingDiffComments.length,
      isSubmittingNativeQueuedPrompt,
      pendingComposerAttachments.length,
      requiresModelSelection,
      typedRuntimeCommand,
      unavailableTypedRuntimeCommand,
    ],
  );

  const queuedPromptViewModels = useMemo(
    () =>
      queuedPrompts.map((queuedPrompt) => ({
        id: queuedPrompt.id,
        text:
          queuedPrompt.text.length > 0
            ? queuedPrompt.text
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
      composerStateInput.configControl.isUpdating ||
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
    composerStateInput.configControl.isUpdating,
    composerStateInput.turnControl.activeTurnState,
    composerStateInput.turnControl.isStarting,
    isSubmittingQueuedPrompt,
    queuedPrompts,
    submitQueuedPrompt,
  ]);

  return {
    composerViewModel: {
      composerCapabilities: composerStateInput.bootstrap.composerCapabilities,
      composerDraft,
      commandPanel: composerStateInput.commandPanel ?? null,
      contextMentionControl: composerStateInput.contextMentionControl ?? null,
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
      reasoningEffortOptions: composerStateInput.configControl.reasoningEffortOptions,
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
      goalStatus: composerStateInput.goalStatus ?? null,
      placeholderText: composerStateInput.placeholderText,
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
        composerStateInput.configControl.controlsDisabled ||
        composerStateInput.attachmentControl.isUploadingAttachments,
      showConfigControls,
      showReasoningControl: composerStateInput.configControl.canChangeReasoningEffort,
      onComposerDraftChange: handleComposerDraftChange,
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

function findTypedRuntimeComposerCommand(input: {
  composerText: string;
  commands: readonly ComposerCommandDescriptor[];
}): ComposerCommandDescriptor | null {
  const commandName = readLeadingSlashCommandName(input.composerText);
  if (commandName === null) {
    return null;
  }

  const command = input.commands.find(
    (candidateCommand) =>
      candidateCommand.name === commandName && candidateCommand.submitAs === "typedRuntimeCommand",
  );

  return command ?? null;
}

function findUnavailableTypedRuntimeCommand(input: {
  composerText: string;
  commands: readonly { name: string; message: string }[];
}): { name: string; message: string } | null {
  const commandName = readLeadingSlashCommandName(input.composerText);
  if (commandName === null) {
    return null;
  }

  const command = input.commands.find((candidateCommand) => candidateCommand.name === commandName);
  return command ?? null;
}
