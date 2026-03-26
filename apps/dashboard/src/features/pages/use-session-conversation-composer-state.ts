import type {
  CodexModelSummary,
  CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/openai/agent/client";
import { uploadSandboxImage } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useEffect, useState } from "react";

import {
  buildAttachedImagePathsText,
  buildPromptWithAttachedImagePaths,
  buildTurnPrompt,
  resolveTurnRepresentation,
} from "../session-agents/codex/session-state/codex-attachment-presentation.js";
import type { CodexModelCatalogStatus } from "../session-agents/codex/session-state/use-codex-session-admin.js";
import { mintSandboxInstanceConnectionToken } from "../sessions/sessions-service.js";
import {
  readComposerConfigSnapshot,
  type ComposerConfigSnapshot,
} from "./session-composer-config.js";
import {
  buildModelSelectionLoadingMessage,
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  getComposerSelectionKey,
  resolveActiveComposerModel,
  resolveComposerStatusMessage,
  resolveComposerSubmitReadiness,
  supportsImageInspection,
  type ComposerStatusMessage,
  type ComposerSubmitReadiness,
  type ResolvedComposerModelContext,
} from "./session-composer-model-readiness.js";
import { resolveUploadErrorMessage } from "./session-composer-upload-errors.js";
import type { SessionConversationComposerProps } from "./session-conversation-pane.tsx";
import { resolveChatComposerAction } from "./session-workbench-view-model.js";

type ComposerConfigDraft = ComposerConfigSnapshot & {
  baseConfigJson: string | null;
};

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
};

type ComposerConnectedSession = {
  threadId: string | null;
} | null;

type ComposerAdminState = {
  availableModels: readonly CodexModelSummary[];
  modelCatalogStatus: CodexModelCatalogStatus;
  configJson: string | null;
  isBatchWritingConfig: boolean;
  isWritingConfigValue: boolean;
  batchWriteConfig: (input: {
    edits: readonly {
      keyPath: string;
      value: unknown;
      mergeStrategy: "replace" | "upsert";
    }[];
  }) => void;
  loadModels: () => void;
  readConfig: (includeLayers: boolean) => void;
  writeConfigValue: (input: {
    keyPath: string;
    value: unknown;
    mergeStrategy: "replace" | "upsert";
  }) => void;
};

type ComposerChatState = {
  canInterruptTurn: boolean;
  canSteerTurn: boolean;
  completedErrorMessage: string | null;
  interruptTurn: () => void;
  isInterruptingTurn: boolean;
  isStartingTurn: boolean;
  isSteeringTurn: boolean;
  startTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    transcriptAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    transcriptAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
};

export {
  buildAttachedImagePathsText,
  buildPromptWithAttachedImagePaths,
  buildTurnPrompt,
  buildModelSelectionLoadingMessage,
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  resolveComposerStatusMessage,
  resolveComposerSubmitReadiness,
  resolveTurnRepresentation,
  supportsImageInspection,
};
export type { ComposerStatusMessage, ComposerSubmitReadiness, ResolvedComposerModelContext };

export function useSessionConversationComposerState(input: {
  admin: ComposerAdminState;
  chat: ComposerChatState;
  connectedSession: ComposerConnectedSession;
  hasActiveTurn: boolean;
  sandboxInstanceId: string | null;
}): SessionConversationComposerProps {
  const {
    availableModels,
    batchWriteConfig,
    configJson,
    isBatchWritingConfig,
    isWritingConfigValue,
    loadModels,
    modelCatalogStatus,
    readConfig,
    writeConfigValue,
  } = input.admin;
  const [composerText, setComposerText] = useState("");
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [composerConfigDraft, setComposerConfigDraft] = useState<ComposerConfigDraft | null>(null);
  const [resolvedComposerModelContext, setResolvedComposerModelContext] =
    useState<ResolvedComposerModelContext | null>(null);

  const composerConfigSnapshot =
    input.connectedSession === null
      ? {
          model: null,
          modelReasoningEffort: null,
        }
      : readComposerConfigSnapshot(configJson);
  const activeComposerConfig =
    input.connectedSession !== null &&
    composerConfigDraft !== null &&
    composerConfigDraft.baseConfigJson === configJson
      ? {
          model: composerConfigDraft.model,
          modelReasoningEffort: composerConfigDraft.modelReasoningEffort,
        }
      : composerConfigSnapshot;

  useEffect(() => {
    setComposerText("");
    setComposerErrorMessage(null);
    setPendingComposerAttachments([]);
    setIsUploadingAttachments(false);
    setComposerConfigDraft(null);
    setResolvedComposerModelContext(null);
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.connectedSession === null) {
      return;
    }

    loadModels();
    readConfig(false);
  }, [input.connectedSession, loadModels, readConfig]);

  const composerSelectionKey = getComposerSelectionKey(activeComposerConfig.model);
  const activeComposerModel = resolveActiveComposerModel({
    availableModels,
    selectedModel: activeComposerConfig.model,
  });

  useEffect(() => {
    if (input.connectedSession === null) {
      setResolvedComposerModelContext(null);
      return;
    }

    setResolvedComposerModelContext((currentContext) => {
      if (currentContext !== null && currentContext.selectionKey !== composerSelectionKey) {
        return null;
      }

      if (activeComposerModel === null) {
        return currentContext;
      }

      if (
        currentContext !== null &&
        currentContext.selectionKey === composerSelectionKey &&
        currentContext.model.model === activeComposerModel.model &&
        currentContext.model.displayName === activeComposerModel.displayName
      ) {
        return currentContext;
      }

      return {
        selectionKey: composerSelectionKey,
        model: activeComposerModel,
      };
    });
  }, [activeComposerModel, composerSelectionKey, input.connectedSession]);

  const composerSubmitReadiness = resolveComposerSubmitReadiness({
    activeModel: activeComposerModel,
    modelCatalogStatus,
    resolvedModel: resolvedComposerModelContext?.model ?? null,
    selectedModel: activeComposerConfig.model,
  });
  const composerStatusMessage = resolveComposerStatusMessage({
    composerErrorMessage,
    hasPendingAttachments: pendingComposerAttachments.length > 0,
    submitReadiness: composerSubmitReadiness,
  });

  const handleComposerTextChange = useCallback((nextText: string): void => {
    setComposerErrorMessage(null);
    setComposerText(nextText);
  }, []);

  const setComposerModel = useCallback(
    (nextModel: string): void => {
      setComposerErrorMessage(null);
      setResolvedComposerModelContext(null);
      setComposerConfigDraft((currentDraft) => ({
        baseConfigJson: configJson,
        model: nextModel,
        modelReasoningEffort:
          currentDraft?.baseConfigJson === configJson
            ? currentDraft.modelReasoningEffort
            : composerConfigSnapshot.modelReasoningEffort,
      }));
      batchWriteConfig({
        edits: [
          {
            keyPath: "model",
            value: nextModel,
            mergeStrategy: "replace",
          },
        ],
      });
    },
    [batchWriteConfig, composerConfigSnapshot.modelReasoningEffort, configJson],
  );

  const setComposerReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      setComposerErrorMessage(null);
      setComposerConfigDraft((currentDraft) => ({
        baseConfigJson: configJson,
        model:
          currentDraft?.baseConfigJson === configJson
            ? currentDraft.model
            : composerConfigSnapshot.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
      writeConfigValue({
        keyPath: "model_reasoning_effort",
        value: nextReasoningEffort,
        mergeStrategy: "replace",
      });
    },
    [composerConfigSnapshot.model, configJson, writeConfigValue],
  );

  const addPendingComposerFiles = useCallback((files: readonly File[]): void => {
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

    setComposerErrorMessage(null);
    setPendingComposerAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ]);
  }, []);

  const removePendingComposerAttachment = useCallback((attachmentId: string): void => {
    setComposerErrorMessage(null);
    setPendingComposerAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
  }, []);

  const submitComposer = useCallback((): void => {
    void (async () => {
      setComposerErrorMessage(null);
      const action = resolveChatComposerAction({
        composerText,
        hasActiveTurn: input.hasActiveTurn,
        hasPendingAttachments: pendingComposerAttachments.length > 0,
      });

      if (action.type === "interrupt_turn") {
        input.chat.interruptTurn();
        return;
      }

      if (composerSubmitReadiness.status !== "ready") {
        setComposerErrorMessage(composerSubmitReadiness.message);
        return;
      }

      let uploadedAttachments: readonly CodexTurnInputLocalImageItem[] = [];
      let uploadedAttachmentPaths: readonly string[] = [];
      if (pendingComposerAttachments.length > 0) {
        if (
          input.sandboxInstanceId === null ||
          input.connectedSession === null ||
          input.connectedSession.threadId === null
        ) {
          setComposerErrorMessage("Connect to a sandbox session before uploading images.");
          return;
        }

        setIsUploadingAttachments(true);
        try {
          const runtime = createBrowserSandboxSessionRuntime();
          const uploadedImages = [];
          const sandboxInstanceId = input.sandboxInstanceId;
          const threadId = input.connectedSession.threadId;
          for (const attachment of pendingComposerAttachments) {
            const mintedConnection = await mintSandboxInstanceConnectionToken({
              instanceId: sandboxInstanceId,
            });
            uploadedImages.push(
              await uploadSandboxImage({
                connectionUrl: mintedConnection.connectionUrl,
                file: attachment.file,
                runtime,
                threadId,
              }),
            );
          }
          uploadedAttachmentPaths = uploadedImages.map((image) => image.path);
          uploadedAttachments = uploadedImages.map((image) => ({
            type: "localImage",
            path: image.path,
          }));
        } catch (error) {
          setComposerErrorMessage(resolveUploadErrorMessage(error));
          return;
        } finally {
          setIsUploadingAttachments(false);
        }
      }

      const turnRepresentation = resolveTurnRepresentation({
        prompt: action.prompt,
        attachmentPaths: uploadedAttachmentPaths,
        uploadedAttachments,
        supportsImageInspection: supportsImageInspection(composerSubmitReadiness.activeModel),
      });

      try {
        if (action.type === "steer_turn") {
          await input.chat.steerTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            transcriptAttachments: turnRepresentation.transcriptAttachments,
            transcriptPrompt: action.prompt,
          });
        } else {
          await input.chat.startTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            transcriptAttachments: turnRepresentation.transcriptAttachments,
            transcriptPrompt: action.prompt,
          });
        }
      } catch (error) {
        setComposerErrorMessage(
          error instanceof Error ? error.message : "Could not submit chat message.",
        );
        return;
      }

      if (action.shouldClearComposer) {
        setComposerText("");
      }
      setComposerErrorMessage(null);
      setPendingComposerAttachments([]);
    })();
  }, [
    composerSubmitReadiness,
    composerText,
    input.chat,
    input.connectedSession,
    input.hasActiveTurn,
    input.sandboxInstanceId,
    pendingComposerAttachments,
  ]);

  return {
    composerText,
    composerUi: {
      action: {
        canInterruptTurn: input.chat.canInterruptTurn,
        canSteerTurn: input.chat.canSteerTurn,
        canSubmitTurns: composerSubmitReadiness.status === "ready",
        isInterruptingTurn: input.chat.isInterruptingTurn,
        isStartingTurn: input.chat.isStartingTurn,
        isSteeringTurn: input.chat.isSteeringTurn,
      },
      completedErrorMessage: input.chat.completedErrorMessage,
      isConnected: input.connectedSession !== null,
      isUpdatingConfig: isBatchWritingConfig || isWritingConfigValue,
      isUploadingAttachments,
      statusMessage: composerStatusMessage,
    },
    modelOptions: availableModels.map((model) => ({
      value: model.model,
      label: model.displayName,
    })),
    onComposerTextChange: handleComposerTextChange,
    onModelChange: setComposerModel,
    onPendingImageFilesAdded: addPendingComposerFiles,
    onReasoningEffortChange: setComposerReasoningEffort,
    onRemovePendingAttachment: removePendingComposerAttachment,
    onSubmit: submitComposer,
    pendingAttachments: pendingComposerAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
    })),
    selectedModel: activeComposerConfig.model,
    selectedReasoningEffort: activeComposerConfig.modelReasoningEffort,
  };
}
