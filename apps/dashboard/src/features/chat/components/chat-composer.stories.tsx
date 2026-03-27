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
  title: "Dashboard/Chat/ChatComposer",
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
    composerUi: {
      ...SessionComposerFixtureProps.composerUi,
      action: {
        ...SessionComposerFixtureProps.composerUi.action,
        canInterruptTurn: true,
        canSteerTurn: true,
      },
    },
  },
};

export const InterruptOnly: Story = {
  args: {
    composerText: "",
    composerUi: {
      ...SessionComposerFixtureProps.composerUi,
      action: {
        ...SessionComposerFixtureProps.composerUi.action,
        canInterruptTurn: true,
        canSteerTurn: false,
      },
    },
  },
};

export const DisconnectedWithError: Story = {
  args: {
    composerUi: {
      ...SessionComposerFixtureProps.composerUi,
      completedErrorMessage: "The session disconnected before the turn could be submitted.",
      isConnected: false,
    },
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
