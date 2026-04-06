import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import {
  SessionComposerFixtureProps,
  SessionComposerFixturePropsWithPendingImageAttachments,
  CodexFixtureSessionModelOptions,
} from "../../session-agents/codex/fixtures/session-fixtures.js";
import { ChatComposer } from "./chat-composer.js";
import { noop } from "./chat-story-support.js";

function InteractiveChatComposerStory(
  props: React.ComponentProps<typeof ChatComposer>,
): React.JSX.Element {
  const [composerText, setComposerText] = useState(props.composerText);
  const [selectedModel, setSelectedModel] = useState(props.selectedModel);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(
    props.selectedReasoningEffort,
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
      onRemovePendingAttachment={(attachmentId) => {
        setPendingAttachments((currentAttachments) =>
          currentAttachments.filter((attachment) => attachment.id !== attachmentId),
        );
      }}
      pendingAttachments={pendingAttachments}
      selectedModel={selectedModel}
      selectedReasoningEffort={selectedReasoningEffort}
    />
  );
}

const meta = {
  title: "Dashboard/Chat/Composer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    ...SessionComposerFixtureProps,
    modelOptions: CodexFixtureSessionModelOptions,
    onSubmit: noop,
  },
  render: (args) => <InteractiveChatComposerStory {...args} />,
} satisfies Meta<typeof ChatComposer>;

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
