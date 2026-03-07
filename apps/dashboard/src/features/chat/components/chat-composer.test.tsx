// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatComposer } from "./chat-composer.js";

describe("ChatComposer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a Send action button when there is no active turn", () => {
    render(
      <ChatComposer
        canInterruptTurn={false}
        canSteerTurn={false}
        completedErrorMessage={null}
        composerText="Ship it"
        isConnected={true}
        isInterruptingTurn={false}
        isStartingTurn={false}
        isSteeringTurn={false}
        isUpdatingComposerConfig={false}
        modelOptions={[
          { value: "gpt-5.4-codex", label: "GPT-5.4" },
          { value: "gpt-5.3-codex", label: "GPT-5.3" },
        ]}
        onComposerTextChange={() => {}}
        onModelChange={() => {}}
        onReasoningEffortChange={() => {}}
        onSubmit={() => {}}
        selectedModel="gpt-5.4-codex"
        selectedReasoningEffort="medium"
      />,
    );

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("renders a Stop action button when an active turn has no steering text", () => {
    render(
      <ChatComposer
        canInterruptTurn={true}
        canSteerTurn={true}
        completedErrorMessage={null}
        composerText="   "
        isConnected={true}
        isInterruptingTurn={false}
        isStartingTurn={false}
        isSteeringTurn={false}
        isUpdatingComposerConfig={false}
        modelOptions={[{ value: "gpt-5.4-codex", label: "GPT-5.4" }]}
        onComposerTextChange={() => {}}
        onModelChange={() => {}}
        onReasoningEffortChange={() => {}}
        onSubmit={() => {}}
        selectedModel="gpt-5.4-codex"
        selectedReasoningEffort="medium"
      />,
    );

    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("renders a Steer action button when an active turn has steering text", () => {
    render(
      <ChatComposer
        canInterruptTurn={true}
        canSteerTurn={true}
        completedErrorMessage={null}
        composerText="Focus on the failing test."
        isConnected={true}
        isInterruptingTurn={false}
        isStartingTurn={false}
        isSteeringTurn={false}
        isUpdatingComposerConfig={false}
        modelOptions={[{ value: "gpt-5.4-codex", label: "GPT-5.4" }]}
        onComposerTextChange={() => {}}
        onModelChange={() => {}}
        onReasoningEffortChange={() => {}}
        onSubmit={() => {}}
        selectedModel="gpt-5.4-codex"
        selectedReasoningEffort="medium"
      />,
    );

    expect(screen.getByRole("button", { name: "Steer" })).toBeTruthy();
  });

  it("renders model and reasoning switchers in the footer", () => {
    render(
      <ChatComposer
        canInterruptTurn={false}
        canSteerTurn={false}
        completedErrorMessage={null}
        composerText="Ship it"
        isConnected={true}
        isInterruptingTurn={false}
        isStartingTurn={false}
        isSteeringTurn={false}
        isUpdatingComposerConfig={false}
        modelOptions={[
          { value: "gpt-5.4-codex", label: "GPT-5.4" },
          { value: "gpt-5.3-codex", label: "GPT-5.3" },
        ]}
        onComposerTextChange={() => {}}
        onModelChange={() => {}}
        onReasoningEffortChange={() => {}}
        onSubmit={() => {}}
        selectedModel="gpt-5.4-codex"
        selectedReasoningEffort="medium"
      />,
    );

    expect(screen.getAllByRole("combobox", { name: "Model switcher" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("combobox", { name: "Reasoning switcher" }).length).toBeGreaterThan(
      0,
    );
  });
});
