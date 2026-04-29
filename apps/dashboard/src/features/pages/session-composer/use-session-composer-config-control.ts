import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { useCallback, useMemo, useState } from "react";

import type { CodexSessionConfigState } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import type { SessionBootstrapResult } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import type { ComposerConfigSnapshot } from "./session-composer-config.js";

export type SessionComposerConfigControl = {
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  modelOptions: readonly {
    value: string;
    label: string;
  }[];
  canChangeModel: boolean;
  canChangeReasoningEffort: boolean;
  isUpdating: boolean;
  setModel: (value: string) => void;
  setReasoningEffort: (value: string) => void;
};

function findSelectedModel(input: {
  availableModels: readonly CodexModelSummary[];
  selectedModel: string | null;
}): CodexModelSummary | null {
  if (input.selectedModel !== null) {
    return input.availableModels.find((model) => model.model === input.selectedModel) ?? null;
  }

  return input.availableModels.find((model) => model.isDefault) ?? null;
}

export function useSessionComposerConfigControl(input: {
  bootstrap: SessionBootstrapResult;
  clearSessionErrorMessage: () => void;
  codexConfig: CodexSessionConfigState;
}): SessionComposerConfigControl {
  const { batchWriteConfig, isBatchWritingConfig, isWritingConfigValue, writeConfigValue } =
    input.codexConfig;
  const [composerConfigOverrides, setComposerConfigOverrides] = useState<ComposerConfigSnapshot>({
    model: null,
    modelReasoningEffort: null,
  });

  const selectedModel = useMemo(
    () =>
      composerConfigOverrides.model ??
      input.bootstrap.establishedSnapshot.configSnapshot.model ??
      findSelectedModel({
        availableModels: input.bootstrap.establishedSnapshot.availableModels,
        selectedModel: null,
      })?.model ??
      null,
    [
      composerConfigOverrides.model,
      input.bootstrap.establishedSnapshot.availableModels,
      input.bootstrap.establishedSnapshot.configSnapshot.model,
    ],
  );

  const selectedReasoningEffort = useMemo(() => {
    const explicitReasoningEffort =
      composerConfigOverrides.modelReasoningEffort ??
      input.bootstrap.establishedSnapshot.configSnapshot.modelReasoningEffort;
    if (explicitReasoningEffort !== null) {
      return explicitReasoningEffort;
    }

    return (
      findSelectedModel({
        availableModels: input.bootstrap.establishedSnapshot.availableModels,
        selectedModel,
      })?.defaultReasoningEffort ?? null
    );
  }, [
    composerConfigOverrides.modelReasoningEffort,
    input.bootstrap.establishedSnapshot.availableModels,
    input.bootstrap.establishedSnapshot.configSnapshot.modelReasoningEffort,
    selectedModel,
  ]);

  const modelOptions = useMemo(
    () =>
      input.bootstrap.establishedSnapshot.availableModels.map((model) => ({
        value: model.model,
        label: model.displayName,
      })),
    [input.bootstrap.establishedSnapshot.availableModels],
  );

  const setModel = useCallback(
    (nextModel: string): void => {
      input.clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
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
    [batchWriteConfig, input.clearSessionErrorMessage],
  );

  const setReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      input.clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
        model: currentConfig.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
      writeConfigValue({
        keyPath: "model_reasoning_effort",
        value: nextReasoningEffort,
        mergeStrategy: "replace",
      });
    },
    [input.clearSessionErrorMessage, writeConfigValue],
  );

  return {
    selectedModel,
    selectedReasoningEffort,
    modelOptions,
    canChangeModel: true,
    canChangeReasoningEffort: true,
    isUpdating: isBatchWritingConfig || isWritingConfigValue,
    setModel,
    setReasoningEffort,
  };
}
