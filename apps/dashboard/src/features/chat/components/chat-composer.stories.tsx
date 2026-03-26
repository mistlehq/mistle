import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureSessionComposerProps,
  CodexFixtureSessionComposerPropsForUnavailableModel,
  CodexFixtureSessionComposerPropsForNonImageCapableModel,
  CodexFixtureSessionComposerPropsUploadingImageAttachments,
  CodexFixtureSessionComposerPropsWithPendingImageAttachments,
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
  title: "Dashboard/Chat/ChatComposer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    ...CodexFixtureSessionComposerProps,
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

export const WithPendingImageAttachments: Story = {
  args: {
    ...CodexFixtureSessionComposerPropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    ...CodexFixtureSessionComposerPropsUploadingImageAttachments,
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    ...CodexFixtureSessionComposerPropsForNonImageCapableModel,
  },
};

export const UnavailableSelectedModelWithAttachments: Story = {
  args: {
    ...CodexFixtureSessionComposerPropsForUnavailableModel,
  },
};
