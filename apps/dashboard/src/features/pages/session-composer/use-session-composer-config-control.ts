import { useCallback, useMemo, useState } from "react";

import type {
  CodexSessionConfigState,
  SessionBootstrapResult,
} from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import type { ComposerConfigSnapshot } from "./session-composer-config.js";
import { resolveActiveComposerModel } from "./session-composer-model-readiness.js";

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

export function useSessionComposerConfigControl(input: {
  bootstrap: SessionBootstrapResult;
  clearSessionErrorMessage: () => void;
  codexConfig: CodexSessionConfigState;
}): SessionComposerConfigControl {
  const { availableModels, configSnapshot } = input.bootstrap.establishedSnapshot;
  const { batchWriteConfig, isBatchWritingConfig, isWritingConfigValue, writeConfigValue } =
    input.codexConfig;
  const [composerConfigOverrides, setComposerConfigOverrides] = useState<ComposerConfigSnapshot>({
    model: null,
    modelReasoningEffort: null,
  });

  const selectedModel = useMemo(
    () =>
      composerConfigOverrides.model ??
      configSnapshot.model ??
      resolveActiveComposerModel({
        availableModels,
        selectedModel: null,
      })?.model ??
      null,
    [availableModels, composerConfigOverrides.model, configSnapshot.model],
  );

  const selectedReasoningEffort = useMemo(() => {
    const explicitReasoningEffort =
      composerConfigOverrides.modelReasoningEffort ?? configSnapshot.modelReasoningEffort;
    if (explicitReasoningEffort !== null) {
      return explicitReasoningEffort;
    }

    return (
      resolveActiveComposerModel({
        availableModels,
        selectedModel,
      })?.defaultReasoningEffort ?? null
    );
  }, [
    availableModels,
    composerConfigOverrides.modelReasoningEffort,
    configSnapshot.modelReasoningEffort,
    selectedModel,
  ]);

  const modelOptions = useMemo(
    () =>
      availableModels.map((model) => ({
        value: model.model,
        label: model.displayName,
      })),
    [availableModels],
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
