import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  SessionComposerFixtureProps,
  SessionComposerFixturePropsWithPendingDiffComments,
  SessionComposerFixturePropsWithPendingImageAttachments,
  CodexFixtureSessionModelOptions,
} from "../../session-agents/codex/fixtures/session-fixtures.js";
import { ChatComposer } from "./chat-composer.js";
import { noop } from "./chat-story-support.js";

type ShortcutPreviewPlatform = "linux" | "macos" | "windows";
type ChatComposerStoryArgs = React.ComponentProps<typeof ChatComposer> & {
  shortcutPreviewPlatform: ShortcutPreviewPlatform;
};

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
  const [pendingDiffCommentSummary, setPendingDiffCommentSummary] = useState(
    props.pendingDiffCommentSummary,
  );
  const [pendingAttachments, setPendingAttachments] = useState(props.pendingAttachments);

  return (
    <ChatComposer
      {...props}
      composerText={composerText}
      onComposerTextChange={setComposerText}
      onModelChange={setSelectedModel}
      onPendingImageFilesAdded={(files) => {
        setPendingAttachments((currentAttachments) => [
          ...currentAttachments,
          ...files.map((file, index) => ({
            id: `${file.name}-${currentAttachments.length + index}`,
            name: file.name,
          })),
        ]);
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
  );
}

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

export const SteeringTurn: Story = {
  args: {
    composerText: "Focus only on Storybook asset ownership.",
    submitMode: "steer",
    submitLabel: "Steer",
  },
};

export const WithGitBranch: Story = {
  args: {
    composerText: "Summarize the current dashboard regression.",
    gitBranchLabel: "feature/show-session-branch",
  },
};

export const WithGitBranchAndPullRequest: Story = {
  args: {
    composerText: "Summarize the current dashboard regression.",
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

export const WithPendingImageAttachments: Story = {
  args: {
    ...SessionComposerFixturePropsWithPendingImageAttachments,
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
