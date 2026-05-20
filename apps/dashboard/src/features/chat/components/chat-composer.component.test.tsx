// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChatComposer } from "./chat-composer.js";

const ComposerCommandCapabilityFixture: React.ComponentProps<
  typeof ChatComposer
>["composerCapabilities"][number] = {
  kind: "composerCommand",
  trigger: "/",
  source: "runtimeCommand",
  commands: [
    {
      id: "codex.review",
      name: "review",
      description: "Review the current changes",
      submitAs: "inlineText",
    },
    {
      id: "codex.explain",
      name: "explain",
      description: "Explain the selected code",
      submitAs: "inlineText",
    },
    {
      id: "codex.rewrite",
      name: "rewrite",
      description: "Rewrite with constraints",
      submitAs: "inlineText",
    },
    {
      id: "codex.plan",
      name: "plan",
      description: "Plan before making changes",
      submitAs: "inlineText",
    },
    {
      id: "codex.goal",
      name: "goal",
      description: "Set or update the current goal",
      submitAs: "inlineText",
    },
    {
      id: "codex.compact",
      name: "compact",
      description: "Compact the current context",
      submitAs: "runtimeCommand",
    },
  ],
};

function createBaseComposerProps(): React.ComponentProps<typeof ChatComposer> {
  return {
    composerCapabilities: [],
    composerText: "Ship it",
    gitBranchLabel: null,
    pullRequest: null,
    contextUsage: null,
    pendingDiffCommentSummary: null,
    pendingAttachments: [],
    modelOptions: [{ value: "gpt-5.4-codex", label: "GPT-5.4" }],
    reasoningEffortOptions: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ],
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
    onRuntimeCommandSubmit: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPendingFilesAdded: () => {},
    onClearPendingDiffComments: () => {},
    onRemovePendingAttachment: () => {},
  };
}

function ControlledChatComposer(
  input: Partial<React.ComponentProps<typeof ChatComposer>>,
): React.JSX.Element {
  const [composerText, setComposerText] = useState(input.composerText ?? "");

  return (
    <ChatComposer
      {...createBaseComposerProps()}
      {...input}
      composerText={composerText}
      onComposerTextChange={setComposerText}
    />
  );
}

function getComposerTextarea(): HTMLTextAreaElement {
  const textbox = screen.getByRole("textbox");
  if (!(textbox instanceof HTMLTextAreaElement)) {
    throw new Error("Expected composer textbox to be a textarea.");
  }

  return textbox;
}

describe("ChatComposer", () => {
  it("renders a Send action button when there is no active turn", () => {
    render(<ChatComposer {...createBaseComposerProps()} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("keeps the composer textarea at an iOS-safe mobile font size", () => {
    render(<ChatComposer {...createBaseComposerProps()} />);

    const composer = screen.getByPlaceholderText("Ask anything");

    expect(composer.className).toContain("text-base");
    expect(composer.className).toContain("md:text-sm");
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

  it("hides model and reasoning controls when the composer does not own runtime config", () => {
    render(<ChatComposer {...createBaseComposerProps()} showConfigControls={false} />);

    expect(screen.queryByRole("combobox", { name: "Model switcher" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Reasoning switcher" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("renders the file attachment button with icon-only visible copy", () => {
    const { container } = render(<ChatComposer {...createBaseComposerProps()} />);

    expect(screen.getByRole("button", { name: "Add files" }).textContent).toBe("");
    expect(container.querySelector('input[type="file"]')?.getAttribute("accept")).toBeNull();
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

  it("renders pending attachments and upload progress", () => {
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

  it("renders a single removable badge for pending diff comments", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        pendingDiffCommentSummary={{
          count: 3,
          label: "3 comments",
          title: "apps/dashboard/src/features/pages/session-workbench-page.tsx R10",
        }}
      />,
    );

    expect(screen.getByText("3 comments")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove all 3 comments" })).toBeTruthy();
  });

  it("renders the current git branch when provided", () => {
    render(<ChatComposer {...createBaseComposerProps()} gitBranchLabel="feature/show-branch" />);

    expect(screen.getByText("feature/show-branch")).toBeTruthy();
  });

  it("renders the current pull request beside the branch when provided", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        gitBranchLabel="feature/show-branch"
        pullRequest={{
          isDraft: false,
          number: 142,
          state: "OPEN",
          title: "Show pull request status in composer",
          url: "https://github.com/mistlehq/mistle/pull/142",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "PR #142" })).toBeTruthy();
  });

  it("renders context usage beside repository status when provided", () => {
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        contextUsage={{
          label: "Context 82% left",
          title: "42,000 used of 200,000 window",
        }}
      />,
    );

    expect(screen.getByText("Context 82% left")).toBeTruthy();
  });

  it("renders Plan mode status and lets the user switch back to Default", () => {
    let switchedToDefault = false;
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        collaborationModeStatus={{
          label: "Plan mode",
          title: "Codex will plan before implementation.",
          onSwitchToDefault: () => {
            switchedToDefault = true;
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));

    expect(switchedToDefault).toBe(true);
  });

  it("renders a choice command panel", () => {
    const selectedChoices: string[] = [];
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        commandPanel={{
          kind: "choice",
          title: "Implement this plan?",
          choices: [
            {
              label: "Clear context and implement",
              onSelect: () => {
                selectedChoices.push("clear");
              },
              variant: "secondary",
            },
            {
              label: "Dismiss",
              onSelect: () => {
                selectedChoices.push("dismiss");
              },
              variant: "ghost",
            },
            {
              label: "Implement",
              onSelect: () => {
                selectedChoices.push("implement");
              },
              variant: "default",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss" }));

    expect(screen.getByText("Implement this plan?")).toBeTruthy();
    expect(
      screen.getByText("Implement this plan?").compareDocumentPosition(getComposerTextarea()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Implement" })
        .compareDocumentPosition(screen.getByRole("button", { name: "More actions" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(selectedChoices).toEqual(["dismiss"]);
  });

  it("accepts dropped files on the git branch footer row", () => {
    const droppedFiles: File[][] = [];
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        gitBranchLabel="feature/show-branch"
        onPendingFilesAdded={(files) => {
          droppedFiles.push([...files]);
        }}
      />,
    );

    const imageFile = new File(["image-bytes"], "branch-footer-drop.png", { type: "image/png" });
    fireEvent.drop(screen.getByText("feature/show-branch"), {
      dataTransfer: {
        files: [imageFile],
      },
    });

    expect(droppedFiles).toHaveLength(1);
    expect(droppedFiles[0]?.[0]?.name).toBe("branch-footer-drop.png");
  });

  it("clears the pending diff comment badge when the remove action is pressed", () => {
    function Harness(): React.JSX.Element {
      const [pendingDiffCommentSummary, setPendingDiffCommentSummary] = useState<{
        count: number;
        label: string;
        title: string;
      } | null>({
        count: 3,
        label: "3 comments",
        title: "apps/dashboard/src/features/pages/session-workbench-page.tsx R10",
      });

      return (
        <ChatComposer
          {...createBaseComposerProps()}
          onClearPendingDiffComments={() => {
            setPendingDiffCommentSummary(null);
          }}
          pendingDiffCommentSummary={pendingDiffCommentSummary}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Remove all 3 comments" }));

    expect(screen.queryByText("3 comments")).toBeNull();
  });

  it("routes Cmd/Ctrl+Enter to the secondary submit action when provided", () => {
    let submitCount = 0;
    let secondarySubmitCount = 0;

    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerText="Queue this for later."
        keyboardShortcuts={[
          { action: "Steer", shortcut: "enter" },
          { action: "Queue", shortcut: "mod-enter" },
        ]}
        onSecondarySubmit={() => {
          secondarySubmitCount += 1;
        }}
        onSubmit={() => {
          submitCount += 1;
        }}
        secondarySubmitDisabled={false}
        submitMode="steer"
        submitLabel="Steer"
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      metaKey: true,
    });

    expect(secondarySubmitCount).toBe(1);
    expect(submitCount).toBe(0);
  });

  it("shows slash command suggestions from runtime composer capabilities", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/re"
      />,
    );

    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "/review Review the current changes" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "/rewrite Rewrite with constraints" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "/explain Explain the selected code" })).toBeNull();
  });

  it("shows no-results slash command state without blocking normal submit", () => {
    let submitCount = 0;

    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/zz"
        onSubmit={() => {
          submitCount += 1;
        }}
      />,
    );

    expect(screen.getByText("No commands")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(submitCount).toBe(1);
  });

  it("inserts the active slash command with keyboard selection", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/"
      />,
    );

    const composer = getComposerTextarea();
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(composer.value).toBe("/explain ");
  });

  it("inserts a slash command with mouse selection", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/re"
      />,
    );

    fireEvent.mouseDown(screen.getByRole("option", { name: "/rewrite Rewrite with constraints" }));

    expect(getComposerTextarea().value).toBe("/rewrite ");
  });

  it("executes a runtime slash command with keyboard selection", () => {
    const submittedRuntimeCommands: string[] = [];
    let submitCount = 0;

    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/comp"
        onRuntimeCommandSubmit={(commandId) => {
          submittedRuntimeCommands.push(commandId);
        }}
        onSubmit={() => {
          submitCount += 1;
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(submittedRuntimeCommands).toEqual(["codex.compact"]);
    expect(submitCount).toBe(0);
  });

  it("submits manually typed slash text with arguments as ordinary prompt text", () => {
    let submitCount = 0;

    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/does-not-exist do something"
        onSubmit={() => {
          submitCount += 1;
        }}
      />,
    );

    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(submitCount).toBe(1);
  });

  it("submits a known slash command with arguments as ordinary prompt text when no suggestion is selected", () => {
    const submittedRuntimeCommands: string[] = [];
    let submitCount = 0;

    render(
      <ChatComposer
        {...createBaseComposerProps()}
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="/compact now"
        onRuntimeCommandSubmit={(commandId) => {
          submittedRuntimeCommands.push(commandId);
        }}
        onSubmit={() => {
          submitCount += 1;
        }}
      />,
    );

    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(submittedRuntimeCommands).toEqual([]);
    expect(submitCount).toBe(1);
  });
});
