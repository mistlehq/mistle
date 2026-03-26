import type { Meta, StoryObj } from "@storybook/react-vite";

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
  title: "Dashboard/Chat/ChatComposer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    composerText: "",
    modelOptions: [
      { value: "gpt-5", label: "GPT-5" },
      { value: "gpt-5-mini", label: "GPT-5 Mini" },
      { value: "gpt-4.1", label: "GPT-4.1" },
    ],
    selectedModel: "gpt-5",
    selectedReasoningEffort: "medium",
    isConnected: true,
    isStartingTurn: false,
    isSteeringTurn: false,
    isInterruptingTurn: false,
    isUploadingAttachments: false,
    isUpdatingComposerConfig: false,
    canInterruptTurn: false,
    canSteerTurn: false,
    completedErrorMessage: null,
    onComposerTextChange: noopComposerTextChange,
    onModelChange: noopModelChange,
    onPendingImageFilesAdded: noopPendingImageFilesAdded,
    onReasoningEffortChange: noopReasoningEffortChange,
    onRemovePendingAttachment: noopRemovePendingAttachment,
    onSubmit: noop,
    pendingAttachments: [],
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
    canInterruptTurn: true,
    canSteerTurn: true,
  },
};

export const InterruptOnly: Story = {
  args: {
    composerText: "",
    canInterruptTurn: true,
    canSteerTurn: false,
  },
};

export const DisconnectedWithError: Story = {
  args: {
    isConnected: false,
    completedErrorMessage: "The session disconnected before the turn could be submitted.",
  },
};
