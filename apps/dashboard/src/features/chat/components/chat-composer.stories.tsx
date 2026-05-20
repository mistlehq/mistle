import { CodexComposerCapabilities } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { mapOpenCodePromptCommandsToComposerCapabilities } from "@mistle/integrations-definitions/agent-runtimes/opencode/composer-capabilities";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  SessionComposerFixtureProps,
  SessionComposerFixturePropsWithPendingDiffComments,
  SessionComposerFixturePropsWithPendingAttachments,
  CodexFixtureSessionModelOptions,
} from "../../session-agents/codex/fixtures/session-fixtures.js";
import { ChatComposer, type ChatComposerCommandPanel } from "./chat-composer.js";
import { noop } from "./chat-story-support.js";

type ShortcutPreviewPlatform = "linux" | "macos" | "windows";
type ChatComposerStoryArgs = React.ComponentProps<typeof ChatComposer> & {
  shortcutPreviewPlatform: ShortcutPreviewPlatform;
};

const ReviewTargetPickerPanel: ChatComposerCommandPanel = {
  kind: "picker",
  title: "Review target",
  searchPlaceholder: "Search",
  emptyLabel: "No review targets found",
  onCancel: noop,
  options: [
    {
      label: "Review against a base branch (PR Style)",
      onSelect: noop,
    },
    {
      label: "Review uncommitted changes",
      onSelect: noop,
    },
    {
      label: "Review a commit",
      onSelect: noop,
    },
  ],
};

const ReviewBranchPickerPanel: ChatComposerCommandPanel = {
  kind: "picker",
  title: "Review against a base branch",
  searchPlaceholder: "Search branches",
  emptyLabel: "No matching branches",
  onCancel: noop,
  options: [
    {
      label: "Review against main",
      onSelect: noop,
    },
    {
      label: "Review against origin/main",
      onSelect: noop,
    },
    {
      label: "Review against release/2026-05",
      onSelect: noop,
    },
  ],
};

const ReviewCommitPickerPanel: ChatComposerCommandPanel = {
  kind: "picker",
  title: "Review commit",
  searchPlaceholder: "Search commits",
  emptyLabel: "No matching commits",
  onCancel: noop,
  options: [
    {
      label: "ad92f4a Add review command panel",
      onSelect: noop,
    },
    {
      label: "b8192cd Wire typed review command",
      onSelect: noop,
    },
    {
      label: "f3182e1 Document Codex review behavior",
      onSelect: noop,
    },
  ],
};

const OpenCodePromptCommandCapabilities = mapOpenCodePromptCommandsToComposerCapabilities([
  {
    name: "review",
    description: "review changes",
  },
  {
    name: "explain",
    description: "explain the selected code",
  },
  {
    name: "tests",
    description: "write targeted tests",
  },
]);

function detectShortcutPreviewPlatform(): ShortcutPreviewPlatform {
  if (typeof navigator === "undefined") {
    return "macos";
  }

  if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
    return "macos";
  }

  if (/Win/i.test(navigator.platform)) {
    return "windows";
  }

  return "linux";
}

function resolveStoryShortcutLabel(
  shortcut: string,
  shortcutPreviewPlatform: ShortcutPreviewPlatform,
): string {
  if (shortcut === "enter") {
    return "Enter";
  }

  if (shortcut === "mod-enter") {
    return shortcutPreviewPlatform === "macos" ? "⌘Enter" : "Ctrl+Enter";
  }

  return shortcut;
}

function PlatformAwareChatComposerStory(props: ChatComposerStoryArgs): React.JSX.Element {
  const { keyboardShortcuts, shortcutPreviewPlatform, ...chatComposerProps } = props;
  const resolvedKeyboardShortcuts =
    keyboardShortcuts === undefined
      ? {}
      : {
          keyboardShortcuts: keyboardShortcuts.map((shortcutHint) => ({
            ...shortcutHint,
            shortcut: resolveStoryShortcutLabel(shortcutHint.shortcut, shortcutPreviewPlatform),
          })),
        };

  return <InteractiveChatComposerStory {...chatComposerProps} {...resolvedKeyboardShortcuts} />;
}

function InteractiveChatComposerStory(
  props: React.ComponentProps<typeof ChatComposer>,
): React.JSX.Element {
  const [composerText, setComposerText] = useState(props.composerText);
  const [selectedModel, setSelectedModel] = useState(props.selectedModel);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(
    props.selectedReasoningEffort,
  );
  const [runtimeCommandStatus, setRuntimeCommandStatus] = useState<string | null>(null);
  const [pendingDiffCommentSummary, setPendingDiffCommentSummary] = useState(
    props.pendingDiffCommentSummary,
  );
  const [pendingAttachments, setPendingAttachments] = useState(props.pendingAttachments);

  return (
    <>
      <ChatComposer
        {...props}
        composerText={composerText}
        onComposerTextChange={setComposerText}
        onModelChange={setSelectedModel}
        onPendingFilesAdded={(files) => {
          setPendingAttachments((currentAttachments) => [
            ...currentAttachments,
            ...files.map((file, index) => ({
              id: `${file.name}-${currentAttachments.length + index}`,
              name: file.name,
            })),
          ]);
        }}
        onRuntimeCommandSubmit={(commandId) => {
          setRuntimeCommandStatus(`Executed ${commandId}`);
          setComposerText("");
        }}
        onReasoningEffortChange={setSelectedReasoningEffort}
        onClearPendingDiffComments={() => {
          setPendingDiffCommentSummary(null);
        }}
        onRemovePendingAttachment={(attachmentId) => {
          setPendingAttachments((currentAttachments) =>
            currentAttachments.filter((attachment) => attachment.id !== attachmentId),
          );
        }}
        pendingDiffCommentSummary={pendingDiffCommentSummary}
        pendingAttachments={pendingAttachments}
        selectedModel={selectedModel}
        selectedReasoningEffort={selectedReasoningEffort}
      />
      {runtimeCommandStatus === null ? null : (
        <div className="text-muted-foreground px-1.5 pt-2 text-sm">{runtimeCommandStatus}</div>
      )}
    </>
  );
}

/**
 * Use these stories to review the session composer across ordinary prompt entry,
 * slash command discovery, runtime command panels, attachments, and active-turn controls.
 */
const meta = {
  title: "Dashboard/Chat/Composer",
  component: PlatformAwareChatComposerStory,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    shortcutPreviewPlatform: {
      control: "inline-radio",
      options: ["macos", "windows", "linux"],
    },
  },
  args: {
    ...SessionComposerFixtureProps,
    modelOptions: CodexFixtureSessionModelOptions,
    onSubmit: noop,
    shortcutPreviewPlatform: detectShortcutPreviewPlatform(),
  },
  render: (args) => <PlatformAwareChatComposerStory {...args} />,
} satisfies Meta<typeof PlatformAwareChatComposerStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReadyToSend: Story = {
  args: {
    composerText: "Summarize the config drift and propose the next patch.",
  },
};

export const SlashCommandAutocomplete: Story = {
  args: {
    composerCapabilities: CodexComposerCapabilities,
    composerText: "/",
  },
  render: (args) => (
    <div className="flex min-h-[420px] items-end">
      <PlatformAwareChatComposerStory {...args} />
    </div>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "/review Review the current changes" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "/plan Plan before making changes" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "/goal Set or update the current goal" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "/compact Compact the current context" }),
    ).toBeVisible();
  },
};

export const SteeringTurn: Story = {
  args: {
    composerText: "Focus only on Storybook asset ownership.",
    submitMode: "steer",
    submitLabel: "Steer",
  },
};

export const WithRepositoryStatusAndContextUsage: Story = {
  args: {
    composerText: "Summarize the remaining implementation risk.",
    contextUsage: {
      label: "Context 82% left",
      title: "42,000 used of 200,000 window",
    },
    gitBranchLabel: "feature/show-session-branch",
    pullRequest: {
      isDraft: false,
      number: 142,
      state: "OPEN",
      title: "Show pull request status in the composer",
      url: "https://github.com/mistlehq/mistle/pull/142",
    },
  },
};

export const PlanModeActive: Story = {
  args: {
    collaborationModeStatus: {
      label: "Plan mode",
      title: "Codex is planning. Submissions stay in Plan mode until implementation starts.",
      onSwitchToDefault: noop,
    },
    composerText: "Audit the current implementation before changing code.",
    gitBranchLabel: "feature/codex-plan-command",
    pullRequest: {
      isDraft: true,
      number: 231,
      state: "OPEN",
      title: "Add Codex plan command",
      url: "https://github.com/mistlehq/mistle/pull/231",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Plan mode")).toBeVisible();
    await expect(canvas.getByText("PR #231 Draft")).toBeVisible();
  },
};

export const PlanImplementationConfirmation: Story = {
  args: {
    collaborationModeStatus: {
      label: "Plan mode",
      title: "Codex proposed a plan and is waiting for an implementation choice.",
      onSwitchToDefault: noop,
    },
    commandPanel: {
      kind: "choice",
      title: "Implement this plan?",
      choices: [
        {
          label: "Clear context and implement",
          onSelect: noop,
          variant: "secondary",
        },
        {
          label: "Dismiss",
          onSelect: noop,
          variant: "ghost",
        },
        {
          label: "Implement",
          onSelect: noop,
          variant: "default",
        },
      ],
    },
    composerText: "",
    gitBranchLabel: "feature/codex-plan-command",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Implement this plan?")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Implement" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "More actions" })).toBeVisible();
  },
};

export const ReviewTargetPicker: Story = {
  args: {
    commandPanel: ReviewTargetPickerPanel,
    composerCapabilities: CodexComposerCapabilities,
    composerText: "",
    gitBranchLabel: "handle-codex-review-command",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("textbox", { name: "Review target search" })).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "Review against a base branch (PR Style)" }),
    ).toBeVisible();
    await expect(canvas.getByRole("option", { name: "Review uncommitted changes" })).toBeVisible();
  },
};

export const ReviewBranchPicker: Story = {
  args: {
    commandPanel: ReviewBranchPickerPanel,
    composerCapabilities: CodexComposerCapabilities,
    composerText: "",
    gitBranchLabel: "handle-codex-review-command",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("textbox", { name: "Review against a base branch search" }),
    ).toBeVisible();
    await expect(canvas.getByRole("option", { name: "Review against main" })).toBeVisible();
  },
};

export const ReviewCommitPicker: Story = {
  args: {
    commandPanel: ReviewCommitPickerPanel,
    composerCapabilities: CodexComposerCapabilities,
    composerText: "",
    gitBranchLabel: "handle-codex-review-command",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("textbox", { name: "Review commit search" })).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "ad92f4a Add review command panel" }),
    ).toBeVisible();
  },
};

export const OpenCodeDefaultModel: Story = {
  args: {
    composerText: "Review the failing setup script and propose a minimal patch.",
    modelOptions: [
      {
        value: "openai/gpt-5.3-codex",
        label: "OpenAI / GPT-5.3 Codex (default)",
      },
      {
        value: "openai/gpt-5.3-codex-spark",
        label: "OpenAI / GPT-5.3 Codex Spark",
      },
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Anthropic / Claude Sonnet 4.5",
      },
    ],
    selectedModel: "openai/gpt-5.3-codex",
    selectedReasoningEffort: null,
    showReasoningControl: false,
  },
};

export const OpenCodePromptCommands: Story = {
  args: {
    composerCapabilities: OpenCodePromptCommandCapabilities,
    composerText: "/",
    modelOptions: [
      {
        value: "openai/gpt-5.3-codex",
        label: "OpenAI / GPT-5.3 Codex (default)",
      },
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Anthropic / Claude Sonnet 4.5",
      },
    ],
    selectedModel: "openai/gpt-5.3-codex",
    selectedReasoningEffort: null,
    showReasoningControl: false,
  },
  render: (args) => (
    <div className="flex min-h-[420px] items-end">
      <PlatformAwareChatComposerStory {...args} />
    </div>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
    await expect(canvas.getByRole("option", { name: "/review review changes" })).toBeVisible();
    await expect(
      canvas.getByRole("option", { name: "/explain explain the selected code" }),
    ).toBeVisible();
    await expect(canvas.getByRole("option", { name: "/tests write targeted tests" })).toBeVisible();
  },
};

export const SteeringTurnShortcutHover: Story = {
  args: {
    composerText: "Focus only on Storybook asset ownership.",
    keyboardShortcuts: [
      { action: "Steer", shortcut: "enter" },
      { action: "Queue", shortcut: "mod-enter" },
    ],
    onSecondarySubmit: noop,
    secondarySubmitDisabled: false,
    submitMode: "steer",
    submitLabel: "Steer",
  },
  parameters: {
    controls: {
      include: [
        "shortcutPreviewPlatform",
        "composerText",
        "submitMode",
        "submitLabel",
        "secondarySubmitDisabled",
      ],
    },
  },
  render: (args) => <PlatformAwareChatComposerStory {...args} />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const submitButton = canvas.getByRole("button", { name: "Steer" });

    await userEvent.hover(submitButton);

    await expect(canvas.getByText("Steer")).toBeVisible();
    await expect(canvas.getByText("Queue")).toBeVisible();
    await expect(canvas.getByText("Enter")).toBeVisible();
    await expect(canvas.getByText(/(⌘Enter|Ctrl\+Enter)/)).toBeVisible();
  },
};

export const InterruptOnly: Story = {
  args: {
    composerText: "",
    submitMode: "interrupt",
    submitLabel: "Stop",
  },
};

export const WithPendingAttachments: Story = {
  args: {
    ...SessionComposerFixturePropsWithPendingAttachments,
  },
};

export const WithPendingDiffComments: Story = {
  args: {
    ...SessionComposerFixturePropsWithPendingDiffComments,
  },
};

export const SendingPendingStart: Story = {
  args: {
    composerText: "Summarize the current regression risk.",
    isSubmitPending: true,
    submitDisabled: true,
    submitLabel: "Sending...",
  },
};
