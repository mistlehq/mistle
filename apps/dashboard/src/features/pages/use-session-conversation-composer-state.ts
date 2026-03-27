import type {
  CodexModelSummary,
  CodexTurnInputLocalImageItem,
} from "@mistle/integrations-definitions/openai/agent/client";
import { uploadSandboxImage } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveTurnRepresentation } from "../session-agents/codex/session-state/codex-attachment-presentation.js";
import type { SessionBootstrapState } from "../session-agents/codex/session-state/use-codex-session-state.js";
import { mintSandboxInstanceConnectionToken } from "../sessions/sessions-service.js";
import { type ComposerConfigSnapshot } from "./session-composer-config.js";
import {
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  supportsImageInspection,
} from "./session-composer-model-readiness.js";
import { resolveUploadErrorMessage } from "./session-composer-upload-errors.js";
import type { SessionConversationComposerProps } from "./session-conversation-pane.tsx";
import { resolveChatComposerAction } from "./session-workbench-view-model.js";

type PendingComposerAttachment = {
  id: string;
  file: File;
  name: string;
};

type ComposerStatusMessage = {
  message: string;
  tone: "error" | "warning";
};

type ComposerConnectedSession = {
  threadId: string | null;
} | null;

type ComposerBootstrapState = {
  availableModels: readonly CodexModelSummary[];
  initialComposerConfig: ComposerConfigSnapshot;
  state: SessionBootstrapState;
};

type ComposerAdminState = {
  isBatchWritingConfig: boolean;
  isWritingConfigValue: boolean;
  batchWriteConfig: (input: {
    edits: readonly {
      keyPath: string;
      value: unknown;
      mergeStrategy: "replace" | "upsert";
    }[];
  }) => void;
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
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
  steerTurn: (input: {
    submittedPrompt: string;
    submittedAttachments?: readonly CodexTurnInputLocalImageItem[];
    transcriptPrompt?: string;
    displayAttachments?: readonly CodexTurnInputLocalImageItem[];
  }) => Promise<void>;
};

export type { ComposerStatusMessage };

function resolveComposerBootstrapMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapState;
}): string | null {
  if (input.bootstrapState.status === "failed") {
    return input.bootstrapState.message;
  }

  if (input.bootstrapState.status !== "ready") {
    return null;
  }

  if (input.activeComposerModel !== null) {
    return null;
  }

  return buildModelSelectionRequiredMessage();
}

function resolveComposerStatusMessage(input: {
  activeComposerModel: CodexModelSummary | null;
  bootstrapState: SessionBootstrapState;
  composerErrorMessage: string | null;
  hasPendingAttachments: boolean;
}): ComposerStatusMessage | null {
  if (input.composerErrorMessage !== null) {
    return {
      message: input.composerErrorMessage,
      tone: "error",
    };
  }

  const bootstrapMessage = resolveComposerBootstrapMessage({
    activeComposerModel: input.activeComposerModel,
    bootstrapState: input.bootstrapState,
  });
  if (bootstrapMessage !== null) {
    return {
      message: bootstrapMessage,
      tone: "error",
    };
  }

  if (input.hasPendingAttachments && input.activeComposerModel !== null) {
    if (!supportsImageInspection(input.activeComposerModel)) {
      return {
        message: buildNonImageCapableModelWarningMessage(input.activeComposerModel.displayName),
        tone: "warning",
      };
    }
  }

  return null;
}

export function useSessionConversationComposerState(input: {
  admin: ComposerAdminState;
  bootstrap: ComposerBootstrapState;
  chat: ComposerChatState;
  connectedSession: ComposerConnectedSession;
  hasActiveTurn: boolean;
  sandboxInstanceId: string | null;
}): SessionConversationComposerProps {
  const { batchWriteConfig, isBatchWritingConfig, isWritingConfigValue, writeConfigValue } =
    input.admin;
  const [composerText, setComposerText] = useState("");
  const [composerErrorMessage, setComposerErrorMessage] = useState<string | null>(null);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<
    readonly PendingComposerAttachment[]
  >([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [composerConfig, setComposerConfig] = useState<ComposerConfigSnapshot>({
    model: null,
    modelReasoningEffort: null,
  });

  useEffect(() => {
    setComposerText("");
    setComposerErrorMessage(null);
    setPendingComposerAttachments([]);
    setIsUploadingAttachments(false);
    setComposerConfig({
      model: null,
      modelReasoningEffort: null,
    });
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.bootstrap.state.status !== "ready") {
      return;
    }

    setComposerConfig(input.bootstrap.initialComposerConfig);
  }, [input.bootstrap.initialComposerConfig, input.bootstrap.state.status]);

  const activeComposerModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels: input.bootstrap.availableModels,
        selectedModel: composerConfig.model,
      }),
    [composerConfig.model, input.bootstrap.availableModels],
  );

  const composerStatusMessage = resolveComposerStatusMessage({
    activeComposerModel,
    bootstrapState: input.bootstrap.state,
    composerErrorMessage,
    hasPendingAttachments: pendingComposerAttachments.length > 0,
  });

  const handleComposerTextChange = useCallback((nextText: string): void => {
    setComposerErrorMessage(null);
    setComposerText(nextText);
  }, []);

  const setComposerModel = useCallback(
    (nextModel: string): void => {
      setComposerErrorMessage(null);
      setComposerConfig((currentConfig) => ({
        model: nextModel,
        modelReasoningEffort: currentConfig.modelReasoningEffort,
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
    [batchWriteConfig],
  );

  const setComposerReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      setComposerErrorMessage(null);
      setComposerConfig((currentConfig) => ({
        model: currentConfig.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
      writeConfigValue({
        keyPath: "model_reasoning_effort",
        value: nextReasoningEffort,
        mergeStrategy: "replace",
      });
    },
    [writeConfigValue],
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

      if (input.bootstrap.state.status !== "ready") {
        if (input.bootstrap.state.status === "failed") {
          setComposerErrorMessage(input.bootstrap.state.message);
        }
        return;
      }

      if (activeComposerModel === null) {
        const missingModelMessage =
          composerConfig.model === null
            ? buildModelSelectionRequiredMessage()
            : buildUnavailableModelErrorMessage(composerConfig.model);
        setComposerErrorMessage(missingModelMessage);
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
        supportsImageInspection: supportsImageInspection(activeComposerModel),
      });

      try {
        if (action.type === "steer_turn") {
          await input.chat.steerTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            displayAttachments: turnRepresentation.displayAttachments,
            transcriptPrompt: action.prompt,
          });
        } else {
          await input.chat.startTurn({
            submittedPrompt: turnRepresentation.prompt,
            submittedAttachments: turnRepresentation.submittedAttachments,
            displayAttachments: turnRepresentation.displayAttachments,
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
    activeComposerModel,
    composerConfig.model,
    composerText,
    input.bootstrap.state,
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
        canSubmitTurns: input.bootstrap.state.status === "ready" && activeComposerModel !== null,
        isInterruptingTurn: input.chat.isInterruptingTurn,
        isStartingTurn: input.chat.isStartingTurn,
        isSteeringTurn: input.chat.isSteeringTurn,
      },
      completedErrorMessage: input.chat.completedErrorMessage,
      isConnected: input.connectedSession !== null,
      isUpdatingConfig:
        input.bootstrap.state.status === "bootstrapping" ||
        isBatchWritingConfig ||
        isWritingConfigValue,
      isUploadingAttachments,
      statusMessage: composerStatusMessage,
    },
    modelOptions: input.bootstrap.availableModels.map((model) => ({
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
    selectedModel: composerConfig.model,
    selectedReasoningEffort: composerConfig.modelReasoningEffort,
  };
}
