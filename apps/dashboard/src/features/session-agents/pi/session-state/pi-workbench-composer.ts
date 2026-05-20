import type {
  PiModel,
  PiThinkingLevel,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { useCallback, useMemo, useState } from "react";

import { buildSessionComposerModelOptions } from "../../../pages/session-composer/session-composer-model-options.js";
import { resolveActiveComposerModel } from "../../../pages/session-composer/session-composer-model-readiness.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerModel,
  SessionComposerReasoningEffortOption,
} from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import type { SessionComposerConfigControl } from "../../../pages/session-composer/use-session-composer-config-control.js";

const EmptyPiComposerConfig = {
  model: null,
  modelReasoningEffort: null,
};

export type PiModelSelection = {
  provider: string;
  modelId: string;
};

export type PiModelWriter = {
  setModel: (selection: PiModelSelection) => Promise<void>;
  setThinkingLevel: (level: PiThinkingLevel) => Promise<void>;
};

const PiThinkingLevels: readonly PiThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const PiThinkingLevelLabels: Readonly<Record<PiThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export function buildPiModelSelectionValue(input: PiModelSelection): string {
  return `${input.provider}/${input.modelId}`;
}

export function parsePiModelSelectionValue(value: string): PiModelSelection {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`Invalid Pi model selection '${value}'.`);
  }

  return {
    provider: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function mapPiThinkingLevelsToReasoningEffortOptions(
  model: PiModel,
): readonly SessionComposerReasoningEffortOption[] {
  if (model.reasoning !== true) {
    return [];
  }

  return PiThinkingLevels.filter((level) => {
    if (model.thinkingLevelMap === undefined) {
      return true;
    }
    const mappedLevel = model.thinkingLevelMap?.[level];
    if (mappedLevel === null) {
      return false;
    }
    return level !== "xhigh" || mappedLevel !== undefined;
  }).map((level) => ({
    value: level,
    label: PiThinkingLevelLabels[level],
  }));
}

function parsePiThinkingLevel(value: string): PiThinkingLevel {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      throw new Error(`Invalid Pi thinking level '${value}'.`);
  }
}

export function mapPiModelsToComposerModels(input: {
  availableModels: readonly PiModel[];
}): readonly SessionComposerModel[] {
  return input.availableModels.map((model) => {
    const selection = {
      provider: model.provider,
      modelId: model.id,
    };
    return {
      model: buildPiModelSelectionValue(selection),
      displayName: `${model.provider} / ${model.name}`,
      defaultReasoningEffort: null,
      reasoningEffortOptions: mapPiThinkingLevelsToReasoningEffortOptions(model),
      inputModalities: model.input,
      isDefault: false,
    };
  });
}

export function buildReadyPiComposerBootstrap(input: {
  activeModel: PiModel | null;
  availableModels: readonly PiModel[];
  thinkingLevel: PiThinkingLevel;
}): SessionComposerBootstrapResult {
  return {
    phase: { status: "ready" },
    composerCapabilities: [],
    establishedSnapshot: {
      availableModels: mapPiModelsToComposerModels({ availableModels: input.availableModels }),
      configSnapshot: {
        model:
          input.activeModel === null
            ? null
            : buildPiModelSelectionValue({
                provider: input.activeModel.provider,
                modelId: input.activeModel.id,
              }),
        modelReasoningEffort: input.thinkingLevel,
      },
    },
  };
}

export function buildUnavailablePiComposerBootstrap(
  phase: SessionComposerBootstrapResult["phase"],
): SessionComposerBootstrapResult {
  return {
    phase,
    composerCapabilities: [],
    establishedSnapshot: {
      availableModels: [],
      configSnapshot: EmptyPiComposerConfig,
    },
  };
}

export function usePiSessionComposerConfigControl(input: {
  bootstrap: SessionComposerBootstrapResult;
  clearSessionErrorMessage: () => void;
  isTurnRunning: boolean;
  reportSessionErrorMessage: (message: string) => void;
  writer: PiModelWriter;
}): SessionComposerConfigControl {
  const { bootstrap, clearSessionErrorMessage, isTurnRunning, reportSessionErrorMessage, writer } =
    input;
  const { availableModels, configSnapshot } = bootstrap.establishedSnapshot;
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const [isUpdatingThinkingLevel, setIsUpdatingThinkingLevel] = useState(false);

  const modelOptions = useMemo(
    () => buildSessionComposerModelOptions(availableModels, false),
    [availableModels],
  );

  const setModel = useCallback(
    (nextModel: string): void => {
      clearSessionErrorMessage();
      if (isTurnRunning) {
        reportSessionErrorMessage("Pi model cannot be changed while Pi is working.");
        return;
      }

      let selection: PiModelSelection;
      try {
        selection = parsePiModelSelectionValue(nextModel);
      } catch (error) {
        reportSessionErrorMessage(
          error instanceof Error ? error.message : "Invalid Pi model selection.",
        );
        return;
      }

      setIsUpdatingModel(true);
      void (async (): Promise<void> => {
        try {
          await writer.setModel(selection);
          clearSessionErrorMessage();
        } catch (error) {
          reportSessionErrorMessage(
            error instanceof Error ? error.message : "Could not change Pi model.",
          );
        } finally {
          setIsUpdatingModel(false);
        }
      })();
    },
    [clearSessionErrorMessage, isTurnRunning, reportSessionErrorMessage, writer],
  );

  const activeComposerModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels,
        selectedModel: configSnapshot.model,
      }),
    [availableModels, configSnapshot.model],
  );

  const canChangeReasoningEffort =
    activeComposerModel !== null && (activeComposerModel.reasoningEffortOptions?.length ?? 0) > 1;

  const setReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      clearSessionErrorMessage();
      if (isTurnRunning) {
        reportSessionErrorMessage("Pi thinking level cannot be changed while Pi is working.");
        return;
      }

      let thinkingLevel: PiThinkingLevel;
      try {
        thinkingLevel = parsePiThinkingLevel(nextReasoningEffort);
      } catch (error) {
        reportSessionErrorMessage(
          error instanceof Error ? error.message : "Invalid Pi thinking level.",
        );
        return;
      }

      setIsUpdatingThinkingLevel(true);
      void (async (): Promise<void> => {
        try {
          await writer.setThinkingLevel(thinkingLevel);
          clearSessionErrorMessage();
        } catch (error) {
          reportSessionErrorMessage(
            error instanceof Error ? error.message : "Could not change Pi thinking level.",
          );
        } finally {
          setIsUpdatingThinkingLevel(false);
        }
      })();
    },
    [clearSessionErrorMessage, isTurnRunning, reportSessionErrorMessage, writer],
  );

  return {
    selectedModel: configSnapshot.model,
    selectedReasoningEffort: configSnapshot.modelReasoningEffort,
    hasExplicitModelSelection: configSnapshot.model !== null,
    modelOptions,
    reasoningEffortOptions: activeComposerModel?.reasoningEffortOptions ?? [],
    canChangeReasoningEffort,
    controlsDisabled: isUpdatingModel || isUpdatingThinkingLevel || isTurnRunning,
    isUpdating: isUpdatingModel || isUpdatingThinkingLevel,
    setModel,
    setReasoningEffort,
  };
}
