import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CodexSessionConfigState,
  SessionBootstrapResult,
} from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import type { ComposerConfigSnapshot } from "./session-composer-config.js";
import { resolveActiveComposerModel } from "./session-composer-model-readiness.js";

export type SessionComposerConfigControl = {
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  hasExplicitModelSelection: boolean;
  modelOptions: readonly {
    value: string;
    label: string;
  }[];
  canChangeReasoningEffort: boolean;
  isUpdating: boolean;
  setModel: (value: string) => void;
  setReasoningEffort: (value: string) => void;
};

function resolveSelectedReasoningEffort(input: {
  availableModels: SessionBootstrapResult["establishedSnapshot"]["availableModels"];
  configuredReasoningEffort: string | null;
  selectedModel: string | null;
}): string | null {
  if (input.selectedModel === null) {
    return null;
  }

  if (input.configuredReasoningEffort !== null) {
    return input.configuredReasoningEffort;
  }

  return (
    resolveActiveComposerModel({
      availableModels: input.availableModels,
      selectedModel: input.selectedModel,
    })?.defaultReasoningEffort ?? null
  );
}

function buildModelOptions(
  availableModels: SessionBootstrapResult["establishedSnapshot"]["availableModels"],
): SessionComposerConfigControl["modelOptions"] {
  return availableModels.map((model) => ({
    value: model.model,
    label: model.displayName,
  }));
}

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

  const selectedReasoningEffort = useMemo(
    () =>
      resolveSelectedReasoningEffort({
        availableModels,
        configuredReasoningEffort:
          composerConfigOverrides.modelReasoningEffort ?? configSnapshot.modelReasoningEffort,
        selectedModel,
      }),
    [
      availableModels,
      composerConfigOverrides.modelReasoningEffort,
      configSnapshot.modelReasoningEffort,
      selectedModel,
    ],
  );

  const modelOptions = useMemo(() => buildModelOptions(availableModels), [availableModels]);

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
    hasExplicitModelSelection: selectedModel !== null,
    modelOptions,
    canChangeReasoningEffort: true,
    isUpdating: isBatchWritingConfig || isWritingConfigValue,
    setModel,
    setReasoningEffort,
  };
}

export function useLocalSessionComposerConfigControl(input: {
  bootstrap: SessionBootstrapResult;
  clearSessionErrorMessage: () => void;
  canChangeReasoningEffort?: boolean;
  resetKey?: string | null;
}): SessionComposerConfigControl {
  const { availableModels, configSnapshot } = input.bootstrap.establishedSnapshot;
  const [composerConfigOverrides, setComposerConfigOverrides] = useState<ComposerConfigSnapshot>({
    model: null,
    modelReasoningEffort: null,
  });
  const appliedResetKeyRef = useRef<string | null | undefined>(input.resetKey);

  useEffect(() => {
    if (appliedResetKeyRef.current === input.resetKey) {
      return;
    }
    appliedResetKeyRef.current = input.resetKey;
    setComposerConfigOverrides({
      model: null,
      modelReasoningEffort: null,
    });
  }, [input.resetKey]);

  const configuredModel = useMemo(
    () => composerConfigOverrides.model ?? configSnapshot.model ?? null,
    [composerConfigOverrides.model, configSnapshot.model],
  );
  const selectedModel = useMemo(() => {
    if (configuredModel === null) {
      return null;
    }

    return availableModels.some((model) => model.model === configuredModel)
      ? configuredModel
      : null;
  }, [availableModels, configuredModel]);

  const selectedReasoningEffort = useMemo(
    () =>
      resolveSelectedReasoningEffort({
        availableModels,
        configuredReasoningEffort:
          composerConfigOverrides.modelReasoningEffort ?? configSnapshot.modelReasoningEffort,
        selectedModel,
      }),
    [
      availableModels,
      composerConfigOverrides.modelReasoningEffort,
      configSnapshot.modelReasoningEffort,
      selectedModel,
    ],
  );

  const modelOptions = useMemo(() => buildModelOptions(availableModels), [availableModels]);

  const setModel = useCallback(
    (nextModel: string): void => {
      input.clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
        model: nextModel,
        modelReasoningEffort: currentConfig.modelReasoningEffort,
      }));
    },
    [input.clearSessionErrorMessage],
  );

  const setReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      input.clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
        model: currentConfig.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
    },
    [input.clearSessionErrorMessage],
  );

  return {
    selectedModel,
    selectedReasoningEffort,
    hasExplicitModelSelection: selectedModel !== null,
    modelOptions,
    canChangeReasoningEffort: input.canChangeReasoningEffort ?? true,
    isUpdating: false,
    setModel,
    setReasoningEffort,
  };
}
