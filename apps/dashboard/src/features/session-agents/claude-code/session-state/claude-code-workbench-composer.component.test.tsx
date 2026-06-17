// @vitest-environment jsdom

import type { ClaudeCodeSessionConfig } from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildReadyClaudeCodeComposerBootstrap,
  useClaudeCodeSessionComposerConfigControl,
  type ClaudeCodeConfigWriter,
} from "./claude-code-workbench-composer.js";

const ClaudeCodeConfigWithReasoningModels: ClaudeCodeSessionConfig = {
  availableCommands: [
    {
      name: "review",
      description: "Review current changes",
    },
  ],
  availableModels: [
    {
      model: "default",
      displayName: "Default",
      defaultReasoningEffort: null,
      reasoningEffortOptions: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
      inputModalities: ["text", "image"],
      isDefault: true,
    },
    {
      model: "sonnet",
      displayName: "Sonnet",
      defaultReasoningEffort: "high",
      reasoningEffortOptions: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
      inputModalities: ["text", "image"],
      isDefault: false,
    },
  ],
  model: "default",
  modelReasoningEffort: null,
};

function ClaudeCodeConfigControlHarness(): React.JSX.Element {
  const [lastWrite, setLastWrite] = useState("");
  const writer: ClaudeCodeConfigWriter = {
    refreshModelCatalog: async () => {
      setLastWrite("refresh");
    },
    setSessionConfig: async (input) => {
      setLastWrite(`${input.model}:${input.modelReasoningEffort ?? ""}`);
    },
  };
  const configControl = useClaudeCodeSessionComposerConfigControl({
    bootstrap: buildReadyClaudeCodeComposerBootstrap(ClaudeCodeConfigWithReasoningModels),
    clearSessionErrorMessage: () => {
      return;
    },
    isTurnRunning: false,
    reportSessionErrorMessage: (message) => {
      setLastWrite(`error:${message}`);
    },
    writer,
  });

  return (
    <div>
      <div data-testid="selected-model">{configControl.selectedModel ?? ""}</div>
      <div data-testid="selected-reasoning-effort">
        {configControl.selectedReasoningEffort ?? ""}
      </div>
      <div data-testid="last-write">{lastWrite}</div>
      <button
        type="button"
        onClick={() => {
          configControl.setModel("sonnet");
        }}
      >
        Select Sonnet
      </button>
    </div>
  );
}

describe("useClaudeCodeSessionComposerConfigControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps Claude Code reasoning effort unset until the user selects one", async () => {
    render(<ClaudeCodeConfigControlHarness />);

    expect(screen.getByTestId("selected-model").textContent).toBe("default");
    expect(screen.getByTestId("selected-reasoning-effort").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Select Sonnet" }));

    await waitFor(() => {
      expect(screen.getByTestId("last-write").textContent).toBe("sonnet:");
    });
  });
});

describe("buildReadyClaudeCodeComposerBootstrap", () => {
  it("includes runtime-provided Claude Code slash commands", () => {
    expect(
      buildReadyClaudeCodeComposerBootstrap(ClaudeCodeConfigWithReasoningModels)
        .composerCapabilities,
    ).toContainEqual({
      kind: "composerCommand",
      trigger: "/",
      source: "runtimeCommand",
      commands: [
        {
          id: "claude-code.slash.review",
          name: "review",
          description: "Review current changes",
          availability: {
            duringActiveTurn: "disabled",
          },
          submitAs: "typedRuntimeCommand",
        },
      ],
    });
  });
});
