// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CodexSessionConfigState,
  SessionBootstrapResult,
} from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import {
  useLocalSessionComposerConfigControl,
  useSessionComposerConfigControl,
} from "./use-session-composer-config-control.js";

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
      <div data-testid="has-explicit-model-selection">
        {configControl.hasExplicitModelSelection ? "true" : "false"}
      </div>
      <div data-testid="last-write">{lastWrite}</div>
    </div>
  );
}

function LocalSessionComposerConfigControlHarness(input: {
  bootstrap: SessionBootstrapResult;
  resetKey?: string | null;
}): React.JSX.Element {
  const configControl = useLocalSessionComposerConfigControl({
    bootstrap: input.bootstrap,
    clearSessionErrorMessage: () => {
      return;
    },
    ...(input.resetKey === undefined ? {} : { resetKey: input.resetKey }),
  });

  return (
    <div>
      <div data-testid="selected-model">{configControl.selectedModel ?? ""}</div>
      <div data-testid="selected-reasoning-effort">
        {configControl.selectedReasoningEffort ?? ""}
      </div>
      <div data-testid="has-explicit-model-selection">
        {configControl.hasExplicitModelSelection ? "true" : "false"}
      </div>
      <button
        type="button"
        onClick={() => {
          configControl.setModel("gpt-5.3-codex-spark");
        }}
      >
        Select Spark
      </button>
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
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("true");
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

  it("leaves local runtime model selection unset until the user or config chooses a model", () => {
    render(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("false");
  });

  it("ignores local runtime model selections that are missing from the current catalog", () => {
    const { rerender } = render(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Spark" }));
    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("true");

    rerender(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("false");
  });

  it("resets local runtime model selections when the reset key changes", async () => {
    const { rerender } = render(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
        resetKey="sbi_one:ses_one"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Spark" }));
    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("true");

    rerender(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
        resetKey="sbi_two:ses_two"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-model").textContent).toBe("");
    });
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("false");
  });
});
