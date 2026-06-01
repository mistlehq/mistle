// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
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
      availability: {
        duringActiveTurn: "disabled",
      },
      submitAs: "typedRuntimeCommand",
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

const ContextMentionCapabilityFixture: React.ComponentProps<
  typeof ChatComposer
>["composerCapabilities"][number] = {
  kind: "contextMention",
  trigger: "@",
  source: "workspacePath",
  insertAs: "relativePathText",
  submitAs: "inlineText",
};

const SkillMentionCapabilityFixture: React.ComponentProps<
  typeof ChatComposer
>["composerCapabilities"][number] = {
  kind: "skillMention",
  trigger: "$",
  source: "runtimeSkill",
  submitAs: "inlineText",
  skills: [
    {
      name: "grill-with-docs",
      description: "Stress test a plan against docs",
    },
    {
      name: "write-a-skill",
      description: "Create a reusable skill",
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

  it("renders a searchable command panel picker with keyboard selection", () => {
    const selectedChoices: string[] = [];
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        commandPanel={{
          kind: "picker",
          title: "Review target",
          searchPlaceholder: "Search",
          onCancel: () => {
            selectedChoices.push("cancel");
          },
          options: [
            {
              label: "Review against a base branch (PR Style)",
              onSelect: () => {
                selectedChoices.push("branch");
              },
            },
            {
              label: "Review uncommitted changes",
              onSelect: () => {
                selectedChoices.push("uncommitted");
              },
            },
          ],
        }}
      />,
    );

    const searchInput = screen.getByRole("textbox", { name: "Review target search" });
    fireEvent.change(searchInput, { target: { value: "branch" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(screen.queryByRole("option", { name: "Review uncommitted changes" })).toBeNull();
    expect(
      screen.getByRole("option", { name: "Review against a base branch (PR Style)" }),
    ).toBeTruthy();
    expect(selectedChoices).toEqual(["branch"]);
  });

  it("cancels a command panel picker with Escape", () => {
    const selectedChoices: string[] = [];
    render(
      <ChatComposer
        {...createBaseComposerProps()}
        commandPanel={{
          kind: "picker",
          title: "Review target",
          searchPlaceholder: "Search",
          onCancel: () => {
            selectedChoices.push("cancel");
          },
          options: [
            {
              label: "Review uncommitted changes",
              onSelect: () => {
                selectedChoices.push("uncommitted");
              },
            },
          ],
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Review target search" }), {
      key: "Escape",
    });

    expect(selectedChoices).toEqual(["cancel"]);
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

  it("shows inline slash commands away from the composer start without start-only commands", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture]}
        composerText="Use /re"
      />,
    );

    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "/review Review the current changes" })).toBeNull();
    expect(screen.getByRole("option", { name: "/rewrite Rewrite with constraints" })).toBeTruthy();
  });

  it("groups commands before skills in the slash palette", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture, SkillMentionCapabilityFixture]}
        composerText="/"
      />,
    );

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([
      "/reviewReview the current changes",
      "/explainExplain the selected code",
      "/rewriteRewrite with constraints",
      "/planPlan before making changes",
      "/goalSet or update the current goal",
      "/compactCompact the current context",
      "$grill-with-docsStress test a plan against docs",
      "$write-a-skillCreate a reusable skill",
    ]);
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

  it("inserts slash-discovered skills using Codex skill mention syntax", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture, SkillMentionCapabilityFixture]}
        composerText="Use /gr"
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "$grill-with-docs Stress test a plan against docs",
      }),
    );

    expect(getComposerTextarea().value).toBe("Use $grill-with-docs ");
  });

  it("shows skill suggestions from runtime skill mention capabilities", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[SkillMentionCapabilityFixture]}
        composerText="Use $gr"
      />,
    );

    expect(screen.getByRole("listbox", { name: "Skills" })).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: "$grill-with-docs Stress test a plan against docs",
      }),
    ).toBeTruthy();
  });

  it("inserts selected skill suggestions as editable prompt text", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[SkillMentionCapabilityFixture]}
        composerText="Use $gr"
      />,
    );

    fireEvent.keyDown(getComposerTextarea(), { key: "Enter" });

    expect(getComposerTextarea().value).toBe("Use $grill-with-docs ");
  });

  it("does not reuse slash palette selection when opening the skill menu", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ComposerCommandCapabilityFixture, SkillMentionCapabilityFixture]}
        composerText="/"
      />,
    );

    fireEvent.keyDown(getComposerTextarea(), { key: "ArrowDown" });
    fireEvent.change(getComposerTextarea(), {
      target: {
        value: "Use $",
        selectionStart: 5,
        selectionEnd: 5,
      },
    });
    fireEvent.keyDown(getComposerTextarea(), { key: "Enter" });

    expect(getComposerTextarea().value).toBe("Use $grill-with-docs ");
  });

  it("shows context mention file search results for inline @ queries", () => {
    const observedQueries: string[] = [];

    render(
      <ControlledChatComposer
        composerCapabilities={[ContextMentionCapabilityFixture]}
        composerText="review @src"
        contextMentionControl={{
          status: "ready",
          results: [
            { kind: "directory", path: "src/features" },
            { kind: "file", path: "src/index.ts" },
          ],
          onQueryChange: (query) => {
            observedQueries.push(query);
          },
          onSelect: () => {},
          onDismiss: () => {},
        }}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Search files" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "src/features" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "src/index.ts" })).toBeTruthy();
    expect(observedQueries).toEqual(["src"]);
  });

  it("does not repeat context mention queries when result state changes", () => {
    const observedQueries: string[] = [];

    function ResultChangingComposer(): React.JSX.Element {
      const [results, setResults] = useState([{ kind: "file" as const, path: "src/alpha.ts" }]);
      const recordQuery = useCallback((query: string): void => {
        observedQueries.push(query);
      }, []);
      const ignoreContextMentionEvent = useCallback((): void => {
        return;
      }, []);

      return (
        <>
          <ControlledChatComposer
            composerCapabilities={[ContextMentionCapabilityFixture]}
            composerText="@src"
            contextMentionControl={{
              status: "ready",
              results,
              onQueryChange: recordQuery,
              onSelect: ignoreContextMentionEvent,
              onDismiss: ignoreContextMentionEvent,
            }}
          />
          <button
            onClick={() => {
              setResults([{ kind: "file", path: "src/beta.ts" }]);
            }}
            type="button"
          >
            Replace results
          </button>
        </>
      );
    }

    render(<ResultChangingComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Replace results" }));

    expect(observedQueries).toEqual(["src"]);
  });

  it("inserts selected context mention results as editable prompt text", () => {
    const selectedPaths: string[] = [];

    render(
      <ControlledChatComposer
        composerCapabilities={[ContextMentionCapabilityFixture]}
        composerText="/review @src"
        contextMentionControl={{
          status: "ready",
          results: [
            { kind: "file", path: "src/index.ts" },
            { kind: "file", path: "src/file with space.ts" },
          ],
          onQueryChange: () => {},
          onSelect: (input) => {
            selectedPaths.push(input.path);
          },
          onDismiss: () => {},
        }}
      />,
    );

    const composer = getComposerTextarea();
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(composer.value).toBe('/review "src/file with space.ts" ');
    expect(selectedPaths).toEqual(["src/file with space.ts"]);
  });

  it("keeps keyboard-selected context mention results scrolled into view", () => {
    const scrolledElementIds: string[] = [];
    const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element): void {
        if (this.id.length > 0) {
          scrolledElementIds.push(this.id);
        }
      },
    });

    try {
      render(
        <ControlledChatComposer
          composerCapabilities={[ContextMentionCapabilityFixture]}
          composerText="@src"
          contextMentionControl={{
            status: "ready",
            results: [
              { kind: "file", path: "src/alpha.ts" },
              { kind: "file", path: "src/beta.ts" },
              { kind: "file", path: "src/gamma.ts" },
            ],
            onQueryChange: () => {},
            onSelect: () => {},
            onDismiss: () => {},
          }}
        />,
      );

      fireEvent.keyDown(getComposerTextarea(), { key: "ArrowDown" });

      expect(scrolledElementIds.some((elementId) => elementId.endsWith("-1"))).toBe(true);
    } finally {
      if (originalScrollIntoViewDescriptor === undefined) {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      } else {
        Object.defineProperty(
          Element.prototype,
          "scrollIntoView",
          originalScrollIntoViewDescriptor,
        );
      }
    }
  });

  it("surfaces unavailable context mention file search", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ContextMentionCapabilityFixture]}
        composerText="@src"
        contextMentionControl={{
          status: "unavailable",
          results: [],
          onQueryChange: () => {},
          onSelect: () => {},
          onDismiss: () => {},
        }}
      />,
    );

    expect(screen.getByText("File search is unavailable")).toBeTruthy();
  });

  it("hides the active context mention menu when Escape is pressed", () => {
    render(
      <ControlledChatComposer
        composerCapabilities={[ContextMentionCapabilityFixture]}
        composerText="@src"
        contextMentionControl={{
          status: "ready",
          results: [{ kind: "file", path: "src/index.ts" }],
          onQueryChange: () => {},
          onSelect: () => {},
          onDismiss: () => {},
        }}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Search files" })).toBeTruthy();

    fireEvent.keyDown(getComposerTextarea(), { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Search files" })).toBeNull();
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
