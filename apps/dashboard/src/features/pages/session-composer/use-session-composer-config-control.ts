import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ComposerConfigSnapshot } from "./session-composer-config.js";
import { buildSessionComposerModelOptions } from "./session-composer-model-options.js";
import { resolveActiveComposerModel } from "./session-composer-model-readiness.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerReasoningEffortOption,
} from "./session-composer-runtime-contracts.js";

export type SessionComposerConfigControl = {
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  hasExplicitModelSelection: boolean;
  modelOptions: readonly {
    value: string;
    label: string;
  }[];
  reasoningEffortOptions: readonly SessionComposerReasoningEffortOption[];
  canChangeReasoningEffort: boolean;
  controlsDisabled: boolean;
  isUpdating: boolean;
  setModel: (value: string) => void;
  setReasoningEffort: (value: string) => void;
};

export type SessionComposerConfigWriter = {
  isUpdating: boolean;
  writeModel: (model: string) => void;
  writeReasoningEffort: (reasoningEffort: string) => void;
};

const DefaultReasoningEffortOptions: readonly SessionComposerReasoningEffortOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

function resolveReasoningEffortOptions(input: {
  availableModels: SessionComposerBootstrapResult["establishedSnapshot"]["availableModels"];
  selectedModel: string | null;
}): readonly SessionComposerReasoningEffortOption[] {
  if (input.selectedModel === null) {
    return [];
  }

  return (
    resolveActiveComposerModel({
      availableModels: input.availableModels,
      selectedModel: input.selectedModel,
    })?.reasoningEffortOptions ?? DefaultReasoningEffortOptions
  );
}

function resolveSelectedReasoningEffort(input: {
  availableModels: SessionComposerBootstrapResult["establishedSnapshot"]["availableModels"];
  configuredReasoningEffort: string | null;
  reasoningEffortOptions: readonly SessionComposerReasoningEffortOption[];
  selectedModel: string | null;
}): string | null {
  if (input.selectedModel === null) {
    return null;
  }

  if (
    input.configuredReasoningEffort !== null &&
    input.reasoningEffortOptions.some((option) => option.value === input.configuredReasoningEffort)
  ) {
    return input.configuredReasoningEffort;
  }

  const defaultReasoningEffort =
    resolveActiveComposerModel({
      availableModels: input.availableModels,
      selectedModel: input.selectedModel,
    })?.defaultReasoningEffort ?? null;

  return defaultReasoningEffort !== null &&
    input.reasoningEffortOptions.some((option) => option.value === defaultReasoningEffort)
    ? defaultReasoningEffort
    : null;
}

export function usePersistedSessionComposerConfigControl(input: {
  bootstrap: SessionComposerBootstrapResult;
  clearSessionErrorMessage: () => void;
  writer: SessionComposerConfigWriter;
}): SessionComposerConfigControl {
  const { availableModels, configSnapshot } = input.bootstrap.establishedSnapshot;
  const { clearSessionErrorMessage, writer } = input;
  const { isUpdating, writeModel, writeReasoningEffort } = writer;
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

  const reasoningEffortOptions = useMemo(
    () => resolveReasoningEffortOptions({ availableModels, selectedModel }),
    [availableModels, selectedModel],
  );

  const selectedReasoningEffort = useMemo(
    () =>
      resolveSelectedReasoningEffort({
        availableModels,
        configuredReasoningEffort:
          composerConfigOverrides.modelReasoningEffort ?? configSnapshot.modelReasoningEffort,
        reasoningEffortOptions,
        selectedModel,
      }),
    [
      availableModels,
      composerConfigOverrides.modelReasoningEffort,
      configSnapshot.modelReasoningEffort,
      reasoningEffortOptions,
      selectedModel,
    ],
  );

  const modelOptions = useMemo(
    () => buildSessionComposerModelOptions(availableModels, false),
    [availableModels],
  );

  const setModel = useCallback(
    (nextModel: string): void => {
      clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
        model: nextModel,
        modelReasoningEffort: currentConfig.modelReasoningEffort,
      }));
      writeModel(nextModel);
    },
    [clearSessionErrorMessage, writeModel],
  );

  const setReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      clearSessionErrorMessage();
      setComposerConfigOverrides((currentConfig) => ({
        model: currentConfig.model,
        modelReasoningEffort: nextReasoningEffort,
      }));
      writeReasoningEffort(nextReasoningEffort);
    },
    [clearSessionErrorMessage, writeReasoningEffort],
  );

  return {
    selectedModel,
    selectedReasoningEffort,
    hasExplicitModelSelection: selectedModel !== null,
    modelOptions,
    reasoningEffortOptions,
    canChangeReasoningEffort: reasoningEffortOptions.length > 0,
    controlsDisabled: isUpdating,
    isUpdating,
    setModel,
    setReasoningEffort,
  };
}

export function useLocalSessionComposerConfigControl(input: {
  bootstrap: SessionComposerBootstrapResult;
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
      return (
        resolveActiveComposerModel({
          availableModels,
          selectedModel: null,
        })?.model ?? null
      );
    }

    return availableModels.some((model) => model.model === configuredModel)
      ? configuredModel
      : null;
  }, [availableModels, configuredModel]);

  const reasoningEffortOptions = useMemo(
    () => resolveReasoningEffortOptions({ availableModels, selectedModel }),
    [availableModels, selectedModel],
  );

  const selectedReasoningEffort = useMemo(
    () =>
      resolveSelectedReasoningEffort({
        availableModels,
        configuredReasoningEffort:
          composerConfigOverrides.modelReasoningEffort ?? configSnapshot.modelReasoningEffort,
        reasoningEffortOptions,
        selectedModel,
      }),
    [
      availableModels,
      composerConfigOverrides.modelReasoningEffort,
      configSnapshot.modelReasoningEffort,
      reasoningEffortOptions,
      selectedModel,
    ],
  );

  const modelOptions = useMemo(
    () => buildSessionComposerModelOptions(availableModels, true),
    [availableModels],
  );

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
    hasExplicitModelSelection: configuredModel !== null && selectedModel !== null,
    modelOptions,
    reasoningEffortOptions,
    canChangeReasoningEffort:
      (input.canChangeReasoningEffort ?? true) && reasoningEffortOptions.length > 0,
    controlsDisabled: false,
    isUpdating: false,
    setModel,
    setReasoningEffort,
  };
}
