import type {
  ClaudeCodeModelSummary,
  ClaudeCodeSessionConfig,
} from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";
import { useCallback, useMemo, useState } from "react";

import { buildSessionComposerModelOptions } from "../../../pages/session-composer/session-composer-model-options.js";
import { resolveActiveComposerModel } from "../../../pages/session-composer/session-composer-model-readiness.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerModel,
} from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import type { SessionComposerConfigControl } from "../../../pages/session-composer/use-session-composer-config-control.js";

export type ClaudeCodeConfigWriter = {
  refreshModelCatalog: () => Promise<void>;
  setSessionConfig: (input: {
    model: string;
    modelReasoningEffort: string | null;
  }) => Promise<void>;
};

function mapClaudeCodeModelToComposerModel(model: ClaudeCodeModelSummary): SessionComposerModel {
  return {
    model: model.model,
    displayName: model.displayName,
    defaultReasoningEffort: model.defaultReasoningEffort,
    reasoningEffortOptions: model.reasoningEffortOptions,
    inputModalities: model.inputModalities,
    isDefault: model.isDefault,
  };
}

export function buildReadyClaudeCodeComposerBootstrap(
  config: ClaudeCodeSessionConfig,
): SessionComposerBootstrapResult {
  return {
    phase: { status: "ready" },
    composerCapabilities: [
      {
        kind: "contextMention",
        trigger: "@",
        source: "workspacePath",
        insertAs: "relativePathText",
        submitAs: "inlineText",
      },
    ],
    establishedSnapshot: {
      availableModels: config.availableModels.map(mapClaudeCodeModelToComposerModel),
      configSnapshot: {
        model: config.model,
        modelReasoningEffort: config.modelReasoningEffort,
      },
    },
  };
}

export function useClaudeCodeSessionComposerConfigControl(input: {
  bootstrap: SessionComposerBootstrapResult;
  clearSessionErrorMessage: () => void;
  isTurnRunning: boolean;
  reportSessionErrorMessage: (message: string) => void;
  writer: ClaudeCodeConfigWriter;
}): SessionComposerConfigControl {
  const { bootstrap, clearSessionErrorMessage, isTurnRunning, reportSessionErrorMessage, writer } =
    input;
  const { availableModels, configSnapshot } = bootstrap.establishedSnapshot;
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels,
        selectedModel: configSnapshot.model,
      })?.model ?? null,
    [availableModels, configSnapshot.model],
  );

  const activeComposerModel = useMemo(
    () =>
      resolveActiveComposerModel({
        availableModels,
        selectedModel,
      }),
    [availableModels, selectedModel],
  );

  const reasoningEffortOptions = activeComposerModel?.reasoningEffortOptions ?? [];
  const selectedReasoningEffort =
    configSnapshot.modelReasoningEffort !== null &&
    reasoningEffortOptions.some((option) => option.value === configSnapshot.modelReasoningEffort)
      ? configSnapshot.modelReasoningEffort
      : null;

  const modelOptions = useMemo(
    () => buildSessionComposerModelOptions(availableModels, false),
    [availableModels],
  );

  const writeConfig = useCallback(
    (nextConfig: { model: string; modelReasoningEffort: string | null }): void => {
      clearSessionErrorMessage();
      if (isTurnRunning) {
        reportSessionErrorMessage(
          "Claude Code model settings cannot be changed while Claude Code is working.",
        );
        return;
      }

      setIsUpdating(true);
      void writer
        .setSessionConfig(nextConfig)
        .then(clearSessionErrorMessage)
        .catch((error: unknown) => {
          reportSessionErrorMessage(
            error instanceof Error ? error.message : "Could not change Claude Code model settings.",
          );
        })
        .finally(() => {
          setIsUpdating(false);
        });
    },
    [clearSessionErrorMessage, isTurnRunning, reportSessionErrorMessage, writer],
  );

  const refreshModelOptions = useCallback((): void => {
    clearSessionErrorMessage();
    void writer
      .refreshModelCatalog()
      .then(clearSessionErrorMessage)
      .catch((error: unknown) => {
        reportSessionErrorMessage(
          error instanceof Error ? error.message : "Could not load Claude Code models.",
        );
      });
  }, [clearSessionErrorMessage, reportSessionErrorMessage, writer]);

  const setModel = useCallback(
    (nextModel: string): void => {
      const nextComposerModel =
        availableModels.find((model) => model.model === nextModel) ?? activeComposerModel;
      const nextReasoningEffortOptions = nextComposerModel?.reasoningEffortOptions ?? [];
      const nextReasoningEffort = nextReasoningEffortOptions.some(
        (option) => option.value === selectedReasoningEffort,
      )
        ? selectedReasoningEffort
        : null;

      writeConfig({
        model: nextModel,
        modelReasoningEffort: nextReasoningEffort,
      });
    },
    [activeComposerModel, availableModels, selectedReasoningEffort, writeConfig],
  );

  const setReasoningEffort = useCallback(
    (nextReasoningEffort: string): void => {
      if (selectedModel === null) {
        reportSessionErrorMessage("Choose a Claude Code model before setting effort.");
        return;
      }

      writeConfig({
        model: selectedModel,
        modelReasoningEffort: nextReasoningEffort,
      });
    },
    [reportSessionErrorMessage, selectedModel, writeConfig],
  );

  return {
    selectedModel,
    selectedReasoningEffort,
    hasExplicitModelSelection: configSnapshot.model !== null && selectedModel !== null,
    modelOptions,
    reasoningEffortOptions,
    canChangeReasoningEffort: reasoningEffortOptions.length > 0,
    controlsDisabled: isUpdating || isTurnRunning,
    isUpdating,
    refreshModelOptions,
    setModel,
    setReasoningEffort,
  };
}
