import type { PiModel } from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { useCallback, useMemo, useState } from "react";

import { buildSessionComposerModelOptions } from "../../../pages/session-composer/session-composer-model-options.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerModel,
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
  setModel: (selection: PiModelSelection) => Promise<PiModel>;
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

export function modelsAreSamePiSelection(left: PiModelSelection, right: PiModelSelection): boolean {
  return left.provider === right.provider && left.modelId === right.modelId;
}

export function mapPiModelsToComposerModels(input: {
  activeModel: PiModel | null;
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
      inputModalities: model.input,
      isDefault:
        input.activeModel !== null &&
        modelsAreSamePiSelection(selection, {
          provider: input.activeModel.provider,
          modelId: input.activeModel.id,
        }),
    };
  });
}

export function buildReadyPiComposerBootstrap(input: {
  activeModel: PiModel | null;
  availableModels: readonly PiModel[];
}): SessionComposerBootstrapResult {
  return {
    phase: { status: "ready" },
    composerCapabilities: [],
    establishedSnapshot: {
      availableModels: mapPiModelsToComposerModels(input),
      configSnapshot: {
        model:
          input.activeModel === null
            ? null
            : buildPiModelSelectionValue({
                provider: input.activeModel.provider,
                modelId: input.activeModel.id,
              }),
        modelReasoningEffort: null,
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

  const modelOptions = useMemo(
    () => buildSessionComposerModelOptions(availableModels, true),
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

  const setReasoningEffort = useCallback((): void => {
    reportSessionErrorMessage("Pi thinking controls are not available in this composer.");
  }, [reportSessionErrorMessage]);

  return {
    selectedModel: configSnapshot.model,
    selectedReasoningEffort: null,
    hasExplicitModelSelection: configSnapshot.model !== null,
    modelOptions,
    canChangeReasoningEffort: false,
    isUpdating: isUpdatingModel || isTurnRunning,
    setModel,
    setReasoningEffort,
  };
}
