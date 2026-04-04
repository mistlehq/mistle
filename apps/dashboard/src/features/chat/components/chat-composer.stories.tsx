import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  SessionComposerFixtureProps,
  SessionComposerFixturePropsUploadingImageAttachments,
  SessionComposerFixturePropsWithPendingImageAttachments,
  CodexFixtureSessionModelOptions,
} from "../../session-agents/codex/fixtures/session-fixtures.js";
import { ChatComposer } from "./chat-composer.js";
import {
  noop,
  noopComposerTextChange,
  noopModelChange,
  noopPendingImageFilesAdded,
  noopReasoningEffortChange,
  noopRemovePendingAttachment,
} from "./chat-story-support.js";

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
    onComposerTextChange: noopComposerTextChange,
    onModelChange: noopModelChange,
    onPendingImageFilesAdded: noopPendingImageFilesAdded,
    onReasoningEffortChange: noopReasoningEffortChange,
    onRemovePendingAttachment: noopRemovePendingAttachment,
    onSubmit: noop,
  },
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

export const DisconnectedWithError: Story = {
  args: {
    completedTurnErrorMessage: "The session disconnected before the turn could be submitted.",
    submitDisabled: true,
  },
};

export const WithPendingImageAttachments: Story = {
  args: {
    ...SessionComposerFixturePropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    ...SessionComposerFixturePropsUploadingImageAttachments,
  },
};
