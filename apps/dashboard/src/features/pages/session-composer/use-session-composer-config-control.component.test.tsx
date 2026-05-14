// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  SessionComposerBootstrapResult,
  SessionComposerModel,
} from "./session-composer-runtime-contracts.js";
import {
  useLocalSessionComposerConfigControl,
  usePersistedSessionComposerConfigControl,
  type SessionComposerConfigWriter,
} from "./use-session-composer-config-control.js";

const DefaultModel: SessionComposerModel = {
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  isDefault: true,
};

const SparkModel: SessionComposerModel = {
  model: "gpt-5.3-codex-spark",
  displayName: "GPT-5.3 Codex Spark",
  defaultReasoningEffort: "high",
  inputModalities: ["text"],
  isDefault: false,
};

function createReadyBootstrap(input: {
  availableModels: readonly SessionComposerModel[];
  model: string | null;
  modelReasoningEffort: string | null;
}): SessionComposerBootstrapResult {
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
  bootstrap: SessionComposerBootstrapResult;
}): React.JSX.Element {
  const [lastWrite, setLastWrite] = useState("");
  const writer: SessionComposerConfigWriter = {
    isUpdating: false,
    writeModel: (model) => {
      setLastWrite(`model:${model}`);
    },
    writeReasoningEffort: (reasoningEffort) => {
      setLastWrite(`model_reasoning_effort:${reasoningEffort}`);
    },
  };
  const configControl = usePersistedSessionComposerConfigControl({
    bootstrap: input.bootstrap,
    clearSessionErrorMessage: () => {
      setLastWrite("");
    },
    writer,
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
      <button
        type="button"
        onClick={() => {
          configControl.setModel("gpt-5.3-codex-spark");
        }}
      >
        Select Spark
      </button>
      <button
        type="button"
        onClick={() => {
          configControl.setReasoningEffort("low");
        }}
      >
        Set Low
      </button>
    </div>
  );
}

function LocalSessionComposerConfigControlHarness(input: {
  bootstrap: SessionComposerBootstrapResult;
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
      <div data-testid="model-options">
        {configControl.modelOptions.map((option) => option.label).join(",")}
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

describe("usePersistedSessionComposerConfigControl", () => {
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

  it("writes selected persisted runtime models through the composer writer", () => {
    render(
      <SessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel, SparkModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Spark" }));

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("last-write").textContent).toBe("model:gpt-5.3-codex-spark");
  });

  it("writes selected persisted runtime reasoning effort through the composer writer", () => {
    render(
      <SessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel, SparkModel],
          model: "gpt-5.3-codex-spark",
          modelReasoningEffort: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set Low" }));

    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("low");
    expect(screen.getByTestId("last-write").textContent).toBe("model_reasoning_effort:low");
  });

  it("uses the local runtime default model when config is unset", () => {
    render(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [SparkModel, DefaultModel],
          model: null,
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.4");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("medium");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("false");
    expect(screen.getByTestId("model-options").textContent).toBe(
      "GPT-5.3 Codex Spark,GPT-5.4 (default)",
    );
  });

  it("treats configured local runtime models as explicit selections", () => {
    render(
      <LocalSessionComposerConfigControlHarness
        bootstrap={createReadyBootstrap({
          availableModels: [DefaultModel, SparkModel],
          model: "gpt-5.3-codex-spark",
          modelReasoningEffort: null,
        })}
      />,
    );

    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.3-codex-spark");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("high");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("true");
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
      expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5.4");
    });
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("medium");
    expect(screen.getByTestId("has-explicit-model-selection").textContent).toBe("false");
  });
});
