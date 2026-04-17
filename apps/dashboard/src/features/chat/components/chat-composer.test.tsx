// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatComposer } from "./chat-composer.js";

function createBaseComposerProps(): React.ComponentProps<typeof ChatComposer> {
  return {
    composerText: "Ship it",
    pendingAttachments: [],
    modelOptions: [{ value: "gpt-5.4-codex", label: "GPT-5.4" }],
    selectedModel: "gpt-5.4-codex",
    selectedReasoningEffort: "medium",
    isSubmitPending: false,
    submitMode: "start",
    submitLabel: "Send",
    submitDisabled: false,
    submitDisabledReason: null,
    canUploadAttachments: true,
    isUploadingAttachments: false,
    configControlsDisabled: false,
    onComposerTextChange: () => {},
    onSubmit: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPendingImageFilesAdded: () => {},
    onRemovePendingAttachment: () => {},
  };
}

describe("ChatComposer", () => {
  it("renders a Send action button when there is no active turn", () => {
    render(<ChatComposer {...createBaseComposerProps()} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("renders a spinner icon while a start-turn request is pending", () => {
    const { container } = render(
      <ChatComposer
        {...createBaseComposerProps()}
        isSubmitPending
        submitDisabled
        submitLabel="Sending..."
      />,
    );

    expect(screen.getByRole("button", { name: "Sending..." })).toBeTruthy();
    const spinnerIcon = container.querySelector("svg.animate-spin");
    expect(spinnerIcon).toBeTruthy();
  });

  it("disables send when turns are not submit-ready", () => {
    const baseProps = createBaseComposerProps();
    render(<ChatComposer {...baseProps} submitDisabled />);

    expect(screen.getByRole("button", { name: "Send" }).getAttribute("disabled")).not.toBeNull();
  });

  it("renders a Stop action button when an active turn has no steering text", () => {
    const baseProps = createBaseComposerProps();
    render(
      <ChatComposer {...baseProps} composerText="   " submitMode="interrupt" submitLabel="Stop" />,
    );

    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("renders a Steer action button when an active turn has steering text", () => {
    const baseProps = createBaseComposerProps();
    render(
      <ChatComposer
        {...baseProps}
        composerText="Focus on the failing test."
        submitMode="steer"
        submitLabel="Steer"
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

  it("renders the image attachment button with icon-only visible copy", () => {
    render(<ChatComposer {...createBaseComposerProps()} />);

    expect(screen.getByRole("button", { name: "Add images" }).textContent).toBe("");
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
    const baseProps = createBaseComposerProps();
    render(
      <ChatComposer
        {...baseProps}
        isUploadingAttachments
        submitDisabled
        submitLabel="Uploading..."
        pendingAttachments={[
          {
            id: "att_1",
            name: "design.png",
          },
        ]}
      />,
    );

    expect(screen.getByText("design.png")).toBeTruthy();
    expect(screen.queryByText("Uploading attachments...")).toBeNull();
  });
});
