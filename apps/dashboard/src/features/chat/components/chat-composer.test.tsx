// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatComposer } from "./chat-composer.js";

function createBaseComposerProps(): React.ComponentProps<typeof ChatComposer> {
  return {
    canInterruptTurn: false,
    canSteerTurn: false,
    completedErrorMessage: null,
    composerStatusMessage: null,
    composerText: "Ship it",
    isConnected: true,
    isInterruptingTurn: false,
    isStartingTurn: false,
    isSteeringTurn: false,
    isUpdatingComposerConfig: false,
    isUploadingAttachments: false,
    modelOptions: [{ value: "gpt-5.4-codex", label: "GPT-5.4" }],
    onComposerTextChange: () => {},
    onModelChange: () => {},
    onPendingImageFilesAdded: () => {},
    onReasoningEffortChange: () => {},
    onRemovePendingAttachment: () => {},
    onSubmit: () => {},
    pendingAttachments: [],
    selectedModel: "gpt-5.4-codex",
    selectedReasoningEffort: "medium",
  };
}

describe("ChatComposer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a Send action button when there is no active turn", () => {
    render(<ChatComposer {...createBaseComposerProps()} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("renders composer-local status messages above the composer", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerStatusMessage={{
          message:
            "Model GPT-5.3 Codex Spark is not image-capable. Images can remain attached, but the model will not inspect them.",
          tone: "warning",
        }}
      />,
    );

    expect(
      screen.getByText(
        "Model GPT-5.3 Codex Spark is not image-capable. Images can remain attached, but the model will not inspect them.",
      ),
    ).toBeTruthy();
  });

  it("renders a Stop action button when an active turn has no steering text", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        canInterruptTurn={true}
        canSteerTurn={true}
        composerText="   "
      />,
    );

    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("renders a Steer action button when an active turn has steering text", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        canInterruptTurn={true}
        canSteerTurn={true}
        composerText="Focus on the failing test."
      />,
    );

    expect(screen.getByRole("button", { name: "Steer" })).toBeTruthy();
  });

  it("renders model and reasoning switchers in the footer", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        modelOptions={[
          { value: "gpt-5.4-codex", label: "GPT-5.4" },
          { value: "gpt-5.3-codex", label: "GPT-5.3" },
        ]}
      />,
    );

    expect(screen.getAllByRole("combobox", { name: "Model switcher" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("combobox", { name: "Reasoning switcher" }).length).toBeGreaterThan(
      0,
    );
  });

  it("renders safely when model and reasoning selections are unset", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        selectedModel={null}
        selectedReasoningEffort={null}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Model switcher" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Reasoning switcher" })).toBeTruthy();
  });

  it("renders safely when the selected model is no longer in the available options", () => {
    render(<ChatComposer {...createBaseComposerProps()} selectedModel="gpt-5.3-codex" />);

    expect(screen.getByRole("combobox", { name: "Model switcher" })).toBeTruthy();
  });

  it("renders pending image attachments and upload progress", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        isUploadingAttachments={true}
        pendingAttachments={[
          {
            id: "att_1",
            name: "design.png",
          },
        ]}
      />,
    );

    expect(screen.getByText("design.png")).toBeTruthy();
    expect(screen.getByText("Uploading attachments...")).toBeTruthy();
  });
});
