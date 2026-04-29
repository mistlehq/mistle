// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CodexSessionConfigState,
  SessionBootstrapResult,
} from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import { useSessionComposerConfigControl } from "./use-session-composer-config-control.js";

const DefaultModel: CodexModelSummary = {
  id: "model-default",
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  hidden: false,
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  supportsPersonality: true,
  isDefault: true,
};

const SparkModel: CodexModelSummary = {
  id: "model-spark",
  model: "gpt-5.3-codex-spark",
  displayName: "GPT-5.3 Codex Spark",
  hidden: false,
  defaultReasoningEffort: "high",
  inputModalities: ["text"],
  supportsPersonality: false,
  isDefault: false,
};

function createReadyBootstrap(input: {
  availableModels: readonly CodexModelSummary[];
  model: string | null;
  modelReasoningEffort: string | null;
}): SessionBootstrapResult {
  return {
    phase: { status: "ready" },
    establishedSnapshot: {
      availableModels: input.availableModels,
      configSnapshot: {
        model: input.model,
        modelReasoningEffort: input.modelReasoningEffort,
      },
    },
  };
}

function SessionComposerConfigControlHarness(input: {
  bootstrap: SessionBootstrapResult;
}): React.JSX.Element {
  const [lastWrite, setLastWrite] = useState("");
  const codexConfig: CodexSessionConfigState = {
    isWritingConfigValue: false,
    isBatchWritingConfig: false,
    writeConfigValue: (edit) => {
      setLastWrite(`${edit.keyPath}:${String(edit.value)}`);
    },
    batchWriteConfig: (batch) => {
      setLastWrite(batch.edits.map((edit) => `${edit.keyPath}:${String(edit.value)}`).join(","));
    },
  };
  const configControl = useSessionComposerConfigControl({
    bootstrap: input.bootstrap,
    clearSessionErrorMessage: () => {
      setLastWrite("");
    },
    codexConfig,
  });

  return (
    <div>
      <div data-testid="selected-model">{configControl.selectedModel ?? ""}</div>
      <div data-testid="selected-reasoning-effort">
        {configControl.selectedReasoningEffort ?? ""}
      </div>
      <div data-testid="last-write">{lastWrite}</div>
    </div>
  );
}

describe("useSessionComposerConfigControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the app-server default model and reasoning effort when config is unset", () => {
    render(
      <SessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.4");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("medium");
    expect(screen.getByTestId("last-write").textContent).toBe("");
  });

  it("uses the selected model's default reasoning effort when only the model is configured", () => {
    render(
      <SessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel, SparkModel],
          model: "gpt-5.3-codex-spark",
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("high");
  });

  it("keeps explicit config values ahead of app-server defaults", () => {
    render(
      <SessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel, SparkModel],
          model: "gpt-5.3-codex-spark",
          modelReasoningEffort: "low",
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("low");
  });
});
